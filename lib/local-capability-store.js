/** Save a validated package locally without requiring Git or a shared library. */
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { KINDS, packageFiles, scanPackages } from './bundles.js'
import { validateReference } from './project.js'
import { confinePath } from './contribute.js'

export function capabilityRoot(library, path) {
  const { relative } = confinePath(library.path, path)
  const parts = relative.split('/'), kind = Object.keys(KINDS).find(kind => KINDS[kind] === parts[0])
  if (!kind || parts.length < 3) throw new Error('Edit a file inside a capability package')
  const existing = scanPackages(join(library.path, parts[0]), kind, library.name).find(item => relative.startsWith(`${parts[0]}/${item.name}/`))
  const marker = { expert: 'agents', skill: 'SKILL.md', rule: 'RULE.md', connector: 'mcp.json' }[kind]
  const boundary = parts.indexOf(marker, 2)
  const root = existing ? `${parts[0]}/${existing.name}` : parts.slice(0, boundary > 1 ? boundary : 2).join('/')
  validateReference(`${library.name}:${root}`, kind)
  return { root, kind, id: root.split('/').at(-1) }
}

export function saveLocalPackage(library, changes, { create = false } = {}) {
  const roots = new Set(changes.map(change => capabilityRoot(library, change.path).root))
  if (roots.size !== 1) throw new Error('一次只能保存一个能力包')
  const packageName = [...roots][0]
  const kind = Object.keys(KINDS).find(kind => packageName.startsWith(`${KINDS[kind]}/`))
  if (!kind) throw new Error('能力类型无效')
  validateReference(`${library.name}:${packageName}`, kind)
  const { target } = confinePath(library.path, packageName)
  // Never replace packages through symlinks, including dangling links.
  let part = library.path
  for (const name of packageName.split('/')) {
    part = join(part, name)
    try { if (lstatSync(part).isSymbolicLink()) throw new Error('不能写入符号链接能力目录') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const existed = existsSync(target)
  if (create && existed) throw new Error('该能力已存在，请修改路径或编辑已有能力')
  if (!create && !existed) throw new Error('能力已不存在，请刷新后重试')
  mkdirSync(dirname(target), { recursive: true })
  const staging = mkdtempSync(join(dirname(target), '.wb-save-'))
  const draft = join(staging, 'package'), backup = join(staging, 'backup')
  mkdirSync(draft)
  try {
    if (existed) for (const file of packageFiles(target)) {
      const dest = join(draft, file.relative)
      mkdirSync(dirname(dest), { recursive: true }); copyFileSync(file.path, dest)
    }
    for (const change of changes) {
      const dest = join(draft, relative(packageName, change.path))
      if (change.delete) rmSync(dest, { force: true })
      else { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, change.content, { mode: 0o644 }) }
    }
    if (existed) renameSync(target, backup)
    try { renameSync(draft, target) }
    catch (error) { if (existed) renameSync(backup, target); throw error }
    return { library: library.name, package: packageName, files: changes.map(change => change.path), saved: true }
  } finally { rmSync(staging, { recursive: true, force: true }) }
}
