import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { RunCheckpoints, recoveryPlan } from '../../lib/delivery/run-checkpoints.mjs'
import { QualityLedger } from '../../lib/delivery/quality-ledger.mjs'
const root=mkdtempSync(join(tmpdir(),'delivery-recovery-checkpoints.')),file=join(root,'business.sqlite'),checks=[]
let db=new DatabaseSync(file),store=new RunCheckpoints(db),quality=new QualityLedger(db)
try {
  const manifest={businessRunId:'business',template:{id:'template',version:1,digest:'fixed'},definition:{graph:{nodes:[{id:'code',type:'agent'},{id:'hold',type:'script'}],edges:[{id:'edge',source:'code',target:'hold'}]},qualityPolicies:[{nodeId:'code',required:true}]}}
  const handoff={attempt:1,status:'ready',repositories:[{alias:'code',inputCommit:'base',outputCommit:'fixed',sources:[]}],artifactIds:[]},result={output:'fixed output',structuredOutput:{version:1,type:'text',value:'fixed output'},extra:{}}
  const input={requestId:'request',businessRunId:'business',nodeId:'code',attempt:1,handoff,artifacts:[],result}
  const cp=store.put(input);assert.deepEqual(store.put(input),cp);assert.throws(()=>store.put({...input,result:{...result,output:'changed'}}),e=>e.code==='CHECKPOINT_CHANGED')
  checks.push({name:'successful execution checkpoint is idempotent and refuses a changed output for the same attempt',passed:true})
  const job={requestId:'request',nativeRunId:'native',preparationComplete:true,codeAttempts:{code:[{attempt:1,status:'ready'}]},codeHandoffs:{code:handoff},artifacts:[]}
  quality.create({...input,template:manifest.template})
  const plan=(current=job,cps=store.list('request'),subjects=quality.list('request'))=>recoveryPlan({job:current,manifest,checkpoints:cps,subjects})
  let p=plan();assert.equal(p.eligible,true);assert.deepEqual(p.completed,[]);assert.deepEqual(p.waiting,['code']);assert.deepEqual(p.unstarted,['hold'])
  const subject=quality.list('request')[0],intent={decisionId:'failed',requestId:'request',subjectId:subject.id,subjectDigest:subject.digest,nodeId:'code',attempt:1,reviewId:subject.reviews[0].id,outcome:'failed',note:'fixture'}
  quality.decide(intent);assert.deepEqual(plan().waiting,['code'])
  const next=quality.open(subject.id,intent.reviewId);quality.decide({...intent,decisionId:'passed',reviewId:next.id,outcome:'passed'});assert.deepEqual(plan().completed,['code'])
  checks.push({name:'pending and failed quality remain parked; only an accepted subject becomes a reusable successful seed',passed:true})
  assert.ok(plan({...job,preparationComplete:false}).reasons.some(r=>r.code==='PREPARATION_NOT_CHECKPOINTED'))
  assert.ok(plan({...job,codeAttempts:{code:[...job.codeAttempts.code,{attempt:2,status:'executing'}]}}).reasons.some(r=>r.code==='EXECUTION_OUTCOME_UNCERTAIN'))
  assert.ok(plan(job,[]).reasons.some(r=>r.code==='EXECUTION_OUTCOME_UNCERTAIN'))
  checks.push({name:'old preparation, missing checkpoints and a newer unfinished attempt cannot reuse older accepted evidence',passed:true})
  const childHandoff={...handoff,repositories:[{alias:'code',inputCommit:'fixed',outputCommit:'fixed',sources:[{nodeId:'code',commit:'fixed'}]}]}
  store.put({...input,nodeId:'hold',handoff:childHandoff})
  const childJob={...job,codeAttempts:{...job.codeAttempts,hold:[{attempt:1,status:'ready'}]},codeHandoffs:{...job.codeHandoffs,hold:childHandoff}}
  const pending=structuredClone(quality.list('request'));pending[0].status='pending'
  assert.ok(plan(childJob,store.list('request'),pending).reasons.some(r=>r.code==='RECOVERY_DEPENDENCY_MISMATCH'))
  assert.equal(plan(childJob).eligible,true)
  checks.push({name:'recorded consumers require accepted parents before any recovery seed is admitted',passed:true})
  assert.ok(plan({...job,codeHandoffs:{code:{...handoff,status:'changed'}}}).reasons.some(r=>r.code==='CHECKPOINT_HANDOFF_MISMATCH'))
  const badQuality=structuredClone(quality.list('request'));badQuality[0].evidence.output='changed'
  assert.ok(plan(job,store.list('request'),badQuality).reasons.some(r=>r.code==='QUALITY_CHECKPOINT_MISMATCH'))
  const nativeArtifacts=structuredClone(store.list('request'));nativeArtifacts[0].result.extra.artifacts=['native-report.txt']
  assert.ok(plan(job,nativeArtifacts).reasons.some(r=>r.code==='NATIVE_ARTIFACT_RECOVERY_NOT_READY'))
  checks.push({name:'handoff or quality drift and unsupported native artifact restoration produce explicit blocking reasons',passed:true})
  const digestBefore=plan(childJob).digest;db.close();db=new DatabaseSync(file);store=new RunCheckpoints(db);quality=new QualityLedger(db)
  assert.equal(plan(childJob).digest,digestBefore)
  assert.throws(()=>db.exec("UPDATE execution_checkpoints SET document_json='{}'"),/immutable execution checkpoint/);assert.throws(()=>db.exec('DELETE FROM execution_checkpoints'),/immutable execution checkpoint/)
  checks.push({name:'reopening the database preserves the recovery plan digest and checkpoint immutability',passed:true})
  const evidence={date:'2026-10-21',checks,scope:'synthetic checkpoint/planner fixtures, not Git or native execution'};if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2))
} finally {db.close();rmSync(root,{recursive:true,force:true})}
