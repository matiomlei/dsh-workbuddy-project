/** JSON project declarations and qualified package references. */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { librarySchedule, repositoryAddress } from './library-config.js'
import { KINDS, markdown, packageHash, packagePath, readJson, readPackage, scanPackages } from './bundles.js'
export const CONFIG_DIR = '.dsh'
export const CONFIG_FILE = 'project.json'
export const SKILLS_DIR = 'skills'
export const EXPERTS_DIR = 'experts'
export const RULES_DIR = 'rules'
export const CONNECTORS_DIR = 'connectors'
export const SCHEMA_VERSION = 1
export const PROJECT_ID = /^[a-z0-9][a-z0-9._-]*$/
export const LIBRARY_NAME = /^[a-z][a-z0-9._-]*$/i
export const PRESET_DEFINITION_EXTENSIONS = ['.json']
export function configPath(cwd) { return join(cwd,CONFIG_DIR,CONFIG_FILE) }
export function hasProject(cwd) { return !!cwd && existsSync(configPath(cwd)) }
export function globalExpertsRoot(projectsRoot) { return join(projectsRoot ? dirname(resolve(projectsRoot)) : process.env.DSH_HOME ?? join(homedir(),'.dsh'), 'experts') }
export function projectSkillsRoot(cwd) { return join(cwd,CONFIG_DIR,SKILLS_DIR) }
export function projectExpertsRoot(cwd) { return join(cwd,CONFIG_DIR,EXPERTS_DIR) }
export function projectRulesRoot(cwd) { return join(cwd,CONFIG_DIR,RULES_DIR) }
export function resolveLibrary(entry) { return { ...entry,configuredPath:entry.path,path:entry.path,exists:existsSync(entry.path) } }
export function librariesOf(project) { return project.libraries.map(resolveLibrary) }
export function splitReference(reference) {
  const index = reference.indexOf(':')
  return { library: index > 0 ? reference.slice(0,index) : undefined, name:index > 0 ? reference.slice(index+1) : reference }
}
export function validateReference(reference,kind) {
  if (typeof reference !== 'string' || /[\\\s\x00-\x1f]/.test(reference)) throw new Error('Capability references must be qualified package IDs')
  const { library,name } = splitReference(reference)
  if (!library || !LIBRARY_NAME.test(library) || !name.startsWith(`${KINDS[kind]}/`)) throw new Error(`Expected source:${KINDS[kind]}/package, received ${JSON.stringify(reference)}`)
  const id = name.slice(KINDS[kind].length+1)
  if (!id || id.startsWith('/') || id.split('/').some(x=>!x || x === '.' || x === '..')) throw new Error('Invalid capability package ID')
  return { source:library,id,relative:name }
}
export function normalizeLibraries(input = [], source = 'libraries') {
  if (!Array.isArray(input)) throw new Error(`${source}: libraries must be an array`)
  const seen = new Set()
  return input.map(entry=> {
    if (!entry || !LIBRARY_NAME.test(entry.name) || ['project','personal','agents','workbuddy','runtime'].includes(entry.name) || seen.has(entry.name)) throw new Error(`${source}: invalid, reserved or duplicate library name`)
    if (typeof entry.path !== 'string' || !entry.path.trim()) throw new Error(`${source}: library path is required`)
    seen.add(entry.name)
    return { name:entry.name,path:resolve(entry.path),trust:entry.trust === 'system' ? 'system' : 'user',...(entry.repo === undefined ? {} : {repo:repositoryAddress(entry.repo)}),sync:librarySchedule(entry.sync) }
  })
}
function strings(input,field) {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.some(x=>typeof x !== 'string' || !x.trim()) || new Set(input).size !== input.length) throw new Error(`${field} must be an array of unique strings`)
  return [...input]
}
export function normalizeProject(input,cwd,source = 'project',options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${source}: project must be an object`)
  const allowed = new Set(['version','id','name','description','instructions','experts','rules','skills','connectors'])
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`${source}: unknown project field ${key}`)
  if (input.version !== undefined && input.version !== SCHEMA_VERSION) throw new Error(`${source}: unsupported project version`)
  if (!PROJECT_ID.test(input.id ?? '')) throw new Error(`${source}: invalid project id`)
  for (const key of ['name','description','instructions']) if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error(`${source}: ${key} must be text`)
  if (input.name !== undefined && !input.name.trim()) throw new Error(`${source}: name must not be empty`)
  const lists = {}
  for (const [kind,key] of Object.entries(KINDS)) {
    lists[key] = strings(input[key],key)
    for (const reference of lists[key]) validateReference(reference,kind)
  }
  const expertsRoot = options.expertsRoot ?? globalExpertsRoot()
  return { version:SCHEMA_VERSION,id:input.id,name:input.name??input.id,description:input.description,instructions:input.instructions??'',...lists,
    cwd:resolve(cwd),assetRoot:options.assetRoot??join(resolve(cwd),CONFIG_DIR),expertsRoot,
    libraries:normalizeLibraries(options.libraries),sources:options.sources??[],localConnectors:options.localConnectors??[],
    cacheRoot:options.cacheRoot,lockPath:options.lockPath,locked:options.locked??{} }
}
export function projectDocument(project) {
  return Object.fromEntries(['version','id','name','description','instructions','experts','rules','skills','connectors'].filter(key=>project[key]!==undefined).map(key=>[key,project[key]]))
}
export function readProject(cwd, options = {}) {
  if (!hasProject(cwd)) return undefined
  return normalizeProject(readJson(configPath(cwd)),cwd,configPath(cwd),options)
}
export function readPresetDefinition(path,options = {}) { return normalizeProject(readJson(path),options.cwd??dirname(path),path,options) }
export function writeProject(cwd,project) {
  mkdirSync(join(cwd,CONFIG_DIR),{recursive:true})
  const path=configPath(cwd)
  writeFileSync(path,JSON.stringify(projectDocument(project),null,2)+'\n',{mode:0o644})
  return path
}
export function instructionsText(project) { return project.instructions || undefined }
export function packageRoots(project) {
  const personal = dirname(project.expertsRoot)
  return [{name:'project',path:project.assetRoot},{name:'personal',path:personal},{name:'agents',path:process.env.DSH_AGENTS_HOME??join(homedir(),'.agents')},...project.sources,...librariesOf(project)]
}
export function resolvePackage(reference,kind,project) {
  const { source,id,relative }=validateReference(reference,kind)
  const pinned=project.locked[reference]
  if (pinned) {
    if (!project.cacheRoot || !pinned.hash || !/^[a-f0-9]{64}$/.test(pinned.hash)) throw new Error(`Invalid locked package ${reference}`)
    const path=join(project.cacheRoot,pinned.hash)
    if (!existsSync(path)) throw new Error(`Cached capability ${reference} is missing; explicitly upgrade project capabilities`)
    return { ...readPackage(path,kind,id),reference,hash:pinned.hash,sourcePath:pinned.sourcePath }
  }
  if (source === 'runtime') {
    const native=project.localConnectors.find(entry=>entry.reference===reference)
    if (!native || kind !== 'connector') throw new Error(`Local connector ${reference} is unavailable`)
    return { ...native,kind,reference,connectorType:'mcp',metadata:{},native:true }
  }
  const root=packageRoots(project).find(entry=>entry.name===source)
  if (!root) throw new Error(`Capability source ${source} is not configured`)
  const directory = root.roots?.[kind] ?? join(root.path,KINDS[kind])
  const path=packagePath(directory,id)
  return {...readPackage(path,kind,id),reference}
}
export function expertPath(reference,project) { return resolvePackage(reference,'expert',project).path }
export function expertName(reference) { return splitReference(reference).name.replace(/^experts\//,'') }
export function ruleTexts(project) { return project.rules.map(reference=>{const bundle=resolvePackage(reference,'rule',project);return {reference,path:bundle.path,text:bundle.text}}) }
export function skillDirs(project) { return [...new Set([...project.skills.map(reference=>resolvePackage(reference,'skill',project).path),...(project.attachedSkillDirs??[])])] }
export function listBundles(root) { return scanPackages(root,'skill','personal') }
export function listProjectExperts(cwd) { return scanPackages(projectExpertsRoot(cwd),'expert','project') }
export function listProjectSkills(cwd) { return scanPackages(projectSkillsRoot(cwd),'skill','project') }
export function listProjectRules(cwd) { return scanPackages(projectRulesRoot(cwd),'rule','project') }
export function listGlobalExperts(root) { return scanPackages(root,'expert','personal') }
export function listFiles(root, extensions) {
  if (!existsSync(root)) return []
  return readdirSync(root,{withFileTypes:true}).filter(x=>x.isFile() && extensions.some(ext=>x.name.endsWith(ext))).map(x=>({name:x.name.replace(/\.[^.]+$/,''),path:join(root,x.name)}))
}
export function projectIdFromName(name) {
  const slug=(name??'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
  return PROJECT_ID.test(slug)?slug:`project-${Date.now().toString(36)}`
}
export function emptyProject(id,cwd = process.cwd(),libraries = []) { return normalizeProject({id},cwd,'empty',{libraries}) }
export function describeLibrary(entry) {
  const exists=existsSync(entry.path),meta=existsSync(join(entry.path,'library.json'))?readJson(join(entry.path,'library.json')):{}
  const out={...entry,name:entry.name,displayName:meta.name??entry.name,description:meta.description,icon:meta.icon,path:entry.path,configuredPath:entry.path,exists,isCheckout:exists&&!!gitDir(entry.path),revision:exists?libraryRevision(entry.path):undefined,headRef:exists?libraryHeadRef(entry.path):undefined}
  for (const [kind,directory] of Object.entries(KINDS)) out[directory]=scanPackages(join(entry.path,directory),kind,entry.name)
  return out
}
export function bundleHash(path) { return packageHash(path) }
export function assertLibrariesPresent() { /* Package resolution reports missing selected sources. */ }
/** The git directory of a checkout, resolving a linked worktree's pointer file. */
export function gitDir(path) {
  const dotGit = join(path, '.git')
  try {
    if (statSync(dotGit).isDirectory()) return dotGit
    const text = readFileSync(dotGit, 'utf8').trim()
    if (text.startsWith('gitdir:')) return resolve(dirname(dotGit), text.slice(7).trim())
  } catch {
    /* not a checkout */
  }
  return undefined
}

/**
 * The content-addressed identity of one blob: git's own object id.
 *
 * This is what makes per-element versioning honest without inventing version
 * numbers — the same bytes produce the same id here and in `git hash-object`,
 * and a locally edited file hashes differently from what the revision recorded.
 *
 * @param content - the file's text.
 * @returns the 40-character blob id.
 */
export function blobHash(content) {
  const bytes = Buffer.from(content, 'utf8')
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

/**
 * Which library one resolved path came from, as a library-relative path.
 * @param path - an absolute resolved path.
 * @param project - a normalized project.
 * @returns `{ library, relative }`, or `undefined` when the path is project-local.
 */
export function relativeToLibrary(path, project) {
  for (const entry of librariesOf(project)) {
    if (!path.startsWith(`${entry.path}/`)) continue
    return { library: entry.name, relative: path.slice(entry.path.length + 1) }
  }
  return undefined
}

/**
 * Resolve one library name to its root.
 * @param project - a normalized project.
 * @param name - the library name from a reference.
 * @returns the absolute root.
 * @throws when no configured library carries that name.
 */
export function libraryRoot(project, name) {
  const found = librariesOf(project).find((entry) => entry.name === name)
  if (found === undefined) {
    const known = librariesOf(project).map((entry) => entry.name).join(', ') || '(none configured)'
    throw new Error(
      `project "${project.id}": unknown library ${JSON.stringify(name)}; configured libraries: ${known}`,
    )
  }
  return found.path
}

/**
 * The current git revision of one library checkout, for provenance.
 *
 * Reads `.git/HEAD` and its ref file directly: git itself stays the user's tool,
 * and recording which revision a preset was compiled from must not require
 * running it.
 *
 * @param path - the library root.
 * @returns the short revision, or `undefined` when the directory is not a checkout.
 */
export function libraryRevision(path) {
  const head = readHead(path)
  if (head === undefined) return undefined
  if (!head.startsWith('ref:')) return head.slice(0, 7)
  const git = gitDir(path)
  if (git === undefined) return undefined
  const ref = refFile(git, head.slice(4).trim())
  if (ref === undefined) return undefined
  try {
    return readFileSync(ref, 'utf8').trim().slice(0, 7)
  } catch {
    return undefined
  }
}

/**
 * Locate the file holding one ref.
 *
 * A linked worktree's git directory holds only `HEAD` and the index; refs live in
 * the COMMON directory, which the gitdir names in its `commondir` file. Falling
 * back to the gitdir itself keeps a minuscule hand-built checkout readable.
 */
function refFile(git, ref) {
  const candidates = []
  try {
    candidates.push(join(resolve(git, readFileSync(join(git, 'commondir'), 'utf8').trim()), ref))
  } catch {
    /* not a linked worktree */
  }
  if (git.includes(`${sep}worktrees${sep}`)) candidates.push(join(git, '..', '..', ref))
  candidates.push(join(git, ref))
  return candidates.find((candidate) => existsSync(candidate))
}

/**
 * The branch or tag a checkout currently has out, for reporting.
 * @param path - a checkout root.
 * @returns a branch name, `detached <sha>`, or `undefined`.
 */
export function libraryHeadRef(path) {
  const head = readHead(path)
  if (head === undefined) return undefined
  if (head.startsWith('ref:')) return head.slice(4).trim().replace(/^refs\/(?:heads|tags)\//u, '')
  return `detached ${head.slice(0, 7)}`
}

/** Read one checkout's `.git/HEAD`, following a linked worktree's pointer. */
function readHead(path) {
  const git = gitDir(path)
  if (git === undefined) return undefined
  try {
    return readFileSync(join(git, 'HEAD'), 'utf8').trim()
  } catch {
    return undefined
  }
}
