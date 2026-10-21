import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const peers = process.env.WB_DSH_NODE_MODULES ?? join(homedir(), '.dsh/profiles/node_modules')
const modules = dirname(dirname(realpathSync(join(peers, '@deepseek-ai/dsh-app-boot'))))
const root = mkdtempSync(join(tmpdir(), 'wb-preset-host-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = join(root, 'home')
let host
try {
  symlinkSync(modules, join(root, 'node_modules'))
  cpSync(fileURLToPath(new URL('../lib', import.meta.url)), join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'cordis.yml'), '[]\n')
  const { boot, loadOptionalPatches } = await import(pathToFileURL(join(modules, '@deepseek-ai/dsh-app-boot/lib/index.js')))
  host = await boot('wb-preset-host', join(root, 'cordis.yml'), [
    ...loadOptionalPatches('base', join(modules, '@deepseek-ai/dsh-base/cordis.patch.yml')),
    { insert: [
      { id: 'model-selection-settings', name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings' },
      { id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'fixture' } },
      { id: 'preset-native', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'native', plugins: [
        { id: 'skills', name: '@deepseek-ai/dsh-skill-filesystem', config: { providerName: 'fixture', includeDefaultRoots: false, customSkillDirs: [join(root, 'skills')] } },
        { id: 'dynamic-skills', name: '@deepseek-ai/dsh-skill-filesystem', config: { providerName: 'dynamic', includeDefaultRoots: false, customSkillDirs: [{ __jsExpr: "dshHomePath('skills')" }] } },
      ] } },
      { id: 'wb', name: join(root, 'lib/index.js'), config: { projectsRoot: join(root, 'home/projects'), libraries: [] } },
    ] },
  ])
  const service = host.get('workbuddyProject')
  const presets = host.get('agentPresets')
  const { localRuntimeEntries } = await import(pathToFileURL(join(root, 'lib/local-runtime.js')))
  const nativeSkills = localRuntimeEntries(host).find(row => row.id === 'preset:native:skills')
  assert.deepEqual(nativeSkills?.config.customSkillDirs, [join(root, 'skills')])
  assert.equal(localRuntimeEntries(host).some(row => row.id === 'preset:native:dynamic-skills'), false)
  mkdirSync(join(root, 'workspace'))
  const created = await service.create({ name: 'Fixture', cwd: join(root, 'workspace'), instructions: 'PRESET FIXTURE' })
  assert.equal(created.validated, true, JSON.stringify(created))
  assert.equal((await presets.resolve(created.presetId)).broken, undefined)
  assert.ok(presets.inspectCompositions().some(preset => preset.id === created.presetId))
  const updated = await service.update({ id: created.id, instructions: 'UPDATED FIXTURE' })
  assert.equal(updated.validated, true, JSON.stringify(updated))
  await service.remove(created.id)
  assert.equal((await presets.list()).some(preset => preset.id === created.presetId), false)
  console.log('PASS real DSH base services and preset registry: compile, activate, inspect, update and unregister project preset')
} finally {
  if (host) await host.fiber.dispose()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(root, { recursive: true, force: true })
}
