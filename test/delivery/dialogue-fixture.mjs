/** Test-only model behavior for real node steering, human input and revision. */
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function* call(name,args,id,index=0) {
  const argumentsText=JSON.stringify(args)
  yield {type:'block-start',index,blockType:'tool-call'}
  yield {type:'tool-call-delta',index,id,name,argumentsDelta:argumentsText}
  yield {type:'block-end',index,block:{type:'tool-call',id,name,arguments:argumentsText}}
  yield {type:'finish',reason:{kind:'tool-calls'}}
}
const failedTokens=new Set()
export async function* restartResponse(options) {
  const results=options.messages.filter(m=>m.role==='tool'),done=id=>results.some(m=>m.toolCallId===id)
  const users=options.messages.filter(m=>m.role==='user').flatMap(m=>m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')
  const token=users.match(/RESTART_TOKEN:([a-f0-9-]+)/)?.[1]
  if(!token)throw new Error('missing restart probe token')
  const continuation=options.system.includes('本节点执行曾中断')
  if(!failedTokens.has(token)) {
    if(!done('partial-write')){yield*call('write',{file_path:'partial.txt',content:'PARTIAL_WORK\n'},'partial-write');return}
    failedTokens.add(token);throw new Error('运行已取消')
  }
  if(!done('probe-read')){yield*call('read',{file_path:'partial.txt'},'probe-read');return}
  const partial=JSON.stringify(results.find(r=>r.toolCallId==='probe-read')).includes('PARTIAL_WORK')
  if(continuation?!partial:partial)throw new Error('restart did not preserve/reset partial work correctly')
  if(continuation&&!options.system.includes('保留进度并继续'))throw new Error('continuation lost user instructions')
  if(!done('final-write')){yield*call('write',{file_path:'result.json',content:JSON.stringify({continued:continuation,partialPreserved:partial})+'\n'},'final-write');return}
  const text='节点已恢复，等待验收。';yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text};yield{type:'block-end',index:0,block:{type:'text',text}};yield{type:'finish',reason:{kind:'stop'}}
}
export async function* dialogueResponse(options) {
  const users=options.messages.filter(message=>message.role==='user').flatMap(message=>message.content??[]).filter(block=>block.type==='text').map(block=>block.text).join('\n')
  const results=options.messages.filter(message=>message.role==='tool')
  const completed=id=>results.some(block=>block.toolCallId===id)
  if(options.system.includes('这是工作流已固定结果的只读讨论')) {
    if(!completed('dialogue-explain-read')){yield*call('read',{file_path:'product.json'},'dialogue-explain-read');return}
    const text='只读说明：固定的 v2 产物保留已确认字段，验收和下游结果没有变化。';yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text};yield{type:'block-end',index:0,block:{type:'text',text}};yield{type:'finish',reason:{kind:'stop'}};return
  }
  if(options.system.includes('DIALOGUE_TESTER_PROBE')) {
    if(!completed('dialogue-test-read')){yield*call('read',{file_path:'product.json'},'dialogue-test-read');return}
    const text='下游读取了验收后的 product.json。'
    yield {type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text};yield{type:'block-end',index:0,block:{type:'text',text}};yield{type:'finish',reason:{kind:'stop'}};return
  }
  if(!completed('dialogue-question')){yield*call('delivery_ask_user',{question:'请选择数据格式',options:['JSON','CSV']},'dialogue-question');return}
  const revision=users.includes('修改为v2'),id=revision?'dialogue-write-v2':'dialogue-write-v1'
  if(!completed(id)) {
    yield {type:'block-start',index:0,blockType:'reasoning'}
    yield {type:'reasoning-delta',index:0,text:'VISIBLE_REASONING_PREFIX：根据用户回答核对数据格式。'}
    await wait(1800)
    yield {type:'reasoning-delta',index:0,text:'确认本节点范围后继续。'}
    yield {type:'block-end',index:0,block:{type:'reasoning',text:'VISIBLE_REASONING_PREFIX：根据用户回答核对数据格式。确认本节点范围后继续。'}}
    // New steering becomes model-visible at the next step, before the final output.
    yield*call('write',{file_path:'product.json',content:JSON.stringify({version:revision?'v2':'v1',format:'JSON',name:users.includes('字段增加 name')?'included':'missing'})+'\n'},id,1);return
  }
  if(!revision&&users.includes('字段增加 name')&&!completed('dialogue-steered-name')){yield*call('write',{file_path:'product.json',content:JSON.stringify({version:'v1',format:'JSON',name:'included'})+'\n'},'dialogue-steered-name');return}
  const answer=revision?'修改完成：product.json 为 v2，请重新验收。':users.includes('字段增加 name')?'完成初稿，已接收补充字段要求，请验收。':'完成初稿，请验收。'
  yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:answer.slice(0,4)};await wait(1000);yield{type:'text-delta',index:0,text:answer.slice(4)};yield{type:'block-end',index:0,block:{type:'text',text:answer}};yield{type:'finish',reason:{kind:'stop'}}
}
