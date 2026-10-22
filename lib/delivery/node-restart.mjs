/** Explicit user restart: only verified, accepted checkpoints may skip execution. */
import { ContractError } from './template-store.mjs'
import { recoveryPlan } from './run-checkpoints.mjs'
const fail = (code, message) => { throw new ContractError(code, message) }
export function nodeRestartPlan({ job, manifest, checkpoints, subjects, nodeId }) {
  if (!['canceled', 'execution_failed', 'interrupted'].includes(job.status)) fail('NODE_RESTART_NOT_READY', '请等待本轮运行结束后再继续或重试')
  const node = manifest?.definition.graph.nodes.find(node => node.id === nodeId)
  const latest = job.codeAttempts?.[nodeId]?.at(-1)
  if (node?.type !== 'agent' || !latest) fail('NODE_RESTART_NOT_READY', '请选择已执行但未完成的 Agent 节点')
  const masked = structuredClone(job)
  // An uncertain execution is deliberately rerun, never restored as successful.
  for (const [id, attempts] of Object.entries(masked.codeAttempts)) {
    if (attempts.at(-1)?.status !== 'ready') delete masked.codeAttempts[id]
  }
  const intact = recoveryPlan({ job: masked, manifest, checkpoints, subjects })
  if (!intact.eligible) fail('NODE_RESTART_UNSAFE', '固定结果校验未通过，请检查运行数据：' + intact.reasons.map(item => item.code).join(', '))
  if (intact.completed.includes(nodeId)) fail('NODE_ALREADY_ACCEPTED', '该节点已有通过验收的固定结果，可只读讨论；修改请发起新运行')
  // A ready but unaccepted target becomes a new attempt; other pending gates stay parked.
  delete masked.codeAttempts[nodeId]
  const plan = recoveryPlan({ job: masked, manifest, checkpoints, subjects })
  if (!plan.eligible) fail('NODE_RESTART_UNSAFE', '该节点已有下游固定结果，不能直接重跑')
  const inputs = latest.repositories ?? job.codeHandoffs?.[nodeId]?.repositories
  return { ...plan, canContinue: !!inputs?.length, inputs: inputs ?? null }
}

export function assertAgentCompletion(reason, signal) {
  if (signal?.aborted) throw new Error('运行已取消')
  if (reason?.kind === 'error') {
    // Provider cancellation errors are execution failures, not a user cancel command.
    const error = new Error('模型执行失败：' + (reason.error?.message ?? reason.error ?? '未知错误'))
    error.code = 'DELIVERY_MODEL_FAILED'; error.handoffBlocked = true
    throw error
  }
  if (reason?.kind !== 'completed') {
    throw Object.assign(new Error('模型执行中断（' + (reason?.kind ?? '未返回完成状态') + '），可发送消息继续或重试节点'), { code: 'DELIVERY_MODEL_INTERRUPTED', handoffBlocked: true })
  }
}
