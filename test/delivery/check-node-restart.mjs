import assert from 'node:assert/strict'
import { nodeRestartPlan, assertAgentCompletion } from '../../lib/delivery/node-restart.mjs'
const manifest={businessRunId:'b',template:{id:'t',version:1},definition:{graph:{nodes:[{id:'a',type:'agent'},{id:'b',type:'agent'}],edges:[{source:'a',target:'b'}]},qualityPolicies:[]}}
const handoff={attempt:1,status:'ready',repositories:[{alias:'r',inputCommit:'base',outputCommit:'accepted'}],artifactIds:[]}
const cp={businessRunId:'b',nodeId:'a',attempt:1,handoff,artifacts:[],digest:'fixed',result:{output:'accepted',extra:{}}}
const job={nativeRunId:'old',preparationComplete:true,status:'execution_failed',codeAttempts:{a:[{attempt:1,status:'ready'}],b:[{attempt:1,status:'failed',repositories:[{alias:'r',inputCommit:'accepted'}]}]},codeHandoffs:{a:handoff},artifacts:[]}
const plan=(patch={})=>nodeRestartPlan({job:{...job,...patch},manifest,checkpoints:[cp],subjects:[],nodeId:'b'})
assert.deepEqual(plan().completed,['a']);assert.deepEqual(plan().unstarted,['b']);assert.equal(plan().canContinue,true)
assert.equal(plan({status:'canceled'}).canContinue,true)
assert.equal(plan({codeAttempts:{...job.codeAttempts,b:[{attempt:1,status:'failed'}]}}).canContinue,false)
assert.throws(()=>plan({status:'running'}),e=>e.code==='NODE_RESTART_NOT_READY')
assert.throws(()=>nodeRestartPlan({job,manifest,checkpoints:[cp],subjects:[],nodeId:'a'}),e=>e.code==='NODE_ALREADY_ACCEPTED')
assert.throws(()=>plan({codeHandoffs:{a:{...handoff,status:'changed'}}}),e=>e.code==='NODE_RESTART_UNSAFE')
assertAgentCompletion({kind:'completed'})
for(const kind of ['aborted','interrupted','max-tokens','blocked'])assert.throws(()=>assertAgentCompletion({kind}),e=>e.code==='DELIVERY_MODEL_INTERRUPTED'&&e.handoffBlocked)
assert.throws(()=>assertAgentCompletion({kind:'error',error:{message:'运行已取消'}}),e=>e.code==='DELIVERY_MODEL_FAILED'&&e.message!=='运行已取消')
assert.throws(()=>assertAgentCompletion({kind:'completed'},AbortSignal.abort()),/运行已取消/)
console.log('PASS explicit restart reuses accepted checkpoints, reruns uncertain work, preserves continuation inputs, refuses accepted targets and distinguishes model interruption from user cancellation')
