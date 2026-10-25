import {test} from 'node:test'
import assert from 'node:assert/strict'
import {makeApp} from './index.mjs'
import {Store} from './store.mjs'
import {topicProblems} from './topic-packs.mjs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const version=w=>({expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch})
const preparationVersion=w=>({preparationId:w.numericPreparation.id,expectedPreparationRevision:w.numericPreparation.revision})
function fixture(){const prompts=[];return {...makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:false}),respond:async args=>{prompts.push(JSON.parse(args.prompt));throw Error('offline')},close(){}}}),prompts}}
const save=async(app,w,answer)=>(await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:w.revision,document:w.document,finalAnswer:answer})).work
const submit=(app,w)=>app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:crypto.randomUUID()})
test('topic packages expose public catalog, guarded help, independent transfer and scalar review anchors',async()=>{
 const app=fixture();try{
  for(const packageId of ['graphs','inequalities']){
   let w=(await app.route('POST','/api/work/new',{packageId,mode:'solo'})).work
   const state=await app.route('GET','/api/state');assert.ok(state.packages.some(p=>p.id===packageId))
   const task=state.problems.find(p=>p.id===w.problemId);for(const key of ['answer','solution','help'])assert.equal(key in task,false)
   await assert.rejects(app.route('POST','/api/topics/help',{workId:w.id,...version(w)}),{status:403})
   await assert.rejects(app.route('POST','/api/topics/preparation',{workId:w.id,...version(w),answer:'0'}),{status:403})
   w=await save(app,w,'непонятная запись');const result=await submit(app,w);assert.equal(result.submission.result.status,'unknown');assert.equal('seriesResult' in result.submission,false)
   w=result.work;const help=await app.route('POST','/api/topics/help',{workId:w.id,...version(w)});assert.ok(help.help.steps.length);assert.equal('answer' in help.help.check,false);assert.equal('feedback' in help.help.check,false)
   w=(await app.route('POST','/api/topics/return',{workId:w.id,...version(help.work),...preparationVersion(help.work)})).work
   const next=(await app.route('POST','/api/work/next',{workId:w.id})).work;assert.equal(next.packageId,packageId);assert.equal(next.mode,'solo');assert.notEqual(next.problemId,w.problemId)
   const done=await submit(app,await save(app,next,app.store.problem(next).answer));assert.equal(done.submission.result.status,'correct');assert.equal(app.store.memory()[0].independent,true)
   await new Promise(setImmediate);const prompt=app.prompts.at(-1);assert.equal(prompt.anchors[0].kind,'numeric');assert.equal(prompt.exactChecks.seriesResult,undefined);assert.equal('answer' in prompt.task,false)
   await assert.rejects(app.route('POST','/api/percentages/help',{workId:next.id,...version(app.store.get(next.id))}),{status:400})
   await assert.rejects(app.route('POST','/api/work/new',{packageId:'percentages',problemId:next.problemId,mode:'guided'}),{status:400})
  }
 }finally{await app.close()}
})
test('topic attempts freeze content through database reopen and preserve old trig and percentages',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pole-topic-')),path=join(directory,'state.sqlite');let store=new Store(path)
 try{
  const trig=store.create('double-angle-cos','guided'),percent=store.create('percent-discount-v1','guided')
  const ids=[];for(const p of topicProblems){const w=store.create(p.id,'guided');w.finalAnswer='draft';store.put(w);ids.push([w.id,p.id,JSON.stringify(store.problem(w))])}
  store.close();store=new Store(path)
  for(const [id,pid,snapshot] of ids){const work=store.open(id);assert.equal(work.finalAnswer,'draft');assert.equal(work.problemId,pid);assert.equal(JSON.stringify(store.problem(work)),snapshot);assert.throws(()=>store.forVisitor(crypto.randomUUID()).get(id),{status:404})}
  assert.equal(store.open(trig.id).kind,'trig');assert.equal(store.open(percent.id).kind,'numeric')
 }finally{store.close();await rm(directory,{recursive:true,force:true})}
})
