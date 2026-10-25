import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExecutionSettings } from '../../lib/delivery/execution-settings.mjs'
import { NodeDialogue } from '../../lib/delivery/node-dialogue.mjs'

const root=mkdtempSync(join(tmpdir(),'delivery-permissions-')),file=join(root,'settings.sqlite')
let db=new DatabaseSync(file),settings=new ExecutionSettings(db)
try {
  assert.equal(settings.get().autoAllowDangerFullAccess,false)
  assert.throws(()=>settings.save({autoAllowDangerFullAccess:'true'}),error=>error.code==='INVALID_EXECUTION_SETTINGS')
  const listeners=new Map(),events=[],agent={id:'node-agent',session:{seq:0,header:{cwd:root},snapshotEvents:()=>events}}
  const ctx={on:(name,fn)=>listeners.set(name,fn),tools:{register:()=>{}},systemPrompt:{section:()=>{}}}
  let pauses=0
  const dialogue=new NodeDialogue(db,{autoAllowDangerFullAccess:()=>settings.get().autoAllowDangerFullAccess})
  dialogue.attach({requestId:'r',nodeId:'n',nativeRunId:'g',attempt:1,agentCtx:ctx,agent,execution:{pauseTimeout:()=>{pauses++;return()=>{pauses--}}}})
  let sequence=0
  const ask=(args={sandbox_permissions:'danger-full-access'},reason='escalate sandbox to danger-full-access: test')=>{
    const callId=String(++sequence)
    events.push({seq:events.length,type:'tool/call',data:{name:'pwsh',callId,arguments:JSON.stringify(args)}})
    return listeners.get('approval/request')({agent,toolName:'pwsh',callId,reason},()=>{throw new Error('unmanaged request')})
  }
  const first=ask();assert.equal(dialogue.thread('r','n').approvals.length,1)
  settings.save({autoAllowDangerFullAccess:true});dialogue.applyApprovalSettings()
  assert.equal(await first,'allowed-once');assert.equal(pauses,0)
  assert.equal(await ask(),'allowed-once');assert.equal(dialogue.thread('r','n').approvals.length,0)
  assert.equal(dialogue.history('r','n').entries.filter(entry=>entry.decisionSource==='project-settings').length,2)
  const reject=()=>dialogue.decideApproval({requestId:'r',nodeId:'n',expectedNativeRunId:'g',expectedAttempt:1,approvalId:dialogue.thread('r','n').approvals[0].id,outcome:'rejected'})
  for(const args of [{sandbox_permissions:'workspace-write'},{command:'echo danger-full-access'}]) {
    const pending=ask(args);assert.equal(dialogue.thread('r','n').approvals.length,1);reject();assert.equal(await pending,'rejected')
  }
  const unrelated=ask(undefined,'An unrelated approval mentioning danger-full-access')
  assert.equal(dialogue.thread('r','n').approvals.length,1);reject();assert.equal(await unrelated,'rejected')
  settings.save({autoAllowDangerFullAccess:false});const pending=ask()
  assert.equal(dialogue.thread('r','n').approvals.length,1);reject();assert.equal(await pending,'rejected')
  settings.save({autoAllowDangerFullAccess:true});await dialogue.close('r','n');db.close()
  db=new DatabaseSync(file);settings=new ExecutionSettings(db)
  assert.equal(settings.get().autoAllowDangerFullAccess,true,'local preference survives a process/store reopen')
  console.log('PASS default/manual mode, persistent opt-in, waiting and future full-access calls, precise matching and disabling')
} finally {db.close();rmSync(root,{recursive:true,force:true})}
