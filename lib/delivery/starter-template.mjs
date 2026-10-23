/** Resolve the portable starter recipe through the same capability snapshot compiler. */
import { readFileSync } from 'node:fs'
import { freezeWorkflowRecipe } from './shared-workflows.mjs'
export function createStarter(capabilities) {
  const recipe = JSON.parse(readFileSync(new URL('../../examples/software-delivery/library/workflows/software-delivery/workflow.json',import.meta.url),'utf8'))
  return {name:recipe.name,definition:freezeWorkflowRecipe(recipe,'delivery-starter',capabilities),source:{starter:recipe.id,version:recipe.version}}
}
