import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert.equal(manifest.name, 'dsh-workbuddy-project')
assert.notEqual(manifest.private, true)
assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
for (const filename of [manifest.main, manifest.exports['./client'], manifest.dsh.bundle.patch, 'LICENSE', 'README.md', 'docs/releasing.md']) {
  assert.ok(existsSync(new URL(`../${filename}`, import.meta.url)), `Missing ${filename}`)
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const [pack] = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }))
const allowed = /^(?:package\.json|cordis\.patch\.yml|README\.md|LICENSE|CHANGELOG\.md|(?:lib|docs|examples)\/.*)$/
for (const { path } of pack.files) {
  assert.ok(allowed.test(path), `Unexpected package file: ${path}`)
  assert.ok(!/(?:^|\/)(?:node_modules|\.git|\.dsh|\.env(?:\..*)?|\.DS_Store)(?:\/|$)/.test(path), `Private or generated file: ${path}`)
}
for (const filename of ['cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/connector-client.js', 'examples/library/library.json']) {
  assert.ok(pack.files.some(file => file.path === filename), `Not packed: ${filename}`)
}
console.log(`PASS ${pack.name}@${pack.version}: ${pack.files.length} files, ${pack.size} packed bytes; runtime, documentation, and examples only`)
