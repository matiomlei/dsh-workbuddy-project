/** Native rc3 approval service and file tool, isolated fake model; no ACL repair. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
const root=resolve(process.argv[2]),url=readFileSync(join(root,'host.log'),'utf8').match(/dsh web: (\S+)/)?.[1],base=new URL(url).origin
const auth=await fetch(url,{redirect:'manual'}),cookie=auth.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
const request=async(action,body={})=>{const response=await fetch(base+'/api/workbuddy-delivery',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action,...body})});return{status:response.status,value:await response.json()}}
const api=async(action,body={})=>{const result=await request(action,body);assert.equal(result.status,200,JSON.stringify(result));return result.value}
const repo=join(root,'approval-source');mkdirSync(repo,{recursive:true})
const git=(...args)=>execFileSync('git',['-c','user.name=Approval Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-C',repo,...args],{encoding:'utf8'}).trim()
if(!existsSync(join(repo,'.git'))){git('init','-q');writeFileSync(join(repo,'README.md'),'Native approval test\n');git('add','.');git('commit','-qm','base')}
const head=git('rev-parse','HEAD'),graph={nodes:[{id:'worker',type:'agent',position:{x:10,y:10},data:{label:'原生权限确认',prompt:'APPROVAL_PROBE',inputTemplate:'验证审批',tools:['write'],timeoutSec:4}}],edges:[]}
const template=await api('template/import',{name:'原生审批验证',definition:{graph,repositoryRoles:[{id:'main'}]}}),editor=await api('editor/open',{id:template.templateId})
const saved=await api('node/save',{id:template.templateId,editorId:editor.editorId,expectedRevision:editor.revision,nodeId:'worker',repositoryRole:'main',capabilities:{experts:[],skills:[],rules:[],connectors:[]},expectedHashes:{}})
const version=await api('publish',{id:template.templateId,expectedRevision:saved.revision})
let project=await api('project/create',{name:'原生审批验证',repositories:[{alias:'repo',url:repo,ref:'HEAD'}]})
project=await api('project/bind',{id:project.id,expectedRevision:project.revision,binding:{templateId:template.templateId,version:version.version,repositoryMap:{main:'repo'}}})
const start=()=>api('runs/start',{requestId:randomUUID(),projectId:project.id,expectedProjectRevision:project.revision,triggerInput:'只验证本次工具调用的允许和拒绝'})
const detail=id=>api('runs/node',{requestId:id,nodeId:'worker'})
async function wait(id,predicate){for(let i=0;i<120;i++){const run=await api('runs/detail',{requestId:id}),node=await detail(id);if(predicate(run,node))return{run,node};if(['execution_failed','preparation_failed'].includes(run.status))throw new Error(JSON.stringify({run,node}));await new Promise(r=>setTimeout(r,100))}throw new Error('Approval test timed out: '+JSON.stringify(await detail(id)))}
assert.equal((await api('settings/get')).autoAllowDangerFullAccess,false)
let run=await start(),state=await wait(run.requestId,(_r,n)=>n.thread?.approvals?.length===1)
writeFileSync(join(root,'approval-active-run.json'),JSON.stringify({requestId:run.requestId,projectId:project.id}))
assert.ok((await api('nodes/native-sessions')).some(info=>info.sessionId===state.node.nativeSession.sessionId&&info.pendingApprovalCount===1));
assert.equal(state.node.thread.phase,'waiting_approval');assert.equal(state.run.nodeStates.worker.status,'waiting_approval')
await new Promise(r=>setTimeout(r,5500));state=await wait(run.requestId,(_r,n)=>n.thread?.approvals?.length===1)
let allow=state.node.thread.approvals[0];const cwd=allow.cwd;
assert.equal(JSON.parse(allow.arguments).file_path,'allow.txt');assert.equal(existsSync(join(cwd,'allow.txt')),false);assert.equal(existsSync(join(cwd,'deny.txt')),false)
const decide=(approval,outcome,override={})=>({requestId:run.requestId,nodeId:'worker',expectedNativeRunId:state.node.nativeRunId,expectedAttempt:state.node.attempt,approvalId:approval.id,outcome,...override})
assert.notEqual((await request('nodes/approval',decide(allow,'allowed-once',{expectedAttempt:999}))).status,200)
await api('nodes/approval',decide(allow,'allowed-once'));
state=await wait(run.requestId,(_r,n)=>n.thread?.approvals?.some(a=>JSON.parse(a.arguments).file_path==='deny.txt'))
const deny=state.node.thread.approvals[0];await new Promise(r=>setTimeout(r,5500));state=await wait(run.requestId,(_r,n)=>n.thread?.approvals?.length===1)
assert.equal(readFileSync(join(cwd,'allow.txt'),'utf8'),'APPROVAL_TEST_ONLY\n');assert.equal(existsSync(join(cwd,'deny.txt')),false)
await api('nodes/approval',decide(deny,'rejected'));state=await wait(run.requestId,r=>r.status==='execution_succeeded')
assert.equal(existsSync(join(cwd,'deny.txt')),false);assert.equal(git('rev-parse','HEAD'),head);assert.equal(git('status','--porcelain'),'')
const audit=readFileSync(join(root,'test-approval-audit.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.sessionId===state.node.nativeSession.sessionId).map(row=>row.event)
assert.equal(audit.filter(event=>event.type==='approval/asked').length,2)
assert.deepEqual(audit.filter(event=>event.type==='approval/decided').map(event=>event.data.outcome).sort(),['allowed-once','rejected'])
const completed=run.requestId;run=await start();state=await wait(run.requestId,(_r,n)=>n.thread?.approvals?.length===1)
const cancelCwd=state.node.thread.approvals[0].cwd,stale=decide(state.node.thread.approvals[0],'allowed-once');await api('runs/cancel',{requestId:run.requestId});state=await wait(run.requestId,(r,n)=>r.status==='canceled'&&!n.thread?.approvals?.length)
assert.notEqual((await request('nodes/approval',stale)).status,200);assert.equal(existsSync(join(cancelCwd,'deny.txt')),false);assert.equal(existsSync(join(cancelCwd,'allow.txt')),false)
const cancelled=run.requestId
run=await start();state=await wait(run.requestId,(_r,n)=>n.thread?.approvals?.length===1)
const autoSession=state.node.nativeSession.sessionId,autoCwd=state.node.thread.approvals[0].cwd
assert.equal((await api('settings/save',{autoAllowDangerFullAccess:true})).autoAllowDangerFullAccess,true)
state=await wait(run.requestId,r=>r.status==='execution_succeeded')
assert.equal(readFileSync(join(autoCwd,'allow.txt'),'utf8'),'APPROVAL_TEST_ONLY\n');assert.equal(readFileSync(join(autoCwd,'deny.txt'),'utf8'),'APPROVAL_TEST_ONLY\n')
assert.equal(state.node.entries.filter(entry=>entry.decisionSource==='project-settings').length,2,'pending and subsequent requests both follow the saved preference')
const autoAudit=readFileSync(join(root,'test-approval-audit.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line)).filter(row=>row.sessionId===autoSession).map(row=>row.event)
assert.deepEqual(autoAudit.filter(event=>event.type==='approval/decided').map(event=>event.data.outcome),['allowed-once','allowed-once'])
const autoRun=run.requestId
await api('settings/save',{autoAllowDangerFullAccess:false});run=await start();state=await wait(run.requestId,(_r,n)=>n.thread?.approvals?.length===1)
await api('runs/cancel',{requestId:run.requestId});assert.equal((await api('settings/get')).autoAllowDangerFullAccess,false)
assert.equal(git('status','--porcelain'),'')
const report={date:new Date().toISOString(),platform:process.platform,externalModelCalls:0,completedRequestId:completed,cancelledRequestId:cancelled,autoApprovedRequestId:autoRun,checks:['native approval/asked + approval/decided retained','native tool approvals visible in project mode','waiting beyond timeout keeps node alive across consecutive requests','only explicitly granted write executes; rejection and cancellation keep files unchanged','stale and late permission decisions rejected; original source remains clean','saved full-access preference releases pending and subsequent native calls, with native audit and source label','disabling restores manual approval']}
writeFileSync(join(root,'approval-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
