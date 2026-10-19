/** Shared host service for JSON projects, package catalogs and Git team libraries. */
import { Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { TeamLibraries } from './library-sync.js'
import { listCapabilities, dependencyIndex } from './catalog.js'
import { KINDS, attachedSkills, connectorServers, packageFiles, packagePath, readJson, readPackage, scanPackages } from './bundles.js'
import { describeOption, validateIcon, withCapabilityIcon } from './capability-metadata.js'
import { discoverLocalCapabilities, localSources, nativeConnectors } from './local-capabilities.js'
import { atomicJson } from './package-cache.js'
import { capabilityRoot, saveLocalPackage } from './local-capability-store.js'
import { buildTemplateDraft } from './template-draft.js'
import { compileProject, elementHashes, projectModel } from './compile.js'
import { contribute as commitContribution, confinePath, gitState } from './contribute.js'
import { previewSkill } from './local-skills.js'
import { readExpert } from './expert.js'
import { checkConnector } from './connector-diagnostics.js'
import { localMcpConfig } from './local-runtime.js'
import { CONFIG_DIR, configPath, describeLibrary, emptyProject, globalExpertsRoot, hasProject, instructionsText, normalizeProject, projectDocument, projectIdFromName, readProject, resolveLibrary, splitReference, writeProject } from './project.js'

export const Config=Schema.object({projectsRoot:Schema.string().default(''),compileOptions:Schema.boolean().default(true),libraries:Schema.array(Schema.object({
  name:Schema.string().required(),path:Schema.string().required(),repo:Schema.string(),sync:Schema.object({startup:Schema.boolean().default(false),daily:Schema.boolean().default(false),time:Schema.string().default('09:00')}),trust:Schema.union(['system','user']).default('user'),
})).default([])})

export class WorkbuddyProject extends Service {
  static inject=['tools']
  constructor(ctx,config) {
    super(ctx,'workbuddyProject');this.config=config
    this.projectsRoot=resolve(config.projectsRoot?.trim() || ctx.get?.('dshHomePath')?.('projects') || join(process.env.DSH_HOME?.trim() || join(homedir(),'.dsh'),'projects'))
    this.expertsRoot=globalExpertsRoot(this.projectsRoot)
    this.libraryManager=new TeamLibraries(this.projectsRoot,config.libraries);this.libraryRoots=this.libraryManager.entries
    this.libraryManager.onChange=entries=>{this.libraryRoots=entries}
  }
  get root() { return this.projectsRoot }
  get expertLibrary() { return this.expertsRoot }
  get roots() { return {expertsRoot:this.expertsRoot,libraries:this.libraryRoots,sources:localSources(this.ctx,dirname(this.projectsRoot)),localConnectors:nativeConnectors(this.ctx),cacheRoot:join(dirname(this.projectsRoot),'capabilities/cache')} }
  _normalize(input,cwd,source='project',extra={}) {
    const lockPath=join(this.projectsRoot,input.id??'_draft','capabilities.lock.json')
    const locked=existsSync(lockPath)?readJson(lockPath).packages??{}:{}
    return normalizeProject(input,cwd,source,{...this.roots,lockPath,locked,...extra})
  }
  _read(cwd) {
    if (!hasProject(cwd)) return undefined
    return this._normalize(readJson(configPath(cwd)),cwd,configPath(cwd))
  }
  _index() {
    const path=join(this.projectsRoot,'index.json')
    return existsSync(path)?readJson(path).projects??[]:[]
  }
  _remember(project) {
    atomicJson(join(this.projectsRoot,'index.json'),{version:1,projects:[...this._index().filter(x=>x.id!==project.id),{id:project.id,cwd:project.cwd}]})
  }
  _workspaceDirs() {
    const registry=this.ctx.get('workspaceRegistry')
    return [...new Set([process.cwd(),...(registry?.list?.()??[]).map(x=>x.path)].filter(Boolean))]
  }
  _findById(id) {
    for (const cwd of [...this._index().filter(x=>x.id===id).map(x=>x.cwd),...this._workspaceDirs()]) {
      try { const project=this._read(cwd);if(project?.id===id)return project } catch { /* list reports malformed projects */ }
    }
  }
  _load(id) { const project=this._findById(id);if(!project)throw new Error(`Unknown project ${id}`);return project }
  _summary(project) { return {...projectDocument(project),cwd:project.cwd,configPath:configPath(project.cwd),preset:{known:existsSync(join(this.projectsRoot,project.id,'agent.cordis.yml')),dir:join(this.projectsRoot,project.id)},packages:project.locked} }
  list() {
    const seen=new Map()
    for (const cwd of [...this._index().map(x=>x.cwd),...this._workspaceDirs()]) {
      try { const project=this._read(cwd);if(project)seen.set(project.id,this._summary(project)) }
      catch(error) { seen.set(cwd,{id:basename(cwd),cwd,configPath:configPath(cwd),error:error.message}) }
    }
    return [...seen.values()].sort((a,b)=>a.id.localeCompare(b.id))
  }
  get(id) { return this.describe(id).project }
  describe(id) {
    const project=this._load(id)
    let metrics={}
    try { metrics=compileProject(project,this.projectsRoot,{write:false}).metrics } catch(error) { metrics={metricsError:error.message} }
    return {project:{...this._summary(project),...metrics},instructionsContent:instructionsText(project)??'',document:readFileSync(configPath(project.cwd),'utf8'),configPath:configPath(project.cwd)}
  }
  async create(request) {
    const cwd=resolve(request.cwd??process.cwd())
    if (!existsSync(cwd)||!statSync(cwd).isDirectory())throw new Error('Project working directory must exist')
    if (hasProject(cwd))throw new Error(`This directory already has ${configPath(cwd)}; edit its project or choose another directory`)
    const id=request.id??projectIdFromName(request.name)
    if (this._findById(id))throw new Error(`Project ID ${id} is already used`)
    const input=Object.fromEntries(['name','description','instructions','experts','rules','skills','connectors'].filter(key=>request[key]!==undefined).map(key=>[key,request[key]]))
    const project=this._normalize({...input,id},cwd,'project_create')
    // Check packages and runtime configuration before writing the declaration.
    compileProject(project,this.projectsRoot,{write:false})
    mkdirSync(join(cwd,CONFIG_DIR),{recursive:true})
    for (const directory of Object.values(KINDS))mkdirSync(join(cwd,CONFIG_DIR,directory),{recursive:true})
    const path=writeProject(cwd,project);this._remember(project)
    return {...await this.apply(id,{validate:request.validate}),configPath:path}
  }
  async update(request) {
    const current=this._load(request.id)
    const input=projectDocument(current)
    for (const key of ['name','description','instructions','experts','rules','skills','connectors']) if(request[key]!==undefined)input[key]=request[key]
    const project=this._normalize(input,current.cwd,'project_update')
    compileProject(project,this.projectsRoot,{write:false})
    writeProject(project.cwd,project)
    return {...this._summary(project),...await this.apply(project.id,{validate:request.validate})}
  }
  async apply(id,options={}) {
    const project=this._load(id)
    const compiled=compileProject(project,this.projectsRoot,{write:options.preview!==true,refresh:options.refresh===true})
    const result={id,cwd:project.cwd,presetId:id,presetDir:compiled.dir,compositionPath:compiled.compositionPath,...compiled.metrics}
    if(options.preview)return {...result,preview:true,composition:compiled.composition}
    if(options.validate===false){await this.presetManager?.publish(id);return {...result,validated:false}}
    return {...result,...await this.validate(id)}
  }
  async validate(id) {
    const presets=this.ctx.get('agentPresets')
    if(!presets)return {validated:false,error:'agent-presets is not composed in this deployment'}
    try {
      if(this.presetManager)await this.presetManager.validate(id)
      else if(presets.standingKeyFor)await presets.standingKeyFor(id)
      else throw new Error('Project preset registry is not ready')
      return {validated:true}
    }catch(error){return {validated:false,error:error.message}}
  }
  async checkConnectors(id) {
    const model=projectModel(this._load(id)).project
    const checks=await Promise.all(model.connectorServers.map(server=>checkConnector(server.localSource?{...server,...localMcpConfig(this.ctx,server.localSource)}:server)))
    for(const bundle of model.connectorPackages.filter(bundle=>bundle.connectorType==='cli'))checks.push({name:bundle.displayName??bundle.name,reference:bundle.reference,status:'manual',message:'CLI 连接器通过本机终端使用，请按配套技能检查安装及登录状态。'})
    return {id,connectorChecks:checks,healthy:checks.every(check=>check.status!=='error')}
  }
  async remove(id) {
    const project=this._load(id);await this.presetManager?.remove(id)
    rmSync(configPath(project.cwd),{force:true});rmSync(join(this.projectsRoot,id),{recursive:true,force:true})
    atomicJson(join(this.projectsRoot,'index.json'),{version:1,projects:this._index().filter(x=>x.id!==id)})
    const installedPath=join(dirname(this.projectsRoot),'capabilities/installed.json')
    if(existsSync(installedPath)) {
      const installed=readJson(installedPath);delete installed.projects?.[id];atomicJson(installedPath,installed)
    }
    return {id,cwd:project.cwd,configRemoved:true}
  }
  empty(id,cwd) { return emptyProject(id,cwd) }
  _describe(entry) { return {...describeLibrary(entry),git:gitState(entry),syncStatus:this.libraryManager.status(entry.name),syncTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone} }
  libraries() { return this.libraryRoots.map(entry=>this._describe(resolveLibrary(entry))) }
  saveLibrary(config) { return this._describe(resolveLibrary(this.libraryManager.save(config))) }
  removeLibrary(name) { return this.libraryManager.remove(name) }
  syncLibrary(name) { return this.libraryManager.sync(name) }
  _libraryEntry(name) { const entry=this.libraryRoots.find(x=>x.name===name);if(!entry)throw new Error(`Library ${name} is not configured`);return resolveLibrary(entry) }
  options(cwd) {
    const dir=cwd===null?undefined:resolve(cwd??process.cwd()),home=dirname(this.projectsRoot)
    const exists=!!dir&&existsSync(dir)&&statSync(dir).isDirectory(),local=discoverLocalCapabilities(this.ctx,dir,home),libraries=this.libraries()
    const projectFor=(kind)=>exists?scanPackages(join(dir,CONFIG_DIR,KINDS[kind]),kind,'project').map(x=>describeOption(x,kind)):[]
    const shared=(kind)=>libraries.flatMap(lib=>lib[KINDS[kind]].map(item=>describeOption({...item,library:lib.name},kind)))
    return {cwd:dir,exists,hasProject:exists&&hasProject(dir),document:exists&&hasProject(dir)?readFileSync(configPath(dir),'utf8'):undefined,
      experts:{project:projectFor('expert'),library:local.experts,shared:shared('expert')},skills:{project:projectFor('skill'),local:local.skills,shared:shared('skill')},
      rules:projectFor('rule'),localRules:local.rules,sharedRules:shared('rule'),connectors:{project:projectFor('connector'),local:local.connectors,shared:shared('connector')},
      libraries,templates:this.templates(),projectsRoot:this.projectsRoot,expertsRoot:this.expertsRoot,defaultCwd:process.cwd()}
  }
  capabilities() {
    const projects=this.list().filter(project=>!project.error)
    const sources=[...this.templates().filter(x=>!x.error).map(template=>({kind:'template',id:template.id,library:template.library,keys:Object.values(KINDS).flatMap(key=>template[key]??[])})),...projects.map(project=>({kind:'project',id:project.id,keys:Object.values(KINDS).flatMap(key=>project[key]??[])}))]
    const dependencies=dependencyIndex(sources)
    const shared=this.libraryRoots.flatMap(lib=>listCapabilities(resolveLibrary(lib)).map(item=>({...item,scope:'shared',sourceLabel:`共享 · ${lib.name}`,writable:true,refs:dependencies.get(item.reference)??[]})))
    const local=discoverLocalCapabilities(this.ctx,undefined,dirname(this.projectsRoot))
    const localItems=Object.entries(KINDS).flatMap(([kind,key])=>local[key].map(item=>({...item,kind,key:item.reference,relative:`${key}/${item.name}`,library:item.reference.split(':')[0],scope:'local',sourceLabel:`本地 · ${item.reference.split(':')[0]}`,writable:item.reference.startsWith('personal:'),refs:dependencies.get(item.reference)??[]})))
    const projectItems=projects.flatMap(project=>Object.entries(KINDS).flatMap(([kind,key])=>scanPackages(join(project.cwd,CONFIG_DIR,key),kind,'project').map(item=>({...describeOption(item,kind),key:`project:${project.id}:${key}/${item.name}`,relative:`${key}/${item.name}`,library:'project',projectId:project.id,scope:'project',sourceLabel:`项目 · ${project.name??project.id}`,writable:true,refs:(dependencies.get(item.reference)??[]).filter(ref=>ref.kind==='project'&&ref.id===project.id)}))))
    return [...localItems,...projectItems,...shared]
  }
  _editableLibrary(request) {
    if(request.library==='personal')return {name:'personal',path:resolve(process.env.DSH_HOME?.trim()||dirname(this.projectsRoot)),exists:true}
    if(request.library==='project')return {name:'project',path:join(this._load(request.projectId).cwd,CONFIG_DIR),exists:true}
    throw new Error('Only local and project capabilities can be saved directly')
  }
  saveCapability(request) {
    const library=this._editableLibrary(request),changes=this._editChanges(library,request)
    return saveLocalPackage(library,changes,{create:request.create===true})
  }
  readCapability(request) {
    const entry=this.capabilities().find(item=>request.key ? item.key===request.key : item.library===request.library&&item.relative===request.path&&item.projectId===request.projectId)
    const relative=entry?.relative,target=entry?.path
    if(!entry)throw new Error('Select an existing capability package')
    if(entry.native)return {...entry,files:[],content:JSON.stringify({name:entry.displayName,description:entry.description},null,2),readOnly:true}
    const files=packageFiles(target).map(file=>file.relative),fallback={expert:'.codebuddy-plugin/plugin.json',skill:'SKILL.md',rule:'RULE.md',connector:files.includes('mcp.json')?'mcp.json':'cli.json'}[entry.kind],file=request.file??entry.documentFile??fallback
    if(!files.includes(file))throw new Error('Requested file is outside the package')
    if(statSync(packagePath(target,file)).size>1024*1024)throw new Error('Selected file exceeds the editor limit')
    return {key:entry.key,projectId:entry.projectId,scope:entry.scope,readOnly:!entry.writable,library:entry.library,path:`${relative}/${file}`,package:relative,selected:file,files,content:readFileSync(packagePath(target,file),'utf8'),icon:entry.icon,iconUrl:entry.iconUrl,kind:entry.kind}
  }
  contribute(request) {
    if(this.libraryManager.isBusy(request.library))throw new Error('资源库正在同步，请等待完成后提交修改')
    const library=this._libraryEntry(request.library),changes=this._editChanges(library,request)
    return commitContribution(library,{...request,changes})
  }
  _editChanges(library,request) {
    const changes=request.changes.map(change=>({...change}))
    const affected=new Map()
    for (const change of [...changes]) {
      const {relative}=confinePath(library.path,change.path)
      const {root:bundleRoot,kind,id}=capabilityRoot(library,relative)
      affected.set(bundleRoot,{kind,id})
      if(change.icon!==undefined) {
        const icon=validateIcon(change.icon)
        if(kind==='expert'||kind==='connector') {
          const metaPath=`${bundleRoot}/${kind==='expert'?'.codebuddy-plugin/plugin.json':'connector.json'}`
          let meta=changes.find(x=>x.path===metaPath)
          if(!meta) {meta={path:metaPath,content:existsSync(join(library.path,metaPath))?readFileSync(join(library.path,metaPath),'utf8'):JSON.stringify(kind==='expert'?{name:id,version:'1.0.0',expertType:'agent',agentName:id,agents:[`./agents/${id}.md`]}:{id,name:id,type:relative.endsWith('cli.json')?'cli':'mcp'})};changes.push(meta)}
          meta.content=withCapabilityIcon(meta.content,kind,icon)
        } else change.content=withCapabilityIcon(change.content,kind,icon)
      }
      if(kind==='expert'&&!existsSync(join(library.path,bundleRoot,'.codebuddy-plugin/plugin.json'))&&!changes.some(x=>x.path===`${bundleRoot}/.codebuddy-plugin/plugin.json`)) {
        changes.push({path:`${bundleRoot}/.codebuddy-plugin/plugin.json`,content:JSON.stringify({name:id,displayName:id,version:'1.0.0',expertType:'agent',agentName:id,agents:[`./agents/${id}.md`]},null,2)+'\n'})
      }
      if(kind==='connector'&&!existsSync(join(library.path,bundleRoot,'connector.json'))&&!changes.some(x=>x.path===`${bundleRoot}/connector.json`)) {
        changes.push({path:`${bundleRoot}/connector.json`,content:JSON.stringify({id,name:id,version:'1.0.0',type:relative.endsWith('cli.json')?'cli':'mcp'},null,2)+'\n'})
      }
    }
    const staging=mkdtempSync(join(tmpdir(),'wb-package-edit-'))
    try {
      for(const [bundleRoot,{kind,id}] of affected) {
        const src=join(library.path,bundleRoot),dest=join(staging,bundleRoot);mkdirSync(dest,{recursive:true})
        if(existsSync(src))for(const file of packageFiles(src)){const path=join(dest,file.relative);mkdirSync(dirname(path),{recursive:true});copyFileSync(file.path,path)}
        for(const change of changes.filter(x=>x.path.startsWith(`${bundleRoot}/`))){const path=join(staging,change.path);if(change.delete)rmSync(path,{force:true});else{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,change.content)}}
        const bundle=readPackage(dest,kind,id);if(kind==='connector')connectorServers(bundle);if(kind==='expert'||kind==='connector')attachedSkills(bundle)
      }
    }finally{rmSync(staging,{recursive:true,force:true})}
    return changes
  }
  _readTemplate(entry) {
    return this._normalize(readJson(entry.configPath),entry.path,entry.configPath,{assetRoot:entry.path,locked:{},lockPath:undefined})
  }
  templates() {
    const out=[]
    for(const library of this.libraryRoots) {
      const dir=join(library.path,'projects');if(!existsSync(dir))continue
      for(const id of readdirSync(dir).sort()) {
        const path=join(dir,id),configPath=join(path,'project.json');if(!existsSync(configPath))continue
        const entry={id,library:library.name,kind:'template',path,configPath}
        try {const project=this._readTemplate(entry);if(project.id!==id)throw new Error('Template ID must match its directory');out.push({...entry,...projectDocument(project)})}
        catch(error){out.push({...entry,error:error.message})}
      }
    }
    return out
  }
  _template(reference) {
    const {library,name}=splitReference(reference),entry=this.templates().find(x=>x.library===library&&x.id===name)
    if(!entry)throw new Error(`Unknown project template ${reference}`);if(entry.error)throw new Error(entry.error);return entry
  }
  templateDraft(reference) {
    const entry=this._template(reference),project=this._readTemplate(entry),draft=buildTemplateDraft(project,entry)
    for(const [kind,key] of Object.entries(KINDS))draft.options[key]=scanPackages(join(entry.path,key),kind,'project').map(item=>describeOption(item,kind))
    // Resolve every selected package before returning a ready-to-use draft.
    projectModel(project)
    return draft
  }
  async createFromTemplate(request) {
    const entry=this._template(request.template),source=this._readTemplate(entry),target=resolve(request.cwd)
    if(hasProject(target))throw new Error('The target directory already has a project')
    const edits=Object.fromEntries(['name','description','instructions','experts','rules','skills','connectors'].filter(key=>request.config?.[key]!==undefined).map(key=>[key,request.config[key]]))
    const input={...projectDocument(source),...edits,id:request.config?.id??projectIdFromName(request.config?.name??source.name)}
    this._normalize(input,target,'template create')
    for(const key of Object.values(KINDS)) {
      const root=join(entry.path,key);if(!existsSync(root))continue
      for(const file of packageFiles(root)) {
        const destination=join(target,CONFIG_DIR,key,file.relative)
        if(existsSync(destination)&&!readFileSync(destination).equals(readFileSync(file.path)))throw new Error(`Template would overwrite ${destination}`)
      }
    }
    mkdirSync(target,{recursive:true})
    for(const key of Object.values(KINDS)) {
      const root=join(entry.path,key);if(!existsSync(root))continue
      for(const file of packageFiles(root)){const destination=join(target,CONFIG_DIR,key,file.relative);mkdirSync(dirname(destination),{recursive:true});copyFileSync(file.path,destination)}
    }
    const result=await this.create({...input,cwd:target,validate:request.validate})
    atomicJson(join(target,CONFIG_DIR,'template.json'),{library:entry.library,id:entry.id})
    return {...result,template:{library:entry.library,id:entry.id,path:entry.path}}
  }
  expertDefinition(request) {
    const cwd=resolve(request.cwd??process.cwd()),template=this.templates().find(entry=>entry.path===cwd)
    const project=this._normalize({id:'expert-preview',experts:[request.expert]},cwd,'expert preview',{locked:{},...(template?{assetRoot:template.path}:{})})
    const expert=readExpert(request.expert,project)
    return {reference:expert.reference,path:expert.path,name:expert.name,text:expert.text,skills:expert.skills,connectors:expert.connectors,expertType:expert.expertType}
  }
  previewSkill(request) {
    const options=this.options(request.cwd),templateSkills=this.templates().flatMap(entry=>scanPackages(join(entry.path,'skills'),'skill','project')),allowed=[...options.skills.project,...options.skills.local,...options.skills.shared,...templateSkills].map(x=>resolve(x.path))
    if(!allowed.includes(resolve(request.directory)))throw new Error('Select a discovered skill package')
    return previewSkill(request.directory,request.file)
  }
}
