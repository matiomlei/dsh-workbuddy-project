/** Offline path smoke test. Uses temporary fixtures, the installed compiler, Git and bundled MCP. */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { nodeCapabilities, preflightPresetModules } from '../lib/delivery/node-capabilities.mjs'
import { createStarter } from '../lib/delivery/starter-template.mjs'
import { TeamLibraries } from '../lib/library-sync.js'
import { snapshotGit as git, initializeCodeStores, createNodeWorktrees, prepareCodeInput, snapshotCodeOutput } from '../lib/delivery/code-handoff.mjs'

const compilerRoot = fileURLToPath(new URL('../', import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), 'wb-验证 空格#%-')))
const checks = [], manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
let phase = 'setup', manager, client, transport
const check = async (name, fn) => { phase = name; await fn(); checks.push({ name, passed: true }) }
const source = join(root, '业务 仓库#%'), runRoot = join(root, '运行 #1')
let preset, repositories, worktrees, input, deepFile
try {
  await check('file URL import with Chinese, spaces, # and %', async () => {
    const target = join(root, '组件 #%.mjs')
    cpSync(new URL('../lib/delivery/node-policy.mjs', import.meta.url), target)
    await preflightPresetModules([{ id: 'path-smoke-policy', name: pathToFileURL(target).href }])
  })
  await check('local Git library with spaces; starter capability snapshots and four presets', async () => {
    const origin = join(root, '团队 能力库 #%.git')
    cpSync(new URL('../examples/software-delivery/library/', import.meta.url), origin, { recursive: true })
    await git(origin, ['init', '--quiet']); await git(origin, ['add', '.']); await git(origin, ['commit', '--quiet', '-m', 'path fixture'])
    manager = new TeamLibraries(join(root, 'home/projects'), [])
    manager.save({ name: 'delivery-starter', repo: origin }); await manager.sync('delivery-starter')
    const capabilities = await nodeCapabilities({ root: runRoot, compilerRoot, libraries: manager.entries })
    const starter = createStarter(capabilities)
    assert.equal(starter.definition.nodeBindings.length, 4)
    for (const binding of starter.definition.nodeBindings) {
      const compiled = capabilities.preparePreset(binding, { id: 'smoke-' + binding.nodeId, directory: join(runRoot, binding.nodeId), cwd: source })
      await preflightPresetModules(compiled.plugins)
      for (const row of compiled.plugins.filter(row => row.name.startsWith('file:'))) assert.ok(existsSync(fileURLToPath(row.name)))
      preset ??= compiled
    }
  })
  await check('Git private worktree and paths exceeding 260 characters', async () => {
    mkdirSync(source); writeFileSync(join(source, 'README.md'), 'WORKBUDDY_PATH_FIXTURE\n')
    deepFile = [...Array.from({ length: 4 }, (_, i) => 'nested-' + i + '-' + 'x'.repeat(62)), 'readme.md'].join('/')
    mkdirSync(dirname(join(source, deepFile)), { recursive: true }); writeFileSync(join(source, deepFile), 'LONG_PATH_PROOF\n')
    assert.ok(join(source, deepFile).length > 260)
    await git(source, ['init', '--quiet']); await git(source, ['add', '.']); await git(source, ['commit', '--quiet', '-m', 'path fixture'])
    const commit = await git(source, ['rev-parse', 'HEAD'])
    repositories = await initializeCodeStores(runRoot, [{ alias: 'main', path: source, commit }])
    worktrees = await createNodeWorktrees(join(runRoot, 'node'), repositories)
    assert.equal(readFileSync(join(worktrees.main, deepFile), 'utf8'), 'LONG_PATH_PROOF\n')
    input = await prepareCodeInput({ runRoot, node: { id: 'smoke' }, repositories, graph: { edges: [] }, nodeStates: {}, handoffs: {}, worktrees, attempt: 1 })
  })
  await check('bundled MCP stdio startup and document reads in the private worktree', async () => {
    const row = preset.plugins.find(row => row.id === 'connector-delivery_repo')
    assert.ok(row)
    transport = new StdioClientTransport({ ...row.config, env: { ...row.config.env, WORKBUDDY_WORKSPACE: worktrees.main } })
    client = new Client({ name: 'workbuddy-path-smoke', version: '1' }, { capabilities: {} })
    const options = { timeout: 15000, signal: AbortSignal.timeout(15000) }
    await client.connect(transport, options)
    assert.ok((await client.listTools(undefined, options)).tools.some(tool => tool.name === 'read_document'))
    for (const file of ['README.md', deepFile]) {
      const result = await client.callTool({ name: 'read_document', arguments: { path: file } }, undefined, options)
      assert.ok(!result.isError, JSON.stringify(result))
      assert.match(JSON.parse(result.content[0].text).text, /PATH_(?:FIXTURE|PROOF)/)
    }
    const rejected = await client.callTool({ name: 'read_document', arguments: { path: '.git' } }, undefined, options)
    assert.equal(rejected.isError, true)
    await client.close(); await transport.close(); client = transport = undefined
  })
  await check('snapshot, downstream checkout and unchanged source repository', async () => {
    writeFileSync(join(worktrees.main, '交付 #%.md'), 'HANDOFF_PATH_PROOF\n')
    const result = await snapshotCodeOutput({ runRoot, node: { id: 'smoke' }, repositories, inputs: input, worktrees, attempt: 1 })
    const downstream = await createNodeWorktrees(join(runRoot, 'downstream'), repositories)
    await prepareCodeInput({ runRoot, node: { id: 'consumer' }, repositories, graph: { edges: [{ source: 'smoke', target: 'consumer' }] }, nodeStates: { smoke: { status: 'success' } }, handoffs: { smoke: { status: 'ready', repositories: result.repositories } }, worktrees: downstream, attempt: 1 })
    assert.equal(readFileSync(join(downstream.main, '交付 #%.md'), 'utf8'), 'HANDOFF_PATH_PROOF\n')
    assert.equal(await git(source, ['status', '--porcelain']), '')
    assert.equal(await git(source, ['rev-parse', 'HEAD']), repositories[0].commit)
    assert.equal(existsSync(join(source, '交付 #%.md')), false)
  })
} catch (error) {
  checks.push({ name: phase, passed: false, code: error.code ?? error.name, message: error.message })
  process.exitCode = 1
} finally {
  await client?.close().catch(() => {})
  await transport?.close().catch(() => {})
  await manager?.stop()
  try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
  catch (error) { checks.push({ name: 'temporary fixture cleanup', passed: false, code: error.code, message: error.message }); process.exitCode = 1 }
}
console.log(JSON.stringify({ version: manifest.version, platform: process.platform, node: process.versions.node, nativeWindows: process.platform === 'win32', passed: !process.exitCode, checks, externalModelCalls: 0 }, null, 2))
