/** Resolve the portable starter recipe through the same capability snapshot compiler. */
import { readFileSync } from 'node:fs'
import { validateDefinition } from './template-store.mjs'
export function createStarter(capabilities) {
  const recipe = JSON.parse(readFileSync(new URL('../../examples/software-delivery/template.json',import.meta.url),'utf8'))
  const expectedHashes = Object.fromEntries(capabilities.catalog().map(item=>[item.reference,item.hash]))
  const definition = {...recipe.definition,nodeBindings:recipe.bindings.map(binding=>({
    schemaVersion:1,nodeId:binding.nodeId,repositoryRole:binding.repositoryRole,
    ...capabilities.freeze(binding.capabilities,expectedHashes),
  }))}
  return {name:recipe.name,definition:validateDefinition(definition),source:{starter:recipe.id,version:recipe.version}}
}
