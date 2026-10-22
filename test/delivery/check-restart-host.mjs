/** Actual DSH + actual Git: interrupted work can continue or reset explicitly. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
const root=resolve(process.argv[2]),url=readFileSync(join(root,'host.log'),'utf8').match(/dsh web: (\S+)/)?.[1],base=new URL(url).origin
const auth=await fetch(url,{redirect:'manual'}),cookie=auth.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
const request=async(action,body={})=>{const r=await fetch(base+'/api/workbuddy-delivery',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(20000)});return{status:r.status,value:await r.json()}}
const api=async(action,body={})=>{const r=await request(action,body);assert.ok(r.status===200&&!r.value.error,JSON.stringify(r));return r.value}
const repo=join(root,'restart-source');mkdirSync(repo,{recursive:true})
const git=(...args)=>execFileSync('git',['-c','user.name=Restart Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-C',repo,...args],{encoding:'utf8'}).trim()
if(!existsSync(join(repo,'.git'))){git('init','-q');writeFileSync(join(repo,'README.md'),'Restart acceptance\n');git('add','.');git('commit','-qm','base')}
const graph={nodes:['source','coder','tester'].map((id,i)=>({id,type:'agent',position:{x:i*260,y:10},data:{label:{source:'已完成上游',coder:'中断与重试',tester:'下游校验'}[id],prompt:id==='coder'?'RESTART_CODER_PROBE':'完成当前阶段',inputTemplate:'{{$trigger}}',tools:['read','write']}})),edges:[{id:'a',source:'source',target:'coder'},{id:'b',source:'coder',target:'tester'}]}
const template=await api('template/import',{name:'中断恢复验证',definition:{graph,repositoryRoles:[{id:'main'}]}}),id=template.templateId,editor=await api('editor/open',{id})
let revision=editor.revision
for(const nodeId of ['source','coder','tester'])revision=(await api('node/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId,repositoryRole:'main',capabilities:{experts:[],skills:[],rules:[],connectors:[]},expectedHashes:{}})).revision
revision=(await api('quality-policy/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId:'coder',required:true})).revision
const published=await api('publish',{id,expectedRevision:revision});let project=await api('project/create',{name:'中断恢复验收',repositories:[{alias:'repo',url:repo,ref:'HEAD'}]})
project=await api('project/bind',{id:project.id,expectedRevision:project.revision,binding:{templateId:id,version:published.version,repositoryMap:{main:'repo'}}})
const start=()=>api('runs/start',{requestId:randomUUID(),projectId:project.id,expectedProjectRevision:project.revision,triggerInput:'RESTART_TOKEN:'+randomUUID()})
async function wait(id,predicate){for(let i=0;i<400;i++){const run=await api('runs/detail',{requestId:id}),detail=await api('runs/node',{requestId:id,nodeId:'coder'});if(predicate(run,detail))return{run,detail};await new Promise(r=>setTimeout(r,100))}throw new Error('Restart test timeout: '+JSON.stringify(await api('runs/detail',{requestId:id})))}
const approve=async run=>{const s=run.qualitySubjects.at(-1);return api('quality/decide',{decisionId:randomUUID(),requestId:run.requestId,subjectId:s.id,subjectDigest:s.digest,nodeId:'coder',attempt:s.evidence.attempt,reviewId:s.reviews.at(-1).id,outcome:'passed',note:'核对恢复产物'})}
const checks=[]
let run=await start(),state=await wait(run.requestId,(r,d)=>r.status==='execution_failed'&&d.canContinue)
assert.equal(state.run.nodeStates.coder.status,'error');assert.equal(state.run.codeHandoffs.coder,undefined);assert.equal(state.run.qualitySubjects.length,0)
assert.ok(state.detail.entries.some(e=>e.kind==='tool'&&e.name==='write'&&e.status==='success'));assert.equal(state.detail.canRetry,true)
checks.push('provider error named 运行已取消 becomes a model failure, never user cancellation, a successful handoff or a quality gate')
const sourceOutput=state.run.outputs.source,sourceHandoff=JSON.stringify(state.run.codeHandoffs.source)
const message={messageId:randomUUID(),requestId:run.requestId,nodeId:'coder',expectedNativeRunId:state.detail.nativeRunId,expectedAttempt:1,mode:'continue',text:'保留进度并继续'}
await api('nodes/message',message);await api('nodes/message',message)
state=await wait(run.requestId,r=>r.nodeStates.coder?.status==='waiting_quality')
assert.equal(state.run.codeAttempts.source.length,1);assert.equal(JSON.stringify(state.run.codeHandoffs.source),sourceHandoff);assert.equal(state.run.outputs.source,sourceOutput)
assert.equal(state.run.codeAttempts.coder.length,2);assert.equal(state.run.nodeStates.tester,undefined)
assert.equal(state.detail.entries.filter(e=>e.kind==='user'&&e.text===message.text).length,1)
assert.ok(state.detail.entries.some(e=>e.kind==='tool'&&e.result?.includes('PARTIAL_WORK')&&e.attempt===2))
let artifact=await api('runs/artifact',{requestId:run.requestId,artifactId:state.run.artifacts.find(a=>a.name==='result.json').id});assert.deepEqual(JSON.parse(artifact.content),{continued:true,partialPreserved:true})
checks.push('sending continue carries user instructions/history and partial files into a new attempt; upstream is reused and downstream stays gated')
await approve(state.run);await wait(run.requestId,r=>r.status==='execution_succeeded');const continued=run.requestId
run=await start();state=await wait(run.requestId,(r,d)=>r.status==='execution_failed'&&d.canRetry)
const retry={commandId:randomUUID(),requestId:run.requestId,nodeId:'coder',expectedNativeRunId:state.detail.nativeRunId,expectedAttempt:1}
await api('nodes/retry',retry);await api('nodes/retry',retry)
state=await wait(run.requestId,r=>r.nodeStates.coder?.status==='waiting_quality')
assert.equal(state.run.codeAttempts.coder.length,2);assert.equal(state.run.codeAttempts.source.length,1);assert.equal(state.run.nodeStates.tester,undefined)
assert.ok(!state.run.artifacts.some(a=>a.nodeId==='coder'&&a.name==='partial.txt'))
artifact=await api('runs/artifact',{requestId:run.requestId,artifactId:state.run.artifacts.find(a=>a.name==='result.json').id});assert.deepEqual(JSON.parse(artifact.content),{continued:false,partialPreserved:false})
assert.notEqual((await request('nodes/retry',{...retry,commandId:randomUUID()})).status,200)
checks.push('one-click retry is idempotent, cleans partial writes, reuses accepted parents and rejects stale-generation commands')
await approve(state.run);await wait(run.requestId,r=>r.status==='execution_succeeded')
assert.equal(git('status','--porcelain'),'')
const report={date:new Date().toISOString(),platform:process.platform,node:process.version,externalModelCalls:0,continuedRequestId:continued,retriedRequestId:run.requestId,checks}
writeFileSync(join(root,'restart-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
