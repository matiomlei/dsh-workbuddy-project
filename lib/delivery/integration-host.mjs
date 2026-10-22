/** Private project/template dispatcher behind the authenticated product gateway. */
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { TemplateStore, ContractError, backendProjection, canonical, validateDefinition } from './template-store.mjs'
import { BASE_TOOLS } from './tool-policy.mjs'
import { createStarter } from './starter-template.mjs'
import { nodeCapabilities } from './node-capabilities.mjs'
import { createRunRuntime } from './run-runtime.mjs'
export const name = 'workbuddy-delivery-service'
export const inject = ['webServer', 'sessions', 'agentPresets']
const messages = {
  DRAFT_CONFLICT: '草稿已被另一窗口更新。本窗口内容已保留，请复制需要保留的修改后重新打开最新草稿。',
  PROJECT_CONFLICT: '项目配置已更新，请刷新后重新选择版本。',
  EMPTY_GRAPH: '模板没有节点，请先在画布中添加节点。',
  CYCLIC_GRAPH: '图中存在环路，DAG 模板不能发布。',
  DANGLING_EDGE: '存在连接到缺失节点的连线，请修正后发布。',
  TEMPLATE_ARCHIVED: '该模板已归档，不能用于新的编辑或项目绑定。',
  VERSION_NOT_READY: '该版本尚未完成发布，请重试发布后再选用。',
  INVALID_REPOSITORY_MAPPING: '请选择项目中存在的仓库，与模板角色建立映射。',
  REPOSITORY_MAPPING_REQUIRED: '请为模板的每个仓库角色选择实际仓库。',
  CAPABILITY_CHANGED: '能力库内容已变化，请刷新能力列表后重新选择并保存。',
  CAPABILITY_UNAVAILABLE: '所选能力已不可用，或不支持此类型，请刷新列表。',
  CAPABILITY_SNAPSHOT_REQUIRED: '节点能力快照不完整，请重新选择并保存。',
  CAPABILITY_CACHE_CHANGED: '能力快照内容已变化，请检查本地能力缓存。',
  INVALID_CAPABILITY_NODE: '能力配置仅适用于存在的 Agent 节点。',
  UNKNOWN_REPOSITORY_ROLE: '节点选择的仓库角色不存在，请先在模板中声明角色。',
  ONE_ENTRY_EXPERT_REQUIRED: '当前每个节点支持一个入口专家或专家团包。',
  INVALID_QUALITY_POLICY: '节点完成条件无效，请重新选择节点并保存。',
  QUALITY_SUBJECT_MISMATCH: '检查结果与节点尝试或固定产物不一致，未予采用。',
  QUALITY_REVIEW_CONFLICT: '检查轮次已变化，请刷新后查看当前待检记录。',
  QUALITY_REVIEW_CLOSED: '本轮结果已固定，不能覆盖；不通过时可发起新一轮检查。',
  QUALITY_RECHECK_NOT_ALLOWED: '只有不通过且仍在等待的检查可以重新检查。',
  QUALITY_DECISION_CONFLICT: '同一结果请求编号不能用于不同内容。',
  INVALID_QUALITY_DECISION: '请选择检查结果并填写检查说明。',
  RECOVERY_STATE_CONFLICT: '运行状态或后端轮次已变化，请刷新后查看。',
  RECOVERY_PLAN_CONFLICT: '恢复检查已变化，请刷新后重新核对。',
  RECOVERY_NOT_SAFE: '部分执行没有完整检查点，结果不确定，不能自动重复执行。',
  RECOVERY_IDEMPOTENCY_CONFLICT: '同一恢复请求编号不能用于不同内容。',
  RUNTIME_NOT_READY: '业务执行后端尚未就绪。',
  IDEMPOTENCY_CONFLICT: '该运行请求编号已用于不同参数，请刷新后重新启动。',
}
export async function apply(ctx, config) {
  const root = resolve(config.root), store = new TemplateStore(join(root, 'business.sqlite'))
  const upstream = resolve(config.upstreamRoot)
  const capabilities = await nodeCapabilities({ root, compilerRoot: config.compilerRoot ?? fileURLToPath(new URL('../../', import.meta.url)), libraries: config.capabilityLibraries ?? [], roots: config.capabilityRoots, catalogSource: config.capabilityCatalog })
  const { graphFingerprint } = await import(pathToFileURL(join(upstream, 'dsh-ccpg-orchestrator/lib/run-scope.js')))
  const editors = new Map(), streams = new Set()
  store.db.exec('CREATE TABLE IF NOT EXISTS projection_status(template_id TEXT, version INTEGER, ready INTEGER NOT NULL, error TEXT, PRIMARY KEY(template_id,version))')
  const json = (res, value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)) }
  const issue = (code, status = 400) => { throw Object.assign(new ContractError(code, messages[code] ?? code), { status }) }
  const readBody = async req => {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 2 * 1024 * 1024) issue('REQUEST_TOO_LARGE', 413) }
    try { return raw ? JSON.parse(raw) : {} } catch { issue('INVALID_JSON') }
  }
  const context = (req, sessionId) => {
    if (typeof sessionId !== 'string' || !ctx.sessions.get(sessionId)) issue('SESSION_REQUIRED', 409)
    return { sessionId, base: `http://127.0.0.1:${req.socket.localPort}` }
  }
  const native = async (connection, path, method = 'GET', body) => {
    return config.invokeNative(connection, path, method, body)
  }
  const status = version => ({ ...version, ready: !!store.db.prepare('SELECT ready FROM projection_status WHERE template_id=? AND version=?').get(version.templateId, version.version)?.ready })
  const readyVersion = (id, version) => {
    const row = status(store.version(id, version)); if (!row.ready) issue('VERSION_NOT_READY', 409)
    for (const binding of row.definition.nodeBindings ?? []) capabilities.verify(binding)
    return row
  }
  async function materialize(connection, version) {
    const projection = backendProjection(version)
    let previous
    try { previous = await native(connection, '/workflows/detail?id=' + encodeURIComponent(projection.id)) } catch (error) { if (error.status !== 404) throw error }
    if (previous) {
      const { updatedAt: _, schemaVersion: __, ...content } = previous
      if (canonical(content) !== canonical(projection)) issue('PROJECTION_MISMATCH', 409)
    } else await native(connection, '/workflows', 'POST', projection)
  }
  const setProjectionStatus = (version, ready, error = null) => store.db.prepare('INSERT INTO projection_status VALUES(?,?,?,?) ON CONFLICT(template_id,version) DO UPDATE SET ready=excluded.ready,error=excluded.error').run(version.templateId, version.version, ready ? 1 : 0, error)
  const snapshot = editor => ({ id: editor.workflowId, name: store.template(editor.templateId).name, graph: editor.definition.graph, variables: editor.definition.variables ?? [], inputSchema: editor.definition.inputSchema ?? { fields: [] }, revision: editor.revision })
  const saveEditor = (editor, body) => {
    if (body.id !== editor.workflowId) issue('WRONG_EDITOR_DOCUMENT', 409)
    if (!Number.isSafeInteger(body.__deliveryExpectedRevision)) issue('DRAFT_REVISION_REQUIRED', 409)
    const definition = { ...editor.definition, graph: body.graph, variables: body.variables ?? [], inputSchema: body.inputSchema ?? { fields: [] } }
    // Graph edits never accept client-supplied capability locks. Remove bindings only
    // when their Agent node was deleted or changed to another node type.
    if (definition.qualityPolicies) definition.qualityPolicies = definition.qualityPolicies.filter(policy => body.graph.nodes.some(node => node.id === policy.nodeId))
    if (definition.nodeBindings) definition.nodeBindings = definition.nodeBindings.filter(binding => body.graph.nodes.some(node => node.id === binding.nodeId && node.type === 'agent'))
    const saved = store.saveDraft(editor.templateId, body.__deliveryExpectedRevision, definition)
    editor.definition = saved.definition; editor.revision = saved.revision
    return { ok: true, id: editor.workflowId, name: store.template(editor.templateId).name, updatedAt: new Date().toISOString(), graphFingerprint: graphFingerprint(saved.definition.graph), revision: saved.revision }
  }
  const runtime = await createRunRuntime({ ctx, root, store, capabilities, ensureVersionReady: readyVersion })
  ctx.webServer.register({ kind: 'prefix', path: '/delivery', async handler(req, res) {
    try {
      const url = new URL(req.url, 'http://local'), path = url.pathname
      if (path === '/delivery/api') {
        if (req.method !== 'POST') issue('METHOD_NOT_ALLOWED', 405)
        const body = await readBody(req), action = body.action
        if (action === 'catalog') return json(res, { templates: store.listTemplates(), projects: store.projects() })
        if (action === 'capabilities') return json(res, { capabilities: capabilities.catalog() })
        if (action === 'runs/list') return json(res, { runs: runtime.list(body.projectId) })
        if (action === 'runs/node') return json(res, runtime.nodeDetail(body.requestId,body.nodeId))
        if (action === 'nodes/message') { context(req,body.sessionId); return json(res,runtime.sendNodeMessage(body)) }
        if (action === 'nodes/retry') { context(req,body.sessionId); return json(res,await runtime.restartNode({...body,mode:'retry'})) }
        if (action === 'runs/detail') return json(res, await runtime.detail(body.requestId))
        if (action === 'runs/patch') return json(res, await runtime.patch(body.requestId, body.nodeId, body.alias))
        if (action === 'runs/artifact') return json(res, runtime.artifact(body.requestId, body.artifactId))
        if (['quality/decide', 'quality/recheck', 'runs/cancel', 'runs/recover'].includes(action)) {
          context(req, body.sessionId)
          if (action === 'runs/recover') return json(res, await runtime.recover(body))
          return json(res, action === 'quality/decide' ? runtime.decideQuality(body) : action === 'quality/recheck' ? runtime.recheckQuality(body) : runtime.cancel(body.requestId))
        }
        if (action === 'node/config') {
          const editor = editors.get(body.editorId), draft = store.draft(body.id)
          if (!editor || editor.templateId !== body.id) issue('WRONG_EDITOR_DOCUMENT',409)
          if (draft.revision !== body.expectedRevision) issue('DRAFT_CONFLICT',409)
          const graph = structuredClone(draft.definition.graph), node = graph.nodes.find(node => node.id === body.nodeId)
          if (!node) issue('INVALID_CAPABILITY_NODE')
          if(body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.some(name=>!BASE_TOOLS.some(tool=>tool.name===name)))) issue('NODE_TOOL_UNAVAILABLE')
          node.data = {...node.data,tools:body.tools??node.data.tools, label:body.label, prompt:body.prompt, inputTemplate:body.inputTemplate, provider:body.provider, model:body.model,channel:body.provider || ''}
          for (const key of Object.keys(node.data)) if (node.data[key] === undefined) delete node.data[key]
          const saved = store.saveDraft(body.id,body.expectedRevision,{...draft.definition,graph})
          editor.definition=saved.definition;editor.revision=saved.revision
          return json(res,saved)
        }
        if (action === 'quality-policy/save') {
          const editor = editors.get(body.editorId), draft = store.draft(body.id)
          if (!editor || editor.templateId !== body.id) issue('WRONG_EDITOR_DOCUMENT', 409)
          if (draft.revision !== body.expectedRevision || editor.revision !== body.expectedRevision) issue('DRAFT_CONFLICT', 409)
          if (!draft.definition.graph.nodes.some(node => node.id === body.nodeId) || typeof body.required !== 'boolean') issue('INVALID_QUALITY_POLICY')
          const qualityPolicies = [...(draft.definition.qualityPolicies ?? []).filter(item => item.nodeId !== body.nodeId), ...(body.required ? [{ nodeId: body.nodeId, required: true }] : [])].sort((a,b) => a.nodeId.localeCompare(b.nodeId))
          const saved = store.saveDraft(body.id, body.expectedRevision, { ...draft.definition, qualityPolicies })
          editor.definition = saved.definition; editor.revision = saved.revision
          return json(res, saved)
        }
        if (action === 'project/workflow') {
          const project = store.project(body.projectId)
          return json(res, { version: project.binding ? readyVersion(project.binding.templateId, project.binding.version) : null })
        }
        if (action === 'runs/start') {
          context(req, body.sessionId)
          return json(res, await runtime.start({ requestId: body.requestId, projectId: body.projectId, expectedProjectRevision: body.expectedProjectRevision, inputs: body.inputs ?? {}, triggerInput: body.triggerInput ?? '' }, ctx.sessions.get(body.sessionId).header.cwd))
        }
        if (action === 'template/starter') { const starter = createStarter(capabilities); return json(res, store.create({...starter,name:body.name?.trim() || starter.name})) }
        if (action === 'template/import') { validateDefinition(body.definition); return json(res, store.create({ name: body.name, definition: body.definition })) }
        if (action === 'template/delete') { store.deleteTemplate(body.id); return json(res, {ok:true}) }
        if (action === 'template/restore') return json(res, store.copyVersion(body.id, body.version, body.name))
        if (action === 'create') return json(res, store.create({ name: body.name }))
        if (action === 'detail') return json(res, { template: store.template(body.id), draft: store.draft(body.id), versions: store.versions(body.id).map(status) })
        if (action === 'copy') {
          const source = store.draft(body.id)
          if (source.revision !== body.expectedRevision) issue('DRAFT_CONFLICT', 409)
          return json(res, store.create({ name: body.name, definition: source.definition, source: { templateId: body.id, revision: source.revision } }))
        }
        if (action === 'template/rename') return json(res,store.rename(body.id,body.expectedRevision,body.name))
        if (action === 'archive') { store.archive(body.id); return json(res, { ok: true }) }
        if (action === 'project/update') return json(res,store.updateProject(body.id,body.expectedRevision,{name:body.name,repositories:body.repositories}))
        if (action === 'project/create') return json(res, store.createProject({ id: randomUUID(), name: body.name, repositories: body.repositories }))
        if (action === 'project/bind') { readyVersion(body.binding.templateId, body.binding.version); return json(res, store.bindProject(body.id, body.expectedRevision, body.binding)) }
        if (action === 'roles/save') {
          const draft = store.draft(body.id)
          if (draft.revision !== body.expectedRevision) issue('DRAFT_CONFLICT', 409)
          return json(res, store.saveDraft(body.id, body.expectedRevision, { ...draft.definition, repositoryRoles: body.roles }))
        }
        if (action === 'node/save') {
          const editor = editors.get(body.editorId)
          if (!editor || editor.templateId !== body.id) issue('WRONG_EDITOR_DOCUMENT', 409)
          const draft = store.draft(body.id)
          if (draft.revision !== body.expectedRevision || editor.revision !== body.expectedRevision) issue('DRAFT_CONFLICT', 409)
          if (!draft.definition.graph.nodes.some(node => node.id === body.nodeId && node.type === 'agent')) issue('INVALID_CAPABILITY_NODE')
          if (body.repositoryRole && !(draft.definition.repositoryRoles ?? []).some(role => role.id === body.repositoryRole)) issue('UNKNOWN_REPOSITORY_ROLE')
          const previous = (draft.definition.nodeBindings ?? []).find(binding => binding.nodeId === body.nodeId)
          const selected = capabilities.selection(body.capabilities)
          let frozen
          if (body.keepSnapshot === true) {
            if (!previous || canonical(previous.capabilities) !== canonical(selected)) issue('CAPABILITY_SNAPSHOT_REQUIRED')
            capabilities.verify(previous); frozen = { capabilities: previous.capabilities, packages: previous.packages }
          } else frozen = capabilities.freeze(selected, body.expectedHashes)
          const binding = { schemaVersion: 1, nodeId: body.nodeId, repositoryRole: body.repositoryRole || null, ...frozen }
          const definition = { ...draft.definition, nodeBindings: [...(draft.definition.nodeBindings ?? []).filter(item => item.nodeId !== body.nodeId), binding].sort((a,b) => a.nodeId.localeCompare(b.nodeId)) }
          const saved = store.saveDraft(body.id, body.expectedRevision, definition)
          editor.definition = saved.definition; editor.revision = saved.revision
          return json(res, { ...saved, binding })
        }
        if (action === 'editor/open') {
          const connection = context(req, body.sessionId), draft = store.draft(body.id)
          if (store.template(body.id).archived) issue('TEMPLATE_ARCHIVED', 409)
          const id = randomUUID(), editor = { id, templateId: body.id, workflowId: 'delivery_d_' + id, revision: draft.revision, definition: draft.definition, connection }
          editors.set(id, editor)
          return json(res, { editorId: id, revision: draft.revision, definition: draft.definition, url: '/delivery/editor/' + id + '/' })
        }
        if (action === 'editor/state') {
          const editor = editors.get(body.editorId)
          if (!editor) issue('WRONG_EDITOR_DOCUMENT', 409)
          return json(res, { revision: editor.revision, definition: editor.definition })
        }
        if (action === 'publish') {
          const connection = context(req, body.sessionId), draft = store.draft(body.id)
          if (draft.revision !== body.expectedRevision) issue('DRAFT_CONFLICT', 409)
          validateDefinition(draft.definition)
          for (const node of draft.definition.graph.nodes) {
            if(!['agent','script','input','output'].includes(node.type)) throw new Error('当前交付运行尚未支持节点类型：'+node.type+'。请使用 Agent、JavaScript、输入或输出节点。')
            if(node.type==='agent' && !draft.definition.nodeBindings?.some(binding=>binding.nodeId===node.id && binding.repositoryRole)) throw new Error('请先保存 Agent 节点的能力配置并选择仓库角色：'+(node.data?.label||node.id))
          }
          for (const binding of draft.definition.nodeBindings ?? []) capabilities.verify(binding)
          const lint = await native(connection, '/graph/lint', 'POST', { graph: draft.definition.graph })
          if (!lint.ok) throw Object.assign(new Error(lint.issues.filter(item => item.level === 'error').map(item => item.message).join('\n')), { code: 'GRAPH_INVALID', status: 422 })
          const version = store.publish(body.id, body.expectedRevision)
          try { await materialize(connection, version); setProjectionStatus(version, true) }
          catch (error) { setProjectionStatus(version, false, error.code ?? 'BACKEND_FAILED'); throw error }
          return json(res, status(version))
        }
        issue('UNKNOWN_ACTION')
      }
      const match = /^\/delivery\/editor\/([^/]+)(\/.*)?$/.exec(path)
      if (!match || !editors.has(match[1])) issue('NOT_FOUND', 404)
      const editor = editors.get(match[1]), rest = match[2] ?? '/'
      if (rest === '/' && req.method === 'GET') {
        const initial = { editorId: editor.id, templateId: editor.templateId, revision: editor.revision, definition:editor.definition, catalog:capabilities.catalog() }
        const html = readFileSync(join(upstream, 'dsh-ccpg-web/web-dist/index.html'), 'utf8').replace('window.__WF1_API_BASE__="/wf1";', `window.__WF1_API_BASE__=${JSON.stringify('/delivery/editor/' + editor.id)};window.__DELIVERY_EDITOR__=${JSON.stringify(initial).replaceAll('<', '\\u003c')};`)
          .replace('<title>物业智能体工作流编排 MVP</title>', '<title>工作流模板编辑</title>').replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" /><script>' + config.editorGatewayScript + '</script><script>' + readFileSync(new URL('./editor-bridge.js', import.meta.url),'utf8') + '</script>')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html); return
      }
      if (!rest.startsWith('/api/')) issue('NOT_FOUND', 404)
      const apiPath = rest.slice(4), method = req.method
      if (apiPath === '/tools' && method === 'GET') return json(res, {tools:BASE_TOOLS,feishuEnabled:false,notificationChannels:[]})
      if (apiPath === '/skills' && method === 'GET') return json(res, {skills:[]})
      if (apiPath === '/lark-auth' && method === 'GET') return json(res, {status:null,enabled:false})
      if (apiPath === '/graph' && method === 'GET') return json(res, { ...editor.definition.graph, workflowId: editor.workflowId })
      if (apiPath === '/workflows' && method === 'GET') return json(res, { workflows: [{ id: editor.workflowId, name: store.template(editor.templateId).name, nodeCount: editor.definition.graph.nodes.length, agentCount: editor.definition.graph.nodes.filter(node => node.type === 'agent').length }] })
      if (apiPath === '/workflows/detail' && method === 'GET') {
        if (url.searchParams.get('id') !== editor.workflowId) issue('WRONG_EDITOR_DOCUMENT', 409)
        return json(res, snapshot(editor))
      }
      if (apiPath === '/workflows' && method === 'POST') return json(res, saveEditor(editor, await readBody(req)))
      if (apiPath === '/runs' && method === 'GET') return json(res, { runs: [] })
      if (apiPath === '/state' && method === 'GET') return json(res, { running: [], lastRun: null })
      if (apiPath === '/events' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write('event: snapshot\ndata: {"running":[],"lastRun":null}\n\n')
        streams.add(res); res.on('close', () => streams.delete(res)); return
      }
      if (apiPath.startsWith('/assistant/')) return json(res, { ok: true, version: 0, patch: [], graph: editor.definition.graph })
      const allowedPosts = ['/graph/lint', '/template/render', '/template/validate', '/variables/describe']
      if (method === 'GET' || (method === 'POST' && allowedPosts.includes(apiPath))) {
        const body = method === 'POST' ? await readBody(req) : undefined
        // Read catalogs and native lint only; editor drafts cannot start executions.
        return json(res, await native(editor.connection, apiPath + url.search, method, body))
      }
      issue('EDITOR_OPERATION_UNAVAILABLE', 409)
    } catch (error) {
      if (res.headersSent) { res.end(); return }
      const code = error.code ?? 'REQUEST_FAILED'
      json(res, { error: messages[code] ?? error.message, code }, error.status ?? (['DRAFT_CONFLICT', 'PROJECT_CONFLICT'].includes(code) ? 409 : 400))
    }
  } })
  ctx.on('dispose', () => { for (const response of streams) response.end(); store.close() })
}
