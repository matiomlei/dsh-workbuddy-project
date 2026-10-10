/** Immutable package snapshots. Git synchronization cannot change running projects. */
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { KINDS, packageFiles, packageHash, readJson } from './bundles.js'
import { libraryRevision, packageRoots, resolvePackage, validateReference } from './project.js'

export function snapshotProject(project,{write = true,refresh = false} = {}) {
  const cacheRoot=project.cacheRoot
  if (!cacheRoot) throw new Error('Capability cache root is required')
  const selected={...project,locked:refresh?{}:project.locked}
  const references=Object.entries(KINDS).flatMap(([kind,key])=>selected[key].map(reference=>({kind,reference})))
  if (project.experts.length) {
    const main=resolvePackage(project.experts[0],'expert',selected)
    const dependencies=main.metadata.connectors??[]
    if (!Array.isArray(dependencies)) throw new Error('Expert connectors must be qualified references')
    for (const reference of dependencies) { validateReference(reference,'connector');references.push({kind:'connector',reference}) }
  }
  const locked={}
  for (const {kind,reference} of references) {
    if (locked[reference]) continue
    const bundle=resolvePackage(reference,kind,selected)
    if (bundle.native) continue
    const digest=packageHash(bundle.path).hash
    if (bundle.hash && bundle.hash!==digest) throw new Error(`Cached package ${reference} was modified; explicitly upgrade project capabilities`)
    const root=packageRoots(project).find(entry=>entry.name===validateReference(reference,kind).source)
    locked[reference]={ hash:digest,version:bundle.version,sourcePath:bundle.sourcePath??bundle.path,revision:selected.locked[reference]?.revision??(root?.path?libraryRevision(root.path):undefined) }
    if (!write) continue
    const target=join(cacheRoot,digest)
    if (!existsSync(target)) {
      mkdirSync(cacheRoot,{recursive:true})
      const temporary=join(cacheRoot,`.${randomUUID()}`)
      try {
        mkdirSync(temporary)
        for (const file of packageFiles(bundle.path)) {
          const dest=join(temporary,file.relative);mkdirSync(dirname(dest),{recursive:true});copyFileSync(file.path,dest)
        }
        if (packageHash(temporary).hash!==digest) throw new Error(`${reference}: package changed while snapshotting; retry after synchronization`)
        renameSync(temporary,target)
      } finally { rmSync(temporary,{recursive:true,force:true}) }
    } else if (packageHash(target).hash!==digest) throw new Error(`Capability cache ${digest} is corrupted`)
  }
  return { project:write?{...selected,locked}:selected,locked }
}

export function savePackageLock(project,entries) {
  if (!project.lockPath) return
  atomicJson(project.lockPath,{version:1,packages:entries})
  const path=join(dirname(project.cacheRoot),'installed.json')
  const previous=existsSync(path)?readJson(path):{version:1,projects:{}}
  atomicJson(path,{version:1,projects:{...previous.projects,[project.id]:entries}})
}

export function atomicJson(path,data) {
  mkdirSync(dirname(path),{recursive:true})
  const temp=`${path}.${randomUUID()}.tmp`
  try { writeFileSync(temp,JSON.stringify(data,null,2)+'\n',{mode:0o600});renameSync(temp,path) }
  finally { rmSync(temp,{force:true}) }
}
