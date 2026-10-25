const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),React=require('react'),{createRoot}=require('react-dom/client');
const {act}=React,dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
Object.assign(global,{window:dom.window,document:dom.window.document,location:dom.window.location,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
let saved=false,fail=false,entry;const writes=[],sections={};
global.fetch=async(url,request)=>{
 const body=JSON.parse(request.body);
 if(url==='/api/workbuddy-delivery'){
  if(body.action==='settings/save') {writes.push(body);if(fail)return{ok:false,json:async()=>({error:'保存失败测试'})};saved=body.autoAllowDangerFullAccess;}
  return{ok:true,json:async()=>({autoAllowDangerFullAccess:saved})};
 }
 return{ok:true,json:async()=>({ok:true,value:body.action==='options'?{libraries:[]}:[]})};
};
window.__ModuleLoader__={load:value=>entry=value};vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../../lib/client.js'),'utf8'));
entry.factory(()=>React).apply({slots:{inject:(_name,fn)=>fn(),register:(registration,component)=>{sections[registration.id??registration.key]=component;return()=>{}}},on:()=>{}});
const root=createRoot(document.getElementById('root')),render=()=>act(async()=>root.render(React.createElement(sections['workbuddy-delivery'])));
const panel=()=>document.querySelector('section[aria-label="节点执行权限"]');
const button=()=>[...panel().querySelectorAll('button')].find(item=>item.textContent==='保存执行设置');
(async()=>{
 await render();await act(async()=>document.querySelector('[aria-label="项目模式设置"]').click());
 assert.ok(panel());assert.equal(panel().querySelector('input').checked,false);assert.ok(button().disabled);assert.match(panel().textContent,/沙箱外执行/);assert.match(panel().textContent,/资源|本机/);
 await act(async()=>panel().querySelector('input').click());assert.equal(writes.length,0,'changing the draft does not grant access');
 await act(async()=>button().click());assert.equal(writes.length,1);assert.equal(writes[0].autoAllowDangerFullAccess,true);assert.match(panel().textContent,/自动允许已开启/);
 await act(async()=>root.render(null));await render();await act(async()=>document.querySelector('[aria-label="项目模式设置"]').click());assert.equal(panel().querySelector('input').checked,true);
 fail=true;await act(async()=>panel().querySelector('input').click());await act(async()=>button().click());assert.equal(saved,true);assert.match(panel().textContent,/保存失败测试/);assert.match(panel().textContent,/自动允许已开启/);
 fail=false;await act(async()=>button().click());assert.equal(saved,false);assert.match(panel().textContent,/逐次确认/);
 await act(async()=>root.unmount());dom.window.close();console.log('PASS project settings switch, explicit save, persisted reload, error display and disable');
})().catch(error=>{dom.window.close();console.error(error);process.exitCode=1});
