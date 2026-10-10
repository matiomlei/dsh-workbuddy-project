/** WorkBuddy capability packages. Cataloguing never executes package content. */
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'

export const KINDS = { expert: 'experts', skill: 'skills', rule: 'rules', connector: 'connectors' }
export const FRONT = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
export const localized = (value) => typeof value === 'string' ? value : value?.zh ?? value?.['zh-CN'] ?? value?.en

export function readJson(path) {
  let data
  try { data = JSON.parse(readFileSync(path, 'utf8')) } catch (error) { throw new Error(`${path}: ${error.message}`) }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path}: JSON root must be an object`)
  return data
}

/** Resolve paths against the whole package, including assets beside agents/. */
export function packagePath(root, value, { missing = false } = {}) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.split('/').includes('..')) throw new Error('Package paths must remain relative to the package root')
  const path = resolve(root, value)
  const base = realpathSync(root)
  if (path !== resolve(root) && !path.startsWith(`${resolve(root)}${sep}`)) throw new Error('Package path escapes its root')
  if (missing && !existsSync(path)) return path
  const actual = realpathSync(path)
  if (actual !== base && !actual.startsWith(`${base}${sep}`)) throw new Error('Package symlink escapes its root')
  return actual
}

export function markdown(path) {
  const source = readFileSync(path, 'utf8'), front = FRONT.exec(source)
  const metadata=front?parseYaml(front[1]):{}
  if (metadata!==null && (typeof metadata!=='object'||Array.isArray(metadata))) throw new Error(`${path}: frontmatter must be a mapping`)
  return { metadata:metadata??{},text:(front?source.slice(front[0].length):source).trim() }
}

/** Hash every regular file; a partial digest must never become a version. */
export function packageFiles(root) {
  root = realpathSync(root)
  const out = [], seen = new Set()
  const walk = (directory) => {
    const actual = realpathSync(directory)
    if (seen.has(actual)) throw new Error(`${root}: cyclic package directory`)
    seen.add(actual)
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['.git', 'node_modules', '.DS_Store'].includes(entry.name)) continue
      const path = packagePath(root, relative(root, join(directory, entry.name)))
      if (lstatSync(join(directory, entry.name)).isSymbolicLink()) throw new Error(`${root}: package symlinks are not supported`)
      if (statSync(path).isDirectory()) walk(path)
      else if (statSync(path).isFile()) out.push({ path, relative: relative(root, path).split(sep).join('/'), bytes: statSync(path).size })
      if (out.length > 20000) throw new Error(`${root}: package exceeds 20000 files`)
    }
  }
  walk(root)
  return out
}

export function packageHash(root) {
  const hash = createHash('sha256')
  const files = packageFiles(root)
  for (const file of files) {
    const bytes=readFileSync(file.path)
    hash.update(`${Buffer.byteLength(file.relative)}:`).update(file.relative).update(`:${bytes.length}:`).update(bytes)
  }
  return { hash: hash.digest('hex'), files: files.length, truncated: false }
}

export function readPackage(path, kind, id) {
  let metadata = {}, entryFile, documentFile, text
  if (kind === 'expert') {
    documentFile = ['.codebuddy-plugin/plugin.json', '.workbuddy-plugin/plugin.json'].find(file => existsSync(join(path, file)))
    if (!documentFile) throw new Error(`${path}: expert package needs .codebuddy-plugin/plugin.json`)
    metadata = readJson(join(path, documentFile))
    const agents = Array.isArray(metadata.agents) ? metadata.agents : []
    entryFile = metadata.agentName ? `agents/${metadata.agentName}.md` : agents.length === 1 ? agents[0] : undefined
    if (!entryFile) throw new Error(`${path}: expert package must declare agentName or exactly one agent`)
    text = markdown(packagePath(path, entryFile)).text
  } else if (kind === 'connector') {
    const manifest = join(path, 'connector.json')
    const indexes=[join(path,'../../.codebuddy-connector/connectors.json'),join(path,'../.codebuddy-connector/connectors.json')]
    const index=indexes.find(file=>existsSync(file))
    const record=index?(readJson(index).connectors??[]).find(item=>item.id===id||item.source===id):undefined
    metadata = {...record,...(existsSync(manifest) ? readJson(manifest) : {})}
    const type = metadata.type ?? (existsSync(join(path, 'mcp.json')) ? 'mcp' : existsSync(join(path, 'cli.json')) ? 'cli' : undefined)
    if (!['mcp', 'cli'].includes(type)) throw new Error(`${path}: connector needs mcp.json or cli.json`)
    metadata = { ...metadata, type }
    documentFile = type === 'mcp' ? 'mcp.json' : 'cli.json'
    readJson(packagePath(path, documentFile))
  } else {
    documentFile = kind === 'skill' ? 'SKILL.md' : 'RULE.md'
    const doc = markdown(packagePath(path, documentFile))
    metadata = doc.metadata; text = doc.text
    const sidecar = join(path, '_skillhub_meta.json')
    if (kind === 'skill' && existsSync(sidecar)) metadata = { ...readJson(sidecar), ...metadata }
  }
  const icon = metadata.icon ?? metadata.avatar ?? metadata.iconSource ?? metadata.icon_url ?? ['_icon.png', '_icon.svg'].find(file => existsSync(join(path,file)))
  const bundle = { name: id ?? metadata.id ?? metadata.name, path, kind, metadata, documentFile, entryFile, text,
    displayName: localized(metadata.displayName) ?? localized(metadata.name) ?? id,
    description: localized(metadata.displayDescription) ?? metadata.description_zh ?? localized(metadata.description) ?? text?.split('\n').find(line => line && !line.startsWith('#')) ?? '',
    profession: localized(metadata.profession), version: metadata.version, icon, category: metadata.categoryId ?? metadata.category,
    expertType: kind === 'expert' ? metadata.expertType ?? 'agent' : undefined, connectorType: kind === 'connector' ? metadata.type : undefined }
  if (kind === 'connector' && bundle.connectorType === 'mcp') connectorServers(bundle)
  return bundle
}

/** Stop at package boundaries; nested references/SKILL.md are not extra skills. */
export function scanPackages(root, kind, source) {
  if (!existsSync(root)) return []
  const out = []
  const walk = (directory, prefix = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const path = join(directory,entry.name), id = `${prefix}${entry.name}`
      const candidate = kind === 'expert' ? ['.codebuddy-plugin/plugin.json','.workbuddy-plugin/plugin.json'].some(file=>existsSync(join(path,file)))
        : kind === 'connector' ? ['connector.json','mcp.json','cli.json'].some(file=>existsSync(join(path,file)))
        : existsSync(join(path,kind === 'skill' ? 'SKILL.md' : 'RULE.md'))
      if (candidate) {
        const reference = `${source}:${KINDS[kind]}/${id}`
        try { out.push({ ...readPackage(path,kind,id), reference }) }
        catch(error) { out.push({ name:id,path,kind,reference,error:error.message,displayName:id }) }
      } else if (kind === 'skill' && prefix === '') walk(path,`${id}/`)
    }
  }
  walk(root)
  return out
}

export function connectorServers(bundle) {
  if (bundle.connectorType !== 'mcp') return []
  const configuration = readJson(packagePath(bundle.path,'mcp.json'))
  if (!configuration.mcpServers || typeof configuration.mcpServers !== 'object' || Array.isArray(configuration.mcpServers)) throw new Error(`${bundle.path}: mcp.json must declare mcpServers`)
  return Object.entries(configuration.mcpServers).map(([name,input]) => {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error(`${bundle.path}: invalid server name ${name}`)
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${bundle.path}: invalid server configuration`)
    const type = input.type ?? (input.command ? 'stdio' : 'streamableHttp')
    const transport = ['streamableHttp','streamable-http','http'].includes(type) ? 'streamable-http' : type
    if (!['stdio','streamable-http'].includes(transport)) throw new Error(`${bundle.path}: connector transport ${type} is not supported`)
    const map = (value,field) => {
      if (value === undefined) return {}
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(x=>typeof x !== 'string')) throw new Error(`${bundle.path}: ${field} must be a string dictionary`)
      return value
    }
    const base = { name,transport,connector:bundle.reference, headers:map(input.headers,'headers'),env:map(input.env,'env'),timeout:input.timeout }
    if (transport === 'stdio') {
      if (typeof input.command !== 'string' || !input.command.trim() || (input.args !== undefined && (!Array.isArray(input.args) || input.args.some(x=>typeof x !== 'string')))) throw new Error(`${bundle.path}: stdio requires command and string args`)
      return { ...base,command:input.command,args:input.args??[],cwd:input.cwd ? packagePath(bundle.path,input.cwd) : bundle.path }
    }
    let url
    try { url = new URL(input.url) } catch { throw new Error(`${bundle.path}: connector URL is invalid`) }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${bundle.path}: use an HTTP URL without embedded credentials`)
    return { ...base,url:input.url }
  })
}

export function attachedSkills(bundle) {
  const declared = bundle.metadata.skills
  if (declared !== undefined && (!Array.isArray(declared) || declared.some(x=>typeof x !== 'string'))) throw new Error(`${bundle.path}: skills must be an array of package-relative paths`)
  if (declared) return declared.map(value => {
    const path = packagePath(bundle.path,value)
    if (!existsSync(join(path,'SKILL.md'))) throw new Error(`${bundle.path}: attached skill ${value} has no SKILL.md`)
    return path
  })
  const root = join(bundle.path,'skills')
  if (existsSync(join(root,'SKILL.md'))) return [root]
  return scanPackages(root,'skill','attached').filter(entry=>!entry.error).map(entry=>entry.path)
}
