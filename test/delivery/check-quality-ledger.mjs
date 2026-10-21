import assert from 'node:assert/strict'
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { QualityLedger } from '../../lib/delivery/quality-ledger.mjs'
import { validateDefinition } from '../../lib/delivery/template-store.mjs'
const directory=mkdtempSync(join(tmpdir(),'dsh-quality-ledger.')),checks=[]
let db=new DatabaseSync(join(directory,'quality.sqlite'));db.exec('PRAGMA foreign_keys=ON');let ledger=new QualityLedger(db)
try {
  const graph={nodes:[{id:'node',type:'script',data:{}}],edges:[]}
  for(const policies of [[{nodeId:'node',required:false}],[{nodeId:'missing',required:true}],[{nodeId:'node',required:true,provider:'chosen-early'}],[{nodeId:'node',required:true},{nodeId:'node',required:true}]])assert.throws(()=>validateDefinition({graph,qualityPolicies:policies}))
  assert.equal(validateDefinition({graph,qualityPolicies:[{nodeId:'node',required:true}]}).qualityPolicies.length,1)
  checks.push({name:'publication rejects missing, duplicate, invalid and premature provider-specific quality policies',passed:true})
  const input={requestId:'run',businessRunId:'business',template:{id:'template',version:1,digest:'template-sha'},nodeId:'node',attempt:1,handoff:{repositories:[{alias:'repo',inputCommit:'base',outputCommit:'commit',sources:[]}]},artifacts:[{id:'artifact',repository:'repo',name:'deleted',change:'deleted',sha256:null,outputCommit:'commit'}],result:{output:'output',structuredOutput:{type:'text',value:'output'}}}
  const subject=ledger.create(input);assert.deepEqual(ledger.create(input),subject)
  assert.throws(()=>ledger.create({...input,result:{...input.result,output:'mutated'}}),e=>e.code==='QUALITY_SUBJECT_CHANGED')
  checks.push({name:'subject identity fixes output, repository commits and deletion artifacts; replay cannot change evidence',passed:true})
  const second=ledger.create({...input,attempt:2});assert.notEqual(subject.id,second.id);assert.notEqual(subject.digest,second.digest)
  const review=ledger.current(subject.id),intent={decisionId:'decision',requestId:'run',subjectId:subject.id,subjectDigest:subject.digest,nodeId:'node',attempt:1,reviewId:review.id,outcome:'failed',note:'local fixture check'}
  assert.throws(()=>ledger.decide({...intent,attempt:2}),e=>e.code==='QUALITY_SUBJECT_MISMATCH')
  ledger.decide(intent);assert.equal(ledger.list('run').find(s=>s.id===second.id).status,'pending')
  checks.push({name:'new execution attempt gets a distinct subject; earlier results cannot approve or reject the new attempt',passed:true})
  const next=ledger.open(subject.id,review.id);assert.equal(next.sequence,2)
  assert.throws(()=>ledger.decide({...intent,decisionId:'late'}),e=>e.code==='QUALITY_REVIEW_CONFLICT')
  const pass={...intent,decisionId:'pass',reviewId:next.id,outcome:'passed'};ledger.decide(pass)
  assert.throws(()=>ledger.open(subject.id,next.id),e=>e.code==='QUALITY_RECHECK_NOT_ALLOWED')
  checks.push({name:'new review rounds preserve failure, reject late callbacks and do not reopen an already accepted subject',passed:true})
  db.close();db=new DatabaseSync(join(directory,'quality.sqlite'));ledger=new QualityLedger(db)
  assert.equal(ledger.list('run').find(s=>s.id===subject.id).status,'passed');assert.equal(ledger.list('run').find(s=>s.id===subject.id).reviews.length,2)
  assert.equal(ledger.list('run').find(s=>s.id===second.id).status,'pending')
  checks.push({name:'reopened database retains independent attempt status and full immutable review history',passed:true})
  const result={date:'2026-10-21',checks};if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
} finally { db.close();rmSync(directory,{recursive:true,force:true}) }
