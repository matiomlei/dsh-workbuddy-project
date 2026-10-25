import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {NodeDialogue} from '../../lib/delivery/node-dialogue.mjs'
const db=new DatabaseSync(':memory:'),dialogue=new NodeDialogue(db),listeners=new Map(),events=[];
let paused=0,resumed=0;
const agent={id:'approval-agent',status:'running',session:{seq:0,header:{cwd:'/private/node'},snapshotEvents:()=>events}};
const ctx={on:(name,fn,prepend)=>{listeners.set(name,{fn,prepend})},tools:{register:()=>{}},systemPrompt:{section:()=>{}}};
const live=dialogue.attach({requestId:'r',nodeId:'n',nativeRunId:'generation',attempt:1,agentCtx:ctx,agent,execution:{pauseTimeout:()=>{paused++;return()=>resumed++}}});
assert.equal(listeners.get('approval/request').prepend,true);
const input={requestId:'r',nodeId:'n',expectedNativeRunId:'generation',expectedAttempt:1};
const request=(id,signal)=>{events.push({seq:events.length,type:'tool/call',data:{callId:id,name:'pwsh',arguments:JSON.stringify({command:'Write-Output safe',sandbox_permissions:'danger-full-access'})}});return listeners.get('approval/request').fn({agent,toolName:'pwsh',callId:id,reason:'review exact command',signal},()=>{throw new Error('must stay in business answerer')})};
const controller=new AbortController(),one=request('a',controller.signal),two=request('b',controller.signal);
assert.equal(dialogue.thread('r','n').phase,'waiting_approval');assert.equal(paused,2);
const pending=dialogue.thread('r','n').approvals;assert.equal(pending.length,2);assert.match(pending[0].arguments,/Write-Output safe/);
assert.throws(()=>dialogue.decideApproval({...input,expectedAttempt:2,approvalId:pending[0].id,outcome:'allowed-once'}),e=>e.code==='NODE_APPROVAL_CHANGED');
assert.throws(()=>dialogue.decideApproval({...input,approvalId:pending[0].id,outcome:'always'}),e=>e.code==='INVALID_NODE_APPROVAL');
dialogue.decideApproval({...input,approvalId:pending[0].id,outcome:'allowed-once'});assert.equal(await one,'allowed-once');assert.equal(resumed,1);assert.equal(dialogue.thread('r','n').phase,'waiting_approval');
assert.throws(()=>dialogue.decideApproval({...input,approvalId:pending[0].id,outcome:'allowed-once'}),e=>e.code==='NODE_APPROVAL_CHANGED');
dialogue.decideApproval({...input,approvalId:pending[1].id,outcome:'rejected'});assert.equal(await two,'rejected');assert.equal(resumed,2);assert.equal(dialogue.thread('r','n').phase,'executing');
const cancelled=request('c',controller.signal);controller.abort();assert.equal(await cancelled,'cancelled');assert.equal(dialogue.thread('r','n').approvals.length,0);
assert.equal(await listeners.get('approval/request').fn({agent:{id:'other'}},async()=> 'unavailable'),'unavailable','unmanaged approvals use native answerers');
const missing=await listeners.get('approval/request').fn({agent,toolName:'pwsh',callId:'missing'},async()=> 'allowed-once');assert.equal(missing,'unavailable','never approve missing call details');
const closePending=request('d');await dialogue.close('r','n','interrupted');assert.equal(await closePending,'cancelled');assert.equal(dialogue.thread('r','n').approvals.length,0);
assert.ok(dialogue.history('r','n').entries.some(entry=>entry.kind==='approval'&&entry.status==='rejected'));
const reloaded=new NodeDialogue(db);assert.equal(reloaded.thread('r','n').approvals.length,0);
db.close();console.log('PASS native approval bridging, exact tool details, parallel requests, explicit one-shot decisions, stale/duplicate rejection, cancellation and timeout pause');
