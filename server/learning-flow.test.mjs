import { versionedRoute } from './test-support/versioned-route.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'
import { learningEpisodes } from '../src/learning-content.ts'
import { formatRoot } from './root-checker.mjs'

test('authored course works offline then new solo freezes exact independent answers before model failure', async () => {
  let modelCalls=0
  const app=makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:false,provider:'test'}),respond:async()=>{modelCalls++;throw Error('offline')},close(){}}})
  try {
    const work=app.store.current()
    const original=structuredClone(work.document)
    for(const id of ['K1','K2','K3','K4','K5','K6','K7','M1']){
      const episode=learningEpisodes.find(e=>e.id===id),progress={step:0,answers:{},outcomes:{},attempts:{}}
      await app.route('POST','/api/learning',{expectedRevision:app.store.learning().revision,workId:work.id,entry:'explain',view:'episode',episodeId:id})
      for(const [i,check] of episode.checks.entries()){
        const checked=await app.route('POST','/api/learning/answer',{workId:work.id,episodeId:id,checkId:check.id,answer:check.answer})
        assert.equal(checked.result.status,'correct')
        progress.step=i+2;progress.answers[check.id]=check.answer;progress.outcomes[check.id]=checked.result.status;progress.attempts[check.id]=1
        await app.route('POST','/api/learning',{expectedRevision:app.store.learning().revision,workId:work.id,progress:{[id]:progress}})
      }
    }
    assert.equal(modelCalls,0)
    assert.deepEqual(app.store.get(work.id).document,original)
    const next=(await app.route('POST','/api/work/next',{workId:work.id})).work
    assert.equal(next.mode,'solo')
    const problem=app.store.problem(next)
    const series=problem.series.map(s=>`${formatRoot(s.a)}+${formatRoot(s.d)}k`).join(';')
    await app.route('POST','/api/work/save',{workId:next.id,expectedRevision:0,document:next.document,generalAnswer:series,finalAnswer:problem.roots.map(formatRoot).join(';')})
    const submitted=await versionedRoute(app,'POST','/api/submit',{workId:next.id,requestId:'flow'})
    assert.equal(submitted.submission.result.status,'correct')
    assert.equal(submitted.submission.seriesResult.status,'correct')
    await new Promise(setImmediate)
    assert.equal(app.store.get(next.id).submissions[0].reviewStatus,'failed')
    assert.equal(app.store.get(next.id).submissions[0].result.status,'correct')
    assert.ok(app.store.learningEvidence().some(event=>event.kind==='episode_check'))
  } finally { await app.close() }
})

test('a delayed tutor reply remains tied to the previous learning episode', async () => {
  let finish
  const app=makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:true,provider:'test'}),respond:()=>new Promise(resolve=>{finish=resolve}),close(){}}})
  try {
    const work=app.store.current()
    await app.route('POST','/api/learning',{expectedRevision:app.store.learning().revision,view:'episode',episodeId:'K1'})
    const pending=app.route('POST','/api/chat',{workId:work.id,requestId:'lesson-late',message:'Почему?',contexts:[]})
    await app.route('POST','/api/learning',{expectedRevision:app.store.learning().revision,view:'episode',episodeId:'K2'})
    finish({text:'Объяснение прежнего эпизода'})
    const response=await pending
    assert.equal(response.work.messages.at(-1).stale,true)
  } finally { await app.close() }
})
