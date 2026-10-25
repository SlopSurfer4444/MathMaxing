import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'
import { getExercise } from './exercises.mjs'

function fixture({store=new Store(':memory:'),respond=async()=>({text:'Разбор'})}={}){
  let calls=0
  const app=makeApp({store,tutor:{status:async()=>({connected:true}),respond:args=>{calls++;return respond(args)},close(){}}})
  return {...app,calls:()=>calls}
}
const version=work=>({expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch})
const solo=async app=>(await app.route('POST','/api/work/new',{problemId:'double-angle-sin',mode:'solo'})).work

test('stale tab cannot submit or request help for a different saved document and answers',async()=>{
  const app=fixture()
  try{
    const tab=await solo(app)
    const document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Другая вкладка'}]}]}
    await app.route('POST','/api/work/save',{workId:tab.id,expectedRevision:0,document,generalAnswer:'x=πk',finalAnswer:'π'})
    const before=app.store.get(tab.id)
    for(const path of ['/api/submit','/api/work/mode']){
      await assert.rejects(app.route('POST',path,{workId:tab.id,...version(tab),mode:'guided',requestId:path}),{status:409})
      assert.deepEqual(app.store.get(tab.id),before)
      assert.equal(app.store.memory().length,0)
      assert.equal(app.calls(),0)
    }
  }finally{await app.close()}
})

test('new transitions validate both version tokens, reject stale mode epochs and namespace request IDs',async()=>{
  const app=fixture()
  try{
    const work=await solo(app)
    for(const path of ['/api/submit','/api/work/mode']){
      for(const key of ['expectedRevision','expectedModeEpoch'])for(const value of [undefined,'0',-1,0.5]){
        await assert.rejects(app.route('POST',path,{workId:work.id,mode:'guided',requestId:'invalid',...version(work),[key]:value}),{status:400})
      }
    }
    for(const requestId of [undefined,'',' ',42,'x'.repeat(101)])await assert.rejects(app.route('POST','/api/work/mode',{workId:work.id,mode:'guided',...version(work),requestId}),{status:400})
    const helped=(await app.route('POST','/api/work/mode',{workId:work.id,...version(work),mode:'guided',requestId:'help'})).work
    assert.equal(helped.revision,work.revision)
    assert.equal(helped.modeEpoch,1)
    for(const path of ['/api/submit','/api/work/mode'])await assert.rejects(app.route('POST',path,{workId:work.id,...version(work),mode:'guided',requestId:'stale-epoch'}),{status:409})
    await assert.rejects(app.route('POST','/api/submit',{workId:work.id,...version(helped),requestId:'help'}),{status:409})
    assert.equal(app.store.get(work.id).submissions.length,1)
  }finally{await app.close()}
})

test('completed submit replays before conflict checks without replacing snapshot or restarting review',async()=>{
  let finish
  const app=fixture({respond:()=>new Promise(resolve=>{finish=resolve})})
  try{
    const work=await solo(app),request={workId:work.id,requestId:'submit-lost',...version(work)}
    const submitted=await app.route('POST','/api/submit',request)
    await app.route('POST','/api/work/save',{workId:work.id,expectedRevision:0,document:work.document,finalAnswer:'later draft'})
    const replay=await app.route('POST','/api/submit',request)
    assert.equal(replay.submission.id,submitted.submission.id)
    assert.equal(replay.submission.finalAnswer,'')
    assert.equal(replay.work.finalAnswer,'later draft')
    assert.equal(replay.work.modeEpoch,1)
    assert.equal(replay.work.submissions.length,1)
    assert.equal(app.calls(),1)
    // Recovery does not need current tokens when the request is already durable.
    assert.equal((await app.route('POST','/api/submit',{workId:work.id,requestId:request.requestId})).submission.id,submitted.submission.id)
    finish({text:'Готово'});await new Promise(setImmediate)
  }finally{await app.close()}
})

test('mode acknowledgement replay neither changes epoch nor cancels newer chat or reopens a reviewed work',async()=>{
  let finish
  const app=fixture({respond:()=>new Promise(resolve=>{finish=resolve})})
  try{
    const work=await solo(app),request={workId:work.id,requestId:'help-lost',mode:'guided',...version(work)}
    const opened=(await app.route('POST','/api/work/mode',request)).work
    assert.equal(opened.submissions[0].requestId,request.requestId)
    const pending=app.route('POST','/api/chat',{workId:work.id,requestId:'new-chat',message:'Объясни'})
    const replay=(await app.route('POST','/api/work/mode',request)).work
    assert.equal(replay.modeEpoch,opened.modeEpoch)
    assert.equal(replay.submissions.length,1)
    finish({text:'Ответ'});await pending
    const submitted=await app.route('POST','/api/submit',{workId:work.id,requestId:'after-help',...version(replay)})
    const afterReview=await app.route('POST','/api/work/mode',request)
    assert.equal(afterReview.work.mode,'review')
    assert.equal(afterReview.work.modeEpoch,submitted.work.modeEpoch)
    assert.equal(afterReview.work.submissions.length,2)
    finish({text:'Разбор'});await new Promise(setImmediate)
  }finally{await app.close()}
})

test('mode receipts survive SQLite restart and do not duplicate the frozen solo attempt',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pole-mode-receipt-')),path=join(directory,'state.sqlite')
  let app=fixture({store:new Store(path)})
  try{
    const work=await solo(app),request={workId:work.id,requestId:'durable-help',mode:'guided',...version(work)}
    const opened=(await app.route('POST','/api/work/mode',request)).work
    await app.close();app=fixture({store:new Store(path)})
    const replay=(await app.route('POST','/api/work/mode',request)).work
    assert.deepEqual(replay,opened)
    assert.equal(replay.submissions.length,1)
    assert.equal(app.store.memory().length,1)
  }finally{await app.close();await rm(directory,{recursive:true,force:true})}
})

test('same preparation instance rejects old draft, check and return without changing newer answer',async()=>{
  const app=fixture()
  try{
    const work=app.store.current()
    const tab=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'lost-branch'})).work.preparation
    assert.equal(tab.revision,0)
    const localDraft='late original answer'
    const saved=(await app.route('POST','/api/preparation/draft',{workId:work.id,preparationId:tab.id,expectedRevision:0,answer:'cos-zero'})).work
    assert.equal(saved.preparation.revision,1)
    for(const action of ['draft','answer','return']){
      await assert.rejects(app.route('POST',`/api/preparation/${action}`,{workId:work.id,preparationId:tab.id,expectedRevision:tab.revision,answer:localDraft}),{status:409})
      assert.deepEqual(app.store.get(work.id),saved)
      for(const expectedRevision of [undefined,'1',-1,0.5])await assert.rejects(app.route('POST',`/api/preparation/${action}`,{workId:work.id,preparationId:tab.id,expectedRevision,answer:localDraft}),{status:400})
    }
    const checked=await app.route('POST','/api/preparation/answer',{workId:work.id,preparationId:tab.id,expectedRevision:1,answer:'cos-zero'})
    assert.equal(checked.result.status,'correct')
    assert.equal(checked.work.preparation.revision,2)
    assert.equal(checked.work.preparation.attempts.length,1)
    const returned=(await app.route('POST','/api/preparation/return',{workId:work.id,preparationId:tab.id,expectedRevision:2})).work
    assert.equal(returned.preparation.revision,3)
    assert.deepEqual(returned.preparationHistory[0],returned.preparation)
    assert.deepEqual(returned.document,work.document)
    assert.equal(returned.revision,work.revision)
  }finally{await app.close()}
})

test('legacy preparation and history receive persistent zero revision on reopen',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pole-prep-revision-')),path=join(directory,'state.sqlite')
  let store=new Store(path)
  try{
    const work=store.current()
    work.preparation={id:'legacy',exerciseId:'lost-branch',answer:'cos-zero',attempts:[],completed:false}
    work.preparationHistory=[{...work.preparation,id:'previous',completed:true}]
    store.put(work);store.close();store=new Store(path)
    assert.equal(store.get(work.id).preparation.revision,0)
    assert.equal(store.get(work.id).preparationHistory[0].revision,0)
    store.close();store=new Store(path)
    assert.equal(store.get(work.id).preparation.revision,0)
  }finally{store.close();await rm(directory,{recursive:true,force:true})}
})

test('two-series selection explanation survives generated exercise to state and tutor API',async()=>{
  let packet
  const app=fixture({respond:async args=>{packet=JSON.parse(args.prompt);return {text:'Посмотри таблицу'}}})
  try{
    const work=app.store.current(),exercise=getExercise('selection-v1-5')
    await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:exercise.id,harder:true})
    const visible=(await app.route('GET','/api/state')).exercises.find(item=>item.id===exercise.id)
    assert.equal(visible.selectionSteps.length,2)
    assert.deepEqual(visible.selectionSteps,exercise.selectionSteps)
    assert.equal(visible.roots,undefined);assert.equal(visible.series,undefined);assert.equal(visible.generation,undefined)
    await app.route('POST','/api/chat',{workId:work.id,requestId:'selection',message:'Как найти k?'})
    assert.deepEqual(packet.activeExercise.selectionSteps,exercise.selectionSteps)
  }finally{await app.close()}
})

test('partial submissions report an absent answer as unknown and check the provided part independently',async()=>{
  const app=fixture()
  try{
    for(const part of ['a','b']){
      const work=await solo(app)
      const generalAnswer=part==='a'?'x=πk; x=π/3+2πk; x=-π/3+2πk':' '
      const finalAnswer=part==='b'?'-π;-π/3;0;π/3;π':' '
      const saved=(await app.route('POST','/api/work/save',{workId:work.id,expectedRevision:0,document:work.document,generalAnswer,finalAnswer})).work
      const {submission}=await app.route('POST','/api/submit',{workId:work.id,requestId:`partial-${part}`,...version(saved)})
      const absent=part==='a'?submission.result:submission.seriesResult
      const present=part==='a'?submission.seriesResult:submission.result
      assert.deepEqual(absent,{status:'unknown',summary:'Ответ пока не указан'})
      assert.equal(present.status,'correct')
    }
  }finally{await app.close()}
})
