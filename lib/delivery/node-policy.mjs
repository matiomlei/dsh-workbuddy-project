/** Keep node rules and expert instructions independent of the task persona. */
export const name = 'delivery-node-policy-prototype'
export const inject = ['systemPrompt']
export function apply(ctx, { policy, expert }) {
  if (policy) ctx.systemPrompt.section({ name: 'delivery:node-policy', order: 5, text: policy })
  if (expert) ctx.systemPrompt.section({ name: 'delivery:node-expert', order: 6, text: expert })
}
