/** Publish generated presets as DSH 0.2 registry definitions. */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadOptionalPatches } from '@deepseek-ai/dsh-app-boot'
import { parseYaml } from './yaml.js'

export class ProjectPresets {
  constructor(presets, root) {
    this.presets = presets
    this.root = root
    this.entries = new Map()
    this.pending = Promise.resolve()
  }

  _enqueue(operation) {
    const task = this.pending.then(operation)
    this.pending = task.catch(() => {})
    return task
  }

  publish(id) {
    return this._enqueue(async () => {
      const directory = join(this.root, id)
      const compositionPath = join(directory, 'agent.cordis.yml')
      const metadataPath = join(directory, 'preset.yml')
      const composition = readFileSync(compositionPath, 'utf8')
      const metadata = readFileSync(metadataPath, 'utf8')
      const revision = JSON.stringify([composition, metadata])
      const previous = this.entries.get(id)
      if (previous?.revision === revision) return
      // Parse first so malformed new output does not withdraw the old definition.
      const plugins = loadOptionalPatches('workbuddy-project', compositionPath)
      const info = parseYaml(metadata, metadataPath)
      if (previous) {
        await previous.dispose()
        this.entries.delete(id)
      }
      const dispose = await this.presets.register({ id, name: info.name, description: info.description, plugins })
      this.entries.set(id, { revision, dispose })
    })
  }

  async validate(id) {
    await this.publish(id)
    const result = await this.presets.resolve(id)
    if (result.broken !== undefined) throw new Error(result.broken)
  }

  async restore() {
    if (!existsSync(this.root)) return
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !existsSync(join(this.root, entry.name, 'preset.yml'))) continue
      try { await this.publish(entry.name) }
      catch (error) { console.warn(`workbuddy-project: cannot register ${entry.name}: ${error.message}`) }
    }
  }

  remove(id) {
    return this._enqueue(async () => {
      const entry = this.entries.get(id)
      if (entry) { await entry.dispose(); this.entries.delete(id) }
    })
  }

  dispose() {
    return this._enqueue(async () => {
      for (const entry of this.entries.values()) await entry.dispose()
      this.entries.clear()
    })
  }
}
