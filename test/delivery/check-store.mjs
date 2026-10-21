import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TemplateStore, canonical } from '../../lib/delivery/template-store.mjs'

const root = mkdtempSync(join(tmpdir(), 'delivery-template-store-')), path = join(root, 'business.sqlite')
let store = new TemplateStore(path), peer = new TemplateStore(path)
const results = []
const code = value => `function main(){return {value:${JSON.stringify(value)}};}`
const node = (id, value = id) => ({ id, type: 'script', data: { code: code(value), repositoryRole: 'source' } })
const initial = { graph: { nodes: [node('collect'), node('summary')], edges: [{ id: 'collect-summary', source: 'collect', target: 'summary' }] }, repositoryRoles: [{ id: 'source' }], inputSchema: { fields: [{ key: 'subject', type: 'string', required: true }] } }
const expect = (code, fn) => assert.throws(fn, error => error.code === code)
const check = (name, fn) => { fn(); results.push({ name, passed: true }); console.log('PASS', name) }
let v1, v2, run1
try {
  check('blank drafts are saveable; empty, cyclic and dangling definitions cannot publish', () => {
    store.create({ id: 'invalid', name: '未完成模板' })
    expect('EMPTY_GRAPH', () => store.publish('invalid', 1))
    const cyclic = structuredClone(initial); cyclic.graph.edges.push({ id: 'back', source: 'summary', target: 'collect' })
    store.saveDraft('invalid', 1, cyclic); expect('CYCLIC_GRAPH', () => store.publish('invalid', 2))
    const dangling = structuredClone(initial); dangling.graph.edges[0].target = 'missing'
    store.saveDraft('invalid', 2, dangling); expect('DANGLING_EDGE', () => store.publish('invalid', 3))
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM versions WHERE template_id='invalid'").get().n, 0)
  })
  check('two independent SQLite connections cannot overwrite from a stale draft revision', () => {
    store.create({ id: 'review', name: '评审模板', definition: initial })
    const readA = store.draft('review'), readB = peer.draft('review')
    const edited = structuredClone(initial); edited.graph.nodes[0].data.label = '新编辑'
    store.saveDraft('review', readA.revision, edited)
    expect('DRAFT_CONFLICT', () => peer.saveDraft('review', readB.revision, initial))
    expect('DRAFT_CONFLICT', () => peer.publish('review', readB.revision))
    assert.equal(peer.draft('review').definition.graph.nodes[0].data.label, '新编辑')
  })
  check('publication is repeatable and content versions retain different immutable definitions', () => {
    v1 = store.publish('review', 2); assert.deepEqual(store.publish('review', 2), v1)
    const updated = structuredClone(v1.definition); updated.graph.nodes.push(node('audit')); updated.graph.edges.push({ id: 'summary-audit', source: 'summary', target: 'audit' })
    store.saveDraft('review', 2, updated); v2 = store.publish('review', 3)
    assert.equal(v1.version, 1); assert.equal(v2.version, 2)
    assert.notEqual(v1.backendWorkflowId, v2.backendWorkflowId)
    assert.equal(store.version('review', 1).definition.graph.nodes.length, 2)
    assert.equal(store.version('review', 2).definition.graph.nodes.length, 3)
  })
  check('copying a version keeps provenance and permits an independent graph', () => {
    const draft = store.copyVersion('review', 1, '独立派生')
    assert.equal(store.template(draft.templateId).source.digest, v1.digest)
    store.saveDraft(draft.templateId, 1, { graph: { nodes: [node('single')], edges: [] }, repositoryRoles: [{ id: 'source' }] })
    assert.equal(store.publish(draft.templateId, 2).definition.graph.nodes.length, 1)
    assert.equal(store.version('review', 1).definition.graph.nodes.length, 2)
  })
  check('project binding validates roles, aliases, explicit versions and stale project revisions', () => {
    expect('REPOSITORY_REQUIRED', () => store.createProject({ id: 'empty', name: '空项目', repositories: [] }))
    for (const id of ['project-a', 'project-b']) store.createProject({ id, name: id, repositories: [{ alias: id + '-repo', url: 'ssh://git.internal/' + id, ref: 'main' }] })
    expect('REPOSITORY_MAPPING_REQUIRED', () => store.bindProject('project-a', 1, { templateId: 'review', version: 1, repositoryMap: {} }))
    expect('INVALID_REPOSITORY_MAPPING', () => store.bindProject('project-a', 1, { templateId: 'review', version: 1, repositoryMap: { source: 'missing' } }))
    store.bindProject('project-a', 1, { templateId: 'review', version: 1, repositoryMap: { source: 'project-a-repo' } })
    store.bindProject('project-b', 1, { templateId: 'review', version: 2, repositoryMap: { source: 'project-b-repo' } })
    expect('PROJECT_CONFLICT', () => peer.bindProject('project-a', 1, { templateId: 'review', version: 2, repositoryMap: { source: 'project-a-repo' } }))
    assert.equal(store.project('project-a').binding.version, 1); assert.equal(store.project('project-b').binding.version, 2)
  })
  check('incomplete run preparation leaves no partial manifest', () => {
    const before = store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n
    expect('COMMIT_REQUIRED', () => store.prepareRun({ requestId: 'bad-commit', projectId: 'project-a', expectedProjectRevision: 2, inputs: { subject: '材料' }, repositoryCommits: {} }))
    expect('REQUIRED_INPUT', () => store.prepareRun({ requestId: 'bad-input', projectId: 'project-a', expectedProjectRevision: 2, repositoryCommits: { 'project-a-repo': 'a'.repeat(40) } }))
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM runs').get().n, before)
  })
  check('run preparation is idempotent; reusing a request with changed intent is rejected', () => {
    const request = { requestId: 'request-a', projectId: 'project-a', expectedProjectRevision: 2, inputs: { subject: '材料A' }, repositoryCommits: { 'project-a-repo': 'a'.repeat(40) } }
    run1 = store.prepareRun(request)
    assert.deepEqual(peer.prepareRun(request), run1)
    expect('IDEMPOTENCY_CONFLICT', () => store.prepareRun({ ...request, inputs: { subject: '材料B' } }))
  })
  check('project upgrades and returned-object edits do not modify an existing run snapshot', () => {
    const original = canonical(run1)
    store.bindProject('project-a', 2, { templateId: 'review', version: 2, repositoryMap: { source: 'project-a-repo' } })
    const next = store.prepareRun({ requestId: 'request-a-v2', projectId: 'project-a', expectedProjectRevision: 3, inputs: { subject: '材料B' }, repositoryCommits: { 'project-a-repo': 'b'.repeat(40) } })
    assert.equal(next.template.version, 2); assert.equal(next.repositories[0].commit, 'b'.repeat(40))
    const returned = store.run(run1.businessRunId); returned.definition.graph.nodes.pop(); returned.inputs.subject = '篡改返回对象'
    assert.equal(canonical(store.run(run1.businessRunId)), original)
  })
  check('database-level updates and deletes cannot overwrite published versions or manifests', () => {
    assert.throws(() => store.db.prepare('UPDATE versions SET document_json=? WHERE template_id=?').run('{}', 'review'), /immutable published version/)
    assert.throws(() => store.db.prepare('DELETE FROM versions WHERE template_id=?').run('review'), /immutable published version/)
    assert.throws(() => store.db.prepare('UPDATE runs SET manifest_json=? WHERE id=?').run('{}', run1.businessRunId), /immutable run manifest/)
  })
  check('archive prevents new usage and deletion, while restart preserves historical snapshots', () => {
    const original = store.run(run1.businessRunId)
    store.archive('review')
    expect('TEMPLATE_ARCHIVED', () => store.bindProject('project-b', 2, { templateId: 'review', version: 2, repositoryMap: { source: 'project-b-repo' } }))
    expect('TEMPLATE_ARCHIVED', () => store.prepareRun({ requestId: 'archived', projectId: 'project-a', expectedProjectRevision: 3, inputs: { subject: '新运行' }, repositoryCommits: { 'project-a-repo': 'a'.repeat(40) } }))
    expect('VERSION_REFERENCED', () => store.deleteTemplate('review'))
    peer.close(); peer = null; store.close(); store = new TemplateStore(path)
    assert.deepEqual(store.run(run1.businessRunId), original)
    assert.equal(store.version('review', 1).digest, v1.digest)
  })
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify({ scope: 'isolated native SQLite domain prototype; no installed plugin or gate protocol changes', checks: results }, null, 2))
} finally { peer?.close(); store.close(); rmSync(root, { recursive: true, force: true }) }
