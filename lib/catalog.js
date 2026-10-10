/** One catalog item per complete capability package. */
import { KINDS, packageHash, scanPackages } from './bundles.js'
import { describeOption } from './capability-metadata.js'
import { join } from 'node:path'
export const CAPABILITY_KINDS = Object.entries(KINDS).map(([kind,dir])=>({kind,dir,label:{expert:'专家',skill:'技能',rule:'规范',connector:'连接器'}[kind]}))
export function kindSpec(kind) { return CAPABILITY_KINDS.find(item=>item.kind===kind) }
export function hashCapability(path) { return packageHash(path).hash }
export function listCapabilities(library) {
  if (!library.exists) return []
  return CAPABILITY_KINDS.flatMap(spec=>scanPackages(join(library.path,spec.dir),spec.kind,library.name).map(entry=> {
    let hash,error=entry.error
    try { hash=packageHash(entry.path).hash } catch(problem) { error=problem.message }
    return describeOption({...entry,library:library.name,relative:`${spec.dir}/${entry.name}`,key:entry.reference,label:spec.label,hash,error},spec.kind)
  }))
}
export function dependencyIndex(sources) {
  const out=new Map()
  for (const source of sources) for (const key of source.keys) {
    const refs=out.get(key)??[];refs.push({kind:source.kind,id:source.id,library:source.library});out.set(key,refs)
  }
  return out
}
