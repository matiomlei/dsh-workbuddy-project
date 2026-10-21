/** Isolated domain prototype. Not imported by the installed WorkBuddy plugin. */
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export class ContractError extends Error {
  constructor(code, message) { super(message); this.code = code }
}
const fail = (code, message = code) => { throw new ContractError(code, message) }
export function canonical(value) {
  const active = new Set()
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (typeof item !== 'object' || active.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype)) fail('INVALID_JSON')
    active.add(item)
    const result = Array.isArray(item) ? `[${item.map(encode).join(',')}]` : `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`
    active.delete(item)
    return result
  }
  return encode(value)
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex')
const copy = value => JSON.parse(canonical(value))
const text = (value, label) => { if (typeof value !== 'string' || !value.trim()) fail('INVALID_FIELD', label); return value }
const object = (value, label) => { if (!value || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_FIELD', label); return value }
const uniqueIds = (values, key) => {
  if (!Array.isArray(values)) fail('INVALID_FIELD', key)
  const ids = values.map(value => text(value[key], key))
  if (new Set(ids).size !== ids.length) fail('DUPLICATE_ID', key)
  return new Set(ids)
}

/** Drafts may be incomplete; publication requires a nonempty, acyclic graph. */
export function validateDefinition(value) {
  const definition = copy(object(value, 'definition'))
  const graph = object(definition.graph, 'graph'), ids = uniqueIds(graph.nodes, 'id')
  if (!ids.size) fail('EMPTY_GRAPH')
  uniqueIds(graph.edges, 'id')
  const roles = uniqueIds(definition.repositoryRoles ?? [], 'id')
  const incoming = new Map([...ids].map(id => [id, 0])), outgoing = new Map([...ids].map(id => [id, []]))
  for (const node of graph.nodes) {
    text(node.type, 'node.type')
    const role = node.data?.repositoryRole
    if (role !== undefined && !roles.has(role)) fail('UNKNOWN_REPOSITORY_ROLE', role)
  }
  const qualityPolicies = definition.qualityPolicies ?? []
  uniqueIds(qualityPolicies, 'nodeId')
  for (const policy of qualityPolicies) if (!ids.has(policy.nodeId) || policy.required !== true || Object.keys(policy).some(key => !['nodeId', 'required'].includes(key))) fail('INVALID_QUALITY_POLICY')
  const bindings = definition.nodeBindings ?? []
  uniqueIds(bindings, 'nodeId')
  for (const binding of bindings) {
    const node = graph.nodes.find(node => node.id === binding.nodeId)
    if (!node || node.type !== 'agent') fail('INVALID_CAPABILITY_NODE', binding.nodeId)
    if (binding.repositoryRole && !roles.has(binding.repositoryRole)) fail('UNKNOWN_REPOSITORY_ROLE', binding.repositoryRole)
    if (binding.schemaVersion !== 1) fail('INVALID_CAPABILITIES')
    object(binding.capabilities, 'capabilities'); object(binding.packages, 'packages')
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) fail('DANGLING_EDGE', edge.id)
    incoming.set(edge.target, incoming.get(edge.target) + 1)
    outgoing.get(edge.source).push(edge.target)
  }
  const ready = [...ids].filter(id => incoming.get(id) === 0)
  let visited = 0
  while (ready.length) {
    const id = ready.shift(); visited++
    for (const next of outgoing.get(id)) { incoming.set(next, incoming.get(next) - 1); if (incoming.get(next) === 0) ready.push(next) }
  }
  if (visited !== ids.size) fail('CYCLIC_GRAPH')
  const fields = definition.inputSchema?.fields ?? []
  uniqueIds(fields, 'key')
  const supported = ['string', 'number', 'boolean', 'object', 'array', 'string[]', 'json']
  for (const field of fields) if (!supported.includes(field.type ?? 'json')) fail('UNKNOWN_INPUT_TYPE', field.key)
  return definition
}

function resolveInputs(definition, supplied) {
  const result = copy(object(supplied, 'inputs')), fields = definition.inputSchema?.fields ?? []
  const known = new Set(fields.map(field => field.key))
  for (const key of Object.keys(result)) if (fields.length && !known.has(key)) fail('UNKNOWN_INPUT', key)
  for (const field of fields) {
    if (!Object.hasOwn(result, field.key) && Object.hasOwn(field, 'defaultValue')) result[field.key] = copy(field.defaultValue)
    if (!Object.hasOwn(result, field.key)) { if (field.required) fail('REQUIRED_INPUT', field.key); continue }
    const value = result[field.key], kind = field.type ?? 'json'
    const valid = kind === 'string' ? typeof value === 'string' : kind === 'number' ? typeof value === 'number' : kind === 'boolean' ? typeof value === 'boolean' : kind === 'object' ? value !== null && !Array.isArray(value) && typeof value === 'object' : kind === 'array' ? Array.isArray(value) : kind === 'string[]' ? Array.isArray(value) && value.every(item => typeof item === 'string') : true
    if (!valid || (field.enum && !field.enum.includes(value))) fail('INVALID_INPUT', field.key)
  }
  return result
}

export class TemplateStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, source_json TEXT);
      CREATE TABLE IF NOT EXISTS drafts(template_id TEXT PRIMARY KEY REFERENCES templates(id), revision INTEGER NOT NULL, content_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions(template_id TEXT REFERENCES templates(id), version INTEGER, digest TEXT NOT NULL, backend_id TEXT NOT NULL UNIQUE, document_json TEXT NOT NULL, PRIMARY KEY(template_id, version), UNIQUE(template_id,digest));
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, document_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_digest TEXT NOT NULL, template_id TEXT, version INTEGER, manifest_json TEXT NOT NULL, FOREIGN KEY(template_id,version) REFERENCES versions(template_id,version));
      CREATE TRIGGER IF NOT EXISTS versions_no_update BEFORE UPDATE ON versions BEGIN SELECT RAISE(ABORT,'immutable published version'); END;
      CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON versions BEGIN SELECT RAISE(ABORT,'immutable published version'); END;
      CREATE TRIGGER IF NOT EXISTS runs_no_update BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT,'immutable run manifest'); END;
      CREATE TRIGGER IF NOT EXISTS runs_no_delete BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,'immutable run manifest'); END;`)
  }
  close() { this.db.close() }
  listTemplates() { return this.db.prepare('SELECT id FROM templates ORDER BY rowid DESC').all().map(({ id }) => ({ ...this.template(id), revision: this.draft(id).revision })) }
  versions(id) { this.template(id); return this.db.prepare('SELECT document_json FROM versions WHERE template_id=? ORDER BY version DESC').all(id).map(row => JSON.parse(row.document_json)) }
  projects() { return this.db.prepare('SELECT id FROM projects ORDER BY rowid DESC').all().map(({ id }) => this.project(id)) }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = fn(); this.db.exec('COMMIT'); return result } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  template(id) { const row = this.db.prepare('SELECT * FROM templates WHERE id=?').get(id); if (!row) fail('TEMPLATE_NOT_FOUND'); return { id: row.id, name: row.name, archived: !!row.archived, source: row.source_json ? JSON.parse(row.source_json) : null } }
  draft(id) { this.template(id); const row = this.db.prepare('SELECT * FROM drafts WHERE template_id=?').get(id); return { templateId: id, revision: row.revision, definition: JSON.parse(row.content_json) } }
  create({ id = randomUUID(), name, definition = { graph: { nodes: [], edges: [] } }, source = null }) {
    text(id, 'id'); text(name, 'name'); object(definition, 'definition')
    return this.transaction(() => {
      this.db.prepare('INSERT INTO templates(id,name,source_json) VALUES(?,?,?)').run(id, name, source === null ? null : canonical(source))
      this.db.prepare('INSERT INTO drafts VALUES(?,?,?)').run(id, 1, canonical(definition))
      return this.draft(id)
    })
  }
  saveDraft(id, expectedRevision, definition) {
    object(definition, 'definition')
    return this.transaction(() => {
      if (this.template(id).archived) fail('TEMPLATE_ARCHIVED')
      const result = this.db.prepare('UPDATE drafts SET revision=revision+1,content_json=? WHERE template_id=? AND revision=?').run(canonical(definition), id, expectedRevision)
      if (result.changes !== 1) fail('DRAFT_CONFLICT')
      return this.draft(id)
    })
  }
  publish(id, expectedRevision) {
    return this.transaction(() => {
      const template = this.template(id), draft = this.draft(id)
      if (template.archived) fail('TEMPLATE_ARCHIVED')
      if (draft.revision !== expectedRevision) fail('DRAFT_CONFLICT')
      const definition = validateDefinition(draft.definition), hash = digest({ name: template.name, definition })
      const previous = this.db.prepare('SELECT version FROM versions WHERE template_id=? AND digest=?').get(id, hash)
      if (previous) return this.version(id, previous.version)
      const version = this.db.prepare('SELECT COALESCE(MAX(version),0)+1 AS next FROM versions WHERE template_id=?').get(id).next
      const document = { templateId: id, name: template.name, version, digest: hash, backendWorkflowId: 'delivery_v_' + digest([id, hash]), definition }
      this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?)').run(id, version, hash, document.backendWorkflowId, canonical(document))
      return copy(document)
    })
  }
  version(id, version) {
    const row = this.db.prepare('SELECT document_json FROM versions WHERE template_id=? AND version=?').get(id, version)
    if (!row) fail('VERSION_NOT_FOUND')
    return JSON.parse(row.document_json)
  }
  copyVersion(id, version, name) { const source = this.version(id, version); return this.create({ name, definition: source.definition, source: { templateId: id, version, digest: source.digest } }) }
  archive(id) { this.template(id); this.db.prepare('UPDATE templates SET archived=1 WHERE id=?').run(id) }
  deleteTemplate(id) {
    this.template(id)
    if (this.db.prepare('SELECT 1 FROM versions WHERE template_id=?').get(id)) fail('VERSION_REFERENCED')
    return this.transaction(() => { this.db.prepare('DELETE FROM drafts WHERE template_id=?').run(id); this.db.prepare('DELETE FROM templates WHERE id=?').run(id) })
  }
  createProject({ id, name, repositories }) {
    text(id, 'id'); text(name, 'name')
    const aliases = uniqueIds(repositories, 'alias'); if (!aliases.size) fail('REPOSITORY_REQUIRED')
    for (const repo of repositories) { text(repo.url, 'repo.url'); text(repo.ref, 'repo.ref') }
    const document = { id, name, repositories: copy(repositories), binding: null }
    this.db.prepare('INSERT INTO projects VALUES(?,?,?)').run(id, 1, canonical(document))
    return this.project(id)
  }
  updateProject(id,expectedRevision,{name,repositories}) {
    const previous=this.project(id)
    text(name,'name');const aliases=uniqueIds(repositories,'alias');if(!aliases.size)fail('REPOSITORY_REQUIRED')
    for(const repo of repositories){text(repo.url,'repo.url');text(repo.ref,'repo.ref')}
    const {revision:_,...document}=previous;Object.assign(document,{name,repositories:copy(repositories)})
    if(document.binding)this.validateMapping(this.version(document.binding.templateId,document.binding.version).definition,document,document.binding.repositoryMap)
    const changed=this.db.prepare('UPDATE projects SET revision=revision+1,document_json=? WHERE id=? AND revision=?').run(canonical(document),id,expectedRevision)
    if(changed.changes!==1)fail('PROJECT_CONFLICT')
    return this.project(id)
  }
  project(id) { const row = this.db.prepare('SELECT * FROM projects WHERE id=?').get(id); if (!row) fail('PROJECT_NOT_FOUND'); return { revision: row.revision, ...JSON.parse(row.document_json) } }
  bindProject(id, expectedRevision, { templateId, version, repositoryMap }) {
    return this.transaction(() => {
      const published = this.version(templateId, version), project = this.project(id)
      if (this.template(templateId).archived) fail('TEMPLATE_ARCHIVED')
      this.validateMapping(published.definition, project, repositoryMap)
      const { revision: _, ...document } = project
      document.binding = { templateId, version, digest: published.digest, repositoryMap: copy(repositoryMap) }
      const changed = this.db.prepare('UPDATE projects SET revision=revision+1,document_json=? WHERE id=? AND revision=?').run(canonical(document), id, expectedRevision)
      if (changed.changes !== 1) fail('PROJECT_CONFLICT')
      return this.project(id)
    })
  }
  validateMapping(definition, project, mapping) {
    object(mapping, 'repositoryMap')
    const aliases = new Set(project.repositories.map(repo => repo.alias)), roles = new Set((definition.repositoryRoles ?? []).map(role => role.id))
    for (const [role, alias] of Object.entries(mapping)) if (!roles.has(role) || !aliases.has(alias)) fail('INVALID_REPOSITORY_MAPPING', role)
    for (const role of roles) if (!Object.hasOwn(mapping, role)) fail('REPOSITORY_MAPPING_REQUIRED', role)
  }
  prepareRun({ requestId, projectId, expectedProjectRevision, inputs = {}, repositoryCommits, triggerInput = '', execution = {} }) {
    text(requestId, 'requestId')
    if (typeof triggerInput !== 'string') fail('INVALID_INPUT', 'triggerInput')
    const requestDigest = digest({ projectId, expectedProjectRevision, inputs, repositoryCommits, triggerInput, execution })
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT request_digest,manifest_json FROM runs WHERE request_id=?').get(requestId)
      if (previous) { if (previous.request_digest !== requestDigest) fail('IDEMPOTENCY_CONFLICT'); return JSON.parse(previous.manifest_json) }
      const project = this.project(projectId)
      if (project.revision !== expectedProjectRevision) fail('PROJECT_CONFLICT')
      if (!project.binding) fail('WORKFLOW_BINDING_REQUIRED')
      const { templateId, version, repositoryMap } = project.binding
      if (this.template(templateId).archived) fail('TEMPLATE_ARCHIVED')
      const published = this.version(templateId, version)
      this.validateMapping(published.definition, project, repositoryMap)
      object(repositoryCommits, 'repositoryCommits')
      const aliases = new Set(project.repositories.map(repo => repo.alias))
      if (Object.keys(repositoryCommits).some(alias => !aliases.has(alias))) fail('UNKNOWN_REPOSITORY')
      const repositories = project.repositories.map(repo => {
        const commit = repositoryCommits[repo.alias]
        if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? '')) fail('COMMIT_REQUIRED', repo.alias)
        return { alias: repo.alias, url: repo.url, commit }
      })
      const manifest = { schemaVersion: 1, businessRunId: 'delivery_run_' + randomUUID(), projectId, projectRevision: project.revision, template: { id: templateId, version, digest: published.digest }, backendWorkflowId: published.backendWorkflowId, definition: published.definition, repositoryMap: copy(repositoryMap), repositories, execution: copy(execution), triggerInput, inputs: resolveInputs(published.definition, inputs) }
      this.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?)').run(manifest.businessRunId, requestId, requestDigest, templateId, version, canonical(manifest))
      return copy(manifest)
    })
  }
  run(id) { const row = this.db.prepare('SELECT manifest_json FROM runs WHERE id=?').get(id); if (!row) fail('RUN_NOT_FOUND'); return JSON.parse(row.manifest_json) }
}

export function backendProjection(published) {
  return { id: published.backendWorkflowId, name: `${published.name} @${published.version}`, graph: published.definition.graph, inputSchema: published.definition.inputSchema ?? { fields: [] }, variables: published.definition.variables ?? [], dependencies: published.definition.dependencies ?? { globalVariables: [], credentials: [] } }
}
