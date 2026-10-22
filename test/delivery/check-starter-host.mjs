/** Full installed starter: four actual Agents, scoped MCP, skills, gates and executable code. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
const root=resolve(process.argv[2]||''),url=readFileSync(join(root,'host.log'),'utf8').match(/dsh web: (\S+)/)?.[1]
assert.ok(url,'Start the prepared isolated host first')
const base=new URL(url).origin,response=await fetch(url,{redirect:'manual'}),cookie=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
async function api(action,body={}) {const r=await fetch(base+'/api/workbuddy-delivery',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action,...body}),signal:AbortSignal.timeout(60000)});const v=await r.json();assert.ok(r.ok&&!v.error,JSON.stringify(v));return v}
const git=(cwd,...args)=>execFileSync('git',['-c','user.name=Starter validation','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','-C',cwd,...args],{encoding:'utf8'}).trim()
const repo=join(root,'starter-source');mkdirSync(repo,{recursive:true})
if(!existsSync(join(repo,'.git'))) {git(repo,'init','-q');writeFileSync(join(repo,'README.md'),'# Shopping cart\nNode.js commonjs module, no dependencies. Use node --test test/cart.test.cjs.\n');git(repo,'add','.');git(repo,'commit','-qm','baseline')}
const sourceHead=git(repo,'rev-parse','HEAD')
const created=await api('template/starter'),id=created.templateId
const detail=await api('detail',{id}),definition=detail.draft.definition
const stages=['requirements','design','implement','verify']
assert.deepEqual(definition.graph.nodes.map(n=>n.id),[...stages,'delivery'])
assert.deepEqual(definition.qualityPolicies.map(p=>p.nodeId),stages)
for(const stage of stages) {const b=definition.nodeBindings.find(b=>b.nodeId===stage);assert.equal(b.repositoryRole,'main');for(const key of ['experts','skills','rules','connectors'])assert.ok(b.capabilities[key].length);assert.ok(Object.keys(b.packages).length>=5)}
const version=await api('publish',{id,expectedRevision:detail.draft.revision});assert.equal(version.ready,true)
let project=await api('project/create',{name:'模板功能验证 · 购物车金额计算',repositories:[{alias:'application',url:repo,ref:'HEAD'}]})
project=await api('project/bind',{id:project.id,expectedRevision:project.revision,binding:{templateId:id,version:version.version,repositoryMap:{main:'application'}}})
let run=await api('runs/start',{requestId:randomUUID(),projectId:project.id,expectedProjectRevision:project.revision,triggerInput:'实现 calculateTotal(items, discountPercent=0)。items 的 priceCents 是非负安全整数，quantity 是正安全整数；discountPercent 是 0..100 整数。汇总后折扣并向下取整，空数组返回 0，非法输入或溢出抛 TypeError。不新增依赖。',inputs:{validationCommand:'node --test test/cart.test.cjs',constraints:'CommonJS 模块；不联网、不新增依赖。'}})
const gates=[]
async function wait(predicate) {for(let i=0;i<600;i++){run=await api('runs/detail',{requestId:run.requestId});if(predicate(run))return;if(['preparation_failed','execution_failed','canceled'].includes(run.status))throw new Error(JSON.stringify({status:run.status,error:run.error,nodes:run.nodeStates}));await new Promise(r=>setTimeout(r,300))}throw new Error('Starter run timed out: '+JSON.stringify(run.nodeStates))}
const reports={requirements:'requirements.md',design:'design.md',implement:'implementation.md',verify:'test-report.md'}
for(const [i,stage] of stages.entries()) {
 await wait(r=>r.nodeStates[stage]?.status==='waiting_quality')
 assert.equal(run.nodeStates[[...stages,'delivery'][i+1]],undefined,'downstream must await acceptance')
 const artifact=run.artifacts.find(a=>a.nodeId===stage&&a.name==='.delivery/outputs/'+reports[stage]);assert.ok(artifact,'report from '+stage)
 const content=await api('runs/artifact',{requestId:run.requestId,artifactId:artifact.id});assert.match(content.content,/AC-01/)
 if(stage==='implement'||stage==='verify')assert.match(content.content,/7 项通过/)
 const subject=run.qualitySubjects.filter(s=>s.evidence.nodeId===stage).at(-1),review=subject.reviews.at(-1)
 await api('quality/decide',{decisionId:randomUUID(),requestId:run.requestId,subjectId:subject.id,subjectDigest:subject.digest,nodeId:stage,attempt:subject.evidence.attempt,reviewId:review.id,outcome:'passed',note:'功能验证脚本已核验固定产物和工具执行结果，允许继续。'})
 gates.push({nodeId:stage,artifact:artifact.name,sha256:artifact.sha256})
}
await wait(r=>r.status==='execution_succeeded')
assert.equal(run.qualityStatus,'passed');assert.equal(run.nodeStates.delivery.status,'success')
const patch=await api('runs/patch',{requestId:run.requestId,nodeId:'verify',alias:'application'}),patchFile=join(root,'starter.patch');writeFileSync(patchFile,Buffer.from(patch.content,'base64'))
const consumer=join(root,'starter-consumer-'+randomUUID().slice(0,8));execFileSync('git',['clone','-q',repo,consumer]);git(consumer,'apply','--check',patchFile);git(consumer,'apply',patchFile)
const output=execFileSync(process.execPath,['--test','test/cart.test.cjs'],{cwd:consumer,encoding:'utf8'});assert.match(output,/(?:# |ℹ )pass 7/);writeFileSync(join(root,'starter-test-output.txt'),output)
for(const file of Object.values(reports))assert.ok(existsSync(join(consumer,'.delivery/outputs',file)))
assert.equal(git(repo,'rev-parse','HEAD'),sourceHead);assert.equal(git(repo,'status','--porcelain'),'')
const requests=readFileSync(join(root,'test-model-requests.jsonl'),'utf8')
for(const marker of ['业务需求分析师','软件架构设计师','软件实现工程师','独立测试工程师','需求分析规范','方案设计规范','编码实现规范','测试验证规范','研发交付通用规范','STARTER_TESTS_PASSED'])assert.ok(requests.includes(marker),marker)
for(const id of stages)assert.ok(requests.includes('delivery-'+id))
const report={date:new Date().toISOString(),dsh:'0.2.1-rc.2',model:'test-only deterministic adapter; no external model calls',templateId:id,templateVersion:version.version,requestId:run.requestId,projectId:project.id,gates,tests:{passed:7,failed:0,runs:'implementation Agent, test Agent, clean patch consumer'},checks:['configured production starter recipe created and published without graph edits','four distinct experts, Skills, shared/stage rules and repository MCP loaded','MCP reads the current node worktree and transferred upstream documents','four fixed reports verified before acceptance; downstream waits at every gate','both coding and test Agents execute real Node tests through DSH bash','cumulative patch applies in a clean checkout and passes seven tests','original source stays clean']}
writeFileSync(join(root,'starter-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
