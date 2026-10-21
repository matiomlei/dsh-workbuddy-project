/** Immutable successful execution checkpoints; recovery never infers missing outputs. */
import { ContractError, canonical, digest } from './template-store.mjs'
import { buildQualityEvidence } from './quality-ledger.mjs'
const fail = code => { throw new ContractError(code, code) }
const plain = value => JSON.parse(JSON.stringify(value))
export class RunCheckpoints {
  constructor(db) {
    this.db=db
    db.exec(`CREATE TABLE IF NOT EXISTS execution_checkpoints(request_id TEXT NOT NULL,node_id TEXT NOT NULL,attempt INTEGER NOT NULL,digest TEXT NOT NULL,document_json TEXT NOT NULL,PRIMARY KEY(request_id,node_id,attempt));
      CREATE TRIGGER IF NOT EXISTS execution_checkpoints_no_update BEFORE UPDATE ON execution_checkpoints BEGIN SELECT RAISE(ABORT,'immutable execution checkpoint'); END;
      CREATE TRIGGER IF NOT EXISTS execution_checkpoints_no_delete BEFORE DELETE ON execution_checkpoints BEGIN SELECT RAISE(ABORT,'immutable execution checkpoint'); END;`)
  }
  list(requestId) {
    return this.db.prepare('SELECT * FROM execution_checkpoints WHERE request_id=? ORDER BY rowid').all(requestId).map(row=>{
      const checkpoint=JSON.parse(row.document_json)
      if(digest(checkpoint)!==row.digest||checkpoint.requestId!==requestId||checkpoint.nodeId!==row.node_id||checkpoint.attempt!==row.attempt)fail('CHECKPOINT_CHANGED')
      return {...checkpoint,digest:row.digest}
    })
  }
  put({requestId,businessRunId,nodeId,attempt,handoff,artifacts,result}) {
    const document=plain({schemaVersion:1,requestId,businessRunId,nodeId,attempt,handoff,artifacts,result:{output:result.output,structuredOutput:result.structuredOutput,extra:result.extra??{}}})
    const hash=digest(document), prior=this.list(requestId).find(item=>item.nodeId===nodeId&&item.attempt===attempt)
    if(prior){if(prior.digest!==hash)fail('CHECKPOINT_CHANGED');return prior}
    this.db.prepare('INSERT INTO execution_checkpoints VALUES(?,?,?,?,?)').run(requestId,nodeId,attempt,hash,canonical(document))
    return {...document,digest:hash}
  }
}
export function recoveryPlan({job,manifest,checkpoints,subjects}) {
  const reasons=[], completed=[], waiting=[], unstarted=[], selected={}
  if(!manifest||!job.preparationComplete)reasons.push({code:'PREPARATION_NOT_CHECKPOINTED',nodeId:null})
  const policies=new Set((manifest?.definition.qualityPolicies??[]).map(item=>item.nodeId)),graph=manifest?.definition.graph??{nodes:[],edges:[]}
  for(const node of graph.nodes){
    const attempts=job.codeAttempts?.[node.id]??[],latest=attempts.at(-1),cp=checkpoints.find(item=>item.nodeId===node.id&&item.attempt===latest?.attempt)
    if(!latest){unstarted.push(node.id);continue}
    if(!cp||latest.status!=='ready'){reasons.push({code:'EXECUTION_OUTCOME_UNCERTAIN',nodeId:node.id});continue}
    if(cp.businessRunId!==manifest.businessRunId||canonical(cp.handoff)!==canonical(job.codeHandoffs?.[node.id]??null)||canonical(cp.artifacts)!==canonical((job.artifacts??[]).filter(item=>item.nodeId===node.id))){reasons.push({code:'CHECKPOINT_HANDOFF_MISMATCH',nodeId:node.id});continue}
    if(cp.result.extra.artifacts?.length){reasons.push({code:'NATIVE_ARTIFACT_RECOVERY_NOT_READY',nodeId:node.id});continue}
    selected[node.id]=cp
    if(!policies.has(node.id)){completed.push(node.id);continue}
    const subject=subjects.find(item=>item.evidence.nodeId===node.id&&item.evidence.attempt===cp.attempt)
    const expected=buildQualityEvidence({...cp,template:manifest.template})
    if(subject&&(digest(subject.evidence)!==subject.digest||canonical(subject.evidence)!==canonical(expected)||!subject.reviews.length)){reasons.push({code:'QUALITY_CHECKPOINT_MISMATCH',nodeId:node.id});continue}
    if(subject?.status==='passed')completed.push(node.id)
    else waiting.push(node.id)
  }
  // A recorded consumer can only exist after all its required parents were admitted.
  for(const id of Object.keys(selected))for(const edge of graph.edges.filter(edge=>edge.target===id))if(!completed.includes(edge.source))reasons.push({code:'RECOVERY_DEPENDENCY_MISMATCH',nodeId:id})
  const document={businessRunId:manifest?.businessRunId??null,nativeRunId:job.nativeRunId,template:manifest?.template??null,completed,waiting,unstarted,reasons,checkpoints:Object.values(selected).map(cp=>({nodeId:cp.nodeId,attempt:cp.attempt,digest:cp.digest})),quality:subjects.map(s=>({id:s.id,digest:s.digest,status:s.status,reviewId:s.reviews.at(-1)?.id??null}))}
  return {...document,eligible:reasons.length===0,digest:digest(document)}
}
export const checkpointResult = checkpoint => ({...checkpoint.result.extra,output:checkpoint.result.output,structuredOutput:checkpoint.result.structuredOutput})
