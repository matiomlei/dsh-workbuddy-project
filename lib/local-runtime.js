const MODULES = ['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-agent-instructions']

// DSH 0.2.1 removed livePresetMounts. Inspect active module identities through
// the registry API and read plain configurations from their Host declarations.
// Child !!js expressions are deliberately not evaluated outside their scope.
function plainConfig(value) {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(plainConfig)
  if (typeof value === 'object' && Object.hasOwn(value, '__jsExpr')) return false
  return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every(key => typeof key === 'string' && plainConfig(value[key]))
}

/** Read resolved plugin configurations locally. Never serialize this result to the browser. */
export function localRuntimeEntries(ctx) {
  if (!ctx) return []
  const tree = ctx.root?.get('loader') ?? ctx.get?.('loader')
  const found = new Map()
  if (tree?.entries) {
    const owner = tree.ctx?.fiber?.entry
    const prefix = owner ? `${owner.id}:` : ''
    for (const entry of tree.entries()) {
      if (entry.options.group || entry.disabled || !entry.fiber?.config) continue
      const module = /\/dsh-workbuddy-project(?:-[^/]+)?\/lib\/connector-client\.js$/.test(entry.options.name) ? '@deepseek-ai/dsh-mcp-client' : entry.options.name
      if (!MODULES.includes(module)) continue
      const id = `host:${entry.id.startsWith(prefix) ? entry.id.slice(prefix.length) : entry.id}`
      found.set(id, { id, module, config: entry.fiber.config })
    }
    const registry = ctx.root?.get('agentPresets') ?? ctx.get?.('agentPresets')
    const inspections = typeof registry?.inspectCompositions === 'function' ? registry.inspectCompositions() : []
    for (const entry of tree.entries()) {
      if (entry.disabled || entry.options.name !== '@deepseek-ai/dsh-agent-preset' || !entry.fiber?.config) continue
      const preset = entry.fiber.config
      const active = new Set(inspections.filter(item => item.id === preset.id).flatMap(item => item.modules.map(module => module.moduleName)))
      const visit = (rows, parents = []) => {
        for (const row of rows ?? []) {
          if (row.disabled || !row.id) continue
          const ids = [...parents, row.id]
          if (row.group) { visit(row.config, ids); continue }
          if (!MODULES.includes(row.name) || !active.has(row.name) || !plainConfig(row.config)) continue
          const id = `preset:${preset.id}:${ids.join(':')}`
          found.set(id, { id, module: row.name, config: row.config ?? {} })
        }
      }
      visit(preset.plugins)
    }
  }
  return [...found.values()]
}

export function localMcpConfig(ctx, source) {
  const row = localRuntimeEntries(ctx).find((entry) => entry.id === source && entry.module === '@deepseek-ai/dsh-mcp-client')
  if (!row) throw new Error(`DSH local MCP configuration is unavailable: ${source}; refresh and select an existing configuration`)
  return row.config
}
