import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { percentageProblems } from './percentages.mjs'
import { publicProblem } from './problems.mjs'
const version=w=>({expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch})
const preparationVersion=w=>({preparationId:w.numericPreparation.id,expectedPreparationRevision:w.numericPreparation.revision})
function fixture(){const prompts=[];const store=new Store(':memory:');const app=makeApp({store,tutor:{status:async()=>({connected:false}),respond:async args=>{prompts.push(JSON.parse(args.prompt));throw Error('Наставник недоступен')},close(){}}});return {...app,prompts}}
const create=(app,mode='guided',taskId)=>(app.route('POST','/api/work/new',{packageId:'percentages',mode,taskId})).then(r=>r.work)
const save=async(app,w,answer)=>(await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:w.revision,document:w.document,finalAnswer:answer})).work
const submit=(app,w,id=crypto.randomUUID())=>app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:id})

test('percentage cycle preserves drafts, scalar checks, offline review, and next independent task',async()=>{
 const app=fixture();try{
  let w=await create(app);assert.equal(w.problemId,'percent-discount-v1');assert.equal(w.kind,'numeric')
  const publicTask=publicProblem(app.store.problem(w));assert.equal(publicTask.kind,'numeric');assert.equal('answer' in publicTask,false);assert.equal('solution' in publicTask,false)
  w=await save(app,w,'1300');const helped=await app.route('POST','/api/percentages/help',{workId:w.id,...version(w)});assert.equal(helped.work.finalAnswer,'1300');assert.ok(helped.help.steps.length)
  w=(await app.route('POST','/api/percentages/return',{workId:w.id,...version(helped.work),...preparationVersion(helped.work)})).work
  w=await save(app,w,'1200');const checked=await submit(app,w);assert.equal(checked.submission.result.status,'correct');assert.equal('seriesResult' in checked.submission,false)
  await new Promise(setImmediate);assert.equal(app.store.get(w.id).submissions[0].reviewStatus,'failed');assert.equal(app.store.memory()[0].independent,false)
  const next=(await app.route('POST','/api/work/next',{workId:w.id})).work;assert.equal(next.problemId,'percent-successive-v1');assert.equal(next.mode,'solo')
  const done=await submit(app,await save(app,next,'1440'));assert.equal(done.submission.result.status,'correct');assert.equal(app.store.memory()[0].independent,true)
  const reverse=(await app.route('POST','/api/work/next',{workId:next.id})).work;assert.equal(reverse.problemId,'percent-reverse-v1');assert.equal((await submit(app,await save(app,reverse,'2000'))).submission.result.status,'correct')
  assert.equal(app.store.open(w.id).finalAnswer,'1200');assert.equal(app.store.get(w.id).submissions[0].finalAnswer,'1200')
 }finally{await app.close()}
})

test('percentage solo guard, stale submission, help snapshot and replay retain original answer',async()=>{
 const app=fixture();try{
  let w=await create(app,'solo');for(const path of ['/api/percentages/help','/api/percentages/preparation'])await assert.rejects(app.route('POST',path,{workId:w.id,...version(w),answer:'1'}),{status:403})
  const old=w;w=await save(app,w,'1200');await assert.rejects(submit(app,old),{status:409})
  const request={workId:w.id,...version(w),mode:'guided',requestId:'help'};const opened=(await app.route('POST','/api/work/mode',request)).work
  assert.equal(opened.submissions[0].finalAnswer,'1200');assert.equal(opened.submissions[0].result.status,'unknown');assert.equal('seriesResult' in opened.submissions[0],false)
  await save(app,opened,'1300');const replay=await app.route('POST','/api/work/mode',request);assert.equal(replay.work.submissions.length,1);assert.equal(replay.work.finalAnswer,'1300')
 }finally{await app.close()}
})

test('numeric malformed input is unknown, frozen authored instance survives catalog drift, visitor isolation and trig reopen',async()=>{
 const app=fixture();try{
  const legacy=app.store.current();legacy.document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Старое решение'}]}]};app.store.put(legacy)
  let w=await create(app);const frozen=app.store.setting(`problem-instance:${w.id}`);assert.ok(frozen);w=await save(app,w,'1200 или 1500');assert.equal((await submit(app,w)).submission.result.status,'unknown')
  assert.equal(app.store.setting(`problem-instance:${w.id}`),frozen)
  const other=app.store.forVisitor(crypto.randomUUID());assert.throws(()=>other.get(w.id),{status:404})
  for(const path of ['/api/series/check','/api/learning/diagnostic','/api/preparation/start'])await assert.rejects(app.route('POST',path,{workId:w.id,answer:'0'}),{status:400})
  assert.deepEqual(app.store.open(legacy.id).document,legacy.document);assert.equal(publicProblem(app.store.problem(legacy)).equation,app.store.problem(legacy).equation)
  assert.ok(app.prompts.every(p=>p.library.length===0&&p.learning===null))
 }finally{await app.close()}
})


test('saved authored instance and numeric draft survive SQLite reopen and later content edits',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pole-percent-'));const path=join(directory,'state.sqlite');let store=new Store(path)
 const authored=percentageProblems[0],originalAnswer=authored.answer,originalPrompt=authored.prompt
 try{
  const work=store.create(authored.id,'guided');work.finalAnswer='1200';store.put(work);store.close();store=new Store(path)
  authored.answer='999';authored.prompt='Changed published content'
  const reopened=store.open(work.id);assert.equal(reopened.finalAnswer,'1200');assert.equal(store.problem(reopened).answer,originalAnswer);assert.equal(store.problem(reopened).prompt,originalPrompt)
 }finally{authored.answer=originalAnswer;authored.prompt=originalPrompt;store.close();await rm(directory,{recursive:true,force:true})}
})

test('package-only trig entry works and frozen help, preparation and chat ignore later catalog edits',async()=>{
 const app=fixture();const authored=percentageProblems[0],saved=structuredClone(authored.help)
 try{
  const trig=(await app.route('POST','/api/work/new',{packageId:'trigonometry',mode:'guided'})).work;assert.equal(trig.problemId,'double-angle-cos')
  let w=await create(app);authored.help.title='Later title';authored.help.check.answer='999';authored.help.check.feedback='Later feedback'
  const help=await app.route('POST','/api/percentages/help',{workId:w.id,...version(w)});assert.equal(help.help.title,saved.title)
  w=help.work
  const checked=await app.route('POST','/api/percentages/preparation',{workId:w.id,...version(w),...preparationVersion(w),answer:saved.check.answer});assert.equal(checked.result.status,'correct');assert.equal(checked.result.summary,saved.check.feedback)
  w=checked.work
  await assert.rejects(app.route('POST','/api/chat',{workId:w.id,requestId:'frozen-chat',message:'Объясни'}))
  assert.equal(app.prompts.at(-1).percentageHelp.title,saved.title)
  w=(await app.route('POST','/api/percentages/return',{workId:w.id,...version(w),...preparationVersion(w)})).work
  const edited=await save(app,w,'123');await assert.rejects(app.route('POST','/api/percentages/help',{workId:w.id,...version(w)}),{status:409});assert.equal(app.store.get(w.id).numericHelpSeen,true);assert.equal(edited.finalAnswer,'123')
 }finally{authored.help=saved;await app.close()}
})
