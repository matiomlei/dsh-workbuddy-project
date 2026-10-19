const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module')
const req=process.env.WB_UI_PACKAGE_JSON?createRequire(process.env.WB_UI_PACKAGE_JSON):require
const {JSDOM}=req('jsdom'),dom=new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>',{url:'http://localhost'})
global.window=dom.window;global.document=dom.window.document;global.navigator=dom.window.navigator;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true
window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
const React=req('react'),{createRoot}=req('react-dom/client'),{act}=React,root=createRoot(document.getElementById('root'))
const settle=()=>new Promise(done=>setImmediate(done))
const click=async element=>{assert.ok(element,'click target');await act(async()=>{element.click();await settle()})}
const change=async(element,value)=>{await act(async()=>{const proto=element.tagName==='SELECT'?window.HTMLSelectElement.prototype:element.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));await settle()})}
const button=label=>[...document.querySelectorAll('button')].find(x=>x.textContent===label)
const editor=()=>document.querySelector('dialog'),picker=()=>document.querySelectorAll('dialog')[1]
const ability=(kind,name,source='team')=>({name,displayName:name,reference:`${source}:${kind}/${name}`,path:`/tmp/${source}/${kind}/${name}`,library:source==='team'?'team':undefined,icon:'🔗'})
const options={exists:true,hasProject:false,experts:{project:[],library:[],shared:[ability('experts','专家团')]},skills:{project:[],local:[ability('skills','本地技能','personal')],shared:[]},rules:[],localRules:[],sharedRules:[ability('rules','规范')],connectors:{project:[],local:[{...ability('connectors','native','runtime'),native:true}],shared:[ability('connectors','搜索')]},libraries:[{name:'team',path:'/tmp/team',experts:[],skills:[],rules:[],connectors:[],exists:true}],templates:[{id:'review',name:'评审模板',library:'team'}]}
const requests=[],projects=[],savedAbilities=[]
const avatar='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6XkAAAAASUVORK5CYII='
const personalExpert={...ability('experts','本地专家','personal'),key:'personal:experts/本地专家',relative:'experts/本地专家',library:'personal',kind:'expert',scope:'local',sourceLabel:'本地 · personal',writable:true,iconUrl:avatar}
const projectExpert={...personalExpert,name:'项目专家',displayName:'项目专家',key:'project:created:experts/项目专家',library:'project',projectId:'created',scope:'project',sourceLabel:'项目 · 新项目'}
let failRemoval=false
global.fetch=async(_url,request)=>{
 const body=JSON.parse(request.body);requests.push(body);let value
 switch(body.action){
 case 'list':value=projects;break
 case 'templates':value=options.templates;break
 case 'options':value={...options,cwd:body.cwd,exists:body.cwd==='/tmp/template-target'?false:options.exists};break
 case 'templateDraft':value={template:'team:review',config:{name:'评审',instructions:'模板指令',experts:['team:experts/专家团'],rules:['team:rules/规范'],skills:['personal:skills/本地技能'],connectors:['team:connectors/搜索']},options:{}};break
 case 'create':case 'fromTemplate':value={id:projects.length?'created-next':'created',cwd:body.config.cwd,validated:true};projects.push({...body.config,id:value.id});break
 case 'describe':value={project:projects.find(x=>x.id===body.id)};break
 case 'update':Object.assign(projects.find(x=>x.id===body.config.id),body.config);value={id:body.config.id,cwd:body.config.cwd,validated:true};break
 case 'checkConnectors':value={id:body.id,healthy:false,connectorChecks:[{name:'search',status:'error',code:'authorization-required',message:'服务要求账号授权（401）'},{name:'tiktok',status:'error',code:'connection-reset',message:'连接被重置（ECONNRESET）'}]};break
 case 'capabilities':value=[personalExpert,projectExpert,...savedAbilities,...(options.libraries.length?[['expert','experts','专家团'],['skill','skills','团队技能'],['rule','rules','规范'],['connector','connectors','搜索']].map(([kind,directory,name])=>({...ability(directory,name),key:`team:${directory}/${name}`,kind,relative:`${directory}/${name}`,refs:[],hash:'abc',scope:'shared',writable:true})):[])];break
 case 'saveCapability':savedAbilities.push({...personalExpert,name:'new-name',displayName:'new-name',key:'personal:experts/new-name',relative:'experts/new-name'});value={saved:true,files:body.changes.map(x=>x.path)};break
 case 'capability':if(body.library!=='team'){value={...personalExpert,path:'experts/本地专家/agents/本地专家.md',files:['agents/本地专家.md'],selected:'agents/本地专家.md',content:'LOCAL EXPERT',readOnly:false};break}value={library:'team',package:'connectors/搜索',path:`connectors/搜索/${body.file??'mcp.json'}`,selected:body.file??'mcp.json',files:['mcp.json','connector.json'],content:body.file==='connector.json'?'{}':'{"mcpServers":{}}',icon:'🔗',scope:'shared'};break
 case 'contribute':value={branch:'change',files:body.changes.map(x=>x.path)};break
 case 'libraries':value=options.libraries;break
 case 'removeLibrary':
   if(failRemoval)return {ok:true,json:async()=>({ok:false,error:{message:'资源库正在同步，请等待完成后删除'}})}
   options.libraries=[];options.templates=[];options.experts.shared=[];options.sharedRules=[];options.connectors.shared=[];value={library:body.library,removed:true,filesRetained:true};break
 default:throw new Error('unexpected '+body.action)
 }
 return {ok:true,json:async()=>({ok:true,value})}
}
async function choose(label,name){
 await click(document.querySelector(`[aria-label="添加${label}"]`));const card=[...picker().querySelectorAll('[aria-pressed]')].find(x=>x.textContent.includes(name));await click(card);await click([...picker().querySelectorAll('button')].find(x=>x.textContent==='确认'))
}
;(async()=>{
 let entry;window.__ModuleLoader__={load:value=>{entry=value}};vm.runInThisContext(fs.readFileSync(require('node:path').join(__dirname,'../lib/client.js'),'utf8'))
 const sections={};entry.factory(()=>React).apply({slots:{inject:(_name,fn)=>fn(),register:(registration,component)=>{sections[registration.id]=component;return ()=>{}}}})
 await act(async()=>{root.render(React.createElement(sections['workbuddy-project']));await settle()})
 assert.match(document.body.textContent,/项目模板 · 1/);await click(button('用此模板新建'));assert.equal(editor().querySelector('textarea').value,'模板指令');await change(editor().querySelector('input'),'/tmp/template-target');assert.equal(button('保存并编译').disabled,false);assert.match(editor().textContent,/将创建目标目录/);await click(button('关闭'))
 await click(button('新建项目'));assert.equal(button('保存并编译').disabled,true)
 await choose('连接器','搜索');await choose('连接器','native');assert.equal(editor().querySelectorAll('[aria-label^="移除"]').length,2)
 await click(document.querySelector('[aria-label="添加连接器"]'));await click([...picker().querySelectorAll('button')].find(x=>x.textContent==='取消'));assert.equal(document.querySelectorAll('dialog').length,1)
 await choose('专家','专家团');assert.ok(editor().querySelector('[aria-label="移除专家团"]'));assert.ok(!editor().textContent.includes('主专家定义与附带能力'));assert.ok(!editor().textContent.includes('已有完整技能目录预览'))
 for(const label of ['仅预览','重新校验','升级能力版本'])assert.equal(button(label),undefined)
 await change(editor().querySelector('input'),'/tmp/project');await change(editor().querySelectorAll('input')[2],'新项目')
 await change(editor().querySelector('[aria-label="选择模板"]'),'team:review')
 assert.equal(editor().querySelector('textarea').value,'模板指令');assert.ok(editor().querySelector('[aria-label="移除搜索"]'));assert.ok(!editor().querySelector('[aria-label="移除native"]'))
 await click(button('保存并编译'));const payload=requests.findLast(x=>x.action==='fromTemplate').config
 assert.deepEqual(payload.connectors,['team:connectors/搜索']);assert.deepEqual(payload.experts,['team:experts/专家团']);assert.ok(!('mcp' in payload));assert.ok(!('instructionsMode' in payload))
 await click(button('关闭'));await click(document.querySelector('[aria-label="编辑项目 新项目"]'))
 for(const label of ['仅预览','重新校验','升级能力版本'])assert.equal(button(label),undefined)
 assert.ok(!editor().textContent.includes('主专家定义与附带能力'));assert.ok(!editor().textContent.includes('已有完整技能目录预览'))
 await change(editor().querySelector('textarea'),'修改后的项目指令');await click(button('保存并编译'))
 const updated=requests.findLast(x=>x.action==='update').config;assert.equal(updated.instructions,'修改后的项目指令');assert.deepEqual(updated.experts,payload.experts);assert.deepEqual(updated.skills,payload.skills);assert.deepEqual(updated.connectors,payload.connectors);assert.match(editor().textContent,/挂载校验：通过/)
 assert.ok(!requests.some(x=>['expertDefinition','previewSkill','apply'].includes(x.action)))
 await click(button('检查连接器'));assert.equal(requests.findLast(x=>x.action==='checkConnectors').id,'created');assert.match(document.querySelector('[aria-label="连接器检查 search"]').textContent,/401/);assert.match(document.querySelector('[aria-label="连接器检查 tiktok"]').textContent,/ECONNRESET/)
 await click(button('关闭'))
 await act(async()=>{root.render(React.createElement(sections['workbuddy-project-capabilities']));await settle()})
 assert.ok(!document.body.textContent.includes('MCP 声明'));assert.ok(!document.body.textContent.includes('项目模板'));assert.ok(!document.body.textContent.includes('团队能力'))
 const summary=document.querySelector('.wb-library-summary'),catalog=document.querySelector('.wb-capability-catalog');assert.equal(summary.nextElementSibling,catalog);assert.equal(document.querySelector('aside'),null);assert.ok(button('已连接 1 个库'));assert.equal(button('编辑配置'),undefined);assert.equal(button('删除资源库'),undefined);assert.ok(!document.body.textContent.includes('/tmp/team'))
 assert.equal(document.querySelector('[aria-label="编辑专家 本地专家"] img').src,avatar)
 await change(document.querySelector('[aria-label="能力来源"]'),'local');assert.ok(document.querySelector('[aria-label="编辑专家 本地专家"]'));assert.equal(document.querySelector('[aria-label="编辑专家 专家团"]'),null)
 await change(document.querySelector('[aria-label="能力来源"]'),'project');assert.ok(document.querySelector('[aria-label="编辑专家 项目专家"]'));assert.equal(document.querySelector('[aria-label="编辑专家 本地专家"]'),null)
 await change(document.querySelector('[aria-label="能力来源"]'),'all')
 await click(button('添加资源库'));assert.ok(!editor().textContent.includes('同步时机'));await change(document.querySelector('[aria-label="Git 仓库地址"]'),'https://example.test/team.git');assert.match(editor().textContent,/同步时机/);await click(button('关闭'))
 const tab=name=>document.querySelector(`[role="tab"][aria-label="${name}"]`)
 assert.equal(document.querySelectorAll('[role="tablist"][aria-label="能力库分类"] [role="tab"]').length,4)
 assert.equal(tab('专家').getAttribute('aria-selected'),'true');assert.ok(document.querySelector('[aria-label="编辑专家 专家团"]'));assert.equal(document.querySelector('[aria-label="编辑连接器 搜索"]'),null)
 await click(tab('技能'));assert.ok(document.querySelector('[aria-label="编辑技能 团队技能"]'));assert.equal(document.querySelector('[aria-label="编辑专家 专家团"]'),null)
 await click(tab('连接器'));await change(document.querySelector('[aria-label="搜索能力库"]'),'规范');assert.match(document.querySelector('[role="tabpanel"]').textContent,/没有匹配/)
 await click(tab('规范'));assert.ok(document.querySelector('[aria-label="编辑规范 规范"]'));await change(document.querySelector('[aria-label="搜索能力库"]'),'')
 await act(async()=>{tab('规范').dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true}));await settle()})
 assert.equal(tab('连接器').getAttribute('aria-selected'),'true');assert.equal(document.activeElement,tab('连接器'))
 assert.equal(document.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby'),tab('连接器').id)
 await click(document.querySelector('[aria-label="编辑连接器 搜索"]'))
 assert.equal(editor().querySelector('textarea').value,'{"mcpServers":{}}')
 await change(editor().querySelectorAll('select')[1],'connector.json');assert.equal(editor().querySelector('textarea').value,'{}')
 await click(button('提交为 PR'));assert.equal(requests.findLast(x=>x.action==='contribute').changes[0].path,'connectors/搜索/connector.json')
 await click(button('新建连接器'));assert.match(editor().querySelector('input').value,/connectors\/new-name\/mcp.json/);await click(button('关闭'))
 await click(tab('专家'))
 await click(button('新建专家'));assert.match(editor().querySelector('input').value,/experts\/new-name\/agents\/new-name.md/)
 await click(button('关闭'))
 await click(button('已连接 1 个库'));assert.match(editor().textContent,/管理共享资源库/);assert.match(editor().textContent,/\/tmp\/team/);await click(button('编辑配置'));assert.match(editor().textContent,/编辑资源库 team/);await click(button('取消'));assert.match(editor().textContent,/管理共享资源库/)
 await click(button('删除资源库'));assert.match(editor().textContent,/本地仓库文件和已锁定/);await click(button('取消'));assert.equal(requests.filter(x=>x.action==='removeLibrary').length,0);assert.match(editor().textContent,/管理共享资源库/)
 await click(button('删除资源库'));failRemoval=true;await click(button('确认删除'));assert.match(editor().textContent,/正在同步/);assert.equal(options.libraries.length,1)
 failRemoval=false;await click(button('确认删除'));assert.match(editor().textContent,/管理共享资源库/);assert.equal(requests.findLast(x=>x.action==='removeLibrary').library,'team');assert.equal(button('删除资源库'),undefined);assert.ok(button('已连接 0 个库'));await click(button('关闭'));assert.equal(editor(),null)
 assert.equal(document.querySelector('[aria-label="编辑专家 专家团"]'),null);assert.equal(button('新建专家').disabled,false);assert.match(document.body.textContent,/已删除资源库 team/)
 assert.equal(button('立即同步'),undefined);assert.ok(document.querySelector('[aria-label="编辑专家 本地专家"]'))
 await click(button('新建专家'));assert.equal(document.querySelector('[aria-label="能力保存位置"]').value,'personal');assert.equal(button('提交为 PR'),undefined);await click(button('保存能力'));assert.equal(requests.findLast(x=>x.action==='saveCapability').library,'personal');assert.equal(editor(),null);assert.ok(document.querySelector('[aria-label="编辑专家 new-name"]'))
 await click(document.querySelector('[aria-label="编辑专家 本地专家"]'));assert.equal(editor().querySelector('textarea').value,'LOCAL EXPERT');await click(button('关闭'))
 await act(async()=>{root.render(React.createElement(sections['workbuddy-project']));await settle()});assert.match(document.body.textContent,/项目模板 · 0/);await click(button('新建项目'));await change(editor().querySelector('input'),'/tmp/no-git-project');await change(editor().querySelectorAll('input')[2],'无需资源库的项目');await click(button('保存并编译'));assert.equal(requests.findLast(x=>x.action==='create').config.name,'无需资源库的项目');await click(button('关闭'))
 await act(async()=>root.unmount());console.log('PASS unified sources, local creation without Git, avatars, compact library summary, modal-only library management, project templates, capability tabs, search and keyboard navigation; library deletion cancel/error/confirm; project/connector pickers; templates; simplified project editing and save validation; package file editor and new package layouts')
})().catch(error=>{console.error(error);process.exitCode=1})
