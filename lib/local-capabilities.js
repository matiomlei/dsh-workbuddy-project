import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { KINDS, scanPackages } from './bundles.js'
import { localRuntimeEntries } from './local-runtime.js'
import { describeOption } from './capability-metadata.js'
export { describeOption } from './capability-metadata.js'

/** DSH and WorkBuddy sources use qualified IDs; connection secrets never leave the host. */
export function localSources(ctx,home) {
  const sources=[{name:'workbuddy',path:join(homedir(),'.workbuddy'),roots:{expert:join(homedir(),'.workbuddy/plugins/marketplaces/experts/plugins'),connector:join(homedir(),'.workbuddy/connectors-marketplace/connectors')}}]
  const runtime=localRuntimeEntries(ctx)
  const paths=[...new Set(runtime.filter(row=>row.module==='@deepseek-ai/dsh-skill-filesystem').flatMap(row=>[...(row.config.customSkillDirs??[]),...(row.config.bundledSkillDir?[row.config.bundledSkillDir]:[])]))]
  paths.forEach(path=>{const directory=existsSync(join(path,'SKILL.md'))?dirname(path):path;sources.push({name:`mounted-${createHash('sha256').update(resolve(directory)).digest('hex').slice(0,10)}`,path:resolve(directory),roots:{skill:resolve(directory)}})})
  return sources.filter(source=>existsSync(source.path)||Object.values(source.roots??{}).some(existsSync))
}
export function nativeConnectors(ctx) {
  return localRuntimeEntries(ctx).filter(row=>row.module==='@deepseek-ai/dsh-mcp-client').map(row=> {
    const {serverName,transport,url,command,args,cwd}=row.config
    return {name:serverName,displayName:serverName,reference:`runtime:connectors/${encodeURIComponent(row.id)}`,native:true,connectorType:'mcp',description:`DSH 本地连接器 · ${transport}`,
      server:{name:serverName,transport,url,command,args,cwd,localSource:row.id},transport}
  })
}
export function discoverLocalCapabilities(ctx,cwd,home) {
  home=resolve(process.env.DSH_HOME??home??join(homedir(),'.dsh'))
  const roots=[{name:'personal',path:home},{name:'agents',path:process.env.DSH_AGENTS_HOME??join(homedir(),'.agents')},...localSources(ctx,home)]
  const out={experts:[],skills:[],rules:[],connectors:[]}
  for (const source of roots) for (const [kind,key] of Object.entries(KINDS)) {
    const directory=source.roots?.[kind]??join(source.path,key)
    out[key].push(...scanPackages(directory,kind,source.name).map(entry=>describeOption(entry,kind)))
  }
  // Only public descriptions are returned; private native configurations stay in roots.
  out.connectors.push(...nativeConnectors(ctx).map(({server,...entry})=>entry))
  return out
}
