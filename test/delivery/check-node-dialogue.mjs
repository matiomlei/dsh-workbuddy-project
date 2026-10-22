import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { NodeDialogue } from '../../lib/delivery/node-dialogue.mjs'
const db=new DatabaseSync(':memory:'),dialogue=new NodeDialogue(db),listeners=new Map(),tools=new Map(),events=[],inbox=[]
let paused=0,resumed=0
const agent={id:'node-session',status:'running',session:{seq:0,snapshotEvents:()=>events},steer:message=>inbox.push(message)}
const agentCtx={on:(name,fn)=>listeners.set(name,fn),tools:{register:tool=>tools.set(tool.name,tool)},systemPrompt:{section:()=>{}}}
const live=dialogue.attach({requestId:'run',nodeId:'node',nativeRunId:'native',attempt:1,agentCtx,agent,execution:{pauseTimeout:()=>{paused++;return()=>{resumed++}}}})
const frame=frame=>listeners.get('agent/assistant-stream')({agent,frame})
frame({type:'start',attemptId:'model-attempt',turn:1,step:1})
frame({type:'chunk',attemptId:'model-attempt',chunk:{type:'reasoning-delta',index:0,text:'实际返回的思考前缀'}})
assert.equal(dialogue.history('run','node').entries[0].text,'实际返回的思考前缀')
assert.equal(dialogue.history('run','node').entries[0].streaming,true)
frame({type:'chunk',attemptId:'model-attempt',chunk:{type:'block-end',index:0,block:{type:'reasoning',text:'实际返回的思考前缀和后缀'}}})
events.push({seq:0,type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'实际返回的思考前缀和后缀'}]}}})
frame({type:'end',attemptId:'model-attempt',outcome:{kind:'committed',seq:0}})
assert.equal(dialogue.history('run','node').entries.filter(entry=>entry.kind==='reasoning').length,1,'settled reasoning is not duplicated')
assert.equal(dialogue.history('run','other').entries.length,0,'node history is isolated')
const body={messageId:'message',requestId:'run',nodeId:'node',expectedNativeRunId:'native',expectedAttempt:1,text:'补充要求'}
const deliver=()=>dialogue.steer(body)
dialogue.accept(body,deliver);dialogue.accept(body,deliver);assert.equal(inbox.length,1,'retried delivery is idempotent')
listeners.get('agent/inbox/claimed')({message:inbox[0]});assert.equal(dialogue.prior(body).status,'consumed')
assert.throws(()=>dialogue.accept({...body,text:'different'},deliver),error=>error.code==='NODE_MESSAGE_CONFLICT')
assert.throws(()=>dialogue.accept({...body,messageId:'old',expectedAttempt:0},deliver),error=>error.code==='NODE_THREAD_CHANGED')
const abort=new AbortController(),question=dialogue.ask(live,{question:'选择格式',options:['JSON','CSV']},abort.signal)
assert.equal(paused,1);assert.equal(dialogue.thread('run','node').phase,'waiting_user')
const answer={...body,messageId:'answer',questionId:dialogue.thread('run','node').question.id,text:'JSON'}
dialogue.accept(answer,()=>dialogue.steer(answer));assert.deepEqual(await question,{answer:'JSON'});assert.equal(resumed,1)
assert.equal(dialogue.thread('run','node').phase,'executing')
const pending=dialogue.ask(live,{question:'继续?'},abort.signal);abort.abort();await assert.rejects(pending,/取消/);assert.equal(resumed,2)
await dialogue.close('run','node')
const reopened=new NodeDialogue(db);assert.ok(reopened.history('run','node').reasoningAvailable);assert.equal(reopened.history('run','node').thread.phase,'completed')
assert.ok(!JSON.stringify(reopened.history('run','node')).includes('systemPrompt'))
db.close()
console.log('PASS published reasoning streams and settlement, per-node durable history, idempotent steering with consumption receipts, stale-attempt rejection, human answer/cancellation and timeout pause')
