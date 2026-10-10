import { createRequire } from 'node:module'
let livePresetMounts = () => []
try {
  const hostRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-app-boot'))
  ;({ livePresetMounts } = await import(hostRequire.resolve('@deepseek-ai/dsh-agent-preset-registry')))
} catch { /* Headless hosts may have no preset registry. Host Loader entries still work. */ }

/** Read resolved plugin configurations locally. Never serialize this result to the browser. */
export function localRuntimeEntries(ctx) {
  if (!ctx) return []
  const trees = [{ source: 'host', tree: ctx.root?.get('loader') ?? ctx.get?.('loader') },
    ...(ctx.root?.fiber ? livePresetMounts(ctx.root.fiber) : []).map((mount) => ({ source: `preset:${mount.presetId}`, tree: mount.tree }))]
  const found = new Map()
  for (const { source, tree } of trees) {
    if (!tree?.entries) continue
    const owner = tree.ctx?.fiber?.entry
    const prefix = owner ? `${owner.id}:` : ''
    for (const entry of tree.entries()) {
      if (entry.options.group || entry.disabled || !entry.fiber?.config) continue
      const module = /\/dsh-workbuddy-project(?:-[^/]+)?\/lib\/connector-client\.js$/.test(entry.options.name) ? '@deepseek-ai/dsh-mcp-client' : entry.options.name
      if (!['@deepseek-ai/dsh-mcp-client', '@deepseek-ai/dsh-skill-filesystem', '@deepseek-ai/dsh-agent-instructions'].includes(module)) continue
      const id = `${source}:${entry.id.startsWith(prefix) ? entry.id.slice(prefix.length) : entry.id}`
      found.set(id, { id, module, config: entry.fiber.config })
    }
  }
  return [...found.values()]
}

export function localMcpConfig(ctx, source) {
  const row = localRuntimeEntries(ctx).find((entry) => entry.id === source && entry.module === '@deepseek-ai/dsh-mcp-client')
  if (!row) throw new Error(`DSH local MCP configuration is unavailable: ${source}; refresh and select an existing configuration`)
  return row.config
}
