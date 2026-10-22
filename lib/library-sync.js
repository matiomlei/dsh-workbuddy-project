import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeLibraries, gitDir } from './project.js'
import { librarySchedule, repositoryAddress } from './library-config.js'
import { sameNativePath } from './native-path.js'

const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
/** Non-blocking git operations, with bounded time and no credential/SSH prompts. */
export function gitAsync(cwd, args, signal) {
  return new Promise((resolveResult, reject) => {
    execFile('git', ['-c', 'core.longpaths=true', ...args], { cwd, signal, timeout: 120000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GIT_PAGER: 'cat',
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes' } },
    (error, stdout, stderr) => error ? reject(new Error(signal?.aborted ? '同步已取消' : `Git 同步失败：${(stderr || error.message).trim().slice(0,2000)}`)) : resolveResult(stdout.trim()))
  })
}

/** Persisted library overrides and status. Existing profile libraries remain available. */
export class TeamLibraries {
  constructor(projectsRoot, defaults, { now = () => new Date(), git = gitAsync } = {}) {
    this.file = join(projectsRoot, '.team-libraries.json')
    this.home = dirname(projectsRoot)
    this.defaults = normalizeLibraries(defaults, 'team libraries')
    this.now = now; this.git = git; this.jobs = new Map(); this.stopped = false
    let stored = { libraries: [], statuses: {} }
    if (existsSync(this.file)) {
      stored = JSON.parse(readFileSync(this.file, 'utf8'))
      if (stored.version !== 1 || !Array.isArray(stored.libraries) || !stored.statuses || typeof stored.statuses !== 'object') throw new Error('团队资源库配置文件格式错误')
    }
    this.overrides = normalizeLibraries(stored.libraries, 'saved team libraries')
    if (stored.removed !== undefined && (!Array.isArray(stored.removed) || stored.removed.some(name => typeof name !== 'string'))) throw new Error('已删除资源库配置格式错误')
    this.removed = new Set(stored.removed ?? [])
    this.statuses = Object.fromEntries(Object.entries(stored.statuses).map(([name, status]) => [name, { ...status, running: false }]))
    this._merge()
  }
  _merge() {
    const entries = new Map(this.defaults.filter(entry => !this.removed.has(entry.name)).map(entry => [entry.name, entry]))
    for (const entry of this.overrides) if (!this.removed.has(entry.name)) entries.set(entry.name, entry)
    this.entries = [...entries.values()]
    this.onChange?.(this.entries)
  }
  _persist() {
    mkdirSync(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, libraries: this.overrides, removed: [...this.removed], statuses: this.statuses }, null, 2)+'\n', { mode: 0o600 })
      renameSync(temporary, this.file)
    } finally { rmSync(temporary, { force: true }) }
  }
  status(name) { return { ...(this.statuses[name] ?? {}), running: this.isBusy(name) } }
  isBusy(name) {
    const entry = this.entries.find(entry => entry.name === name)
    return [...this.jobs.keys()].some(key => key === name || (entry && this.entries.some(other => other.name === key && sameNativePath(other.path, entry.path))))
  }
  save(input) {
    if (this.stopped) throw new Error('资源库管理已停止，请刷新页面')
    const prior = this.entries.find(entry => entry.name === input.name)
    if (this.isBusy(input.name)) throw new Error('资源库正在同步，请等待完成后修改配置')
    const path = input.path?.trim() || prior?.path || join(this.home, 'libraries', input.name ?? '')
    if (!prior && !repositoryAddress(input.repo)) throw new Error('新资源库需要 Git 仓库地址')
    const [entry] = normalizeLibraries([{ ...prior, ...input, path, trust: prior?.trust ?? 'user', sync: librarySchedule(input.sync ?? prior?.sync) }], 'team library')
    if (entry.sync.startup || entry.sync.daily) if (!entry.repo) throw new Error('自动同步需要先配置 Git 仓库地址')
    if (this.entries.some(other => other.name !== entry.name && sameNativePath(other.path, entry.path))) throw new Error('该检出目录已被其他资源库使用')
    const previous = this.overrides
    const previousStatus = this.statuses[entry.name]
    const wasRemoved = this.removed.delete(entry.name)
    if (prior && (prior.path !== entry.path || prior.repo !== entry.repo)) this.statuses[entry.name] = {}
    this.overrides = [...this.overrides.filter(other => other.name !== entry.name), entry]
    try { this._persist() } catch (error) { this.overrides = previous; this.statuses[entry.name] = previousStatus; if (wasRemoved) this.removed.add(entry.name); throw error }
    this._merge()
    return entry
  }
  remove(name) {
    if (this.stopped) throw new Error('资源库管理已停止，请刷新页面')
    const entry = this.entries.find(entry => entry.name === name)
    if (!entry) throw new Error('资源库不存在')
    if (this.isBusy(name)) throw new Error('资源库正在同步，请等待完成后删除')
    const previous = this.overrides, previousStatus = this.statuses[name]
    this.overrides = this.overrides.filter(item => item.name !== name)
    this.removed.add(name); delete this.statuses[name]
    try { this._persist() } catch (error) { this.overrides = previous; this.statuses[name] = previousStatus; this.removed.delete(name); throw error }
    this._merge()
    return { library: name, removed: true, path: entry.path, filesRetained: true }
  }
  start() {
    this.stopped = false
    // Promise work starts after all plugin surfaces are registered.
    this.startup = Promise.resolve().then(async () => {
      if (this.stopped) return
      await Promise.allSettled(this.entries.filter(entry => entry.sync?.startup && entry.repo).map(entry => this.sync(entry.name, 'startup')))
      if (!this.stopped) await this.tick()
    })
    this.timer = setInterval(() => { this.tick().catch(() => {}) }, 30000)
    this.timer.unref?.()
    return () => this.stop()
  }
  async stop() {
    this.stopped = true; clearInterval(this.timer)
    for (const job of this.jobs.values()) job.controller.abort()
    await Promise.allSettled([...this.jobs.values()].map(job => job.promise))
  }
  async tick() {
    if (this.stopped) return
    const now = this.now(), today = localDate(now), minute = now.getHours()*60 + now.getMinutes()
    await Promise.allSettled(this.entries.filter(entry => {
      const sync = librarySchedule(entry.sync)
      const [hour, minutes] = sync.time.split(':').map(Number)
      return sync.daily && entry.repo && !this.isBusy(entry.name) && minute >= hour*60+minutes && this.statuses[entry.name]?.lastDailyDate !== today
    }).map(entry => this.sync(entry.name, 'daily')))
  }
  sync(name, trigger = 'manual') {
    if (this.stopped) return Promise.reject(new Error('资源库管理已停止，请刷新页面'))
    if (this.jobs.has(name)) return this.jobs.get(name).promise
    const entry = this.entries.find(entry => entry.name === name)
    if (!entry) return Promise.reject(new Error('资源库不存在'))
    if (!entry.repo) return Promise.reject(new Error('请先配置 Git 仓库地址'))
    if (this.isBusy(name)) return Promise.reject(new Error('该检出目录正在同步'))
    const controller = new AbortController(), job = { controller }
    this.jobs.set(name, job)
    job.promise = Promise.resolve().then(async () => {
      const now = this.now(), schedule = librarySchedule(entry.sync), due = schedule.time.split(':').map(Number)
      const lastDailyDate = trigger === 'daily' || (schedule.daily && now.getHours()*60+now.getMinutes() >= due[0]*60+due[1]) ? localDate(now) : this.statuses[name]?.lastDailyDate
      this.statuses[name] = { ...this.statuses[name], lastAttempt: now.toISOString(), trigger, lastDailyDate, error: undefined }
      try {
        this._persist()
        const result = await this._checkout(entry, controller.signal)
        if (controller.signal.aborted) throw new Error('同步已取消')
        this.statuses[name] = { ...this.statuses[name], lastSuccess: this.now().toISOString(), revision: result.revision, message: result.message, error: undefined }
        this._persist()
        return { library: name, ...result, status: { ...this.status(name), running: false } }
      } catch (error) {
        this.statuses[name] = { ...this.statuses[name], error: error.message }
        if (!this.stopped) this._persist()
        throw error
      } finally { this.jobs.delete(name) }
    })
    return job.promise
  }
  async _checkout(entry, signal) {
    const path = resolve(entry.path)
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('同步目录不能是符号链接')
    if (!existsSync(path) || (statSync(path).isDirectory() && readdirSync(path).length === 0)) {
      mkdirSync(dirname(path), { recursive: true })
      const temporary = mkdtempSync(join(dirname(path), `.${entry.name}-sync-`))
      try {
        await this.git(dirname(path), ['clone', '--', entry.repo, temporary], signal)
        if (signal.aborted) throw new Error('同步已取消')
        // The target must still be absent/empty; clone never overwrites user files.
        if (existsSync(path)) {
          if (!statSync(path).isDirectory() || readdirSync(path).length) throw new Error('目标目录已出现文件，已停止克隆')
          rmdirSync(path)
        }
        renameSync(temporary, path)
      } finally { rmSync(temporary, { recursive: true, force: true }) }
      return { revision: await this.git(path, ['rev-parse', '--short', 'HEAD'], signal), message: '已克隆资源库' }
    }
    if (!statSync(path).isDirectory() || !gitDir(path)) throw new Error('目标目录不是 Git 仓库，请选择空目录或已有团队仓库')
    const git = (args) => this.git(path, args, signal)
    const checkClean = async () => { if (await git(['status', '--porcelain', '--untracked-files=all'])) throw new Error('资源库有未提交改动，请先提交或处理改动后同步') }
    await checkClean()
    const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
    if (!branch) throw new Error('资源库处于固定提交检出，无法自动快进同步')
    const remote = await git(['remote', 'get-url', 'origin'])
    if (remote !== entry.repo) throw new Error('仓库地址与该目录的 origin 不一致，请填写现有地址，或选择新的空目录')
    await git(['fetch', '--no-tags', 'origin', `refs/heads/${branch}`])
    await checkClean()
    if (await git(['symbolic-ref', '--quiet', '--short', 'HEAD']) !== branch) throw new Error('同步期间分支发生变化，请重试')
    const before = await git(['rev-parse', 'HEAD'])
    // ff-only refuses local commits that diverge from the remote; never reset or stash.
    await git(['merge', '--ff-only', '--no-edit', 'FETCH_HEAD'])
    const after = await git(['rev-parse', 'HEAD'])
    return { revision: after.slice(0,12), message: before === after ? '已是最新版本' : '已快进更新资源库' }
  }
}
