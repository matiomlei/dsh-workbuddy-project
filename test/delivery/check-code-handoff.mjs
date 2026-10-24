/** Actual Git 2.23-compatible merge and snapshot behavior; disposable repositories only. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, chmodSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeCodeStores, createNodeWorktrees, prepareCodeInput, snapshotCodeOutput, snapshotGit as git } from '../../lib/delivery/code-handoff.mjs'
const root = mkdtempSync(join(tmpdir(), 'dsh-code-handoff.')), source = join(root, 'source'), runRoot = join(root, 'run')
mkdirSync(source); await git(source, ['init', '--quiet'])
for (const [file, text] of [['shared.txt','BASE\n'],['remove.txt','DELETE_ME'],['mode.sh','echo test\n'],['.gitignore','ignored.txt\n']]) writeFileSync(join(source,file),text)
await git(source,['add','.']); await git(source,['commit','--quiet','-m','base'])
const base = await git(source,['rev-parse','HEAD']), repositories=await initializeCodeStores(runRoot,[{alias:'source',path:source,commit:base}]), handoffs={}, states={}
const graph={nodes:[],edges:[]}, worlds={}
const checks=[]
async function prepare(id,parents=[],attempt=1) {
  const node={id,type:'agent'};graph.nodes.push(node)
  for(const parent of parents)if(!graph.edges.some(e=>e.source===parent&&e.target===id))graph.edges.push({source:parent,target:id})
  worlds[id]??=await createNodeWorktrees(join(runRoot,'nodes',id),repositories)
  return {node,inputs:await prepareCodeInput({runRoot,node,repositories,graph,nodeStates:states,handoffs,worktrees:worlds[id],attempt}),worktrees:worlds[id],attempt}
}
async function finish(prepared) {
  const result=await snapshotCodeOutput({runRoot,repositories,...prepared})
  handoffs[prepared.node.id]={status:'ready',repositories:result.repositories};states[prepared.node.id]={status:'success'}
  return result
}
const coder=await prepare('coder'),cwd=coder.worktrees.source
writeFileSync(join(cwd,'app.cjs'),'module.exports = () => "UPSTREAM_CODE_V1";\n')
writeFileSync(join(cwd,'binary.bin'),Buffer.from([0,1,2,255]))
unlinkSync(join(cwd,'remove.txt'));chmodSync(join(cwd,'mode.sh'),0o755)
const snapshot=await finish(coder), tester=await prepare('tester',['coder'])
assert.ok(readFileSync(join(tester.worktrees.source,'app.cjs'),'utf8').includes('UPSTREAM_CODE_V1'))
assert.deepEqual(readFileSync(join(tester.worktrees.source,'binary.bin')),Buffer.from([0,1,2,255]));assert.equal(existsSync(join(tester.worktrees.source,'remove.txt')),false)
assert.ok(statSync(join(tester.worktrees.source,'mode.sh')).mode&0o111)
assert.equal(tester.inputs[0].inputCommit,snapshot.repositories[0].outputCommit)
assert.equal(await git(source,['rev-parse','HEAD']),base);assert.equal(existsSync(join(source,'app.cjs')),false)
assert.equal(existsSync(join(source,'.git/worktrees')),false)
checks.push({name:'serial transfer carries new files, binary bytes, deletion and executable mode without changing source checkout or worktree metadata',passed:true})
const left=await prepare('left',['coder']),right=await prepare('right',['coder'])
writeFileSync(join(left.worktrees.source,'left.txt'),'LEFT');writeFileSync(join(right.worktrees.source,'right.txt'),'RIGHT')
await Promise.all([finish(left),finish(right)])
const joined=await prepare('joined',['left','right']);assert.equal(readFileSync(join(joined.worktrees.source,'left.txt'),'utf8'),'LEFT');assert.equal(readFileSync(join(joined.worktrees.source,'right.txt'),'utf8'),'RIGHT')
await finish(joined)
checks.push({name:'independent parallel changes merge in a run-owned integration worktree',passed:true})
const diamond=await prepare('diamond',['coder','joined']);assert.equal(diamond.inputs[0].inputCommit,handoffs.joined.repositories[0].outputCommit);await finish(diamond)
checks.push({name:'ancestor and diamond inputs are deduplicated instead of reapplying the same changes',passed:true})
const conflictA=await prepare('conflictA'),conflictB=await prepare('conflictB')
writeFileSync(join(conflictA.worktrees.source,'shared.txt'),'CHANGE_A\n');writeFileSync(join(conflictB.worktrees.source,'shared.txt'),'CHANGE_B\n')
await Promise.all([finish(conflictA),finish(conflictB)])
await assert.rejects(()=>prepare('conflict',['conflictA','conflictB']),error=>error.code==='CODE_MERGE_CONFLICT'&&error.handoffBlocked&&error.files.includes('shared.txt'))
assert.equal(readFileSync(join(worlds.conflict.source,'shared.txt'),'utf8'),'BASE\n')
checks.push({name:'conflicting parallel edits identify the file and never copy conflict markers into the consumer worktree',passed:true})
const a=await prepare('missing');states.missing={status:'success'}
await assert.rejects(()=>prepare('missingConsumer',['missing']),error=>error.code==='CODE_INPUT_NOT_READY')
states.missing={status:'error'};await assert.rejects(()=>prepare('failedConsumer',['missing']),error=>error.code==='CODE_INPUT_NOT_READY')
checks.push({name:'missing or failed parent evidence cannot become a code input',passed:true})
const archived=snapshot.artifacts.find(item=>item.name==='app.cjs');writeFileSync(join(cwd,'app.cjs'),'MUTATED_LIVE_FILE')
assert.ok(readFileSync(archived.path,'utf8').includes('UPSTREAM_CODE_V1'))
assert.ok(snapshot.artifacts.some(item=>item.name==='remove.txt'&&item.change==='deleted'))
checks.push({name:'node artifacts are captured from immutable Git blobs before downstream admission, with deletion records',passed:true})
const retry=await prepare('retry',['coder']);writeFileSync(join(retry.worktrees.source,'partial.txt'),'PARTIAL');writeFileSync(join(retry.worktrees.source,'ignored.txt'),'PARTIAL_IGNORED')
const retryAgain=await prepare('retry',['coder'],2)
assert.equal(existsSync(join(retryAgain.worktrees.source,'partial.txt')),false);assert.equal(existsSync(join(retryAgain.worktrees.source,'ignored.txt')),false)
assert.ok(readFileSync(join(retryAgain.worktrees.source,'app.cjs'),'utf8').includes('UPSTREAM_CODE_V1'))
checks.push({name:'retry resets only run-owned worktrees to the accepted input and removes failed-attempt leftovers',passed:true})
const batch=await prepare('batch'),batchCwd=batch.worktrees.source
mkdirSync(join(batchCwd,'generated'))
for(let i=0;i<120;i++)writeFileSync(join(batchCwd,'generated',`module-${i}.txt`),`MODULE_${i}\n`)
writeFileSync(join(batchCwd,'shared.txt'),'BATCH_UPDATE\n');unlinkSync(join(batchCwd,'remove.txt'))
const batchSnapshot=await finish(batch)
assert.equal(batchSnapshot.artifacts.length,122)
assert.equal(batchSnapshot.artifacts.filter(item=>item.change==='deleted').length,1)
for(let i=0;i<120;i++) {
  const artifact=batchSnapshot.artifacts.find(item=>item.name===`generated/module-${i}.txt`)
  assert.ok(artifact);assert.equal(readFileSync(artifact.path,'utf8'),`MODULE_${i}\n`)
}
const batchConsumer=await prepare('batchConsumer',['batch'])
assert.equal(batchConsumer.inputs[0].inputCommit,batchSnapshot.repositories[0].outputCommit)
for(let i=0;i<120;i++)assert.equal(readFileSync(join(batchConsumer.worktrees.source,'generated',`module-${i}.txt`),'utf8'),`MODULE_${i}\n`)
assert.equal(readFileSync(join(batchConsumer.worktrees.source,'shared.txt'),'utf8'),'BATCH_UPDATE\n')
assert.equal(existsSync(join(batchConsumer.worktrees.source,'remove.txt')),false)
const batchPatch=join(root,'batch.patch'),patchConsumer=join(root,'patch-consumer')
writeFileSync(batchPatch,await git(repositories[0].objectStore,['diff','--binary','--full-index',base,batchSnapshot.repositories[0].outputCommit],{bytes:true}))
await git(root,['clone','--quiet',source,patchConsumer])
await git(patchConsumer,['apply','--check',batchPatch]);await git(patchConsumer,['apply',batchPatch])
for(let i=0;i<120;i++)assert.equal(readFileSync(join(patchConsumer,'generated',`module-${i}.txt`),'utf8'),`MODULE_${i}\n`)
assert.equal(readFileSync(join(patchConsumer,'shared.txt'),'utf8'),'BATCH_UPDATE\n');assert.equal(existsSync(join(patchConsumer,'remove.txt')),false)
assert.equal(await git(source,['rev-parse','HEAD']),base);assert.equal(await git(source,['status','--porcelain']),'')
checks.push({name:'122 file changes are archived without truncation, transferred downstream and applied as a cumulative patch while source stays clean',passed:true})
const large=await prepare('large');writeFileSync(join(large.worktrees.source,'large.bin'),Buffer.alloc(5*1024*1024+1))
await assert.rejects(()=>finish(large),error=>error.code==='CODE_SNAPSHOT_LIMIT'&&error.handoffBlocked)
assert.equal(handoffs.large,undefined)
checks.push({name:'snapshot limit failure never publishes a usable parent handoff',passed:true})
const evidence={date:new Date().toISOString(),gitVersion:await git(root,['--version']),checks,root,externalModelCalls:0}
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(evidence,null,2))
console.log(JSON.stringify(evidence,null,2))
