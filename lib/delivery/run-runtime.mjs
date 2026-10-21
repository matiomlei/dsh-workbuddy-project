/** Isolated business-run bridge. Native Workflow One still owns DAG scheduling. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ContractError, canonical, digest, validateDefinition } from './template-store.mjs'
import { RunCheckpoints, recoveryPlan, checkpointResult } from './run-checkpoints.mjs'
import { QualityLedger } from './quality-ledger.mjs'
import { admitDeliveryNode } from './prerequisites.mjs'
import { snapshotGit, initializeCodeStores, createNodeWorktrees, prepareCodeInput, snapshotCodeOutput } from './code-handoff.mjs'
const exec = promisify(execFile)
const fail = (code, message = code) => { throw new ContractError(code, message) }
const activeStates = ['preparing', 'ready', 'starting', 'running', 'recovering']
export async function createRunRuntime({ ctx, root, store, capabilities, ensureVersionReady }) {
  const db = store.db, inFlight = new Map(), deployments = new Map(), disposers = new Map()
  const quality = new QualityLedger(db), qualityWaiters = new Map(), checkpoints = new RunCheckpoints(db), replayed = new Map()
  let backend
  db.exec(`CREATE TABLE IF NOT EXISTS delivery_jobs(request_id TEXT PRIMARY KEY,intent_hash TEXT NOT NULL,document_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS recovery_commands(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,intent_hash TEXT NOT NULL);`)
  const read = key => { const row = db.prepare('SELECT * FROM delivery_jobs WHERE request_id=?').get(key); if (!row) fail('RUN_NOT_FOUND'); return { ...JSON.parse(row.document_json), intentHash: row.intent_hash } }
  const save = job => {
    const { intentHash, ...document } = job
    // Native live states contain optional undefined properties; normalize them
    // at this external-data boundary before applying the strict domain encoder.
    const plain = JSON.parse(JSON.stringify(document))
    db.prepare('UPDATE delivery_jobs SET document_json=? WHERE request_id=?').run(canonical(plain), job.requestId)
    return { ...plain, intentHash }
  }
  const jobs = () => db.prepare('SELECT request_id FROM delivery_jobs ORDER BY rowid DESC').all().map(row => read(row.request_id))
  const byNative = id => jobs().find(job => job.nativeRunId === id)
  for (const job of jobs()) if (activeStates.includes(job.status)) save({ ...job, status: 'interrupted', recoveries:(job.recoveries??[]).map(item=>['preparing','running'].includes(item.status)?{...item,status:'interrupted',finishedAt:new Date().toISOString()}:item), error: '宿主已重启。可检查固定输出与质量记录后显式恢复；结果不确定的执行不会自动重跑。' })
  async function git(cwd, args) {
    const { stdout } = await exec('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { encoding: 'utf8', timeout: 20000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' } })
    return args.includes('-z') ? stdout : stdout.trim()
  }
  async function repositories(project) {
    const result = []
    for (const repo of project.repositories) {
      let path = repo.url
      if (path.startsWith('file:')) { const url = new URL(path); if (url.host) fail('LOCAL_GIT_ONLY'); path = fileURLToPath(url) }
      if (!isAbsolute(path)) fail('LOCAL_GIT_ONLY', '请先用 Git 将仓库克隆到本机，再填写本机仓库根目录。')
      path = realpathSync(path)
      if (realpathSync(await git(path, ['rev-parse', '--show-toplevel'])) !== path) fail('GIT_ROOT_REQUIRED')
      // --end-of-options prevents a ref from becoming an option or command.
      const commit = await git(path, ['rev-parse', '--verify', '--end-of-options', repo.ref + '^{commit}'])
      if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) fail('COMMIT_REQUIRED')
      result.push({ alias: repo.alias, path, commit })
    }
    return result
  }
  function manifest(job) { return job.businessRunId ? store.run(job.businessRunId) : null }
  function view(job) {
    const frozen = manifest(job), qualitySubjects = quality.list(job.requestId)
    const required = frozen?.definition.qualityPolicies ?? []
    const latest = required.map(policy => qualitySubjects.filter(item => item.evidence.nodeId === policy.nodeId).at(-1))
    const qualityStatus = !required.length ? 'not_evaluated' : latest.some(item => item?.status === 'failed') ? 'failed' : latest.every(item => item?.status === 'passed') ? 'passed' : qualitySubjects.length ? 'pending' : 'not_evaluated'

    return { requestId: job.requestId, businessRunId: job.businessRunId ?? null, nativeRunId: job.nativeRunId, projectId: job.projectId,
      status: job.status, executionStatus: job.executionStatus ?? null, qualityStatus, qualitySubjects, qualityRequiredNodes: required.map(item => item.nodeId), qualityUnconfiguredNodes: frozen?.definition.graph.nodes.filter(node => !required.some(item => item.nodeId === node.id)).map(node => node.id) ?? [], error: job.error ?? null,
      startedAt: job.startedAt, finishedAt: job.finishedAt ?? null, template: frozen?.template ?? null,
      models: frozen?.execution?.models ?? {}, repositories: frozen?.repositories ?? [], graph: frozen?.definition.graph ?? null, nodeStates: job.nodeStates ?? {},
      artifacts: (job.artifacts ?? []).map(({ path, ...item }) => item),
      artifactErrors: job.artifactErrors ?? [],
      codeHandoffs: job.codeHandoffs ?? {},
      codeAttempts: job.codeAttempts ?? {},
      recovery: job.status === 'interrupted' ? inspectRecovery(job) : null,
      recoveries: job.recoveries ?? [],
    }
  }
  async function prepare(job, intent) {
    const project = store.project(intent.projectId)
    if (project.revision !== intent.expectedProjectRevision) fail('PROJECT_CONFLICT')
    if (!project.binding) fail('WORKFLOW_BINDING_REQUIRED')
    const version = ensureVersionReady(project.binding.templateId, project.binding.version)
    if (version.definition.dependencies?.globalVariables?.length) fail('GLOBAL_VARIABLE_FREEZE_NOT_READY')
    validateDefinition(version.definition)
    const bindings = version.definition.nodeBindings ?? []
    for (const node of version.definition.graph.nodes) {
      if (!['agent', 'script', 'input', 'output'].includes(node.type)) fail('RUNTIME_NODE_TYPE_NOT_READY', '当前执行接入尚不支持节点类型：' + node.type)
      if (node.type === 'agent') {
        const binding = bindings.find(binding => binding.nodeId === node.id)
        if (!binding?.repositoryRole) fail('NODE_BINDING_REQUIRED', '请先为每个 Agent 节点保存能力配置并选择仓库角色。')
        capabilities.verify(binding)
      }
    }
    const models = {}, selected = ctx.agentDefaultModel.currentSelection() ?? {}
    for (const node of version.definition.graph.nodes.filter(node => node.type === 'agent')) {
      const provider = node.data?.provider || selected.provider
      const model = node.data?.model || (provider === selected.provider ? selected.model : null) || (provider ? (await ctx.llm.listModels(provider))[0]?.id : null)
      if (!provider || !model) fail('MODEL_REQUIRED', '请先在 DSH 设置中选择可用模型，或为 Agent 节点指定模型。')
      await ctx.llm.resolveModelInfo(provider, model)
      models[node.id] = { provider, model }
    }
    const resolved = await repositories(project)
    const frozen = store.prepareRun({ ...intent, execution: { models }, repositoryCommits: Object.fromEntries(resolved.map(repo => [repo.alias, repo.commit])) })
    job = save({ ...job, businessRunId: frozen.businessRunId, nodes: {}, codeHandoffs: {}, codeAttempts: {}, artifacts: [], artifactErrors: [] })
    job = save({ ...job, repositories: await initializeCodeStores(join(root, 'runs', frozen.businessRunId), resolved) })
    job = await registerDeployments(job, frozen)
    return save({ ...job, status: 'ready', preparationComplete: true })
  }
  async function registerDeployments(job, frozen, reuse = false) {
    const prepared = new Map(), cleanup = []
    disposers.set(job.nativeRunId, cleanup)
    for (const node of frozen.definition.graph.nodes.filter(node => node.type === 'agent')) {
      const binding = (frozen.definition.nodeBindings ?? []).find(binding => binding.nodeId === node.id), nodeRoot = join(root, 'runs', frozen.businessRunId, 'nodes', digest(node.id).slice(0, 20))
      const worktrees = reuse ? job.nodes[node.id].worktrees : await createNodeWorktrees(nodeRoot, job.repositories)
      const alias = frozen.repositoryMap[binding.repositoryRole], cwd = worktrees[alias]
      if (!cwd) fail('INVALID_REPOSITORY_MAPPING')
      const preset = capabilities.preparePreset(binding, { id: 'delivery_node_' + digest([frozen.businessRunId, node.id]).slice(0, 24), directory: join(nodeRoot, 'preset'), cwd })
      cleanup.push(await ctx.agentPresets.register({ id: preset.id, plugins: preset.plugins }))
      prepared.set(node.id, { cwd, presetId: preset.id, ...frozen.execution.models[node.id],
        async install(agentCtx, agent) {
          const all = agentCtx.tools.schemas(agent).map(tool => tool.name)
          const defaults = all.filter(name => ['read', 'write', 'skill', 'bash'].includes(name) || preset.mcpTools.some(prefix => name.startsWith(prefix)))
          const selected = node.data?.tools?.length ? node.data.tools : defaults
          if (!Array.isArray(selected) || selected.some(name => !all.includes(name) || !defaults.includes(name))) fail('NODE_TOOL_UNAVAILABLE', '节点所选工具不存在或不在本轮能力范围。')
          agentCtx.tools.guard(exec => exec.name !== 'run_code' && !selected.includes(exec.name) ? 'DELIVERY_NODE_TOOL_DENIED' : undefined)
          agentCtx.tools.restrict({ allow: selected })
          agentCtx.systemPrompt.section({ name: 'delivery:repositories', order: 7, text: '本次运行的仓库工作目录：\n' + Object.entries(worktrees).map(([alias, path]) => `${alias}: ${path}`).join('\n') })
          const skills = (await agentCtx.get('skills').list({ scope: agent, cwd })).map(skill => skill.name)
          const current = read(job.requestId)
          current.nodes[node.id] = { ...current.nodes[node.id], sessionId: String(agent.id), visibleTools: agentCtx.tools.schemas(agent).map(tool => tool.name), skills }
          save(current)
        },
      })
      job.nodes[node.id] = { ...job.nodes[node.id], presetId: preset.id, cwd, worktrees }
    }
    deployments.set(job.nativeRunId, prepared)
    return save(job)
  }
  async function disposePresets(id) { const clean = disposers.get(id) ?? []; disposers.delete(id); deployments.delete(id); replayed.delete(id); for (const dispose of clean.reverse()) await dispose() }
  function observeExecution(job, result) {
    const generation = job.nativeRunId
    result.promise.then(async run => {
      const current = read(job.requestId)
      if (current.nativeRunId !== generation) return
      const status = run?.status === 'success' ? 'execution_succeeded' : run?.status === 'canceled' ? 'canceled' : 'execution_failed'
      const recoveries = (current.recoveries ?? []).map(item => item.nativeRunId === generation ? { ...item, status, finishedAt: new Date().toISOString() } : item)
      save({ ...current, status, executionStatus: run?.status ?? 'error', nodeStates: run?.nodeStates ?? {}, recoveries, finishedAt: new Date().toISOString(), error: run ? null : '后端未返回运行结果。' })
      try { await disposePresets(generation) }
      catch (error) { if (read(job.requestId).nativeRunId === generation) save({ ...read(job.requestId), cleanupError: error.message }) }
    }).catch(error => { if (read(job.requestId).nativeRunId === generation) save({ ...read(job.requestId), status: 'execution_failed', error: error.message }); void disposePresets(generation) })
  }
  function inspectRecovery(job) {
    try { return recoveryPlan({job,manifest:manifest(job),checkpoints:checkpoints.list(job.requestId),subjects:quality.list(job.requestId)}) }
    catch (error) { return { eligible: false, reasons: [{code:error.code ?? 'CHECKPOINT_UNREADABLE',nodeId:null}], completed:[], waiting:[], unstarted:[], digest:null } }
  }
  async function verifyRecoveryFiles(job, frozen) {
    const runRoot = join(root, 'runs', frozen.businessRunId)
    if (job.repositories?.length !== frozen.repositories.length) fail('RECOVERY_REPOSITORIES_CHANGED')
    for (const repo of job.repositories) {
      const expected = join(runRoot, 'repositories', digest(repo.alias).slice(0,20)+'.git')
      if (!frozen.repositories.some(item => item.alias === repo.alias && item.commit === repo.commit) || realpathSync(repo.objectStore) !== realpathSync(expected)) fail('RECOVERY_REPOSITORIES_CHANGED')
      await snapshotGit(repo.objectStore, ['fsck', '--full', '--no-reflogs'])
      const commits = [repo.commit, ...Object.values(job.codeHandoffs ?? {}).flatMap(h => h.repositories.filter(r => r.alias === repo.alias).flatMap(r => [r.inputCommit,r.outputCommit]))]
      for (const commit of new Set(commits)) if (await snapshotGit(repo.objectStore, ['cat-file','-t',commit]) !== 'commit') fail('RECOVERY_COMMIT_MISSING')
    }
    for (const node of frozen.definition.graph.nodes.filter(node => node.type === 'agent')) {
      const binding = frozen.definition.nodeBindings.find(item => item.nodeId === node.id)
      capabilities.verify(binding)
      for (const repo of job.repositories) {
        const expected = join(runRoot,'nodes',digest(node.id).slice(0,20),'worktrees',digest(repo.alias).slice(0,20)), cwd = job.nodes[node.id]?.worktrees?.[repo.alias]
        if (!cwd || realpathSync(cwd) !== realpathSync(expected) || realpathSync(resolve(cwd, await snapshotGit(cwd,['rev-parse','--git-common-dir']))) !== realpathSync(repo.objectStore)) fail('RECOVERY_WORKTREE_CHANGED')
      }
    }
    for (const artifact of job.artifacts ?? []) if (artifact.change !== 'deleted') {
      if (realpathSync(artifact.path) !== realpathSync(join(runRoot,'artifacts',artifact.id)) || createHash('sha256').update(readFileSync(artifact.path)).digest('hex') !== artifact.sha256) fail('RECOVERY_ARTIFACT_CHANGED')
    }
  }
  async function recover(body) {
    if (!backend) fail('RUNTIME_NOT_READY')
    const intent = { requestId:body.requestId, recoveryId:body.recoveryId, expectedNativeRunId:body.expectedNativeRunId, expectedPlanDigest:body.expectedPlanDigest }
    if (typeof intent.recoveryId !== 'string' || !intent.recoveryId.trim()) fail('INVALID_INPUT')
    const prior = db.prepare('SELECT * FROM recovery_commands WHERE id=?').get(intent.recoveryId)
    if (prior) {
      if (prior.request_id !== intent.requestId || prior.intent_hash !== digest(intent)) fail('RECOVERY_IDEMPOTENCY_CONFLICT')
      if (inFlight.has(intent.requestId)) await inFlight.get(intent.requestId)
      return view(read(intent.requestId))
    }
    let job = read(intent.requestId), plan = inspectRecovery(job)
    if (job.status !== 'interrupted' || job.nativeRunId !== intent.expectedNativeRunId) fail('RECOVERY_STATE_CONFLICT')
    if (!plan.eligible) fail('RECOVERY_NOT_SAFE', '存在缺失或不确定的执行记录，不能自动恢复。')
    if (plan.digest !== intent.expectedPlanDigest) fail('RECOVERY_PLAN_CONFLICT')
    const fromNativeRunId = job.nativeRunId, nextNativeRunId = 'delivery_native_' + randomUUID(), frozen = manifest(job)
    const record = { id:intent.recoveryId, fromNativeRunId, nativeRunId:nextNativeRunId, status:'preparing', completed:plan.completed, waiting:plan.waiting, unstarted:plan.unstarted, startedAt:new Date().toISOString(), planDigest:plan.digest }
    job = store.transaction(() => {
      db.prepare('INSERT INTO recovery_commands VALUES(?,?,?)').run(intent.recoveryId, intent.requestId, digest(intent))
      return save({...job,status:'recovering',error:null,recoveries:[...(job.recoveries ?? []),record]})
    })
    const work = (async () => {
      try {
        const previous = backend.read({nativeRunId:fromNativeRunId,workspaceRoot:job.workspaceRoot})
        if (previous?.canceled || previous?.status === 'canceled') fail('RECOVERY_CANCELED_RUN')
        await verifyRecoveryFiles(job, frozen)
        const fixed = checkpoints.list(job.requestId), selected = new Map(fixed.filter(cp => plan.checkpoints.some(item => item.digest === cp.digest)).map(cp => [cp.nodeId, cp]))
        const seed = {runId:fromNativeRunId,nodeStates:{},outputs:{},structuredOutputs:{}}
        for (const id of plan.completed) {
          const cp = selected.get(id)
          seed.nodeStates[id] = {...cp.result.extra,status:'success',chars:cp.result.output.length,executionRestored:true}
          seed.outputs[id] = cp.result.output; seed.structuredOutputs[id] = cp.result.structuredOutput
        }
        job = save({...read(job.requestId),nativeRunId:nextNativeRunId,resumeSeedHash:digest(seed),nodeStates:seed.nodeStates,executionStatus:null,finishedAt:null})
        job = await registerDeployments(job, frozen, true)
        replayed.set(nextNativeRunId, new Map(plan.waiting.map(id => [id, selected.get(id)])))
        job = save({...job,status:'ready'})
        const result = backend.start({manifest:frozen,nativeRunId:nextNativeRunId,workspaceRoot:job.workspaceRoot,resumeSeed:seed})
        job = save({...read(job.requestId),status:'running',recoveries:read(job.requestId).recoveries.map(item=>item.id===intent.recoveryId?{...item,status:'running'}:item)})
        observeExecution(job,result)
      } catch (error) {
        try { backend.cancel({ nativeRunId: nextNativeRunId }) } catch {}
        await disposePresets(nextNativeRunId)
        const current = read(intent.requestId)
        save({...current,nativeRunId:fromNativeRunId,status:'interrupted',error:error.message,recoveries:current.recoveries.map(item=>item.id===intent.recoveryId?{...item,status:'blocked',error:error.message,code:error.code ?? 'RECOVERY_FAILED',finishedAt:new Date().toISOString()}:item)})
      }
    })()
    inFlight.set(job.requestId,work)
    try { await work } finally { inFlight.delete(job.requestId) }
    return view(read(job.requestId))
  }
  async function start(intent, workspaceRoot) {
    if (!backend) fail('RUNTIME_NOT_READY')
    workspaceRoot = realpathSync(workspaceRoot)
    if (typeof intent.requestId !== 'string' || !intent.requestId.trim() || typeof intent.triggerInput !== 'string') fail('INVALID_INPUT')
    const intentHash = digest(intent), prior = db.prepare('SELECT 1 FROM delivery_jobs WHERE request_id=?').get(intent.requestId)
    if (prior) {
      const job = read(intent.requestId)
      if (job.intentHash !== intentHash) fail('IDEMPOTENCY_CONFLICT')
      if (inFlight.has(intent.requestId)) await inFlight.get(intent.requestId)
      return view(read(intent.requestId))
    }
    let job = { requestId: intent.requestId, intentHash, nativeRunId: 'delivery_native_' + randomUUID(), projectId: intent.projectId, workspaceRoot, status: 'preparing', startedAt: new Date().toISOString() }
    const { intentHash: _, ...document } = job
    db.prepare('INSERT INTO delivery_jobs VALUES(?,?,?)').run(intent.requestId, intentHash, canonical(document))
    const work = (async () => {
      try {
        job = await prepare(job, intent)
        const result = backend.start({ manifest: manifest(job), nativeRunId: job.nativeRunId, workspaceRoot })
        // authorizeStart has already atomically claimed this prepared run.
        job = save({ ...read(job.requestId), status: 'running' })
        observeExecution(job, result)
      } catch (error) {
        save({ ...read(intent.requestId), status: 'preparation_failed', error: error.message, code: error.code ?? 'PREPARATION_FAILED', finishedAt: new Date().toISOString() })
        await disposePresets(job.nativeRunId)
      }
    })()
    inFlight.set(intent.requestId, work)
    try { await work } finally { inFlight.delete(intent.requestId) }
    return view(read(intent.requestId))
  }
  const service = {
    attach(value) { backend = value },
    admitNode: admitDeliveryNode,
    async executeNode(execCtx, execute) {
      if (!execCtx.workflowId?.startsWith('delivery_v_')) return execute()
      const initial = byNative(execCtx.runId)
      if (!initial || !deployments.has(execCtx.runId)) throw Object.assign(new ContractError('NODE_DEPLOYMENT_REQUIRED', '节点运行准备记录不存在。'), { handoffBlocked: true })
      const restored = replayed.get(execCtx.runId)?.get(execCtx.node.id)
      if (restored) {
        execCtx.s.run.nodeStates[execCtx.node.id].executionRestored = true
        return checkpointResult(restored)
      }
      const { node, signal, s } = execCtx, requestId = initial.requestId
      const attempt = (initial.codeAttempts?.[node.id]?.length ?? 0) + 1
      const record = { attempt, status: 'preparing', startedAt: new Date().toISOString() }
      initial.codeAttempts[node.id] = [...(initial.codeAttempts[node.id] ?? []), record]
      delete initial.codeHandoffs[node.id]
      save(initial)
      const updateAttempt = value => {
        const current = read(requestId), attempts = current.codeAttempts[node.id]
        attempts[attempts.length - 1] = { ...attempts[attempts.length - 1], ...value }
        return save(current)
      }
      const runRoot = join(root, 'runs', initial.businessRunId)
      try {
        const inputs = await prepareCodeInput({ runRoot, node, graph: manifest(initial).definition.graph, repositories: initial.repositories, nodeStates: s.run.nodeStates, handoffs: initial.codeHandoffs, worktrees: initial.nodes[node.id]?.worktrees, attempt, signal })
        updateAttempt({ status: 'executing', repositories: inputs })
        const result = await execute()
        const snapshot = await snapshotCodeOutput({ runRoot, node, repositories: initial.repositories, inputs, worktrees: initial.nodes[node.id]?.worktrees, attempt, signal })
        // Synchronous read/modify/save after awaits preserves parallel-node updates.
        const current = read(requestId), evidence = { attempt, status: 'ready', repositories: snapshot.repositories, artifactIds: snapshot.artifacts.map(item => item.id) }
        current.codeHandoffs[node.id] = evidence
        current.artifacts = [...current.artifacts.filter(item => item.nodeId !== node.id), ...snapshot.artifacts]
        const attempts = current.codeAttempts[node.id]
        attempts[attempts.length - 1] = { ...attempts[attempts.length - 1], ...evidence, finishedAt: new Date().toISOString() }
        save(current)
        return result
      } catch (error) {
        const details = { status: error.code === 'CODE_MERGE_CONFLICT' ? 'conflict' : 'failed', error: error.message, code: error.code ?? 'NODE_EXECUTION_FAILED', files: error.files ?? [], repository: error.repository ?? null, sources: error.sources ?? [], finishedAt: new Date().toISOString() }
        updateAttempt(details)
        throw error
      }
    },
    async awaitNodeCompletion(execCtx, result, suspend) {
      if (!execCtx.workflowId?.startsWith('delivery_v_')) return
      try {
        const job = byNative(execCtx.runId), frozen = job && manifest(job)
        if (!job) fail('NODE_DEPLOYMENT_REQUIRED')
        const sealed = job.codeHandoffs[execCtx.node.id]
        if (!sealed) fail('CHECKPOINT_HANDOFF_MISSING')
        checkpoints.put({requestId:job.requestId,businessRunId:job.businessRunId,nodeId:execCtx.node.id,attempt:sealed.attempt,handoff:sealed,artifacts:job.artifacts.filter(item=>item.nodeId===execCtx.node.id),result})
        if (!frozen?.definition.qualityPolicies?.some(item => item.nodeId === execCtx.node.id && item.required)) return
        const nodeId = execCtx.node.id, handoff = job.codeHandoffs[nodeId]
        if (!handoff || execCtx.signal.aborted) throw Object.assign(new Error('运行已取消'), { handoffBlocked: true })
        const subject = quality.create({ requestId: job.requestId, businessRunId: job.businessRunId, template: frozen.template, nodeId, attempt: handoff.attempt, handoff, artifacts: job.artifacts.filter(item => item.nodeId === nodeId), result })
        await new Promise((resolve, reject) => {
          const cleanup = () => { qualityWaiters.delete(subject.id); execCtx.signal.removeEventListener('abort', abort) }
          const abort = () => { cleanup(); reject(Object.assign(new Error('运行已取消'), { handoffBlocked: true })) }
          const update = () => {
            const current = quality.list(job.requestId).find(item => item.id === subject.id)
            if (current.status === 'passed') { cleanup(); resolve(); return }
            execCtx.s.run.nodeStates[nodeId] = { ...execCtx.s.run.nodeStates[nodeId], status: 'waiting_quality', executionStatus: 'success', qualityStatus: current.status, qualitySubjectId: subject.id }
            execCtx.emit('node-status', { runId: job.nativeRunId, nodeId, ...execCtx.s.run.nodeStates[nodeId] })
          }
          qualityWaiters.set(subject.id, { requestId: job.requestId, nodeId, attempt: handoff.attempt, update })
          execCtx.signal.addEventListener('abort', abort, { once: true })
          update()
          suspend()
        })
      } catch (error) { throw Object.assign(error, { handoffBlocked: true }) }
    },
    authorizeStart({ runId, workflowId, graph, runInputs, workspaceRoot, resume }) {
      if (!workflowId?.startsWith('delivery_v_')) return
      const job = byNative(runId), frozen = job && manifest(job)
      if (!job || job.status !== 'ready' || digest(resume ?? null) !== (job.resumeSeedHash ?? digest(null)) || frozen.backendWorkflowId !== workflowId || canonical(frozen.definition.graph) !== canonical(graph) || canonical(frozen.inputs) !== canonical(runInputs) || job.workspaceRoot !== workspaceRoot) throw Object.assign(new Error('请从业务运行入口启动固定版本。'), { code: 'DELIVERY_RUN_NOT_PREPARED', status: 409 })
      save({ ...job, status: 'starting' })
    },
    deploymentFor(node, run) {
      if (!run.workflowId?.startsWith('delivery_v_')) return undefined
      const deployment = deployments.get(run.runId)?.get(node.id)
      if (!deployment) fail('NODE_DEPLOYMENT_REQUIRED')
      return deployment
    },
  }
  ctx.provide('deliveryRuntime', service)
  ctx.on('dispose', async () => { for (const id of disposers.keys()) await disposePresets(id) })
  async function detail(requestId) {
    const job = read(requestId)
    const native = job.businessRunId && backend?.read({ nativeRunId: job.nativeRunId, workspaceRoot: job.workspaceRoot })
    const result = view(job)
    const nodeStates = { ...(native?.nodeStates ?? job.nodeStates ?? {}) }
    if (job.status === 'interrupted' && result.recovery?.eligible) {
      for (const id of result.recovery.completed) nodeStates[id] = { status:'success',executionRestored:true }
      for (const id of result.recovery.waiting) nodeStates[id] = { status:'waiting_quality',executionStatus:'success' }
    }
    return { ...result, nodeStates, outputs: native?.outputs ?? Object.fromEntries(checkpoints.list(requestId).map(cp=>[cp.nodeId,cp.result.output])), ...(job.status === 'preparation_failed' ? { code: job.code } : {}) }
  }
  function artifact(requestId, artifactId) {
    const item = (read(requestId).artifacts ?? []).find(item => item.id === artifactId)
    if (!item) fail('ARTIFACT_NOT_FOUND')
    if (item.change === 'deleted') return { name: item.name, sha256: null, content: '此节点删除了该文件。', change: 'deleted' }
    const bytes = readFileSync(item.path)
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) fail('ARTIFACT_CHANGED')
    if (bytes.length > 256 * 1024 || bytes.includes(0)) fail('ARTIFACT_PREVIEW_UNAVAILABLE', '该文件暂不支持文本预览。')
    return { name: item.name, sha256: item.sha256, content: bytes.toString('utf8') }
  }
  function liveSubject(body) {
    const job = read(body.requestId), subject = quality.subject(body.subjectId), waiter = qualityWaiters.get(subject.id)
    if (subject.evidence.requestId !== job.requestId || subject.digest !== body.subjectDigest || subject.evidence.nodeId !== body.nodeId || subject.evidence.attempt !== body.attempt) fail('QUALITY_SUBJECT_MISMATCH')
    const handoff = job.codeHandoffs?.[body.nodeId]
    if (job.status !== 'running' || !waiter || waiter.requestId !== job.requestId || handoff?.attempt !== body.attempt) fail('QUALITY_RUN_NOT_WAITING', '该检查不再等待：运行可能已取消或中断；请先恢复中断运行，再检查当前轮次。')
    return { job, subject, waiter }
  }
  function decideQuality(body) {
    const intent = Object.fromEntries(['decisionId','requestId','subjectId','subjectDigest','nodeId','attempt','reviewId','outcome','note'].map(key => [key,body[key]]))
    const prior = quality.prior(intent)
    if (prior) return prior
    const { waiter } = liveSubject(body)
    const decision = quality.decide(intent)
    waiter.update()
    return decision
  }
  function recheckQuality(body) {
    const { waiter } = liveSubject(body)
    const review = quality.open(body.subjectId, body.expectedReviewId)
    waiter.update()
    return review
  }
  function cancel(requestId) {
    const job = read(requestId)
    if (!backend?.cancel({ nativeRunId: job.nativeRunId })) fail('RUN_NOT_ACTIVE')
    return { ok: true }
  }
  async function patch(requestId, nodeId, alias) {
    const job = read(requestId), sealed = job.codeHandoffs?.[nodeId], repo = job.repositories?.find(item => item.alias === alias)
    const output = sealed?.repositories.find(item => item.alias === alias)
    if (!output || !repo) fail('CODE_OUTPUT_NOT_FOUND')
    const content = await snapshotGit(repo.objectStore, ['diff', '--binary', '--full-index', repo.commit, output.outputCommit], { bytes: true })
    return { name: `${alias}-${nodeId}.patch`, content: content.toString('base64'), encoding: 'base64', baseCommit: repo.commit, outputCommit: output.outputCommit }
  }
  return { start, recover, detail, artifact, patch, decideQuality, recheckQuality, cancel, list: projectId => jobs().filter(job => (!projectId || job.projectId === projectId)).map(view) }
}
