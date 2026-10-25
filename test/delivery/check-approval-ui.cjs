const assert=require('node:assert/strict'),{readFileSync}=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const html=readFileSync(path.join(__dirname,'../../lib/delivery/app.html'),'utf8'),source=html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('__INITIAL_PAGE__','projects');
const dom=new JSDOM('<div id="app"></div><div id="overlays"></div>',{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),win=dom.window;
const approvals=[{id:'permit',toolName:'pwsh',reason:'这次命令需要你的许可',cwd:'C:\\private\\node',arguments:JSON.stringify({command:'Write-Output safe',sandbox_permissions:'danger-full-access'})}],decisions=[];
const run={requestId:'r',projectId:'p',status:'running',graph:{nodes:[{id:'n',type:'agent',position:{x:10,y:10},data:{label:'方案设计'}}],edges:[]},nodeStates:{n:{status:'waiting_approval'}},qualitySubjects:[],qualityUnconfiguredNodes:['n'],repositories:[],models:{},template:{version:1},artifacts:[]};
const node={thread:{phase:'waiting_approval',nativeRunId:'g',attempt:1,approvals},entries:[],attempt:1,nativeRunId:'g',attempts:[],canSend:false};
win.fetch=async(_url,init)=>{const body=JSON.parse(init.body);let value;
 switch(body.action){
 case 'bootstrap':value={};break;
 case 'catalog':value={projects:[{id:'p',name:'审批项目',repositories:[]}],templates:[]};break;
 case 'runs/detail':value=run;break;
 case 'runs/node':value=node;break;
 case 'nodes/approval':decisions.push(body);node.thread={...node.thread,phase:'executing',approvals:[]};node.entries=[{id:1,kind:'approval',attempt:1,status:body.outcome,text:'审批结果：'+body.outcome}];value={ok:true};break;
 default:throw new Error('unexpected '+body.action);
 }
 return{ok:true,json:async()=>value};
};
new vm.Script(source).runInContext(dom.getInternalVMContext());
const settle=()=>new Promise(resolve=>setTimeout(resolve,15));
(async()=>{
 await settle();await win.showRun({requestId:'r'});await settle();
 const panel=win.document.querySelector('[aria-label="节点权限确认"]');assert.ok(panel);assert.match(panel.textContent,/Write-Output safe/);assert.match(panel.textContent,/danger-full-access/);assert.match(panel.textContent,/C:\\private\\node/);
 assert.match(win.document.body.textContent,/等待权限确认/);assert.equal(decisions.length,0,'rendering never grants permission');
 const reject=[...panel.querySelectorAll('button')].find(button=>button.textContent==='拒绝');reject.focus();await win.refreshDialogue(run,run.graph.nodes[0]);
 assert.equal(win.document.querySelector('[aria-label="节点权限确认"] button'),reject,'polling must preserve the approval controls');assert.equal(win.document.activeElement,reject);
 reject.click();await settle();assert.equal(decisions[0].outcome,'rejected');assert.equal(decisions[0].approvalId,'permit');assert.equal(decisions[0].expectedNativeRunId,'g');assert.equal(decisions[0].expectedAttempt,1);assert.equal(win.document.querySelector('[aria-label="节点权限确认"]'),null);assert.ok(!win.document.body.textContent.includes('消息未完成接收或执行'));
 node.thread={...node.thread,phase:'waiting_approval',approvals};await win.refreshDialogue(run,run.graph.nodes[0]);
 [...win.document.querySelectorAll('[aria-label="节点权限确认"] button')].find(button=>button.textContent==='仅允许本次').click();await settle();assert.equal(decisions[1].outcome,'allowed-once');assert.equal(decisions.length,2);
 dom.window.close();console.log('PASS node approval details, no automatic grants, stable poll/focus, explicit allow/reject and generation-bound decisions');
})().catch(error=>{dom.window.close();console.error(error);process.exitCode=1});
