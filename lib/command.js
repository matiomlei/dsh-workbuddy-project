import { resolve } from 'node:path'
export const COMMAND_NAME='project'
const USAGE=`/project list | show <id> | apply <id> | upgrade <id> | preview <id> | remove <id>
/project library | template
/project init <名称>
/project init --template <库:id> --cwd <目录>
完整配置请使用「设置 → 项目」。`
export function projectCommand(service) {
  return {name:COMMAND_NAME,description:'管理项目与能力库',input:{hint:USAGE},async handler(invocation){
    const [action='list',...args]=invocation.rawInput.trim().split(/\s+/).filter(Boolean)
    try {
      let value
      const id=args[0]
      switch(action) {
        case 'list':value=service.list();break
        case 'show':value=service.describe(id);break
        case 'apply':value=await service.apply(id);break
        case 'upgrade':value=await service.apply(id,{refresh:true});break
        case 'preview':value=await service.apply(id,{preview:true});break
        case 'remove':value=await service.remove(id);break
        case 'library':value=service.libraries();break
        case 'template':value=service.templates();break
        case 'init': {
          const base=invocation.agent?.session?.header?.cwd??process.cwd()
          const templateAt=args.indexOf('--template'),cwdAt=args.indexOf('--cwd'),cwd=cwdAt<0?resolve(base):resolve(base,args[cwdAt+1]??'')
          if(templateAt>=0)value=await service.createFromTemplate({template:args[templateAt+1],cwd})
          else {const name=args.join(' ').trim();if(!name)throw new Error('需要项目名称');value=await service.create({name,cwd})}
          break
        }
        default:return {kind:'success',text:USAGE}
      }
      return {kind:value?.error?'error':'success',text:JSON.stringify(value,null,2)}
    } catch(error) {return {kind:'error',text:error.message}}
  }}
}
