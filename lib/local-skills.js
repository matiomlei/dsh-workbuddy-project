import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Match DSH filesystem skill roots; keep absolute references so same-name bundles remain distinguishable. */
export function discoverLocalSkills(cwd, dshHome, agentsHome = process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'), additionalRoots = []) {
  let projectRoot = cwd ? resolve(cwd) : undefined
  for (let dir = projectRoot; dir; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) { projectRoot = dir; break }
    if (dirname(dir) === dir) break
  }
  const roots = [...new Set([
    ...(cwd ? [join(resolve(cwd), '.dsh', 'skills'), join(projectRoot, '.dsh', 'skills'), join(projectRoot, '.agents', 'skills')] : []),
    join(dshHome, 'skills'), join(agentsHome, 'skills'), ...additionalRoots,
    ...(process.env.DSH_BUNDLED_SKILL_DIR ? [process.env.DSH_BUNDLED_SKILL_DIR] : []),
  ])]
  return roots.flatMap((root) => {
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.') && entry.name !== '_system')
      .filter((entry) => existsSync(join(root, entry.name, 'SKILL.md')))
      .map((entry) => ({ name: entry.name, path: join(root, entry.name), source: root }))
  })
}

/** Read-only bundle preview. A symlink outside the chosen bundle cannot expose another local file. */
export function previewSkill(directory, file) {
  const root = realpathSync(directory)
  if (!statSync(root).isDirectory() || !existsSync(join(root, 'SKILL.md'))) throw new Error('A skill must be a complete directory containing SKILL.md')
  const files = []
  const inside = (path) => {
    const real = realpathSync(path)
    const rel = relative(root, real)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Skill preview cannot follow paths outside the bundle')
    return real
  }
  const visited = new Set()
  const walk = (dir) => {
    const real = inside(dir)
    if (visited.has(real)) throw new Error('Skill preview encountered a directory cycle or alias')
    visited.add(real)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const stats = statSync(inside(path))
      if (stats.isDirectory()) walk(path)
      else if (stats.isFile()) files.push({ path: relative(root, path).split(sep).join('/'), bytes: stats.size })
      if (files.length > 1000) throw new Error('Skill preview exceeds 1000 files; the directory was not modified')
    }
  }
  walk(root)
  const selected = file ?? 'SKILL.md'
  if (!files.some((entry) => entry.path === selected)) throw new Error('Requested file is not in the skill bundle')
  const path = inside(resolve(root, selected))
  if (statSync(path).size > 512 * 1024) return { directory, files, selected, previewUnavailable: 'File exceeds the 512 KiB preview limit' }
  const bytes = readFileSync(path)
  if (bytes.includes(0)) return { directory, files, selected, previewUnavailable: 'Binary file; text preview is unavailable' }
  return { directory, files, selected, content: bytes.toString('utf8') }
}
