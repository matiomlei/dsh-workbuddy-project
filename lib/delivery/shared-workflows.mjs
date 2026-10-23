/** Portable workflow recipes live alongside capability packages in Git libraries. */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { relativeInside } from '../native-path.js'
import { ContractError, digest, validateDefinition } from './template-store.mjs'

export function freezeWorkflowRecipe(recipe, library, capabilities) {
  const definition=structuredClone(recipe.definition ?? recipe)
  const bindings=recipe.bindings ?? definition.nodeBindings ?? []
  const hashes=Object.fromEntries(capabilities.catalog().map(item=>[item.reference,item.hash]))
  if(bindings.length)definition.nodeBindings=bindings.map(binding=>({
    schemaVersion:1,nodeId:binding.nodeId,repositoryRole:binding.repositoryRole,
    ...capabilities.freeze(Object.fromEntries(['experts','skills','rules','connectors'].map(kind=>[kind,(binding.capabilities?.[kind]??[]).map(ref=>ref.includes(':')?ref:library+':'+ref.replace(/^\.\//,''))])),hashes),
  }))
  return validateDefinition(definition)
}

export function sharedWorkflows(libraries, capabilities) {
  function scan() {
    const result=[]
    for(const library of libraries()) {
      const directory=join(library.path,'workflows')
      if(!existsSync(directory))continue
      const root=realpathSync(library.path)
      if(relativeInside(root,realpathSync(directory))===undefined)continue
      for(const entry of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
        const file=entry.isDirectory()?join(directory,entry.name,'workflow.json'):entry.isFile()&&entry.name.endsWith('.json')?join(directory,entry.name):null
        if(!file||!existsSync(file))continue
        const reference=library.name+':workflows/'+entry.name.replace(/\.json$/,'')
        try {
          if(relativeInside(root,realpathSync(file))===undefined)throw new Error('模板文件不在资源库目录内')
          if(statSync(file).size>2*1024*1024)throw new Error('模板超过 2 MB')
          const recipe=JSON.parse(readFileSync(file,'utf8')),hash=digest(recipe)
          // Validate the graph here; capability locks are created when selected.
          validateDefinition({...recipe.definition,nodeBindings:[]})
          if(typeof recipe.name!=='string'||!recipe.name.trim())throw new Error('模板缺少名称')
          result.push({reference,library:library.name,name:recipe.name,description:recipe.description??'',version:recipe.version??null,hash,recipe})
        } catch(error) {result.push({reference,library:library.name,name:entry.name,error:error.message})}
      }
    }
    return result
  }
  return {
    catalog:()=>scan().map(({recipe,...item})=>item),
    select(reference,expectedHash) {
      const item=scan().find(item=>item.reference===reference)
      if(!item||item.error)throw new ContractError('SHARED_WORKFLOW_UNAVAILABLE',item?.error??'资源库模板已不可用，请刷新列表')
      if(item.hash!==expectedHash)throw new ContractError('SHARED_WORKFLOW_CHANGED','资源库模板已更新，请刷新后重新选择')
      return {name:item.name,definition:freezeWorkflowRecipe(item.recipe,item.library,capabilities),source:{library:item.library,reference:item.reference,hash:item.hash,version:item.version}}
    },
  }
}
