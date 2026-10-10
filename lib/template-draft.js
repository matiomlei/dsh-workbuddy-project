import { projectDocument } from './project.js'
/** Templates use the same qualified IDs and inline instructions as projects. */
export function buildTemplateDraft(project,template) {
  const {id,version,...config}=projectDocument(project)
  return {template:`${template.library}:${template.id}`,cwd:project.cwd,config,options:{experts:[],skills:[],rules:[],connectors:[]}}
}
