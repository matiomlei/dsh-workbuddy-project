/** Run actual application modules with Windows path rules on any development host. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const win = path.win32, root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map()
const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
  for (const [key, value] of Object.entries(values)) this.setExport(key, value)
})
async function moduleFor(file) {
  if (!cache.has(file)) cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file }))
  return cache.get(file)
}
const entry = new vm.SourceTextModule([
  "export * from '../lib/project.js'", "export * from '../lib/native-path.js'",
  "export * from '../lib/library-sync.js'", "export * from '../lib/contribute.js'",
].join('\n'), { identifier: path.join(root, 'test/windows-path-audit-entry.mjs') })
await entry.link(async (specifier, parent) => {
  if (specifier.startsWith('.')) return moduleFor(path.resolve(path.dirname(parent.identifier), specifier))
  const unexpectedWrite = () => { throw new Error('Windows semantics test must never write host files') }
  if (!cache.has(specifier)) cache.set(specifier, synthetic(specifier === 'node:path' ? win : specifier === 'node:fs' ? {
    ...fs, existsSync: () => false, mkdirSync: unexpectedWrite, writeFileSync: unexpectedWrite, renameSync: unexpectedWrite, rmSync: unexpectedWrite,
  } : await import(specifier)))
  return cache.get(specifier)
})
await entry.evaluate()
const project = entry.namespace
const libraries = [{ name: 'team', path: 'D:\\团队 能力库\\' }]
assert.equal(JSON.stringify(project.relativeToLibrary('d:/团队 能力库/experts/lead/agents/main.md', { libraries })), JSON.stringify({ library: 'team', relative: 'experts/lead/agents/main.md' }))
for (const target of ['D:\\团队 能力库-other\\file.md', 'C:\\elsewhere\\file.md', 'D:\\团队 能力库']) assert.equal(project.relativeToLibrary(target, { libraries }), undefined)
const config = cache.get(path.join(root, 'lib/library-config.js')).namespace
for (const value of ['D:\\团队 能力库\\origin.git', '\\\\server\\share\\团队 能力库.git']) assert.equal(config.repositoryAddress(value), value)
for (const value of ['D:relative', 'https://host/bad path', 'git@host:bad path', 'D:\\bad\npath']) assert.throws(() => config.repositoryAddress(value))
for (const [base, target, expected] of [
  ['D:\\', 'd:/skills/check', 'skills\\check'],
  ['D:\\库\\', 'd:/库/skills/check', 'skills\\check'],
  ['D:\\库', 'd:/库', ''],
  ['D:\\库', 'D:\\库-other\\file', undefined],
  ['D:\\库', 'D:\\库\\..\\outside', undefined],
  ['D:\\库', 'C:\\库\\file', undefined],
  ['\\\\server\\share\\库', '\\\\SERVER\\SHARE\\库\\file', 'file'],
  ['\\\\server\\share\\库', '\\\\server\\other\\库\\file', undefined],
]) assert.equal(project.relativeInside(base, target), expected)
assert.equal(project.confinePath('D:\\', 'skills/check/SKILL.md').target, 'D:\\skills\\check\\SKILL.md')
assert.throws(() => project.confinePath('D:\\库', '../outside'))
const team = new project.TeamLibraries('D:\\profile\\projects', [{ name: 'first', path: 'D:\\团队 能力库', repo: 'D:\\origin.git' }, { name: 'alias', path: 'd:/团队 能力库' }])
assert.throws(() => team.save({ name: 'duplicate', path: 'd:/团队 能力库', repo: 'D:\\origin.git' }), /已被其他资源库使用/)
team.jobs.set('first', {})
assert.equal(team.isBusy('alias'), true, 'case/separator aliases share the synchronization lock')

const { localRuntimeEntries } = await import('../lib/local-runtime.js')
for (const name of ['C:\\Users\\封闭机\\plugins\\dsh-workbuddy-project\\lib\\connector-client.js', 'file:///C:/Users/%E5%B0%81%E9%97%AD%E6%9C%BA/plugins/dsh-workbuddy-project/lib/connector-client.js', '/plugins/dsh-workbuddy-project/lib/connector-client.js']) {
  const entries = localRuntimeEntries({ get: key => key === 'loader' ? { entries: () => [{ id: 'connector', options: { name }, fiber: { config: { serverName: 'repo' } } }] } : undefined })
  assert.equal(entries[0]?.module, '@deepseek-ai/dsh-mcp-client', name)
}
// Exercise the actual isolated MCP server's boundary, including realpath casing differences.
for (const workspace of ['D:\\Work Repo', 'D:\\']) {
  const responses = [], requests = [
    { path: 'd:/work repo/README.md', allowed: workspace !== 'D:\\' },
    { path: 'README.md', allowed: true },
    { path: 'C:\\outside.md', allowed: false },
    { path: '//server/share/outside.md', allowed: false },
    { path: '.git/config', allowed: false },
  ].filter(item => item.allowed || item.path !== 'd:/work repo/README.md')
  const context = vm.createContext({ process: { env: { WORKBUDDY_WORKSPACE: workspace }, stdin: null, stdout: { write: value => responses.push(JSON.parse(value)) } } })
  const mock = values => new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value)
  }, { context })
  const server = new vm.SourceTextModule(fs.readFileSync(new URL('../examples/software-delivery/library/connectors/repository-context/server.mjs', import.meta.url), 'utf8'), { context })
  const dependencies = {
    'node:path': win,
    'node:fs': { realpathSync: value => win.resolve(value), readdirSync: () => [], statSync: () => ({ isFile: () => true, size: 5 }), readFileSync: () => 'hello' },
    'node:readline': { createInterface: () => requests.map((item, id) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_document', arguments: { path: item.path } } })) },
  }
  await server.link(specifier => mock(dependencies[specifier]))
  await server.evaluate()
  requests.forEach((item, id) => assert.equal(!responses[id].result.isError, item.allowed, item.path))
}
console.log('PASS Windows library lookup, Git paths with spaces, native path boundaries (drive case/root/UNC/traversal), synchronization aliases and raw-drive/file-URL MCP discovery; path semantics, not native Windows')
