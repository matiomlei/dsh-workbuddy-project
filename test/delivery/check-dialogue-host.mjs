/** Real installed DSH: visible streams, steering, questions and immutable rework. */
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
const head=git('rev-parse','HEAD'),graph={nodes:[{id:'coder',type:'agent',position:{x:10,y:10},data:{label:'交互编码',prompt:'DIALOGUE_CODER_PROBE',inputTemplate:'完成产品数据格式实现',tools:['read','write'],timeoutSec:4}},{id:'tester',type:'agent',position:{x:300,y:10},data:{label:'下游校验',prompt:'DIALOGUE_TESTER_PROBE',inputTemplate:'检查上游 product.json',tools:['read']} }],edges:[{id:'a-b',source:'coder',target:'tester'}]}
const created=await api('template/import',{name:'节点对话验收',definition:{graph,repositoryRoles:[{id:'main'}]}}),id=created.templateId
let editor=await api('editor/open',{id}),revision=editor.revision
for(const nodeId of ['coder','tester'])revision=(await api('node/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId,repositoryRole:'main',capabilities:{experts:[],skills:[],rules:[],connectors:[]},expectedHashes:{}})).revision
revision=(await api('quality-policy/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId:'coder',required:true})).revision
const version=await api('publish',{id,expectedRevision:revision});let project=await api('project/create',{name:'节点交互验证',repositories:[{alias:'repo',url:repo,ref:'HEAD'}]})
project=await api('project/bind',{id:project.id,expectedRevision:project.revision,binding:{templateId:id,version:version.version,repositoryMap:{main:'repo'}}})
const start=()=>api('runs/start',{requestId:randomUUID(),projectId:project.id,expectedProjectRevision:project.revision,triggerInput:'使用用户确认的格式'})
let run=await start(),detail
writeFileSync(join(root,'dialogue-active-run.json'),JSON.stringify({requestId:run.requestId,projectId:project.id,templateId:id}))
async function wait(predicate,requestId=run.requestId){for(let i=0;i<500;i++){const r=await api('runs/detail',{requestId}),d=await api('runs/node',{requestId,nodeId:'coder'});if(requestId===run.requestId){run=r;detail=d}if(predicate(r,d))return{run:r,detail:d};if(['preparation_failed','execution_failed','canceled'].includes(r.status))throw new Error(JSON.stringify({status:r.status,error:r.error,nodes:r.nodeStates,trace:d}));await new Promise(resolve=>setTimeout(resolve,100))}throw new Error('Dialogue test timed out')}
const message=(text,extra={})=>({messageId:randomUUID(),requestId:run.requestId,nodeId:'coder',expectedNativeRunId:detail.nativeRunId,expectedAttempt:detail.attempt,text,...extra})
const checks=[]
await wait((r,d)=>d.thread?.phase==='waiting_user')
assert.equal(run.nodeStates.tester,undefined)
await new Promise(resolve=>setTimeout(resolve,4500))
await wait((r,d)=>d.thread?.phase==='waiting_user');checks.push('human answer waiting pauses the node deadline rather than failing after timeoutSec')
const answer=message('JSON',{questionId:detail.thread.question.id})
await api('nodes/message',answer);await api('nodes/message',answer)
await wait((r,d)=>d.entries.some(entry=>entry.kind==='reasoning'&&entry.streaming&&entry.text.includes('VISIBLE_REASONING_PREFIX')))
assert.equal(detail.entries.filter(entry=>entry.kind==='question').length,1)
checks.push('reasoning prefix is visible through the authenticated gateway before the model step finishes')
const steer=message('补充：字段增加 name')
await api('nodes/message',steer);await api('nodes/message',steer)
await wait(r=>r.nodeStates.coder?.status==='waiting_quality')
assert.ok(detail.entries.some(entry=>entry.kind==='assistant'&&entry.text.includes('已接收补充字段要求')))
assert.ok(detail.entries.some(entry=>entry.kind==='tool'&&entry.name==='write'&&entry.status==='success'))
assert.equal(detail.entries.filter(entry=>entry.kind==='user'&&entry.text===steer.text).length,1)
checks.push('running steering is consumed once and retained beside actual tool call/result records')
const oldSubject=run.qualitySubjects.at(-1),oldArtifact=run.artifacts.find(item=>item.name==='product.json'),oldEvidence=JSON.stringify(oldSubject.evidence)
assert.ok(oldArtifact);assert.equal(run.nodeStates.tester,undefined)
await api('nodes/message',message('修改为v2，并保留已确认的字段要求'))
await wait(r=>r.codeAttempts.coder?.length===2&&r.nodeStates.coder?.status==='waiting_quality')
const subject=run.qualitySubjects.at(-1)
assert.equal(detail.entries.filter(entry=>entry.kind==='user'&&entry.text==='修改为v2，并保留已确认的字段要求').length,1)
assert.equal(subject.evidence.attempt,2);assert.equal(run.qualitySubjects[0].digest,oldSubject.digest);assert.equal(JSON.stringify(run.qualitySubjects[0].evidence),oldEvidence)
assert.notEqual(run.artifacts.find(item=>item.name==='product.json').sha256,oldArtifact.sha256)
assert.equal(run.nodeStates.tester,undefined)
const stale=await request('quality/decide',{decisionId:randomUUID(),requestId:run.requestId,subjectId:oldSubject.id,subjectDigest:oldSubject.digest,nodeId:'coder',attempt:1,reviewId:oldSubject.reviews.at(-1).id,outcome:'passed',note:'旧结果不能放行'})
assert.notEqual(stale.status,200)
checks.push('pre-acceptance conversation creates a new attempt, immutable old evidence and a new gate; stale acceptance cannot release downstream')
await api('quality/decide',{decisionId:randomUUID(),requestId:run.requestId,subjectId:subject.id,subjectDigest:subject.digest,nodeId:'coder',attempt:2,reviewId:subject.reviews.at(-1).id,outcome:'passed',note:'已核对 v2 产物和交互记录'})
await wait(r=>r.status==='execution_succeeded')
const tester=await api('runs/node',{requestId:run.requestId,nodeId:'tester'})
assert.equal(tester.reasoningAvailable,false);assert.ok(tester.entries.some(item=>item.kind==='tool'&&item.result?.includes('v2')))
const artifact=await api('runs/artifact',{requestId:run.requestId,artifactId:run.artifacts.find(item=>item.name==='product.json').id});assert.equal(JSON.parse(artifact.content).version,'v2')
assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'')
assert.equal((await api('runs/node',{requestId:run.requestId,nodeId:'coder'})).canSend,false)
checks.push('only the accepted revision reaches downstream; models without reasoning still show real replies and tools; source remains unchanged')
const sealed=JSON.stringify({outputs:run.outputs,handoffs:run.codeHandoffs,quality:run.qualitySubjects,artifacts:run.artifacts})
await api('nodes/message',message('解释 v2 的字段来源',{mode:'explain'}))
await wait((r,d)=>d.thread?.phase==='completed'&&d.entries.some(entry=>entry.channel==='explanation'&&entry.kind==='assistant'&&entry.text.includes('只读说明')))
assert.equal(JSON.stringify({outputs:run.outputs,handoffs:run.codeHandoffs,quality:run.qualitySubjects,artifacts:run.artifacts}),sealed)
const modelRequests=readFileSync(join(root,'test-model-requests.jsonl'),'utf8').trim().split('\n').map(row=>JSON.parse(row))
const discussionRequests=modelRequests.filter(row=>JSON.stringify(row.messages).includes('这是工作流已固定结果的只读讨论'))
assert.ok(discussionRequests.length);for(const request of discussionRequests){const names=request.tools.map(tool=>tool.name);assert.ok(names.includes('read'));assert.ok(!names.some(name=>['write','edit','bash','skill'].includes(name)||name.startsWith('mcp__')))}
checks.push('completed nodes support a separate read-only discussion without changing fixed outputs, artifacts or acceptance')
const first=run.requestId,cancelled=await start();run=cancelled
await wait((r,d)=>d.thread?.phase==='waiting_user');await api('runs/cancel',{requestId:run.requestId})
for(let i=0;i<100;i++){const r=await api('runs/detail',{requestId:run.requestId});if(r.status==='canceled')break;await new Promise(resolve=>setTimeout(resolve,100))}
const stopped=await api('runs/node',{requestId:run.requestId,nodeId:'coder'});assert.equal(stopped.canSend,false);assert.equal(stopped.thread.question,null)
assert.ok(!(await api('runs/node',{requestId:first,nodeId:'coder'})).entries.some(item=>item.sessionId===stopped.thread.sessionId))
checks.push('cancelled human questions drain correctly and independent runs keep separate node sessions and histories')
const report={date:new Date().toISOString(),platform:process.platform,node:process.version,externalModelCalls:0,requestId:first,cancelledRequestId:run.requestId,checks}
writeFileSync(join(root,'dialogue-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
