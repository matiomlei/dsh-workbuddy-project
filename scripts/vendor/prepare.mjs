/** Copy a fixed upstream orchestrator; never modify its original or a live profile. */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const [sourceArg, targetArg] = process.argv.slice(2)
if (!sourceArg || !targetArg) throw new Error('Usage: node prepare-native.mjs <published-orchestrator> <new-target>')
const source = resolve(sourceArg), target = resolve(targetArg)
const runtime = process.argv[4] === '--runtime'
if (existsSync(target)) throw new Error('Target must not exist')
const expected = { 'lib/index.js': '6f7aae750285a7fb02463ddaf9d4ba6153557f8d297d9541bfaba9aa96f57c03', 'lib/sqlite-store.js': '3471d185662e4c9d84e9b3ecd9788d79601908a51efd993e7219cf4586db9e3a' }
if (runtime) expected['lib/engine.js'] = 'a428c533cdeaa9a6cb2a38d2f82dacf58ea36288aaa6d910091d56df485a307e'
for (const [file, hash] of Object.entries(expected)) {
  if (createHash('sha256').update(readFileSync(join(source, file))).digest('hex') !== hash) throw new Error('Unexpected upstream file: ' + file)
}
const edited = new Map()
function patch(file, before, after) {
  const text = edited.get(file) ?? readFileSync(join(source, file), 'utf8')
  if (text.split(before).length !== 2) throw new Error('Patch anchor must occur once: ' + file)
  edited.set(file, text.replace(before, after))
}
const guardPath = '../../../delivery/projection-guard.mjs'
patch('lib/sqlite-store.js', "import { DatabaseSync } from 'node:sqlite';", `import { DatabaseSync } from 'node:sqlite';\nimport { guardProjection } from ${JSON.stringify(guardPath)};`)
patch('lib/sqlite-store.js', '  putWorkflow(value) {\n    return this.#runWorkflowStatement', "  putWorkflow(value) {\n    guardProjection(value.id, 'write', value, !!this.getWorkflow(value.id));\n    return this.#runWorkflowStatement")
patch('lib/sqlite-store.js', '  deleteWorkflow(id) {\n    return Number', "  deleteWorkflow(id) {\n    guardProjection(id, 'delete');\n    return Number")
patch('lib/index.js', '    if (res.writableEnded) return undefined;\n    if (error instanceof RequestBodyError) {', "    if (res.writableEnded) return undefined;\n    if (String(error?.code || '').startsWith('DELIVERY_')) return json(res, error.status || 409, { error: error.message, code: error.code });\n    if (error instanceof RequestBodyError) {")
if (runtime) {
  patch('lib/engine.js', '    this.nodeRunner = null;', '    this.admitNode = null;\n    this.executeNode = null;\n    this.awaitNodeCompletion = null;\n    this.nodeRunner = null;')
  patch('lib/engine.js', '    if (node.__retryLeft === undefined) node.__retryLeft = this._retryTotal(node);', `    const admission = this.admitNode?.({ node, run, s });
    if (admission?.blocked) {
      run.nodeStates[nodeId] = { status: 'skipped', blockedBy: admission.blockedBy, error: admission.reason };
      this.emit('node-status', { runId: run.runId, nodeId, ...run.nodeStates[nodeId] });
      if (releaseSlot) s.activeCount -= 1;
      this._onNodeDone(s, nodeId, true);
      return;
    }
    if (node.__retryLeft === undefined) node.__retryLeft = this._retryTotal(node);`)
  patch('lib/engine.js', "Object.values(run.nodeStates).some((st) => st.status === 'error')", "Object.values(run.nodeStates).some((st) => st.status === 'error' || st.blockedBy?.length)")
  patch('lib/engine.js', 'result = normalizeExecutionResult(await kind.execute(execCtx), { meta: { nodeType: node.type } });', 'result = normalizeExecutionResult(await (this.executeNode ? this.executeNode(execCtx, () => kind.execute(execCtx)) : kind.execute(execCtx)), { meta: { nodeType: node.type } });')
  patch('lib/engine.js', '      output = result.output;', `      await this.awaitNodeCompletion?.(execCtx, result, () => {
        clearTimeout(timer);
        if (releaseSlot) { s.activeCount -= 1; releaseSlot = false; this._pump(s); }
      });
      if (run.canceled) throw new Error('运行已取消');
      output = result.output;`)
  patch('lib/engine.js', 'if (!canceled0 && !s.run.canceled && kind?.retryable !== false', 'if (!canceled0 && !err?.handoffBlocked && !s.run.canceled && kind?.retryable !== false')
  patch('lib/engine.js', "if (!canceled && err?.code !== 'UNKNOWN_NODE_TYPE' && node.data?.continueOnFail)", "if (!canceled && !err?.handoffBlocked && err?.code !== 'UNKNOWN_NODE_TYPE' && node.data?.continueOnFail)")
  patch('lib/index.js', "export const inject = ['agents', 'agentDefaultModel', 'sessions', 'tools', 'webServer', 'agentPresets', 'sessionPersistence', 'llm', 'skills'];", "export const inject = ['agents', 'agentDefaultModel', 'sessions', 'tools', 'webServer', 'agentPresets', 'sessionPersistence', 'llm', 'skills', 'deliveryRuntime'];")
  patch('lib/index.js', '  orch = new Orchestrator(ctx, { onEvent: onOrchestratorEvent, renderTemplate });', `  const deliveryRuntime = ctx.get('deliveryRuntime');
  orch = new Orchestrator(ctx, { onEvent: onOrchestratorEvent, renderTemplate });
  orch.admitNode = deliveryRuntime.admitNode;
  orch.executeNode = deliveryRuntime.executeNode;
  orch.awaitNodeCompletion = deliveryRuntime.awaitNodeCompletion;`)
  patch('lib/index.js', "states.some((state) => state?.status === 'error')", "states.some((state) => state?.status === 'error' || state?.blockedBy?.length)")
  patch('lib/index.js', '    const runId = providedRunId || `run_${Date.now().toString(36)}_${++runIdSeq}`;', `    const runId = providedRunId || \`run_\${Date.now().toString(36)}_\${++runIdSeq}\`;
    deliveryRuntime.authorizeStart({ runId, workflowId, graph, runInputs, workspaceRoot: store.workspaceRoot, resume });`)
  patch('lib/index.js', '  // 子工作流执行器：lint → 循环/深度/预算防护 → 输入映射 → 启动子 run → 同步等待并选结果。', `  deliveryRuntime.attach({
    start({ manifest, nativeRunId, workspaceRoot, resumeSeed }) {
      return workspaceContext.run(storeForWorkspace(workspaceRoot), () => {
        const wf = readWf(manifest.backendWorkflowId);
        if (!wf || graphFingerprint(wf.graph) !== graphFingerprint(manifest.definition.graph)) throw new Error('DELIVERY_PROJECTION_REQUIRED');
        const lint = lintWorkflowGraph(wf.graph);
        if (!lint.ok) throw new Error('DELIVERY_INVALID_GRAPH');
        const inputs = validateWorkflowInputs(manifest.inputs, wf.inputSchema, { label: wf.name });
        return startRun(wf.graph, { runId: nativeRunId, workflowId: wf.id, workflowName: wf.name,
          triggerInput: manifest.triggerInput, runInputs: inputs, globalVariables: {},
          workflowVariables: variableDefinitionsToValues(wf.variables), source: 'delivery-business', resume: resumeSeed });
      });
    },
    cancel({ nativeRunId }) { return orch.cancel(nativeRunId); },
    read({ nativeRunId, workspaceRoot }) { return workspaceContext.run(storeForWorkspace(workspaceRoot), () => readRun(nativeRunId)); },
  });

  // 子工作流执行器：lint → 循环/深度/预算防护 → 输入映射 → 启动子 run → 同步等待并选结果。`)
  patch('lib/index.js', "    const d = node.data || {};\n\n    // 系统提示词支持显式变量", "    const d = node.data || {};\n    const deployment = deliveryRuntime.deploymentFor(node, run);\n\n    // 系统提示词支持显式变量")
  patch('lib/index.js', '    const provider = resolved.provider;\n    let model = resolved.model;', '    const provider = deployment?.provider ?? resolved.provider;\n    let model = deployment?.model ?? resolved.model;')
  patch('lib/index.js', 'meta: { cwd: store.workspaceRoot },', 'meta: { cwd: deployment?.cwd || store.workspaceRoot },')
  patch('lib/index.js', 'setup: async (agentCtx) => {\n          // 加入 standard preset', 'setup: async (agentCtx, agent) => {\n          // 加入 standard preset')
  patch('lib/index.js', "          try { await ctx.agentPresets.mount(agentCtx, 'standard'); } catch { /* 宿主无 preset 时仅用全局工具 */ }", `          if (deployment) {
            await ctx.agentPresets.mount(agentCtx, deployment.presetId);
            await deployment.install(agentCtx, agent);
          } else {
            try { await ctx.agentPresets.mount(agentCtx, 'standard'); } catch { /* upstream fallback */ }
          }`)
  patch('lib/index.js', '          if (restrictList) {', '          if (restrictList && !deployment) {')
}
patch('lib/index.js', '  ensureWorkflowSkill({ log: (msg) => ctx.logger?.info?.(`[orchestrator] ${msg}`) });', '  // WorkBuddy owns the product entry; no standalone workflow skill is seeded.\n  // ensureWorkflowSkill disabled by the embedded product adapter.');
// Validate all pins/anchors before creating an experimental target.
cpSync(source, target, { recursive: true })
for (const [file, contents] of edited) writeFileSync(join(target, file), contents)
const hashes = Object.fromEntries(Object.keys(expected).map(file => [file, { original: createHash('sha256').update(readFileSync(join(source, file))).digest('hex'), adapted: createHash('sha256').update(readFileSync(join(target, file))).digest('hex') }]))
writeFileSync(join(target, 'workbuddy-patch.json'), JSON.stringify({ scope: runtime ? 'isolated immutable projections plus business-run/preset/cwd bridge and required-prerequisite check' : 'test-only immutable workflow projection guard', hashes }, null, 2))
console.log(JSON.stringify({ target, hashes }, null, 2))
