import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,cpSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir,homedir } from 'node:os'
import { normalizeProject,projectDocument,writeProject,readProject } from '../lib/project.js'
import { listCapabilities } from '../lib/catalog.js'
import { describeOption } from '../lib/capability-metadata.js'
import { compileProject,projectModel } from '../lib/compile.js'
import { packageHash,readPackage,scanPackages } from '../lib/bundles.js'
import { parseYaml } from '../lib/yaml.js'
const root=mkdtempSync(join(tmpdir(),'wb-packages-'))
const put=(file,text)=>{mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,text)}
const json=(file,data)=>put(file,JSON.stringify(data,null,2))
try {
 const library=join(root,'team'),cwd=join(root,'work'),home=join(root,'home'),projects=join(home,'projects'),cacheRoot=join(home,'capabilities/cache'),lockPath=join(projects,'demo/capabilities.lock.json')
 mkdirSync(cwd)
 json(join(library,'library.json'),{name:'开发团队'})
 json(join(library,'experts/company/.codebuddy-plugin/plugin.json'),{name:'company',version:'1.0.0',displayName:{zh:'软件公司'},expertType:'team',agentName:'lead',teamInfo:{leadAgent:'lead',memberAgents:['member']},agents:['./agents/lead.md','./agents/member.md'],skills:['./skills/design'],avatar:'avatars/team.svg'})
 put(join(library,'experts/company/agents/lead.md'),'---\nname: lead\n---\n\nENTRY ROLE')
 put(join(library,'experts/company/agents/member.md'),'MEMBER MUST NOT BE INLINED')
 put(join(library,'experts/company/skills/design/SKILL.md'),'---\nname: design\ndescription: Design\n---\nDESIGN')
 put(join(library,'experts/company/skills/design/scripts/run.py'),'print("design")')
 put(join(library,'experts/company/avatars/team.svg'),'<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>')
 put(join(library,'skills/@owner/review/SKILL.md'),'---\nname: review\ndescription: Review\n---\nREVIEW')
 put(join(library,'skills/@owner/review/references/nested/SKILL.md'),'Nested reference, not a separate capability')
 put(join(library,'rules/style/RULE.md'),'---\nname: 工程规范\nicon: "📋"\n---\nOnly verified conclusions')
 json(join(library,'connectors/search/connector.json'),{id:'search',name:'搜索连接器',icon:'🔗',type:'mcp'})
 json(join(library,'connectors/search/mcp.json'),{mcpServers:{search:{type:'streamableHttp',url:'https://example.test/mcp',headers:{Authorization:'Bearer ${SEARCH_TOKEN}'}},local:{type:'stdio',command:'node',args:['server.mjs'],env:{TOKEN:'${LOCAL_TOKEN}'}}}})
 put(join(library,'connectors/search/skills/SKILL.md'),'---\nname: search-guide\ndescription: Guide\n---\nSearch guide')
 put(join(library,'connectors/search/server.mjs'),'// complete package asset')
 json(join(library,'connectors/cli/cli.json'),{command:'example-cli'})
 put(join(library,'connectors/cli/skills/SKILL.md'),'---\nname: cli-guide\ndescription: CLI guide\n---\nUse example-cli')
 const catalog=listCapabilities({name:'team',path:library,exists:true})
 assert.equal(catalog.length,5)
 const expert=catalog.find(x=>x.kind==='expert');assert.equal(expert.displayName,'软件公司');assert.equal(expert.expertType,'team');assert.match(expert.iconUrl,/data:image\/svg\+xml/)
 assert.equal(scanPackages(join(library,'skills'),'skill','team').length,1)
 // Existing expert avatars above the upload limit must still render.
 const png=Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6XkAAAAASUVORK5CYII=','base64'),Buffer.alloc(320*1024)])
 put(join(library,'experts/company/avatars/large.png'),png)
 const avatarManifest=join(library,'experts/company/.codebuddy-plugin/plugin.json'),avatarMetadata=JSON.parse(readFileSync(avatarManifest))
 json(avatarManifest,{...avatarMetadata,avatar:'avatars/large.png'})
 const largeAvatar=describeOption({path:join(library,'experts/company'),name:'company'},'expert')
 assert.match(largeAvatar.iconUrl,/^data:image\/png;base64,/);assert.deepEqual(Buffer.from(largeAvatar.iconUrl.split(',')[1],'base64'),png)
 put(join(library,'experts/company/avatars/too-large.png'),Buffer.alloc(2*1024*1024+1))
 json(avatarManifest,{...avatarMetadata,avatar:'avatars/too-large.png'})
 assert.equal(describeOption({path:join(library,'experts/company'),name:'company'},'expert').iconUrl,undefined)
 json(avatarManifest,avatarMetadata)
 const options={expertsRoot:join(home,'experts'),libraries:[{name:'team',path:library}],cacheRoot,lockPath}
 const input={id:'demo',name:'示例',instructions:'./instructions.md\n  literal text',experts:['team:experts/company'],skills:['team:skills/@owner/review'],rules:['team:rules/style'],connectors:['team:connectors/search','team:connectors/cli']}
 const project=normalizeProject(input,cwd,'test',options)
 writeProject(cwd,project);assert.ok(existsSync(join(cwd,'.dsh/project.json')));assert.equal(readProject(cwd,options).instructions,input.instructions)
 assert.throws(()=>normalizeProject({...input,mcp:[]},cwd,'test',options),/unknown project field/)
 assert.throws(()=>normalizeProject({...input,skills:['review']},cwd,'test',options),/Expected source/)
 assert.throws(()=>normalizeProject({...input,rules:['team:rules/../secret']},cwd,'test',options),/Invalid capability/)
 const preview=compileProject(project,projects,{write:false});assert.equal(existsSync(cacheRoot),false);assert.match(preview.composition,/ENTRY ROLE/);assert.doesNotMatch(preview.composition,/MEMBER MUST/);assert.match(preview.composition,/\.\/instructions.md/)
 const compiled=compileProject(project,projects)
 const lock=JSON.parse(readFileSync(lockPath)).packages;assert.equal(Object.keys(lock).length,5)
 const expertPath=join(cacheRoot,lock['team:experts/company'].hash)
 assert.equal(readFileSync(join(expertPath,'skills/design/scripts/run.py'),'utf8'),'print("design")')
 const rows=parseYaml(compiled.composition)
 const servers=rows.filter(row=>row.name.endsWith('/connector-client.js'));assert.equal(servers.length,2);assert.ok(servers.every(row=>row.name.startsWith('file:///')));assert.equal(servers[1].config.transport,'stdio');assert.equal(servers[1].config.cwd,join(cacheRoot,lock['team:connectors/search'].hash))
 assert.match(compiled.composition,/process\.env\.SEARCH_TOKEN/)
 assert.match(compiled.composition,/CLI 连接器/)
 assert.match(compiled.composition,new RegExp(`${lock['team:connectors/cli'].hash}/cli\\.json`))
 assert.equal(projectModel({...project,locked:lock}).project.attachedSkillDirs.length,3)
 // Source edits/deletion do not change pinned runtime content; explicit upgrade does.
 put(join(library,'experts/company/agents/lead.md'),'NEW ENTRY ROLE')
 let pinned=normalizeProject(input,cwd,'test',{...options,locked:lock})
 assert.doesNotMatch(compileProject(pinned,projects,{write:false}).composition,/NEW ENTRY ROLE/)
 const refreshed=compileProject(pinned,projects,{refresh:true});assert.match(refreshed.composition,/NEW ENTRY ROLE/)
 const latest=JSON.parse(readFileSync(lockPath)).packages
 rmSync(join(library,'experts/company'),{recursive:true})
 assert.match(compileProject({...project,locked:latest},projects,{write:false}).composition,/NEW ENTRY ROLE/)
 // Duplicate server namespaces refuse compilation.
 json(join(library,'connectors/duplicate/mcp.json'),{mcpServers:{search:{type:'streamableHttp',url:'https://example.test/other'}}})
 assert.throws(()=>compileProject(normalizeProject({id:'collision',connectors:['team:connectors/search','team:connectors/duplicate']},cwd,'test',options),projects,{write:false}),/duplicate server/)
 // Bundle hash covers files beyond the old 500-file limit and refuses escapes.
 const many=join(root,'many');mkdirSync(many);for(let i=0;i<510;i++)put(join(many,`${i}.txt`),'a')
 const before=packageHash(many).hash;put(join(many,'509.txt'),'b');assert.notEqual(packageHash(many).hash,before)
 symlinkSync(join(root,'work'),join(many,'escape'));assert.throws(()=>packageHash(many),/symlink/)
 // Verify a real installed WorkBuddy expert without importing personal credentials.
 const real=join(homedir(),'.workbuddy/plugins/marketplaces/experts/plugins/campus-job-search-coach')
 if(existsSync(real))assert.equal(readPackage(real,'expert','campus-job-search-coach').expertType,'agent')
 console.log('PASS package catalogs, expert-team entry, attached assets, scoped skills, JSON projects, HTTP/stdio connectors, immutable versions, explicit upgrades, complete hashes and confinement')
}finally{rmSync(root,{recursive:true,force:true})}
