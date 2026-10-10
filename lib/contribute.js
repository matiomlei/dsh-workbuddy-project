/**
 * The contribution path: turn a page edit into a pull request.
 *
 * The plugin resolves and compiles a library read-only; this module is the ONE
 * place it writes to one. A contribution never commits to the branch the
 * checkout had out: it creates a branch, commits there, pushes it, and puts the
 * checkout back where it was — so "follow this machine's checkout" keeps meaning
 * exactly what it meant before the edit, and the review happens on GitHub.
 *
 * @module dsh-workbuddy-project/contribute
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { gitDir, libraryHeadRef } from './project.js'

/** Branch names a contribution creates when the caller does not name one. */
export const CONTRIBUTION_BRANCH_PREFIX = 'codex/'

/** How long one git invocation may take before it is killed. */
const GIT_TIMEOUT_MS = 60000
const PUSH_TIMEOUT_MS = 120000

/**
 * Run one git command in a checkout.
 *
 * Prompts are disabled outright: a management page must fail with a message the
 * user can act on rather than block the harness process on a credential prompt.
 *
 * @param cwd - the checkout root.
 * @param args - git arguments.
 * @param timeoutMs - the invocation budget.
 * @returns trimmed stdout.
 * @throws with git's stderr when the command fails.
 */
export function runGit(cwd, args, timeoutMs = GIT_TIMEOUT_MS) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GIT_PAGER: 'cat' },
    }).trim()
  } catch (error) {
    const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
    const detail = stderr === '' ? String(error.message) : stderr
    throw new Error(`git ${args.join(' ')} failed: ${detail}`)
  }
}

/**
 * What a contribution needs to know about a checkout before it starts.
 * @param library - a resolved library entry.
 * @returns branch, dirtiness and whether the path is usable at all.
 */
export function gitState(library) {
  if (library.exists !== true) return { exists: false, isCheckout: false }
  if (gitDir(library.path) === undefined) return { exists: true, isCheckout: false }
  let branch
  let status
  try {
    branch = runGit(library.path, ['rev-parse', '--abbrev-ref', 'HEAD'])
    status = runGit(library.path, ['status', '--porcelain'])
  } catch (error) {
    return { exists: true, isCheckout: true, error: String(error.message) }
  }
  return {
    exists: true,
    isCheckout: true,
    branch: branch === 'HEAD' ? libraryHeadRef(library.path) : branch,
    detached: branch === 'HEAD',
    dirty: status !== '',
    changes: status === '' ? [] : status.split('\n'),
    remote: remoteUrl(library.path),
  }
}

/**
 * Commit a change set onto a new branch and push it.
 *
 * @param library - a resolved library entry.
 * @param request - `{ changes: [{ path, content } | { path, delete: true }], message?, branch? }`.
 * @returns `{ library, branch, base, commit, files, remote, pullRequest }`.
 */
export function contribute(library, request) {
  if (library.exists !== true) {
    throw new Error(`library ${library.name}: ${library.path} does not exist; clone it before contributing`)
  }
  if (gitDir(library.path) === undefined) {
    throw new Error(`library ${library.name}: ${library.path} is not a git checkout`)
  }
  const changes = normalizeChanges(library, request.changes)

  const dirty = runGit(library.path, ['status', '--porcelain'])
  if (dirty !== '') {
    throw new Error(
      `library ${library.name}: the checkout has uncommitted changes, so a contribution would sweep them in; commit or stash them first:\n${dirty}`,
    )
  }
  const base = runGit(library.path, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (base === 'HEAD') {
    throw new Error(
      `library ${library.name}: HEAD is detached at ${libraryHeadRef(library.path)}; check out a branch (the base a pull request targets) before contributing`,
    )
  }

  const message = request.message ?? defaultMessage(changes)
  const branch = request.branch ?? `${CONTRIBUTION_BRANCH_PREFIX}${slug(message)}`
  assertBranch(branch)
  if (branch === base) throw new Error(`library ${library.name}: a contribution cannot commit to its own base branch ${JSON.stringify(base)}`)

  runGit(library.path, ['switch', '-c', branch])
  let commit
  let pushed = false
  try {
    for (const change of changes) applyChange(library, change)
    runGit(library.path, ['add', '--', ...changes.map((change) => change.path)])
    runGit(library.path, ['commit', '-m', message])
    commit = runGit(library.path, ['rev-parse', '--short', 'HEAD'])
    runGit(library.path, ['push', '-u', 'origin', branch], PUSH_TIMEOUT_MS)
    pushed = true
  } finally {
    // Put the checkout back where it started, whatever happened above: the
    // branch keeps the work, and "follow this machine's checkout" keeps meaning
    // what it meant before the page was opened.
    try {
      runGit(library.path, ['switch', base])
    } catch {
      /* the branch and its commit are reported either way */
    }
  }

  const remote = remoteUrl(library.path)
  return {
    library: library.name,
    branch,
    base,
    ...(commit === undefined ? {} : { commit }),
    files: changes.map((change) => change.path),
    pushed,
    ...(remote === undefined ? {} : { remote }),
    pullRequest: pushed ? openPullRequest(library.path, remote, base, branch, message) : undefined,
  }
}

/**
 * Open the pull request with the GitHub CLI when it is installed and signed in.
 *
 * A page cannot assume that: with no `gh`, or with `gh` unauthenticated, the
 * pushed branch plus its compare URL is the whole answer, and one click on
 * GitHub finishes the same job.
 */
function openPullRequest(cwd, remote, base, branch, message) {
  const compare = compareUrl(remote, base, branch)
  if (remote === undefined) return { created: false }
  try {
    const url = execFileSync('gh', ['pr', 'create', '--base', base, '--head', branch, '--title', message.split('\n')[0], '--body', message], {
      cwd,
      encoding: 'utf8',
      timeout: PUSH_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    }).trim()
    return { created: true, url, compare }
  } catch {
    return { created: false, compare }
  }
}

/**
 * The GitHub compare URL that opens a pull request for one pushed branch.
 * @param remote - the `origin` URL, HTTPS or SSH.
 * @param base - the branch the pull request targets.
 * @param branch - the pushed branch.
 * @returns the URL, or `undefined` when the remote is not a forge this shape fits.
 */
export function compareUrl(remote, base, branch) {
  if (typeof remote !== 'string' || remote === '') return undefined
  const normalized = remote
    .replace(/^git@([^:]+):/u, 'https://$1/')
    .replace(/^ssh:\/\/git@([^/]+)\//u, 'https://$1/')
    .replace(/\.git$/u, '')
  if (!/^https?:\/\//u.test(normalized)) return undefined
  return `${normalized}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`
}

/** The `origin` URL, or `undefined` when the checkout names no remote. */
function remoteUrl(cwd) {
  try {
    return runGit(cwd, ['remote', 'get-url', 'origin'])
  } catch {
    return undefined
  }
}

/**
 * Resolve one library-relative path, refusing anything that leaves the root.
 * @param root - the library root.
 * @param raw - the caller's relative path.
 * @returns the absolute target.
 */
export function confinePath(root, raw) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('a capability path must be a non-empty relative path')
  const relative = raw.trim().replace(/^\.\//u, '')
  if (isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
    throw new Error(`path ${JSON.stringify(raw)} must stay inside the library`)
  }
  const target = resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`path ${JSON.stringify(raw)} escapes the library root`)
  }
  return { relative, target }
}

/** Validate the change set and confine every path to the library root. */
function normalizeChanges(library, input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('a contribution needs at least one file change')
  }
  return input.map((change, index) => {
    if (change === null || typeof change !== 'object') throw new Error(`changes[${index}] must be an object`)
    const raw = change.path
    if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`changes[${index}].path must be a non-empty relative path`)
    const relative = raw.trim().replace(/^\.\//u, '')
    if (isAbsolute(relative) || relative.split(/[\\/]/u).includes('..')) {
      throw new Error(`changes[${index}].path ${JSON.stringify(raw)} must stay inside the library`)
    }
    const target = resolve(library.path, relative)
    if (target !== library.path && !target.startsWith(`${library.path}${sep}`)) {
      throw new Error(`changes[${index}].path ${JSON.stringify(raw)} escapes the library root`)
    }
    if (change.delete === true) return { path: relative, target, delete: true }
    if (typeof change.content !== 'string') throw new Error(`changes[${index}].content must be a string`)
    return { path: relative, target, content: change.content }
  })
}

/** Write or remove one change inside the library. */
function applyChange(library, change) {
  if (change.delete === true) {
    rmSync(change.target, { force: true })
    return
  }
  mkdirSync(dirname(change.target), { recursive: true })
  writeFileSync(change.target, change.content, { encoding: 'utf8', mode: 0o644 })
}

/** A branch name git accepts and a reviewer can read. */
function slug(text) {
  const value = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
  return value === '' ? `change-${Date.now().toString(36)}` : value
}

function assertBranch(branch) {
  if (typeof branch !== 'string' || branch.trim() === '' || branch.startsWith('-') || /[\s~^:?*[\\]/u.test(branch) || branch.includes('..')) {
    throw new Error(`invalid branch name ${JSON.stringify(branch)}`)
  }
}

function defaultMessage(changes) {
  const paths = changes.map((change) => change.path)
  const head = paths.length === 1 ? `Update ${paths[0]}` : `Update ${paths.length} capabilities`
  return `${head}\n\n${paths.map((path) => `- ${path}`).join('\n')}`
}
