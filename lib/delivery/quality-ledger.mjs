/** Provider-neutral experimental completion records. No hook or reviewer protocol. */
import { randomUUID } from 'node:crypto'
import { ContractError, canonical, digest } from './template-store.mjs'
const fail = code => { throw new ContractError(code, code) }
const plain = value => JSON.parse(JSON.stringify(value))
export function buildQualityEvidence({requestId,businessRunId,template,nodeId,attempt,handoff,artifacts,result}) {
  return plain({schemaVersion:1,requestId,businessRunId,template,nodeId,attempt,
    repositories:handoff.repositories.map(({alias,inputCommit,outputCommit,sources})=>({alias,inputCommit,outputCommit,sources})),
    artifacts:artifacts.map(({id,repository,name,change,sha256,outputCommit})=>({id,repository,name,change,sha256,outputCommit})),
    output:result.output,structuredOutput:result.structuredOutput})
}
export class QualityLedger {
  constructor(db) {
    this.db = db
    db.exec(`CREATE TABLE IF NOT EXISTS quality_subjects(id TEXT PRIMARY KEY,request_id TEXT NOT NULL,node_id TEXT NOT NULL,attempt INTEGER NOT NULL,digest TEXT NOT NULL,document_json TEXT NOT NULL,UNIQUE(request_id,node_id,attempt));
      CREATE TABLE IF NOT EXISTS quality_reviews(id TEXT PRIMARY KEY,subject_id TEXT NOT NULL REFERENCES quality_subjects(id),sequence INTEGER NOT NULL,document_json TEXT NOT NULL,UNIQUE(subject_id,sequence));
      CREATE TABLE IF NOT EXISTS quality_decisions(id TEXT PRIMARY KEY,review_id TEXT NOT NULL UNIQUE REFERENCES quality_reviews(id),intent_hash TEXT NOT NULL,document_json TEXT NOT NULL);`)
    for (const table of ['quality_subjects', 'quality_reviews', 'quality_decisions']) for (const op of ['UPDATE','DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${op.toLowerCase()} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'immutable quality evidence'); END;`)
  }
  rows(sql, ...args) { return this.db.prepare(sql).all(...args).map(row => JSON.parse(row.document_json)) }
  subject(id) { const result=this.rows('SELECT document_json FROM quality_subjects WHERE id=?',id)[0]; if(!result)fail('QUALITY_SUBJECT_NOT_FOUND');return result }
  review(id) { const result=this.rows('SELECT document_json FROM quality_reviews WHERE id=?',id)[0]; if(!result)fail('QUALITY_REVIEW_NOT_FOUND');return result }
  current(subjectId) { const reviews=this.rows('SELECT document_json FROM quality_reviews WHERE subject_id=? ORDER BY sequence',subjectId);return reviews.at(-1) ?? null }
  decision(reviewId) { return this.rows('SELECT document_json FROM quality_decisions WHERE review_id=?',reviewId)[0] ?? null }
  create({ requestId, businessRunId, template, nodeId, attempt, handoff, artifacts, result }) {
    const existing=this.rows('SELECT document_json FROM quality_subjects WHERE request_id=? AND node_id=? AND attempt=?',requestId,nodeId,attempt)[0]
    const evidence=buildQualityEvidence({requestId,businessRunId,template,nodeId,attempt,handoff,artifacts,result})
    const hash=digest(evidence)
    if(existing){if(existing.digest!==hash)fail('QUALITY_SUBJECT_CHANGED');return existing}
    const subject={id:'quality_subject_'+randomUUID(),digest:hash,evidence,createdAt:new Date().toISOString()}
    this.db.prepare('INSERT INTO quality_subjects VALUES(?,?,?,?,?,?)').run(subject.id,requestId,nodeId,attempt,hash,canonical(subject))
    this.open(subject.id,null)
    return subject
  }
  open(subjectId, expectedReviewId) {
    this.subject(subjectId)
    const previous=this.current(subjectId)
    if(previous?.id !== (expectedReviewId ?? undefined))fail('QUALITY_REVIEW_CONFLICT')
    if(previous && this.decision(previous.id)?.outcome!=='failed')fail('QUALITY_RECHECK_NOT_ALLOWED')
    const review={id:'quality_review_'+randomUUID(),subjectId,sequence:(previous?.sequence??0)+1,createdAt:new Date().toISOString()}
    this.db.prepare('INSERT INTO quality_reviews VALUES(?,?,?,?)').run(review.id,subjectId,review.sequence,canonical(review))
    return review
  }
  prior(intent) {
    const row=this.db.prepare('SELECT * FROM quality_decisions WHERE id=?').get(intent.decisionId)
    if(!row)return null
    if(row.intent_hash!==digest(intent))fail('QUALITY_DECISION_CONFLICT')
    return JSON.parse(row.document_json)
  }
  decide(intent) {
    const prior=this.prior(intent);if(prior)return prior
    if(typeof intent.decisionId!=='string'||!intent.decisionId.trim()||!['passed','failed'].includes(intent.outcome)||typeof intent.note!=='string'||!intent.note.trim()||intent.note.length>2000)fail('INVALID_QUALITY_DECISION')
    const subject=this.subject(intent.subjectId),review=this.review(intent.reviewId)
    if(subject.digest!==intent.subjectDigest || subject.evidence.requestId!==intent.requestId || subject.evidence.nodeId!==intent.nodeId || subject.evidence.attempt!==intent.attempt)fail('QUALITY_SUBJECT_MISMATCH')
    if(review.subjectId!==subject.id||this.current(subject.id)?.id!==review.id)fail('QUALITY_REVIEW_CONFLICT')
    if(this.decision(review.id))fail('QUALITY_REVIEW_CLOSED')
    const decision={...intent,recordedAt:new Date().toISOString(),source:'local-user'}
    this.db.prepare('INSERT INTO quality_decisions VALUES(?,?,?,?)').run(intent.decisionId,review.id,digest(intent),canonical(decision))
    return decision
  }
  list(requestId) {
    return this.rows('SELECT document_json FROM quality_subjects WHERE request_id=? ORDER BY rowid',requestId).map(subject=>{
      const reviews=this.rows('SELECT document_json FROM quality_reviews WHERE subject_id=? ORDER BY sequence',subject.id).map(review=>({...review,decision:this.decision(review.id)}))
      return {...subject,reviews,status:reviews.at(-1)?.decision?.outcome??'pending'}
    })
  }
}
