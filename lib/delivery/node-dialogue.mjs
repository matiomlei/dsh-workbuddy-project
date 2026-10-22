/** Node-owned dialogue and display trace. Only published model content is recorded. */
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ContractError, digest } from './template-store.mjs'
import { assertAgentCompletion } from './node-restart.mjs'
import { getAgentOutputConfig, validateStructuredOutputWithRepair, createStructuredEnvelope } from '../vendor/dsh-ccpg-orchestrator/lib/agent-schema.js'
const fail = (code, message) => { throw new ContractError(code, message ?? code) }
const clipped = value => String(value ?? '').slice(0, 64000)
const eventsOf = session => { try { return typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : session.events ?? [] } catch { return [] } }
const textOf = content => (content ?? []).filter(b => b.type === 'text').map(b => b.text).join('')
export class NodeDialogue {
  constructor(db) {
    this.db = db; this.live = new Map()
    db.exec(`CREATE TABLE IF NOT EXISTS delivery_node_events(id INTEGER PRIMARY KEY AUTOINCREMENT,request_id TEXT NOT NULL,node_id TEXT NOT NULL,event_key TEXT NOT NULL,document_json TEXT NOT NULL,UNIQUE(request_id,node_id,event_key));
      CREATE TABLE IF NOT EXISTS delivery_node_threads(request_id TEXT NOT NULL,node_id TEXT NOT NULL,document_json TEXT NOT NULL,PRIMARY KEY(request_id,node_id));
      CREATE TABLE IF NOT EXISTS delivery_node_messages(id TEXT PRIMARY KEY,intent_hash TEXT NOT NULL,document_json TEXT NOT NULL);`)
    for (const row of db.prepare('SELECT * FROM delivery_node_threads').all()) {
      const thread = JSON.parse(row.document_json)
      if (['executing','revising','waiting_user','sealing','explaining'].includes(thread.phase)) this.state(row.request_id,row.node_id,{phase:'interrupted',question:null})
    }
  }
  key(requestId,nodeId) { return requestId + ':' + nodeId }
  thread(requestId,nodeId) { const row=this.db.prepare('SELECT document_json FROM delivery_node_threads WHERE request_id=? AND node_id=?').get(requestId,nodeId);return row ? JSON.parse(row.document_json) : null }
  state(requestId,nodeId,patch) {
    const state={...this.thread(requestId,nodeId),...patch,updatedAt:new Date().toISOString()}
    this.db.prepare('INSERT INTO delivery_node_threads VALUES(?,?,?) ON CONFLICT(request_id,node_id) DO UPDATE SET document_json=excluded.document_json').run(requestId,nodeId,JSON.stringify(state));return state
  }
  event(info,key,entry) {
    const value={...entry,text:clipped(entry.text),...(entry.result!==undefined?{result:clipped(entry.result)}:{}),truncated:entry.truncated===true||String(entry.text??'').length>64000||String(entry.result??'').length>64000,attempt:info.attempt,sessionId:info.sessionId,channel:info.readOnly?'explanation':'execution',time:entry.time??new Date().toISOString()}
    this.db.prepare('INSERT INTO delivery_node_events(request_id,node_id,event_key,document_json) VALUES(?,?,?,?) ON CONFLICT(request_id,node_id,event_key) DO UPDATE SET document_json=excluded.document_json').run(info.requestId,info.nodeId,key,JSON.stringify(value))
  }
  history(requestId,nodeId) {
    let entries=this.db.prepare('SELECT id,document_json FROM delivery_node_events WHERE request_id=? AND node_id=? ORDER BY id DESC LIMIT 300').all(requestId,nodeId).reverse().map(row=>({id:row.id,...JSON.parse(row.document_json)}))
    let bytes=Buffer.byteLength(JSON.stringify(entries)),truncated=entries.length===300;while(bytes>512000&&entries.length>1){bytes-=Buffer.byteLength(JSON.stringify(entries.shift()));truncated=true}
    return {thread:this.thread(requestId,nodeId),entries,truncated,reasoningAvailable:entries.some(entry=>entry.kind==='reasoning')}
  }
  attach({requestId,nodeId,nativeRunId,attempt,agentCtx,agent,execution,readOnly=false,startSeq=0}) {
    const key=this.key(requestId,nodeId), info={requestId,nodeId,nativeRunId,attempt,sessionId:String(agent.id)}
    const previous=this.live.get(key)
    if(previous && previous.agent!==agent) void this.close(requestId,nodeId).catch(()=>{})
    const live={...info,agent,agentCtx,execution,readOnly,seen:startSeq,blocks:new Map(),settlements:new Map(),messageIds:new Map(),question:null,handle:null,closed:false}
    this.live.set(key,live)
    this.state(requestId,nodeId,{nativeRunId,attempt,sessionId:info.sessionId,phase:readOnly?'explaining':'executing',question:null})
    const scan=()=>this.scan(live)
    live.timer=setInterval(scan,200);live.timer.unref?.()
    agentCtx.on('agent/assistant-stream',({frame})=>{
      if(live.closed)return
      if(frame.type==='start')scan()
      else if(frame.type==='chunk') {
        const chunk=frame.chunk
        if(chunk.type==='text-delta'||chunk.type==='reasoning-delta') {
          const id=String(frame.attemptId)+':'+chunk.index
          const block=live.blocks.get(id)??{kind:chunk.type==='reasoning-delta'?'reasoning':'assistant',text:'',time:new Date().toISOString()}
          block.truncated=block.truncated||block.text.length+chunk.text.length>64000;block.text=clipped(block.text+chunk.text);live.blocks.set(id,block)
          this.event(live,live.sessionId+':stream:'+id,{...block,streaming:true})
        } else if(chunk.type==='block-end'&&['text','reasoning'].includes(chunk.block.type)) {
          const id=String(frame.attemptId)+':'+chunk.index,block=live.blocks.get(id)
          this.event(live,live.sessionId+':stream:'+id,{kind:chunk.block.type==='text'?'assistant':'reasoning',text:chunk.block.text,time:block?.time,streaming:false})
        }
      } else if(frame.type==='end') {
        if(frame.outcome.kind==='committed')live.settlements.set(Number(frame.outcome.seq),String(frame.attemptId))
        scan()
      }
    })
    agentCtx.on('agent/inbox/claimed',({message})=>this.receipt(live.messageIds.get(message.id)??message.id,'consumed'))
    agentCtx.on('agent/inbox/discarded',({message})=>this.receipt(live.messageIds.get(message.id)??message.id,'discarded'))
    agentCtx.on('dispose',()=>{ live.closed=true;clearInterval(live.timer);scan();if(live.question)live.question.reject(new Error('节点会话已结束')) })
    if(!readOnly)agentCtx.tools.register(defineTool({name:'delivery_ask_user',description:'当需求存在必须由用户决定的问题时，向当前工作流节点的用户提问并等待回答。不要猜测关键业务决策。',parameters:{question:{type:'string',required:true},options:{type:'array',items:{type:'string'}}},output:{schema:{type:'object',additionalProperties:true},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async(args,exec)=>this.ask(live,args,exec.signal)}))
    if(!readOnly)agentCtx.systemPrompt.section({name:'delivery:dialogue',order:8,text:'用户可以在节点对话中补充或纠正要求。需要用户澄清关键业务问题时调用 delivery_ask_user 等待回答；它不代表节点完成。后续对话沿用当前节点的专家、规范、能力和本次运行仓库。'})
    return live
  }
  scan(live) {
    const events=Array.from(eventsOf(live.agent.session))
    for(const event of events) {
      if(Number(event.seq)<live.seen)continue
      live.seen=Number(event.seq)+1
      const data=event.data??{},key=live.sessionId+':event:'+event.seq
      if(event.type==='user/message') {
        const message=data.message??data,text=textOf(message.content)
        if(text)this.event(live,'user:'+(live.messageIds.get(message.id)??message.id),{kind:message.source?.kind==='user'?'user':'context',text,status:'consumed'})
      } else if(event.type==='assistant/message') {
        if(!live.settlements.has(Number(event.seq))) for(const [index,block] of (data.message?.content??[]).entries()) if(['text','reasoning'].includes(block.type))this.event(live,key+':'+index,{kind:block.type==='text'?'assistant':'reasoning',text:block.text})
      } else if(event.type==='tool/call')this.event(live,live.sessionId+':tool:'+data.callId,{kind:'tool',name:data.name,text:clipped(data.arguments),callId:data.callId,status:'running'})
      else if(event.type==='tool/result')for(const block of data.message?.toolCallId ? [data.message] : data.message?.content??[]) {
        const prior=this.db.prepare('SELECT document_json FROM delivery_node_events WHERE request_id=? AND node_id=? AND event_key=?').get(live.requestId,live.nodeId,live.sessionId+':tool:'+block.toolCallId)
        const entry=prior?JSON.parse(prior.document_json):{kind:'tool',name:block.toolName??'工具',text:''}
        this.event(live,live.sessionId+':tool:'+block.toolCallId,{...entry,status:block.isError||data.error?'error':'success',result:textOf(block.content)})
      } else if(event.type==='turn/end')this.event(live,key,{kind:'notice',text:data.reason?.kind==='error'?'本轮模型执行失败':'本轮回复结束',status:data.reason?.kind??'ended'})
    }
  }
  retain(requestId,nodeId,handle) {
    const live=this.live.get(this.key(requestId,nodeId));if(!live||live.agent!==handle?.agent||live.closed)return false
    live.handle=handle;this.scan(live);this.state(requestId,nodeId,{phase:'sealing'});return true
  }
  async ask(live,args,signal) {
    if(typeof args.question!=='string'||!args.question.trim()||args.question.length>8000)fail('INVALID_NODE_QUESTION','问题内容无效')
    if(live.question)fail('NODE_QUESTION_PENDING','当前节点已有待回答问题')
    this.scan(live)
    const question={id:randomUUID(),text:args.question,options:(args.options??[]).slice(0,8)}
    const resume=live.execution?.pauseTimeout?.()??(()=>{})
    this.state(live.requestId,live.nodeId,{phase:'waiting_user',question})
    this.event(live,'question:'+question.id,{kind:'question',text:question.text,options:question.options})
    try {
      return await new Promise((resolve,reject)=>{
        const cleanup=()=>{signal?.removeEventListener('abort',abort);live.question=null;resume()}
        const abort=()=>{cleanup();reject(new Error('运行已取消'))}
        live.question={...question,resolve:answer=>{cleanup();resolve({answer})},reject:error=>{cleanup();reject(error)}}
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
      })
    } finally { if(!live.closed)this.state(live.requestId,live.nodeId,{phase:'executing',question:null}) }
  }
  prior(body) {
    const row=this.db.prepare('SELECT * FROM delivery_node_messages WHERE id=?').get(body.messageId)
    if(!row)return null
    if(row.intent_hash!==digest(body))fail('NODE_MESSAGE_CONFLICT','消息编号已用于不同内容')
    return JSON.parse(row.document_json)
  }
  accept(body,deliver) {
    const prior=this.prior(body);if(prior)return prior
    if(typeof body.messageId!=='string'||!body.messageId||typeof body.text!=='string'||!body.text.trim()||body.text.length>16000)fail('INVALID_NODE_MESSAGE','请输入 1–16000 字的消息')
    const thread=this.thread(body.requestId,body.nodeId)
    if(!thread||thread.nativeRunId!==body.expectedNativeRunId||thread.attempt!==body.expectedAttempt)fail('NODE_THREAD_CHANGED','节点执行尝试已变化，请刷新后发送')
    if(body.mode!==undefined&&!['explain','continue'].includes(body.mode))fail('INVALID_NODE_MESSAGE','不支持该对话方式')
    const receipt={id:body.messageId,requestId:body.requestId,nodeId:body.nodeId,attempt:thread.attempt,status:'queued',createdAt:new Date().toISOString()}
    this.db.prepare('INSERT INTO delivery_node_messages VALUES(?,?,?)').run(body.messageId,digest(body),JSON.stringify(receipt))
    try { deliver(receipt) }catch(error){this.receipt(body.messageId,'rejected');throw error}
    return JSON.parse(this.db.prepare('SELECT document_json FROM delivery_node_messages WHERE id=?').get(body.messageId).document_json)
  }
  receipt(id,status) {
    const row=this.db.prepare('SELECT document_json FROM delivery_node_messages WHERE id=?').get(String(id));if(!row)return
    const receipt={...JSON.parse(row.document_json),status};this.db.prepare('UPDATE delivery_node_messages SET document_json=? WHERE id=?').run(JSON.stringify(receipt),String(id))
    const event=this.db.prepare('SELECT document_json FROM delivery_node_events WHERE request_id=? AND node_id=? AND event_key=?').get(receipt.requestId,receipt.nodeId,'user:'+id)
    if(event)this.db.prepare('UPDATE delivery_node_events SET document_json=? WHERE request_id=? AND node_id=? AND event_key=?').run(JSON.stringify({...JSON.parse(event.document_json),status}),receipt.requestId,receipt.nodeId,'user:'+id)
  }
  steer(body) {
    const live=this.live.get(this.key(body.requestId,body.nodeId)),thread=this.thread(body.requestId,body.nodeId)
    if(!live||live.closed)fail('NODE_NOT_INTERACTIVE','节点会话当前不可交互，请刷新状态')
    if(thread.phase==='waiting_user') {
      if(!live.question||body.questionId!==live.question.id)fail('NODE_QUESTION_CHANGED','待回答的问题已变化，请刷新后回答')
      this.receipt(body.messageId,'consumed');this.event(live,'user:'+body.messageId,{kind:'user',text:body.text,status:'consumed'});live.question.resolve(body.text);return
    }
    if(thread.phase!=='executing'||live.agent.status!=='running')fail('NODE_NOT_INTERACTIVE','节点正在固定输出，请稍后在验收前继续对话')
    const message=createUserMessage({content:[{type:'text',text:body.text}],source:{kind:'user'}})
    live.messageIds.set(message.id,body.messageId)
    this.event(live,'user:'+body.messageId,{kind:'user',text:body.text,status:'queued'})
    live.agent.steer(message)
  }
  async followup(requestId,nodeId,text,{attempt,signal,data,messageId}) {
    const live=this.live.get(this.key(requestId,nodeId));if(!live?.handle||live.closed)fail('NODE_SESSION_UNAVAILABLE','节点会话已释放，请恢复运行后重试')
    live.attempt=attempt;this.state(requestId,nodeId,{attempt,phase:live.readOnly?'explaining':'executing',question:null})
    if(signal?.aborted)throw new Error('运行已取消')
    const {agent}=live,start=Number(agent.session.seq)
    let timedOut=false,activeTime=0,last=Date.now()
    const timeout=setInterval(()=>{const now=Date.now();if(!live.question)activeTime+=now-last;last=now;if(activeTime>1000*(Number(data.timeoutSec)||300)){timedOut=true;agent.cancel({kind:'user'})}},250)
    const abort=()=>agent.cancel({kind:'user'});signal?.addEventListener('abort',abort,{once:true})
    let pendingMessageId=messageId
    const send=async prompt=>{const seq=Number(agent.session.seq),message=createUserMessage({content:[{type:'text',text:prompt}],source:{kind:'user'}});if(pendingMessageId){live.messageIds.set(message.id,pendingMessageId);pendingMessageId=null}agent.followup(message);await agent.whenIdle();this.scan(live);const events=Array.from(eventsOf(agent.session)).filter(event=>event.seq>=seq),end=events.filter(event=>event.type==='turn/end').at(-1);if(timedOut)throw new Error('节点对话超时');assertAgentCompletion(end?.data.reason,signal);return events.filter(event=>event.type==='assistant/message').map(event=>textOf(event.data.message.content)).filter(Boolean).at(-1)??''}
    try {
      let output=await send(text),structuredOutput
      const config=getAgentOutputConfig(data)
      if(config.mode==='structured'){const validated=await validateStructuredOutputWithRepair(output,config.schema,send);structuredOutput=createStructuredEnvelope(validated.result,{schema:config.schema})}
      return {output,...(structuredOutput?{structuredOutput}:{}),sessionId:live.sessionId,turns:Array.from(eventsOf(agent.session)).filter(event=>event.seq>=start&&event.type==='turn/end').length}
    } finally {clearInterval(timeout);signal?.removeEventListener('abort',abort);this.scan(live);this.state(requestId,nodeId,{phase:'sealing',question:null})}
  }
  async close(requestId,nodeId,phase='completed') {
    const key=this.key(requestId,nodeId),live=this.live.get(key)
    if(!live)return
    this.live.delete(key);this.scan(live);clearInterval(live.timer)
    if(live.question)live.question.reject(new Error('节点会话已结束'))
    await live.handle?.dispose();live.closed=true;this.scan(live)
    for(const [id] of live.blocks){const eventKey=live.sessionId+':stream:'+id,row=this.db.prepare('SELECT document_json FROM delivery_node_events WHERE request_id=? AND node_id=? AND event_key=?').get(requestId,nodeId,eventKey);if(row){const entry=JSON.parse(row.document_json);if(entry.streaming)this.event(live,eventKey,{...entry,streaming:false,interrupted:phase!=='completed'})}}
    if(!this.live.has(key))this.state(requestId,nodeId,{phase,question:null})
  }
  async closeRun(requestId,phase='completed',includeDiscussions=false) { for(const live of [...this.live.values()].filter(item=>item.requestId===requestId&&(!item.readOnly||includeDiscussions)))await this.close(requestId,live.nodeId,phase) }
}
