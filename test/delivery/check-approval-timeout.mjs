import assert from 'node:assert/strict'
import {Orchestrator,registerKind} from '../../lib/vendor/dsh-ccpg-orchestrator/lib/engine.js'
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
registerKind({type:'approval-timeout-test',execute:async({pauseTimeout,signal})=>{
  const first=pauseTimeout(),second=pauseTimeout();await delay(150);assert.equal(signal.aborted,false)
  first();first();await delay(150);assert.equal(signal.aborted,false,'another pending approval must keep the timer paused')
  second();await delay(10);assert.equal(signal.aborted,false);return 'done'
}})
const engine=new Orchestrator({}),run=await engine.run({nodes:[{id:'n',type:'approval-timeout-test',data:{timeoutSec:0.1}}],edges:[]})
assert.equal(run.status,'success',JSON.stringify(run));console.log('PASS workflow timeout waits for all nested approval pauses and resumes only once')
