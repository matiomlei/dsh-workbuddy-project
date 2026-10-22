/** Run after check-restart-host --prepare-resume and restarting the isolated DSH. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
const root=resolve(process.argv[2]),fixed=JSON.parse(readFileSync(join(root,'cold-resume.json'))),url=readFileSync(join(root,'host.log'),'utf8').match(/dsh web: (\S+)/)[1],base=new URL(url).origin
const auth=await fetch(url,{redirect:'manual'}),cookie=auth.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
const api=async(action,body={})=>{const r=await fetch(base+'/api/workbuddy-delivery',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(20000)}),v=await r.json();assert.ok(r.ok&&!v.error,JSON.stringify(v));return v}
let detail=await api('runs/node',{requestId:fixed.requestId,nodeId:'coder'})
assert.equal(detail.thread.sessionId,fixed.sessionId);assert.equal(detail.canContinue,true)
await api('nodes/message',{messageId:randomUUID(),requestId:fixed.requestId,nodeId:'coder',expectedNativeRunId:detail.nativeRunId,expectedAttempt:1,mode:'continue',text:'保留进度并继续'})
let run
for(let i=0;i<300;i++){
  run=await api('runs/detail',{requestId:fixed.requestId});detail=await api('runs/node',{requestId:fixed.requestId,nodeId:'coder'})
  if(run.nodeStates.coder?.status==='waiting_quality')break
  assert.ok(!['execution_failed','canceled','interrupted'].includes(run.status),JSON.stringify({run,detail}))
  await new Promise(r=>setTimeout(r,100))
}
assert.equal(run.nodeStates.coder?.status,'waiting_quality');assert.equal(detail.attempt,1);assert.equal(detail.thread.sessionId,fixed.sessionId)
assert.deepEqual(detail.entries.find(e=>e.id===fixed.partialTrace.id),fixed.partialTrace)
assert.equal(detail.entries.filter(e=>e.kind==='tool'&&e.name==='write'&&e.callId==='partial-write').length,1)
assert.equal(run.codeAttempts.coder.length,1);assert.equal(run.codeAttempts.source.length,1);assert.equal(run.nodeStates.tester,undefined)
const artifact=await api('runs/artifact',{requestId:fixed.requestId,artifactId:run.artifacts.find(a=>a.name==='result.json').id})
assert.deepEqual(JSON.parse(artifact.content),{continued:true,partialPreserved:true})
const subject=run.qualitySubjects.at(-1)
await api('quality/decide',{decisionId:randomUUID(),requestId:fixed.requestId,subjectId:subject.id,subjectDigest:subject.digest,nodeId:'coder',attempt:1,reviewId:subject.reviews.at(-1).id,outcome:'passed',note:'重启后恢复原会话与部分成果验证通过'})
for(let i=0;i<200;i++){run=await api('runs/detail',{requestId:fixed.requestId});if(run.status==='execution_succeeded')break;await new Promise(r=>setTimeout(r,100))}
assert.equal(run.status,'execution_succeeded')
const report={date:new Date().toISOString(),platform:process.platform,node:process.version,externalModelCalls:0,requestId:fixed.requestId,sessionId:fixed.sessionId,checks:['after a real host process restart, the original persisted session and attempt resume with original tool results','partial work is preserved, completed write is not repeated, and original history rows are not duplicated or reassigned','accepted upstream is reused and the resumed result waits for quality before releasing downstream']}
writeFileSync(join(root,'cold-resume-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
