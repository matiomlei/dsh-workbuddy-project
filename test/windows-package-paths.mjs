/** Exercise the real package scanner with Windows path semantics and a mapped fixture FS. */
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { createHash } from 'node:crypto'
import { parse } from 'yaml'
import { packageHash } from '../lib/bundles.js'

const fixture = fs.mkdtempSync(path.join(tmpdir(), 'wb-windows-packages-'))
const actualRoot = fs.realpathSync(fixture), windowsRoot = 'D:\\封闭验证\\能力库 带空格'
const win = path.win32
const put = (file, value) => {
  const target = path.join(actualRoot, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value))
}
const nativePath = value => {
  const rel = win.relative(windowsRoot, value)
  assert.ok(rel !== '..' && !rel.startsWith('..\\') && !win.isAbsolute(rel), 'fixture path stays in mapped root')
  return path.join(actualRoot, ...rel.split('\\'))
}
const mappedFs = Object.fromEntries(['existsSync', 'lstatSync', 'readFileSync', 'readdirSync', 'statSync'].map(name => [name, (value, ...args) => fs[name](nativePath(value), ...args)]))
mappedFs.realpathSync = value => win.join(windowsRoot, ...path.relative(actualRoot, fs.realpathSync(nativePath(value))).split(path.sep))
const synthetic = values => new vm.SyntheticModule(Object.keys(values), function () {
  for (const [key, value] of Object.entries(values)) this.setExport(key, value)
})
try {
  put('experts/analyst/.codebuddy-plugin/plugin.json', { name: 'analyst', agentName: 'lead' })
  put('experts/analyst/agents/lead.md', '# Analyst\nEvidence before conclusions.')
  put('experts/analyst/skills/nested/SKILL.md', '---\nname: nested\n---\nNested guidance.')
  put('skills/review/SKILL.md', '---\nname: review\n---\nReview guidance.')
  put('skills/review/references/example.md', 'Example reference')
  put('connectors/repository/mcp.json', { mcpServers: { repo: { command: 'node', args: ['server.mjs'] } } })
  put('connectors/repository/server.mjs', '// stdio asset')
  const module = new vm.SourceTextModule(fs.readFileSync(new URL('../lib/bundles.js', import.meta.url), 'utf8'))
  const nativePaths = new vm.SourceTextModule(fs.readFileSync(new URL('../lib/native-path.js', import.meta.url), 'utf8'))
  const dependencies = new Map([
    ['node:fs', synthetic(mappedFs)], ['node:path', synthetic(win)],
    ['node:crypto', synthetic({ createHash })], ['yaml', synthetic({ parse })],
  ])
  await nativePaths.link(() => dependencies.get('node:path'))
  dependencies.set('./native-path.js', nativePaths)
  await module.link(specifier => {
    assert.ok(dependencies.has(specifier), specifier)
    return dependencies.get(specifier)
  })
  await module.evaluate()
  const bundles = module.namespace
  for (const folder of ['experts/analyst', 'skills/review', 'connectors/repository']) {
    const windowsPackage = win.join(windowsRoot, folder)
    assert.deepEqual(JSON.parse(JSON.stringify(bundles.packageHash(windowsPackage))), packageHash(path.join(actualRoot, folder)))
    assert.ok(bundles.packageFiles(windowsPackage).every(file => !file.relative.includes('\\')))
  }
  const expert = bundles.readPackage(win.join(windowsRoot, 'experts/analyst'), 'expert', 'analyst')
  assert.match(expert.text, /Evidence before conclusions/)
  assert.equal(bundles.attachedSkills(expert).length, 1)
  assert.equal(bundles.scanPackages(win.join(windowsRoot, 'skills'), 'skill', 'team').length, 1)
  const connector = bundles.readPackage(win.join(windowsRoot, 'connectors/repository'), 'connector', 'repository')
  assert.equal(bundles.connectorServers(connector)[0].cwd, win.join(windowsRoot, 'connectors/repository'))
  for (const invalid of ['../outside', '..\\outside', 'agents\\lead.md', 'C:\\outside.md', 'D:agents/lead.md', '/outside'])
    assert.throws(() => bundles.packagePath(win.join(windowsRoot, 'experts/analyst'), invalid), /relative to the package root/)
  console.log('PASS Windows drive, Chinese/space paths, nested package scans, portable hashes, expert/Skill/MCP parsing and unchanged package-path rejection (mapped filesystem, not a native Windows run)')
} finally { fs.rmSync(actualRoot, { recursive: true, force: true }) }
