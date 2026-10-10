/** Host administration tools share the same JSON project/package model as the page. */
import { isAbsolute, resolve } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
const list=(description)=>({type:'array',items:{type:'string'},description})
const fields={
  id:{type:'string',description:'Stable project ID'},name:{type:'string'},description:{type:'string'},instructions:{type:'string',description:'Literal project instructions; paths are never read'},
  experts:list('Expert package IDs, e.g. team:experts/software-company. First is the main expert; a team package is one expert.'),
  rules:list('Rule package IDs, e.g. team:rules/engineering'),skills:list('Skill package IDs, e.g. team:skills/commit-message'),connectors:list('Connector package IDs, e.g. team:connectors/search'),
  validate:{type:'boolean',description:'Mount-validate the compiled project (default true)'},
}
const output={schema:{type:'object',additionalProperties:true,properties:{ok:{type:'boolean'}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value,null,2)}]}
const clean=(value)=>JSON.parse(JSON.stringify(value))
export function projectTools(service) {
  const tool=(name,description,parameters,execute)=>defineTool({name,description,parameters,output,async execute(args,exec){return clean({ok:true,...await execute(args,exec)})}})
  return [
    tool('project_create','Create a project with .dsh/project.json and compile a preset using selected capability packages. A running session is unchanged.',{
      ...fields,cwd:{type:'string',description:'Working directory; must exist unless creating from a template'},template:{type:'string',description:'Template as library:id; supplied fields override its defaults'},
    },async(args,exec)=>{
      const base=exec.agent?.session?.header?.cwd??process.cwd(),cwd=args.cwd?isAbsolute(args.cwd)?resolve(args.cwd):resolve(base,args.cwd):resolve(base)
      if(args.template)return service.createFromTemplate({template:args.template,cwd,config:Object.fromEntries(Object.keys(fields).filter(key=>key!=='validate'&&args[key]!==undefined).map(key=>[key,args[key]])),validate:args.validate})
      return service.create({...args,cwd})
    }),
    tool('project_update','Update project fields. Empty arrays clear selections; omitted fields retain their values. Package versions remain pinned until explicitly refreshed.',{...fields,id:{type:'string',required:true}},args=>service.update(args)),
    tool('project_list','List registered JSON projects and compiled preset status.',{},async()=>({projects:service.list()})),
    tool('template_list','List projects/<template>/project.json in configured team libraries.',{},async()=>({templates:service.templates()})),
    tool('capability_list','List complete expert, skill, rule and connector packages in team libraries.',{},async()=>({capabilities:service.capabilities()})),
    tool('project_apply','Compile and validate a project. Preview performs no writes. Refresh explicitly upgrades selected packages to the latest source content.',{
      id:{type:'string',required:true},preview:{type:'boolean'},refresh:{type:'boolean'},validate:{type:'boolean'},
    },args=>service.apply(args.id,args)),
    tool('library_contribute','Validate complete capability packages, commit file edits to a new branch and push for review. Does not merge.',{
      library:{type:'string',required:true},changes:{type:'array',required:true,items:{type:'object',additionalProperties:false,properties:{path:{type:'string',required:true},content:{type:'string'},delete:{type:'boolean'},icon:{type:'string'}}}},message:{type:'string'},branch:{type:'string'},
    },async args=>service.contribute(args)),
  ]
}
