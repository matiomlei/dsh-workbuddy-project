import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync } from 'node:fs'
import { dirname,join,resolve } from 'node:path'
import { homedir,tmpdir } from 'node:os'
import { pathToFileURL,fileURLToPath } from 'node:url'
const root=mkdtempSync(join(tmpdir(),'wb-packages-host-')),peers=process.env.WB_DSH_NODE_MODULES??join(homedir(),'.dsh/profiles/node_modules')
const modules=dirname(dirname(realpathSync(join(peers,'@deepseek-ai/dsh-app-boot'))))
cpSync(resolve(dirname(fileURLToPath(import.meta.url)),'../lib'),join(root,'lib'),{recursive:true});symlinkSync(modules,join(root,'node_modules'))
const load=file=>import(pathToFileURL(join(root,file)))
const put=(file,text)=>{mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
const json=(file,value)=>put(file,JSON.stringify(value,null,2))
let host,bridge
const calls=[]
const server=createServer(async(req,res)=>{
 if(req.url==='/unauthorized'){res.writeHead(401,{'content-type':'application/json','www-authenticate':'Bearer resource_metadata="https://example.test/oauth"'}).end(JSON.stringify({error:'fixture-secret-upstream-body'}));return}
 if(req.url==='/forbidden'){res.writeHead(403,{'content-type':'application/json'}).end(JSON.stringify({error:'fixture-secret-upstream-body'}));return}
 if(req.url==='/reset'){req.socket.destroy();return}
 if(req.url==='/slow')return
 if(req.method!=='POST'){res.writeHead(405).end();return}
 let text='';for await(const chunk of req)text+=chunk
 const msg=JSON.parse(text);if(msg.id===undefined){res.writeHead(202).end();return}
 calls.push(msg.method)
 const result=msg.method==='initialize'?{protocolVersion:msg.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:msg.method==='tools/list'?{tools:[{name:'lookup',inputSchema:req.url==='/bad-schema'?{type:'object',patternProperties:{'.*':{type:'string'}}}:{type:'object',properties:{}}}]}:{content:[{type:'text',text:'found'}]}
 res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}))
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
try {
 const {boot}=await load('node_modules/@deepseek-ai/dsh-app-boot/lib/index.js')
 const {projectRoute}=await load('lib/route.js')
 const team=join(root,'team'),projectsRoot=join(root,'home/projects'),cwd=join(root,'workspace')
 mkdirSync(cwd)
 json(join(team,'library.json'),{name:'团队能力'})
 put(join(team,'rules/style/RULE.md'),'---\nname: 工程规范\nicon: "📋"\n---\nVerified only')
 json(join(team,'experts/lead/.codebuddy-plugin/plugin.json'),{name:'lead',agentName:'lead',expertType:'team',displayName:{zh:'主专家'},skills:['./skills/design']})
 put(join(team,'experts/lead/agents/lead.md'),'MAIN EXPERT')
 put(join(team,'experts/lead/skills/design/SKILL.md'),'---\nname: design\ndescription: Design\n---\nDesign method')
 json(join(team,'connectors/search/connector.json'),{id:'search',name:'搜索',icon:'🔗',type:'mcp'})
 json(join(team,'connectors/search/mcp.json'),{mcpServers:{search:{type:'streamableHttp',url:`http://127.0.0.1:${server.address().port}/mcp`}}})
 json(join(team,'projects/review/project.json'),{id:'review',name:'评审项目',instructions:'./literal.md',experts:['team:experts/lead'],rules:['team:rules/style'],skills:[],connectors:['team:connectors/search']})
 put(join(root,'cordis.yml'),'[]\n')
 host=await boot('wb-packages-test',join(root,'cordis.yml'),[{insert:[{id:'wb',name:join(root,'lib/index.js'),config:{projectsRoot,libraries:[{name:'team',path:team}],compileOptions:true}}]}],ctx=>{
   ctx.provide('tools',{register(){return ()=>{}}});ctx.provide('commands',{register(){return ()=>{}}})
 })
 const service=host.get('workbuddyProject')
 const request=async(action,payload={})=>{
   const response=await projectRoute(service).fetch(new Request('http://localhost/api/workbuddy-project',{method:'POST',body:JSON.stringify({action,...payload})}));return response.json()
 }
 const options=await request('options',{cwd:null});assert.equal(options.ok,true,JSON.stringify(options));assert.equal(options.value.connectors.shared[0].reference,'team:connectors/search');assert.equal(options.value.experts.shared[0].expertType,'team')
 const catalog=await request('capabilities');assert.equal(catalog.ok,true);assert.equal(catalog.value.length,3)
 const definition=await request('capability',{library:'team',path:'experts/lead'});assert.equal(definition.ok,true);assert.ok(definition.value.files.includes('agents/lead.md'))
 const agent=await request('capability',{library:'team',path:'experts/lead',file:'agents/lead.md'});assert.equal(agent.value.content,'MAIN EXPERT')
 const escape=await request('capability',{library:'team',path:'experts/lead',file:'../../secret'});assert.equal(escape.ok,false)
 const draft=await request('templateDraft',{template:'team:review'});assert.equal(draft.ok,true);assert.deepEqual(draft.value.config.connectors,['team:connectors/search']);assert.equal(draft.value.config.instructions,'./literal.md')
 const created=await request('fromTemplate',{template:'team:review',cwd,config:{name:'定制评审',instructions:'CUSTOM TEXT',connectors:['team:connectors/search']},validate:false});assert.equal(created.ok,true,JSON.stringify(created));const id=created.value.id
 assert.equal(JSON.parse(readFileSync(join(cwd,'.dsh/project.json'))).instructions,'CUSTOM TEXT')
 assert.ok(existsSync(join(projectsRoot,id,'capabilities.lock.json')))
 const duplicate=await request('create',{config:{name:'重复',cwd}});assert.equal(duplicate.ok,false)
 const updated=await request('update',{config:{id,instructions:'./new-literal.md'}});assert.equal(updated.ok,true)
 const detail=await request('describe',{id});assert.equal(detail.value.project.instructions,'./new-literal.md')
 const preview=await request('apply',{id,preview:true});assert.equal(preview.ok,true);assert.match(preview.value.composition,/MAIN EXPERT/)
 const checked=await request('checkConnectors',{id});assert.equal(checked.ok,true,JSON.stringify(checked));assert.equal(checked.value.healthy,true);assert.equal(checked.value.connectorChecks[0].tools,1)
 const {checkConnector,connectorProblem}=await load('lib/connector-diagnostics.js')
 for(const [path,code] of [['unauthorized','authorization-required'],['forbidden','authorization-denied'],['reset','connection-reset'],['slow','connection-timeout'],['bad-schema','unsupported-tools']]) {
   const check=await checkConnector({name:path,transport:'streamable-http',url:`http://127.0.0.1:${server.address().port}/${path}`},{timeoutMs:path==='slow'?150:3000})
   assert.equal(check.code,code,JSON.stringify(check));assert.equal(check.status,'error');assert.ok(!JSON.stringify(check).includes('fixture-secret'))
 }
 const unset=await checkConnector({name:'missing',transport:'streamable-http',url:'https://example.test',headers:{Authorization:'Bearer ${WB_TEST_UNSET_CONNECTOR_TOKEN}'}})
 assert.equal(unset.code,'missing-environment')
 assert.equal(connectorProblem(new Error('generic startup',{cause:Object.assign(new Error('sensitive details'),{code:'ECONNRESET'})})).code,'connection-reset')
 // Mount the real host MCP bridge and perform an actual tool call.
 const {Context}=await load('node_modules/@deepseek-ai/cordis/lib/index.js')
 const {WorkbuddyProject}=await load('lib/service.js')
 const defaults=new Context();defaults.provide('tools',{register(){return ()=>{}}});defaults.provide('dshHomePath',(...parts)=>join(root,'default-home',...parts))
 const defaultService=new WorkbuddyProject(defaults,{projectsRoot:'',libraries:[]})
 assert.equal(defaultService.root,join(root,'default-home/projects'),'empty configuration uses host data root, not process.cwd()')
 assert.deepEqual(defaultService.libraries(),[],'new installation does not require a shared library')
 await defaults.fiber.dispose()
 const mcp=await load('lib/connector-client.js')
 const ctx=new Context(),registered=new Map();ctx.provide('tools',{register(tool){registered.set(tool.name,tool);return ()=>registered.delete(tool.name)}})
 bridge=ctx.plugin(mcp,{serverName:'search',transport:'streamable-http',url:`http://127.0.0.1:${server.address().port}/mcp`,failOnStartupError:true});await bridge
 assert.ok(registered.has('mcp__search__lookup'));const called=await registered.get('mcp__search__lookup').execute({},{signal:new AbortController().signal});assert.equal(called.content[0].text,'found')
 await bridge.dispose();bridge=undefined;assert.equal(registered.size,0)
 bridge=ctx.plugin(mcp,{serverName:'unauthorized',transport:'streamable-http',url:`http://127.0.0.1:${server.address().port}/unauthorized`,failOnStartupError:true,reconnect:{enabled:false}})
 await assert.rejects(async()=>{await bridge},/401/);await bridge.dispose();bridge=undefined;assert.equal(registered.size,0)
 // Real stdio connector process uses JSON-RPC and is disposed with its fiber.
 put(join(root,'stdio-server.mjs'),`import readline from 'node:readline';
 const lines=readline.createInterface({input:process.stdin});
 lines.on('line',text=>{const message=JSON.parse(text);if(message.id===undefined)return;
 const result=message.method==='initialize'?{protocolVersion:message.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'stdio',version:'1'}}:message.method==='tools/list'?{tools:[{name:'ping',inputSchema:{type:'object',properties:{}}}]}:{content:[{type:'text',text:'stdio works'}]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result})+'\\n');});`)
 bridge=ctx.plugin(mcp,{serverName:'stdio',transport:'stdio',command:process.execPath,args:['stdio-server.mjs'],cwd:root,failOnStartupError:true});await bridge
 assert.ok(registered.has('mcp__stdio__ping'));const stdioCall=await registered.get('mcp__stdio__ping').execute({},{signal:new AbortController().signal});assert.equal(stdioCall.content[0].text,'stdio works')
 await bridge.dispose();bridge=undefined;assert.equal(registered.size,0)
 assert.ok(calls.includes('initialize')&&calls.includes('tools/list')&&calls.includes('tools/call'))
 const stdioCheck=await checkConnector({name:'stdio',transport:'stdio',command:process.execPath,args:['stdio-server.mjs'],cwd:root},{timeoutMs:3000})
 assert.equal(stdioCheck.status,'connected',JSON.stringify(stdioCheck));assert.equal(stdioCheck.tools,1)
 const {localRuntimeEntries}=await load('lib/local-runtime.js')
 const wrappedRuntime={root:{get:()=>({entries:()=>[{options:{name:'/tmp/fixture/.dsh/profiles/web/plugins/dsh-workbuddy-project-packages-abc/lib/connector-client.js'},id:'search',fiber:{config:{serverName:'search',transport:'streamable-http',url:'https://example.test/mcp',headers:{Authorization:'fixture-secret'}}}}]})}}
 assert.equal(localRuntimeEntries(wrappedRuntime)[0].module,'@deepseek-ai/dsh-mcp-client','wrapper configurations remain discoverable as DSH local connectors')
 // Template-owned packages resolve from the template and copy as complete bundles.
 const own=join(team,'projects/own'),ownCwd=join(root,'own-workspace')
 json(join(own,'project.json'),{id:'own',name:'Own',experts:['project:experts/author'],skills:['project:skills/review'],connectors:[]})
 json(join(own,'experts/author/.codebuddy-plugin/plugin.json'),{name:'author',agentName:'author'})
 put(join(own,'experts/author/agents/author.md'),'TEMPLATE AUTHOR')
 put(join(own,'skills/review/SKILL.md'),'---\nname: review\ndescription: Review\n---\nTEMPLATE REVIEW')
 put(join(own,'skills/review/scripts/check.mjs'),'// bundled check')
 const ownDraft=await request('templateDraft',{template:'team:own'});assert.equal(ownDraft.ok,true,JSON.stringify(ownDraft))
 assert.equal(service.expertDefinition({cwd:own,expert:'project:experts/author'}).text,'TEMPLATE AUTHOR')
 assert.match(JSON.stringify(service.previewSkill({cwd:own,directory:join(own,'skills/review')})),/TEMPLATE REVIEW/)
 const ownCreated=await request('fromTemplate',{template:'team:own',cwd:ownCwd,validate:false});assert.equal(ownCreated.ok,true,JSON.stringify(ownCreated))
 assert.equal(readFileSync(join(ownCwd,'.dsh/skills/review/scripts/check.mjs'),'utf8'),'// bundled check')
 await service.remove(ownCreated.value.id)
 // Contributions validate all files before committing and preserve the base checkout.
 const git=args=>execFileSync('git',args,{cwd:team,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 execFileSync('git',['init','--bare',join(root,'remote.git')],{stdio:'ignore'})
 git(['init']);git(['checkout','-b','main']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.test'])
 git(['add','.']);git(['commit','-m','Fixture packages']);git(['remote','add','origin',join(root,'remote.git')]);git(['push','-u','origin','main'])
 const head=git(['rev-parse','HEAD'])
 const expertContribution=service.contribute({library:'team',changes:[{path:'experts/new/agents/new.md',content:'NEW EXPERT',icon:'👩‍💻'}],message:'Add new expert'})
 assert.equal(expertContribution.pushed,true);assert.match(expertContribution.branch,/^codex\//)
 assert.equal(git(['branch','--show-current']),'main');assert.equal(git(['rev-parse','HEAD']),head);assert.equal(git(['status','--porcelain']),'')
 const manifest=JSON.parse(git(['show',`${expertContribution.branch}:experts/new/.codebuddy-plugin/plugin.json`]))
 assert.equal(manifest.agentName,'new');assert.equal(manifest.icon,'👩‍💻')
 const connectorContribution=service.contribute({library:'team',changes:[{path:'connectors/new/mcp.json',content:JSON.stringify({mcpServers:{new:{command:'node',args:['server.mjs']}}}),icon:'🔌'},{path:'connectors/new/server.mjs',content:'// bundled server'}],message:'Add new connector'})
 assert.equal(connectorContribution.pushed,true);assert.equal(JSON.parse(git(['show',`${connectorContribution.branch}:connectors/new/connector.json`])).icon,'🔌')
 assert.throws(()=>service.contribute({library:'team',changes:[{path:'connectors/bad/mcp.json',content:'{}'}]}),/must declare mcpServers/)
 assert.equal(git(['rev-parse','HEAD']),head);assert.equal(git(['status','--porcelain']),'');assert.equal(existsSync(join(team,'connectors/bad')),false)
 const missingLibrary=await request('removeLibrary');assert.equal(missingLibrary.ok,false)
 const removedLibrary=await request('removeLibrary',{library:'team'});assert.equal(removedLibrary.ok,true);assert.equal(removedLibrary.value.filesRetained,true)
 assert.equal(service.libraries().length,0);assert.equal(service.templates().length,0);assert.equal(service.capabilities().length,0);assert.ok(existsSync(join(team,'connectors/search/mcp.json')))
 const optionsAfterRemoval=await request('options',{cwd:null});assert.deepEqual(optionsAfterRemoval.value.connectors.shared,[])
 const pinnedAfterRemoval=await request('apply',{id,preview:true});assert.equal(pinnedAfterRemoval.ok,true,JSON.stringify(pinnedAfterRemoval));assert.match(pinnedAfterRemoval.value.composition,/MAIN EXPERT/)
 await service.remove(id);assert.equal(existsSync(join(cwd,'.dsh/project.json')),false)
 assert.equal(JSON.parse(readFileSync(join(root,'home/capabilities/installed.json'))).projects[id],undefined)
 console.log('PASS actual DSH boot, HTTP/stdio tools/call and checks; 401/403/reset/timeout/schema diagnostics; safe error rendering; local connector discovery; package editor, templates, Git contributions and project lifecycle')
}finally{if(bridge)await bridge.dispose();if(host)await host.fiber.dispose();await new Promise(done=>server.close(done));rmSync(root,{recursive:true,force:true})}
