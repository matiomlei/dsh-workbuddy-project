import { resolvePackage } from './project.js'
import { attachedSkills, connectorServers } from './bundles.js'

/** An expert team is one expert package; only its declared entry agent is loaded. */
export function readExpert(reference,project) {
  const bundle=resolvePackage(reference,'expert',project)
  return { ...bundle,name:bundle.displayName??bundle.name,skills:attachedSkills(bundle),connectors:bundle.metadata.connectors??[] }
}
export function resolveExpertProject(project,experts) {
  const main=experts[0]
  const connectorRefs=[...new Set([...project.connectors,...(main?.connectors??[])])]
  const connectors=connectorRefs.map(reference=>resolvePackage(reference,'connector',project))
  const servers=connectors.flatMap(bundle=>bundle.native ? [{...bundle.server,connector:bundle.reference}] : connectorServers(bundle))
  const seen=new Set()
  for (const server of servers) { if (seen.has(server.name)) throw new Error(`Selected connectors declare duplicate server name ${server.name}`);seen.add(server.name) }
  return { ...project,connectorPackages:connectors,connectorServers:servers,attachedSkillDirs:[...new Set([...(main?.skills??[]),...connectors.flatMap(bundle=>bundle.native?[]:attachedSkills(bundle))])] }
}
