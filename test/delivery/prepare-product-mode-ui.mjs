/** Prepare an actual running project whose active node is not the first node. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
const root=resolve(process.argv[2]),url=readFileSync(join(root,'host.log'),'utf8').match(/dsh web: (\S+)/)?.[1]
assert.ok(url);const base=new URL(url).origin,response=await fetch(url,{redirect:'manual'}),cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
const request=async(action,body={})=>{const r=await fetch(base+'/api/workbuddy-delivery',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(20000)});return{status:r.status,value:await r.json()}}
const api=async(action,body={})=>{const r=await request(action,body);assert.ok(r.status===200&&!r.value.error,JSON.stringify(r));return r.value}
const repo=join(root,'dialogue-source');mkdirSync(repo,{recursive:true})
const git=(...args)=>execFileSync('git',['-c','user.name=Dialogue Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-C',repo,...args],{encoding:'utf8'}).trim()
if(!existsSync(join(repo,'.git'))){git('init','-q');writeFileSync(join(repo,'README.md'),'Dialogue acceptance\n');git('add','.');git('commit','-qm','base')}
const graph={nodes:[{id:'requirements',type:'agent',position:{x:0,y:10},data:{label:'需求分析',prompt:'完成需求分析',inputTemplate:'确认需求'}},{id:'design',type:'agent',position:{x:300,y:10},data:{label:'方案设计',prompt:'DIALOGUE_CODER_PROBE',inputTemplate:'完成产品数据格式实现',tools:['read','write'],timeoutSec:120}},{id:'done',type:'output',position:{x:600,y:10},data:{label:'交付汇总'}}],edges:[{id:'a',source:'requirements',target:'design'},{id:'b',source:'design',target:'done'}]}
const created=await api('template/import',{name:'项目模式入口验证',definition:{graph,repositoryRoles:[{id:'main'}]}}),id=created.templateId
let editor=await api('editor/open',{id}),revision=editor.revision
for(const nodeId of ['requirements','design'])revision=(await api('node/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId,repositoryRole:'main',capabilities:{experts:[],skills:[],rules:[],connectors:[]},expectedHashes:{}})).revision
revision=(await api('quality-policy/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId:'design',required:true})).revision
const version=await api('publish',{id,expectedRevision:revision});let project=await api('project/create',{name:'项目自动定位验证',repositories:[{alias:'repo',url:repo,ref:'HEAD'}]})
project=await api('project/bind',{id:project.id,expectedRevision:project.revision,binding:{templateId:id,version:version.version,repositoryMap:{main:'repo'}}})
const start=()=>api('runs/start',{requestId:randomUUID(),projectId:project.id,expectedProjectRevision:project.revision,triggerInput:'使用用户确认的格式'})
let run=await start(),detail
writeFileSync(join(root,'product-mode-active-run.json'),JSON.stringify({requestId:run.requestId,projectId:project.id,templateId:id}))
async function wait(predicate,requestId=run.requestId){for(let i=0;i<500;i++){const r=await api('runs/detail',{requestId}),d=await api('runs/node',{requestId,nodeId:'design'});if(requestId===run.requestId){run=r;detail=d}if(predicate(r,d))return{run:r,detail:d};if(['preparation_failed','execution_failed','canceled'].includes(r.status))throw new Error(JSON.stringify({status:r.status,error:r.error,nodes:r.nodeStates,trace:d}));await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Dialogue test timed out')}
const message=(text,extra={})=>({messageId:randomUUID(),requestId:run.requestId,nodeId:'design',expectedNativeRunId:detail.nativeRunId,expectedAttempt:detail.attempt,text,...extra})
await wait((r,d)=>d.thread?.phase==='waiting_user'&&r.nodeStates.requirements?.status==='success')
console.log(JSON.stringify({requestId:run.requestId,projectId:project.id,nodeId:'design',nodeName:'方案设计',status:run.status},null,2))
