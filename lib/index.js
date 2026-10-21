/**
 * WorkBuddy-style projects for DeepSeek Harness.
 *
 * A project is a working directory plus a `.dsh/project.json`: project
 * instructions, normative rules, 1..N experts, the skills it enables, and the
 * connector packages it connects. The registry compiles each project into one agent
 * preset, so a session started on that preset receives exactly the project's
 * capabilities — the harness has no other seam for per-session skills and connector
 * servers.
 *
 * Three surfaces reach the same registry: the model tools, the `/project`
 * human command, and the settings page's JSON route.
 *
 * @module dsh-workbuddy-project
 */
import { ProjectPresets } from './presets.js'
import { projectCommand } from './command.js'
import { projectRoute } from './route.js'
import { Config, WorkbuddyProject } from './service.js'
import { projectTools } from './tools.js'

export { Config }
export { WorkbuddyProject }

export const name = 'workbuddy-project'

/**
 * Hard dependencies. Cordis throws `cannot get property "tools" without inject`
 * on the first `ctx.tools` access, so the row waits for each registry instead of
 * reading it out of band. `connection` is deliberately NOT injected: it exists
 * only on a browser surface, and a headless deployment must still mount this
 * package for its tools and command.
 */
export const inject = ['tools', 'commands']

/**
 * Mount the project registry and its three surfaces.
 *
 * Everything registers on the host plane and unwinds with this row's fiber. A
 * project session runs a compiled project preset, which deliberately omits the
 * administration tools, so management never competes with a project's own work.
 *
 * @param ctx - the host context this row owns.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config) {
  const registry = new WorkbuddyProject(ctx, config)
  ctx.effect(() => registry.libraryManager.start(), 'workbuddy-project: team library sync')

  ctx.inject(['agentPresets'], async (scope) => {
    const manager = new ProjectPresets(scope.agentPresets, registry.root)
    registry.presetManager = manager
    scope.effect(() => async () => {
      if (registry.presetManager === manager) registry.presetManager = undefined
      await manager.dispose()
    }, 'workbuddy-project: preset definitions')
    await manager.restore()
  })

  for (const tool of projectTools(registry)) {
    ctx.effect(() => ctx.tools.register(tool), `workbuddy-project: ${tool.name}`)
  }

  ctx.effect(() => ctx.commands.register(projectCommand(registry)), 'workbuddy-project: /project command')

  // The browser connection loads AFTER this row — it waits for the bound web
  // runtime — so `ctx.get('connection')` at apply time would miss it and the
  // settings page would silently 404. `ctx.inject` runs the registration when
  // the service appears and unwinds it if the service goes away, which also
  // keeps a headless deployment mounting this package for its tools and command.
  ctx.inject(['connection'], (scope) => {
    const route = projectRoute(registry)
    scope.effect(() => {
      const registered = scope.connection.fetch.register(route)
      return () => {
        Promise.resolve(registered).then(
          (dispose) => dispose(),
          () => undefined,
        )
      }
    }, 'workbuddy-project: settings route')
    scope.logger?.info?.('workbuddy-project: settings page served at %s', route.path)
  })

  ctx.inject(['connection', 'webServer', 'sessions', 'agents', 'agentPresets', 'agentDefaultModel', 'sessionPersistence', 'llm', 'skills'], async scope => { try { const { mountDelivery } = await import('./delivery/host.mjs'); await mountDelivery(scope, registry, config) } catch (error) { console.error('项目交付初始化失败:', error); throw error } })

  ctx.logger?.info?.('workbuddy-project: %d project(s) under %s', registry.list().length, registry.root)
}
