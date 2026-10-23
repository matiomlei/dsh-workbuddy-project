/** Git resource synchronization + portable workflow selection on an installed DSH. */
import assert from 'node:assert/strict'
import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
const root=resolve(process.argv[2]),url=readFileSync(join(root,'host.log'),'utf8').match(/dsh web: (\S+)/)[1],base=new URL(url).origin
const auth=await fetch(url,{redirect:'manual'}),cookie=auth.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
const request=async(route,action,body={})=>{const r=await fetch(base+route,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(60000)});return{status:r.status,value:await r.json()}}
const api=async(action,body={})=>{const r=await request('/api/workbuddy-delivery',action,body);assert.ok(r.status===200&&!r.value.error,JSON.stringify(r));return r.value}
const settings=async(action,body={})=>{const r=await request('/api/workbuddy-project',action,body);assert.equal(r.value.ok,true,JSON.stringify(r));return r.value.value}
const origin=join(root,'resource-origin'),checkout=join(root,'shared resource checkout');mkdirSync(origin,{recursive:true})
cpSync(fileURLToPath(new URL('../../examples/software-delivery/library',import.meta.url)),origin,{recursive:true})
const git=(...args)=>execFileSync('git',['-c','user.name=Resource Test','-c','user.email=resource@example.invalid','-c','commit.gpgsign=false','-C',origin,...args],{encoding:'utf8'}).trim()
git('init','-q');git('add','.');git('commit','-qm','resource v1')
await settings('saveLibrary',{config:{name:'shared-workflows',path:checkout,repo:origin,sync:{startup:false,daily:false,time:'09:00'}}})
await settings('syncLibrary',{library:'shared-workflows'})
const reference='shared-workflows:workflows/software-delivery'
let item=(await api('workflows/shared')).templates.find(item=>item.reference===reference)
assert.ok(item&&!item.error,JSON.stringify(item))
const first=await api('template/shared',{reference,expectedHash:item.hash}),before=await api('detail',{id:first.templateId})
assert.equal(before.template.source.library,'shared-workflows');assert.equal(before.template.source.hash,item.hash)
for(const binding of before.draft.definition.nodeBindings){assert.equal(binding.repositoryRole,'main');for(const refs of Object.values(binding.capabilities))assert.ok(refs.every(ref=>ref.startsWith('shared-workflows:')));assert.ok(Object.keys(binding.packages).length>=5)}
const published=await api('publish',{id:first.templateId,expectedRevision:before.draft.revision});assert.equal(published.ready,true)
const path=join(origin,'workflows/software-delivery/workflow.json'),recipe=JSON.parse(readFileSync(path));recipe.version=2;recipe.name='标准研发交付 · 更新版';recipe.definition.graph.nodes[0].data.label='需求澄清'
writeFileSync(path,JSON.stringify(recipe,null,2));git('add','.');git('commit','-qm','resource v2')
await settings('syncLibrary',{library:'shared-workflows'})
const stale=await request('/api/workbuddy-delivery','template/shared',{reference,expectedHash:item.hash});assert.notEqual(stale.status,200);assert.equal(stale.value.code,'SHARED_WORKFLOW_CHANGED')
item=(await api('workflows/shared')).templates.find(item=>item.reference===reference);assert.equal(item.version,2)
const second=await api('template/shared',{reference,expectedHash:item.hash}),updated=await api('detail',{id:second.templateId}),unchanged=await api('detail',{id:first.templateId})
assert.equal(updated.draft.definition.graph.nodes[0].data.label,'需求澄清');assert.deepEqual(unchanged.draft,before.draft);assert.equal(unchanged.versions[0].ready,true)
const report={date:new Date().toISOString(),platform:process.platform,externalModelCalls:0,templateId:first.templateId,checks:['resource Git is configured through the common settings API and cloned locally','portable workflow and all four capability types resolve using the configured library name and freeze into a publishable draft','Git fast-forward updates the catalog; stale selection is rejected while prior drafts and published versions remain unchanged']}
writeFileSync(join(root,'shared-workflows-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
