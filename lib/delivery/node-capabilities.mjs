/** Read-only WorkBuddy library adapter. Snapshots go only into this prototype's cache. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { ContractError, canonical } from './template-store.mjs'

const fields = { expert: 'experts', skill: 'skills', rule: 'rules', connector: 'connectors' }
const fail = (code, detail = code) => { throw new ContractError(code, detail) }
export async function nodeCapabilities({ root, compilerRoot, libraries = [], roots, catalogSource }) {
  const load = file => import(pathToFileURL(join(compilerRoot, 'lib', file)))
  const [{ listCapabilities }, { normalizeLibraries, normalizeProject }, { snapshotProject }, compiler, { packageHash }] = await Promise.all([
    load('catalog.js'), load('project.js'), load('package-cache.js'), load('compile.js'), load('bundles.js'),
  ])
  const { compileProject, projectModel, personaSections, buildComposition } = compiler
  const libraryEntries = () => normalizeLibraries(typeof libraries === 'function' ? libraries() : libraries)
  const cacheRoot = join(resolve(root), 'node-capabilities/cache')
  mkdirSync(join(resolve(root), 'node-capabilities'), { recursive: true, mode: 0o700 })
  const catalog = () => (catalogSource ? catalogSource() : libraryEntries().flatMap(library => listCapabilities({ ...library, exists: true }))).map(item => ({
    reference: item.reference, kind: item.kind, name: item.displayName ?? item.name,
    hash: item.hash ?? (item.path ? packageHash(item.path).hash : null), expertType: item.expertType, connectorType: item.connectorType,
    unavailable: item.native ? '请先将连接器配置保存为能力库中的 MCP 包，再绑定到工作流。' : item.error ? '能力包无效或不支持，不能选用。' : item.kind === 'connector' && item.connectorType !== 'mcp' ? '此面板仅支持 MCP 连接器。' : null,
  }))
  function selection(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.values(fields).includes(key))) fail('INVALID_CAPABILITIES')
    return Object.fromEntries(Object.values(fields).map(key => {
      const refs = input[key] ?? []
      if (!Array.isArray(refs) || refs.some(ref => typeof ref !== 'string') || new Set(refs).size !== refs.length) fail('INVALID_CAPABILITIES')
      if (key === 'experts' && refs.length > 1) fail('ONE_ENTRY_EXPERT_REQUIRED')
      return [key, [...refs].sort()]
    }))
  }
  function project(capabilities, locked = {}) {
    return normalizeProject({ id: 'delivery-node', ...capabilities }, join(root, 'node-working-directory-placeholder'), 'delivery node', {
      ...roots?.(), libraries: libraryEntries(), cacheRoot, locked, expertsRoot: roots?.().expertsRoot ?? join(root, 'node-capabilities/experts'),
    })
  }
  function verify(binding) {
    const capabilities = selection(binding.capabilities), packages = binding.packages
    if (!packages || typeof packages !== 'object' || Array.isArray(packages)) fail('CAPABILITY_SNAPSHOT_REQUIRED')
    for (const refs of Object.values(capabilities)) for (const ref of refs) if (!packages[ref]) fail('CAPABILITY_SNAPSHOT_REQUIRED', ref)
    for (const [ref, item] of Object.entries(packages)) {
      if (!/^[a-f0-9]{64}$/.test(item?.hash ?? '')) fail('CAPABILITY_SNAPSHOT_REQUIRED', ref)
      if (packageHash(join(cacheRoot, item.hash)).hash !== item.hash) fail('CAPABILITY_CACHE_CHANGED', ref)
    }
    // The actual compiler validates package semantics, implicit connectors, attached skills,
    // and duplicate MCP server names. Preview mode never writes a live preset or lock index.
    const pinned = project(capabilities, packages)
    const closure = snapshotProject(pinned, { write: false }).locked
    if (canonical(Object.keys(closure).sort()) !== canonical(Object.keys(packages).sort())) fail('CAPABILITY_SNAPSHOT_REQUIRED')
    const compiled = compileProject(pinned, join(root, 'node-presets'), { write: false })
    return compiled.metrics
  }
  function freeze(input, expectedHashes) {
    const capabilities = selection(input), options = new Map(catalog().map(item => [item.reference, item]))
    for (const [kind, key] of Object.entries(fields)) for (const ref of capabilities[key]) {
      const option = options.get(ref)
      if (!option || option.kind !== kind || option.unavailable) fail('CAPABILITY_UNAVAILABLE', ref)
      if (!expectedHashes || expectedHashes[ref] !== option.hash) fail('CAPABILITY_CHANGED', ref)
    }
    const frozen = snapshotProject(project(capabilities))
    // Do not send package contents, source paths, MCP credentials or compiler YAML to the browser.
    const packages = Object.fromEntries(Object.entries(frozen.locked).map(([ref, item]) => [ref, { hash: item.hash, ...(item.version ? { version: item.version } : {}) }]))
    for (const refs of Object.values(capabilities)) for (const ref of refs) if (packages[ref]?.hash !== expectedHashes[ref]) fail('CAPABILITY_CHANGED', ref)
    const binding = { capabilities, packages }
    verify(binding)
    return binding
  }
  function preparePreset(binding, { id, directory, cwd }) {
    verify(binding)
    const pinned = { ...project(binding.capabilities, binding.packages), id, cwd, name: '交付节点' }
    const model = projectModel(pinned), sections = personaSections(pinned, model).sections
    const plugins = buildComposition(pinned, { model, presetDir: directory }).filter(row => row.id !== 'persona')
    plugins.unshift({ id: 'delivery-node-policy', name: fileURLToPath(new URL('./node-policy.mjs', import.meta.url)), config: {
      policy: sections.filter(section => !section.title.startsWith('专家：')).map(section => section.text).join('\n\n'),
      expert: sections.filter(section => section.title.startsWith('专家：')).map(section => section.text).join('\n\n'),
    } })
    // Resolve only the compiler's known ${ENV} syntax, without evaluating JS.
    // Values are used in memory, never returned to the UI or saved as a hydrated preset.
    const expand = value => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, key) => key === 'WORKBUDDY_NODE_CWD' ? cwd : process.env[key] ?? '')
    const map = values => Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, expand(value)]))
    for (const server of model.project.connectorServers) {
      const row = plugins.find(row => row.id === 'connector-' + server.name)
      row.config = { serverName: server.name, transport: server.transport, failOnStartupError: true,
        ...(server.timeout === undefined ? {} : { toolCallTimeoutMs: server.timeout }),
        ...(server.transport === 'stdio' ? { command: expand(server.command), args: server.args.map(expand), env: map(server.env), cwd: server.cwd } : { url: expand(server.url), headers: map(server.headers) }),
      }
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(join(directory, 'binding.json'), JSON.stringify({ id, binding }, null, 2), { mode: 0o600 })
    return { id, plugins, mcpTools: model.project.connectorServers.map(server => 'mcp__' + server.name + '__') }
  }
  return { catalog, freeze, verify, preparePreset, selection }
}
