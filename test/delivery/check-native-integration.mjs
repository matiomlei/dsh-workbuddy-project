import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { resolveNodeTools,nativeToolCatalog,isNodeToolName } from '../../lib/delivery/tool-policy.mjs'
import { NativeNodeSessions } from '../../lib/delivery/native-sessions.mjs'
const native=['read','write','edit','read_image','glob','grep','skill','job_output','job_list','job_kill'];
const win=[...native,'pwsh','mcp__repo__inspect','working_directory'];
assert.deepEqual(resolveNodeTools(win,['read','bash'],['mcp__repo__'],'win32'),['read','pwsh','job_output','job_list','job_kill','mcp__repo__inspect']);
assert.ok(nativeToolCatalog('win32').some(tool=>tool.name==='pwsh'));
assert.ok(!nativeToolCatalog('win32').some(tool=>tool.name==='bash'));
assert.ok(resolveNodeTools([...native,'bash'],[] ,[],'darwin').includes('edit'));
assert.deepEqual(resolveNodeTools(win,['read'],[],'win32'),['read']);
assert.throws(()=>resolveNodeTools(win,['working_directory'],[],'win32'),error=>error.code==='NODE_TOOL_UNAVAILABLE');
assert.throws(()=>resolveNodeTools(['read'],['bash'],[],'win32'),error=>error.code==='NODE_TOOL_UNAVAILABLE');
assert.equal(isNodeToolName('shell'),true);
const db=new DatabaseSync(':memory:'),agent={id:'native-1',session:{header:{cwd:'/private/node'}}};
let phase='executing';const live={agent,authorizedMessages:new Set(['business']),closed:false};
const dialogue={key:(r,n)=>r+':'+n,live:new Map([['run:node',live]]),thread:()=>({phase})};
const sessions=new NativeNodeSessions(db,dialogue),info={sessionId:agent.id,requestId:'run',nodeId:'node',attempt:1,title:'项目 · 节点 · 第 1 次执行',workspaceTitle:'项目 · 节点'};
sessions.remember(info);
const next=async()=>({kind:'enter',messages:[]});
assert.equal((await sessions.admit({agent,messages:[{id:'business'}]},next)).kind,'enter');
assert.equal((await sessions.admit({agent,messages:[{id:'external'}]},next)).kind,'reject');
assert.equal((await sessions.admit({agent:{id:agent.id},messages:[]},next)).kind,'reject');
phase='waiting_quality';assert.equal((await sessions.admit({agent,messages:[]},next)).kind,'reject');
assert.equal((await sessions.admit({agent:{id:'ordinary'},messages:[{id:'external'}]},next)).kind,'enter');
const calls=[];
await sessions.publish({workspaceRegistry:{create:async(cwd,title)=>{calls.push([cwd,title]);return{id:'workspace',attachSession:async id=>calls.push(id)}}},sessionController:{rename:async input=>calls.push(input)}},agent);
assert.equal(sessions.get(agent.id).workspaceId,'workspace');assert.equal(sessions.get(agent.id).ready,true);
assert.deepEqual(calls,[['/private/node','项目 · 节点'],agent.id,{sessionId:agent.id,title:info.title}]);
const reloaded=new NativeNodeSessions(db,{...dialogue,live:new Map()});
assert.equal(reloaded.get(agent.id).readOnly,true);assert.equal((await reloaded.admit({agent,messages:[]},next)).kind,'reject');
db.close();console.log('PASS native rc3 tool portability, explicit grants, durable node sessions, native workspace linkage and business-only admission');
