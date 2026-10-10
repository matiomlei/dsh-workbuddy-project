import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TeamLibraries, gitAsync } from '../lib/library-sync.js'
import { repositoryAddress, librarySchedule } from '../lib/library-config.js'
import { listCapabilities, } from '../lib/catalog.js'
const root=mkdtempSync(join(tmpdir(),'wb-library-sync-'))
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
try {
 const origin=join(root,'origin.git'), source=join(root,'source'), target=join(root,'home/libraries/team'), projects=join(root,'home/projects')
 mkdirSync(source);git(root,['init','--bare',origin]);git(origin,['symbolic-ref','HEAD','refs/heads/main']);git(source,['init']);git(source,['checkout','-b','main']);git(source,['config','user.name','Sync test']);git(source,['config','user.email','sync@example.test']);git(source,['remote','add','origin',origin]);mkdirSync(join(source,'rules/check'),{recursive:true});writeFileSync(join(source,'rules/check/RULE.md'),'# Rule v1');git(source,['add','.']);git(source,['commit','-m','Initial']);git(source,['push','-u','origin','main'])
 let now=new Date(2026,9,8,8,59), calls=0
 const manager=new TeamLibraries(projects,[],{now:()=>now,git:async(...args)=>{calls++;return gitAsync(...args)}})
 const saved=manager.save({name:'team',repo:origin,sync:{startup:true,daily:true,time:'09:00'}})
 assert.equal(saved.path,target);assert.ok(!existsSync(target),'saving configuration does not clone')
 const restored=new TeamLibraries(projects,[]);assert.equal(restored.entries[0].repo,origin);assert.deepEqual(restored.entries[0].sync,{startup:true,daily:true,time:'09:00'})
 manager.start();await manager.startup;assert.equal(readFileSync(join(target,'rules/check/RULE.md'),'utf8'),'# Rule v1');assert.equal(manager.status('team').trigger,'startup');assert.equal(listCapabilities({name:'team',path:target,exists:true}).length,1)
 writeFileSync(join(source,'rules/check/RULE.md'),'# Rule v2');git(source,['add','.']);git(source,['commit','-m','Remote update']);git(source,['push'])
 const previous=calls;await manager.tick();assert.equal(calls,previous,'before the configured time no daily job runs')
 now=new Date(2026,9,8,9,0);await manager.tick();assert.equal(readFileSync(join(target,'rules/check/RULE.md'),'utf8'),'# Rule v2');assert.equal(manager.status('team').trigger,'daily');const after=calls;await manager.tick();assert.equal(calls,after,'only one scheduled attempt per local day')
 await manager.stop();const restart=new TeamLibraries(projects,[],{now:()=>now,git:async(...args)=>{calls++;return gitAsync(...args)}});await restart.tick();assert.equal(calls,after,'daily attempt state survives a restart')
 writeFileSync(join(target,'local.txt'),'User edits');await assert.rejects(()=>restart.sync('team'),/未提交改动/);assert.equal(readFileSync(join(target,'local.txt'),'utf8'),'User edits');assert.match(restart.status('team').error,/未提交改动/);rmSync(join(target,'local.txt'))
 const updated=await restart.sync('team');assert.equal(updated.status.running,false);assert.equal(updated.message,'已是最新版本')
 git(target,['config','user.name','Sync test']);git(target,['config','user.email','sync@example.test']);writeFileSync(join(target,'local.txt'),'Local commit');git(target,['add','.']);git(target,['commit','-m','Local commit']);const localHead=git(target,['rev-parse','HEAD'])
 writeFileSync(join(source,'remote.txt'),'Remote commit');git(source,['add','.']);git(source,['commit','-m','Remote commit']);git(source,['push']);await assert.rejects(()=>restart.sync('team'),/Git 同步失败/);assert.equal(git(target,['rev-parse','HEAD']),localHead,'divergence never resets local commits')
 restart.save({name:'team',path:target,repo:join(root,'other.git'),sync:{}});await assert.rejects(()=>restart.sync('team'),/origin 不一致/)
 const occupied=join(root,'occupied');mkdirSync(occupied);writeFileSync(join(occupied,'important.txt'),'keep');restart.save({name:'other',path:occupied,repo:origin,sync:{}});await assert.rejects(()=>restart.sync('other'),/不是 Git 仓库/);assert.equal(readFileSync(join(occupied,'important.txt'),'utf8'),'keep')
 for(const value of ['ext::anything','-x','https://user:secret@example.com/repo','git@example.com:bad path']) assert.throws(()=>repositoryAddress(value))
 for(const value of ['24:00','09:60','9:00']) assert.throws(()=>librarySchedule({daily:true,time:value}))
 assert.throws(()=>restart.save({name:'invalid/name',repo:origin}),/invalid/)
 assert.throws(()=>restart.save({name:'other',repo:'',sync:{daily:true}}),/仓库地址/)
 await restart.stop();assert.equal(restart.jobs.size,0)
 // Removing configured and added libraries persists across restart without deleting checkouts.
 const deletionRoot=join(root,'deletion/projects'),defaults=[{name:'configured',path:target,repo:origin,sync:{startup:true,daily:true}}]
 let deleteSyncCalls=0
 const deletion=new TeamLibraries(deletionRoot,defaults,{git:async()=>{deleteSyncCalls++;return ''}})
 deletion.save({name:'added',path:occupied,repo:origin,sync:{startup:true,daily:true}})
 let notifications=0;deletion.onChange=()=>notifications++
 assert.equal(deletion.remove('configured').filesRetained,true);deletion.remove('added');assert.equal(deletion.entries.length,0);assert.equal(notifications,2)
 assert.equal(readFileSync(join(occupied,'important.txt'),'utf8'),'keep');assert.equal(git(target,['rev-parse','HEAD']),localHead)
 const deletedRestart=new TeamLibraries(deletionRoot,defaults);assert.equal(deletedRestart.entries.length,0,'default profile libraries must not reappear')
 deletion.start();await deletion.startup;await deletion.tick();assert.equal(deleteSyncCalls,0,'deleted libraries never synchronize');await deletion.stop()
 assert.throws(()=>deletedRestart.remove('unknown'),/不存在/)
 deletedRestart.save({name:'configured',path:target,repo:origin});assert.equal(new TeamLibraries(deletionRoot,defaults).entries.length,1,'a deleted library can be added again')
 // Failed persistence restores the registration instead of removing it only in memory.
 const stateFile=deletedRestart.file;writeFileSync(join(root,'blocked'),'file');deletedRestart.file=join(root,'blocked/state.json')
 assert.throws(()=>deletedRestart.remove('configured'));assert.equal(deletedRestart.entries.length,1);assert.equal(deletedRestart.removed.has('configured'),false)
 deletedRestart.file=stateFile;await deletedRestart.stop()
 // Clone in flight is cancelled on disposal, never promoted into a completed checkout.
 let finish, entered;const started=new Promise(resolve=>entered=resolve)
 const cancelled=new TeamLibraries(join(root,'cancel/projects'),[],{git:async(cwd,args,signal)=>{entered();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('同步已取消')),{once:true});finish=resolve});return ''}})
 cancelled.save({name:'cancel',repo:origin});const promise=cancelled.sync('cancel');await started;assert.equal(cancelled.isBusy('cancel'),true);assert.throws(()=>cancelled.save({name:'cancel',repo:origin}),/正在同步/);assert.throws(()=>cancelled.remove('cancel'),/正在同步/);assert.equal(cancelled.sync('cancel'),promise,'concurrent requests reuse the existing job');const rejection=assert.rejects(()=>promise,/取消/);await cancelled.stop();await rejection;assert.ok(!existsSync(join(root,'cancel/libraries/cancel')));assert.ok(!readdirSync(join(root,'cancel/libraries')).some(name=>name.startsWith('.cancel-sync-')))
 console.log('PASS persisted Git source/schedule and library deletion/re-addition; default removal across restart; failed deletion rollback; startup/daily sync; fast-forward and checkout protection; overlap and cancellation')
} finally { rmSync(root,{recursive:true,force:true}) }
