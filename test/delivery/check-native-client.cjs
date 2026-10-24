const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),React=require('react'),{createRoot}=require('react-dom/client');
const {act}=React;
const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
Object.assign(global,{window:dom.window,document:dom.window.document,location:dom.window.location,sessionStorage:dom.window.sessionStorage,IS_REACT_ACT_ENVIRONMENT:true});
const info={sessionId:'node-session',requestId:'run',nodeId:'coder',attempt:1,ready:true,title:'项目 · 编码 · 第 1 次执行'};
const events=[],sections={},disposals=[];
global.fetch=async(_url,request)=>{const body=JSON.parse(request.body);events.push(body.action);return{ok:true,json:async()=>body.action==='nodes/native-sessions'?[info]:{nativeSession:info,attempts:[{attempt:1,nativeSession:info}]}}};
let entry;window.__ModuleLoader__={load:value=>entry=value};vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../../lib/client.js'),'utf8'));
entry.factory(()=>React).apply({
 slots:{inject:(_name,fn)=>fn(),register:(registration,component)=>{sections[registration.id??registration.key]=component;return()=>{}}},
 conversation:{blocks:{set:(id,block)=>events.push(['block',id,!!block])}},
 sessions:{refresh:async()=>events.push('refresh')},uiWorkspace:{openSession:id=>events.push(['open',id])},
 layout:{selectPanel:id=>events.push(['panel',id])},on:(name,fn)=>{if(name==='dispose')disposals.push(fn)},
});
const root=createRoot(document.getElementById('root'));
(async()=>{
 await act(async()=>{root.render(React.createElement(sections['workbuddy-delivery']));await new Promise(r=>setTimeout(r,5))});
 const frame=document.querySelector('iframe');events.length=0;
 const message=source=>new window.MessageEvent('message',{origin:location.origin,source,data:{type:'delivery-open-native-session',requestId:'run',nodeId:'coder'}});
 await act(async()=>{window.dispatchEvent(message(window));await new Promise(r=>setTimeout(r,5))});assert.equal(events.length,0,'ignore messages from unrelated windows');
 await act(async()=>{window.dispatchEvent(message(frame.contentWindow));await new Promise(r=>setTimeout(r,5))});
 assert.deepEqual(events,['runs/node',['block','node-session',true],'refresh',['open','node-session']],'refresh native catalogue before navigation');
 await act(async()=>root.render(React.createElement(sections['delivery-node-return'],{sessionId:info.sessionId})));
 assert.equal(document.querySelector('button').dataset.deliveryNode,'coder');
 await act(async()=>document.querySelector('button').click());
 assert.deepEqual(JSON.parse(sessionStorage.getItem('delivery:return-node')),{requestId:'run',nodeId:'coder'});
 assert.deepEqual(events.at(-1),['panel','workbuddy-delivery']);
 await act(async()=>root.unmount());for(const dispose of disposals)dispose();dom.window.close();
 console.log('PASS native client refreshes Session catalogue before opening, blocks direct input, validates iframe source and returns to the exact node');
})().catch(error=>{for(const dispose of disposals)dispose();console.error(error);process.exitCode=1});
