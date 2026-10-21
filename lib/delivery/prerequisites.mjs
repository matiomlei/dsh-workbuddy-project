/** Experimental all-required policy; not a released workflow schema. */
export function admitDeliveryNode({ node, run, s }) {
  function failures(id, visiting = new Set()) {
    if (visiting.has(id)) return [id]
    const state = run.nodeStates[id]
    if (!state) return [id]
    if (state.status === 'error' || state.status === 'canceled' || state.toleratedError) return [id]
    if (state.status === 'success') return []
    if (state.status !== 'skipped') return [id]
    // Upstream uses this exact fact for an explicitly unselected branch.
    if (state.error === '条件分支未命中') return []
    if (state.blockedBy?.length) return state.blockedBy
    const parents = s.incoming.get(id) || []
    if (!parents.length) return [id]
    const next = new Set(visiting).add(id)
    return parents.flatMap(parent => failures(parent, next))
  }
  const blockedBy = [...new Set((s.incoming.get(node.id) || []).flatMap(id => failures(id)))]
  return blockedBy.length ? { blocked: true, blockedBy, reason: `Required predecessors did not pass: ${blockedBy.join(', ')}` } : { blocked: false }
}
