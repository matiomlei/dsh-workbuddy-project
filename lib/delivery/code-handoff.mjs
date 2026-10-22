/** Run-owned Git snapshots and conservative conflict admission. No source branch writes. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { digest, ContractError } from './template-store.mjs'
const exec = promisify(execFile)
const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_ATTR_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_MERGE_AUTOEDIT: 'no', GIT_AUTHOR_NAME: 'DSH Delivery', GIT_AUTHOR_EMAIL: 'delivery@example.invalid', GIT_COMMITTER_NAME: 'DSH Delivery', GIT_COMMITTER_EMAIL: 'delivery@example.invalid' }
export async function snapshotGit(cwd, args, { bytes = false } = {}) {
  const { stdout } = await exec('git', ['-c', 'core.longpaths=true', '-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'core.fsmonitor=false', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-C', cwd, ...args], { env: environment, encoding: bytes ? 'buffer' : 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
  return bytes || args.includes('-z') ? stdout : stdout.trim()
}
const blocked = (code, message, details = {}) => Object.assign(new ContractError(code, message), { handoffBlocked: true, ...details })
const check = signal => { if (signal?.aborted) throw blocked('CODE_HANDOFF_CANCELED', '运行已取消') }
async function ancestor(store, a, b) {
  try { await snapshotGit(store, ['merge-base', '--is-ancestor', a, b]); return true }
  catch (error) { if (error.code === 1) return false; throw error }
}
async function commit(cwd, tree, parents, message) {
  return snapshotGit(cwd, ['commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', message])
}
export async function initializeCodeStores(root, repositories) {
  const result = []
  for (const repo of repositories) {
    const objectStore = join(root, 'repositories', digest(repo.alias).slice(0, 20) + '.git')
    mkdirSync(dirname(objectStore), { recursive: true, mode: 0o700 })
    await snapshotGit(dirname(objectStore), ['init', '--bare', '--quiet', ...(repo.commit.length === 64 ? ['--object-format=sha256'] : []), objectStore])
    await snapshotGit(objectStore, ['fetch', '--quiet', '--no-tags', repo.path, repo.commit])
    await snapshotGit(objectStore, ['update-ref', 'refs/delivery/base', repo.commit])
    result.push({ ...repo, objectStore })
  }
  return result
}
export async function createNodeWorktrees(nodeRoot, repositories) {
  const worktrees = {}
  for (const repo of repositories) {
    const cwd = join(nodeRoot, 'worktrees', digest(repo.alias).slice(0, 20))
    mkdirSync(dirname(cwd), { recursive: true, mode: 0o700 })
    await snapshotGit(repo.objectStore, ['worktree', 'add', '--detach', '--quiet', cwd, repo.commit])
    worktrees[repo.alias] = cwd
  }
  return worktrees
}
/** All refs and checkout operations below stay inside a run-owned object store. */
export async function prepareCodeInput({ runRoot, node, repositories, graph, nodeStates, handoffs, worktrees, attempt, signal }) {
  const parentIds = [...new Set(graph.edges.filter(edge => edge.target === node.id).map(edge => edge.source))].sort()
  const inputs = []
  for (const id of parentIds) {
    if (nodeStates[id]?.status !== 'success' || !handoffs[id] || handoffs[id].status !== 'ready') throw blocked('CODE_INPUT_NOT_READY', '上游代码快照尚未就绪：' + id)
  }
  for (const repo of repositories) {
    check(signal)
    const sources = parentIds.map(nodeId => ({ nodeId, commit: handoffs[nodeId].repositories.find(item => item.alias === repo.alias)?.outputCommit }))
    if (sources.some(source => !source.commit)) throw blocked('CODE_INPUT_NOT_READY', '上游缺少仓库快照：' + repo.alias)
    const heads = [...new Set(sources.map(source => source.commit))]
    let current = heads[0] ?? repo.commit, integration
    for (const next of heads.slice(1)) {
      check(signal)
      if (await ancestor(repo.objectStore, next, current)) continue
      if (await ancestor(repo.objectStore, current, next)) { current = next; continue }
      if (!integration) {
        integration = join(runRoot, 'integrations', digest([node.id, attempt, repo.alias]).slice(0, 24))
        mkdirSync(dirname(integration), { recursive: true, mode: 0o700 })
        await snapshotGit(repo.objectStore, ['worktree', 'add', '--detach', '--quiet', integration, current])
      } else await snapshotGit(integration, ['reset', '--hard', '--quiet', current])
      try { await snapshotGit(integration, ['merge', '--no-commit', '--no-ff', '--no-edit', next]) }
      catch (error) {
        const files = (await snapshotGit(integration, ['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean)
        if (!files.length) throw error
        throw blocked('CODE_MERGE_CONFLICT', `代码交接冲突：${repo.alias} / ${files.join('，')}。下游尚未执行。`, { repository: repo.alias, files, sources })
      }
      const tree = await snapshotGit(integration, ['write-tree'])
      current = await commit(integration, tree, [current, next], `delivery merge ${node.id} attempt ${attempt}`)
      await snapshotGit(integration, ['reset', '--hard', '--quiet', current])
    }
    check(signal)
    await snapshotGit(repo.objectStore, ['update-ref', `refs/delivery/inputs/${digest(node.id).slice(0, 24)}/${attempt}`, current])
    if (worktrees?.[repo.alias]) {
      const cwd = worktrees[repo.alias]
      // These directories were created by this run. A retry starts from the same
      // accepted input, never from a failed attempt's partial writes.
      await snapshotGit(cwd, ['reset', '--hard', '--quiet', current])
      await snapshotGit(cwd, ['clean', '-fdx', '--quiet'])
    }
    inputs.push({ alias: repo.alias, inputCommit: current, outputCommit: current, sources })
  }
  check(signal)
  return inputs
}
async function collectDelta({ cwd, inputCommit, outputCommit, alias, nodeId, artifactRoot }) {
  const names = (await snapshotGit(cwd, ['diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', inputCommit, outputCommit])).split('\0').filter(Boolean)
  if (names.length > 50) throw blocked('CODE_SNAPSHOT_LIMIT', '节点代码变更超过当前 50 文件上限。')
  const artifacts = []
  for (const name of names) {
    const entry = await snapshotGit(cwd, ['ls-tree', '-z', outputCommit, '--', name])
    if (!entry) {
      artifacts.push({ id: digest([nodeId, alias, name, 'deleted', outputCommit]), nodeId, repository: alias, name, change: 'deleted', bytes: 0, sha256: null, outputCommit })
      continue
    }
    const header = entry.slice(0, entry.indexOf('\t')), [mode, type, blob] = header.split(' ')
    if (type !== 'blob' || !['100644', '100755', '120000'].includes(mode)) throw blocked('CODE_ENTRY_UNSUPPORTED', '当前不支持交接的 Git 条目：' + name)
    const size = Number(await snapshotGit(cwd, ['cat-file', '-s', blob]))
    if (size > 5 * 1024 * 1024) throw blocked('CODE_SNAPSHOT_LIMIT', '节点代码文件超过当前 5 MB 上限：' + name)
    const bytes = await snapshotGit(cwd, ['cat-file', 'blob', blob], { bytes: true })
    const sha256 = createHash('sha256').update(bytes).digest('hex'), id = digest([nodeId, alias, name, mode, sha256, outputCommit]), target = join(artifactRoot, id)
    mkdirSync(artifactRoot, { recursive: true, mode: 0o700 }); writeFileSync(target, bytes, { mode: 0o600 })
    artifacts.push({ id, nodeId, repository: alias, name, mode, sha256, bytes: bytes.length, path: target, outputCommit, change: 'updated' })
  }
  return artifacts
}
export async function snapshotCodeOutput({ runRoot, node, repositories, inputs, worktrees, attempt, signal }) {
  const result = [], artifacts = []
  for (const input of inputs) {
    check(signal)
    const repo = repositories.find(repo => repo.alias === input.alias), cwd = worktrees?.[input.alias]
    let outputCommit = input.inputCommit
    if (cwd) {
      await snapshotGit(cwd, ['add', '-A', '--', '.'])
      const tree = await snapshotGit(cwd, ['write-tree']), before = await snapshotGit(repo.objectStore, ['rev-parse', input.inputCommit + '^{tree}'])
      if (tree !== before) outputCommit = await commit(cwd, tree, [input.inputCommit], `delivery node ${node.id} attempt ${attempt}`)
      artifacts.push(...await collectDelta({ cwd, inputCommit: input.inputCommit, outputCommit, alias: input.alias, nodeId: node.id, artifactRoot: join(runRoot, 'artifacts') }))
    }
    check(signal)
    await snapshotGit(repo.objectStore, ['update-ref', `refs/delivery/nodes/${digest(node.id).slice(0, 24)}/${attempt}`, outputCommit])
    result.push({ ...input, outputCommit, changed: outputCommit !== input.inputCommit })
  }
  check(signal)
  return { repositories: result, artifacts }
}
