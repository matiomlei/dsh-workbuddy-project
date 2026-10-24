/** Real DSH tools, quality gate and Git handoff for changes above the old 50-file cap. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const root=resolve(process.argv[2]),url=readFileSync(join(root,'host.log'),'utf8').match(/dsh web: (\S+)/)?.[1]
assert.ok(url,'Start the isolated source host first')
const base=new URL(url).origin,auth=await fetch(url,{redirect:'manual'})
const cookie=auth.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
async function api(action,body={}) {
  const response=await fetch(base+'/api/workbuddy-delivery',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(40000)})
  const value=await response.json();assert.ok(response.ok&&!value.error,JSON.stringify(value));return value
}
const git=(cwd,...args)=>execFileSync('git',['-c','user.name=File batch test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-C',cwd,...args],{encoding:'utf8'}).trim()
const source=join(root,'many-files-source-'+randomUUID().slice(0,8));mkdirSync(source)
for(const [name,text] of [['README.md','Batch source\n'],['shared.txt','BASE\n'],['remove.txt','DELETE\n']])writeFileSync(join(source,name),text)
git(source,'init','-q');git(source,'add','.');git(source,'commit','-qm','base')
const sourceHead=git(source,'rev-parse','HEAD')
const generate=String.raw`const fs=require('node:fs');fs.mkdirSync('generated');for(let i=0;i<120;i++)fs.writeFileSync('generated/module-'+i+'.txt','MODULE_'+i+'\n');fs.writeFileSync('shared.txt','BATCH_UPDATE\n');fs.unlinkSync('remove.txt');fs.unlinkSync(__filename);console.log('BATCH_CREATED_122');`
const verify=String.raw`const fs=require('node:fs'),assert=require('node:assert/strict');for(let i=0;i<120;i++)assert.equal(fs.readFileSync('generated/module-'+i+'.txt','utf8'),'MODULE_'+i+'\n');assert.equal(fs.readFileSync('shared.txt','utf8'),'BATCH_UPDATE\n');assert.equal(fs.existsSync('remove.txt'),false);console.log('ALL_122_CHANGES_VERIFIED');`
const op=(name,args,expect)=>({name,args,...(expect?{expect}:{})})
const agent=(id,operations,x)=>({id,type:'agent',position:{x,y:0},data:{label:id,prompt:'执行本节点并提供真实工具结果。',inputTemplate:'TEST_OPERATIONS:'+JSON.stringify(operations),tools:['read','write','bash']}})
const graph={nodes:[agent('writer',[
  op('write',{file_path:'.generate.cjs',content:generate}),
  op('bash',{description:'Generate batch changes',command:'node .generate.cjs',timeoutMs:20000},'BATCH_CREATED_122'),
  op('read',{file_path:'generated/module-119.txt'},'MODULE_119'),
],0),agent('consumer',[
  op('read',{file_path:'generated/module-119.txt'},'MODULE_119'),
  op('bash',{description:'Verify every upstream batch change',command:'node -e '+JSON.stringify(verify),timeoutMs:20000},'ALL_122_CHANGES_VERIFIED'),
  op('write',{file_path:'receipt.md',content:'All 122 upstream changes verified.\n'}),
],300)],edges:[{id:'handoff',source:'writer',target:'consumer'}]}
const created=await api('template/import',{name:'超过 50 文件的真实宿主回归',definition:{graph,repositoryRoles:[{id:'main'}]}}),id=created.templateId
const editor=await api('editor/open',{id});let revision=editor.revision
for(const nodeId of ['writer','consumer'])revision=(await api('node/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId,repositoryRole:'main',capabilities:{experts:[],skills:[],rules:[],connectors:[]},expectedHashes:{}})).revision
revision=(await api('quality-policy/save',{id,editorId:editor.editorId,expectedRevision:revision,nodeId:'writer',required:true})).revision
const published=await api('publish',{id,expectedRevision:revision})
let project=await api('project/create',{name:'批量文件交接回归',repositories:[{alias:'application',url:source,ref:'HEAD'}]})
project=await api('project/bind',{id:project.id,expectedRevision:project.revision,binding:{templateId:id,version:published.version,repositoryMap:{main:'application'}}})
let run=await api('runs/start',{requestId:randomUUID(),projectId:project.id,expectedProjectRevision:project.revision,triggerInput:'验证批量文件变更可完整交接'})
async function wait(predicate) {
  for(let i=0;i<600;i++) {
    run=await api('runs/detail',{requestId:run.requestId})
    if(predicate(run))return
    if(['preparation_failed','execution_failed','canceled'].includes(run.status))throw new Error(JSON.stringify({status:run.status,error:run.error,nodes:run.nodeStates}))
    await new Promise(resolve=>setTimeout(resolve,100))
  }
  throw new Error('Batch test timed out: '+JSON.stringify(run.nodeStates))
}
await wait(value=>value.nodeStates.writer?.status==='waiting_quality')
assert.equal(run.nodeStates.consumer,undefined)
const artifacts=run.artifacts.filter(item=>item.nodeId==='writer');assert.equal(artifacts.length,122)
assert.equal(artifacts.filter(item=>item.change==='deleted').length,1)
const last=artifacts.find(item=>item.name==='generated/module-119.txt');assert.ok(last)
assert.equal((await api('runs/artifact',{requestId:run.requestId,artifactId:last.id})).content,'MODULE_119\n')
const subject=run.qualitySubjects.find(item=>item.evidence.nodeId==='writer')
await api('quality/decide',{decisionId:randomUUID(),requestId:run.requestId,subjectId:subject.id,subjectDigest:subject.digest,nodeId:'writer',attempt:subject.evidence.attempt,reviewId:subject.reviews.at(-1).id,outcome:'passed',note:'已核验完整批量产物，允许下游验证全部变更'})
await wait(value=>value.status==='execution_succeeded')
const patch=await api('runs/patch',{requestId:run.requestId,nodeId:'consumer',alias:'application'}),patchFile=join(root,'many-files.patch')
writeFileSync(patchFile,Buffer.from(patch.content,'base64'))
const checkout=join(root,'many-files-consumer-'+randomUUID().slice(0,8));git(root,'clone','-q',source,checkout)
git(checkout,'apply','--check',patchFile);git(checkout,'apply',patchFile)
assert.match(execFileSync(process.execPath,['-e',verify],{cwd:checkout,encoding:'utf8'}),/ALL_122_CHANGES_VERIFIED/)
assert.equal(readFileSync(join(checkout,'receipt.md'),'utf8'),'All 122 upstream changes verified.\n')
assert.equal(git(source,'rev-parse','HEAD'),sourceHead);assert.equal(git(source,'status','--porcelain'),'')
const requests=readFileSync(join(root,'test-model-requests.jsonl'),'utf8');assert.ok(requests.includes('BATCH_CREATED_122'));assert.ok(requests.includes('ALL_122_CHANGES_VERIFIED'))
const report={date:new Date().toISOString(),platform:process.platform,nativeWindows:process.platform==='win32',externalModelCalls:0,requestId:run.requestId,writerArtifacts:artifacts.length,checks:['122 changes sealed without truncation','quality gate blocks downstream until accepted','downstream native tools verify all upstream files and deletion','cumulative patch applies to a clean checkout and retains downstream output','source repository stays unchanged']}
writeFileSync(join(root,'many-files-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
