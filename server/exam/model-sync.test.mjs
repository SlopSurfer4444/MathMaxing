import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {createExamRuntime} from './runtime.mjs'
import {flushModelDraft,ModelSyncError,confirmModelDraftBackup,readModelDraft,modelDraftConflicts} from '../../src/exam-local-model.ts'

// In-memory runtime exercises the real revision/quota/return contract. The
// adapter is intentionally small; it does not stand in for rendered React QA.
async function fixture(t){
  const db=new DatabaseSync(':memory:'),store={db,owner:'model-sync'}
  let runtime=createExamRuntime({store}),work,local,n=0
  t.after(()=>{runtime.close();db.close()})
  const route=(path,body={})=>runtime.route('POST',`/api/exam/${path}`,body,store)
  const learn=async(action,extra={})=>{
    const reply=await route('learn',{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:`sync-${++n}`,action,...extra})
    work=reply.work
    return work
  }
  work=(await route('start',{familyId:'finance.debt',templateId:'two-equal-payments',mode:'guided',seed:0,requestId:'sync-start'})).work
  await learn('model-open')
  const adopt=()=>{
    const episode=work.learningModel
    local={episodeId:episode.id,descriptorDigest:episode.descriptorDigest,baseState:episode.state,state:structuredClone(episode.state)}
  }
  adopt()
  const read=()=>({workId:work.id,open:!!work.learning?.modelOpen,episode:work.learningModel,draft:local,recovery:false})
  const persist=async()=>{
    const state=structuredClone(local.state)
    await learn('model-save',{state})
    local={...local,baseState:work.learningModel.state}
  }
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value)},removeItem:key=>{data.delete(key)}}
  return {store,storage,route,learn,read,persist,adopt,get work(){return work},get local(){return local},edit(state){local={...local,state}},async reopen(){work=(await route('open',{workId:work.id})).work;await learn('model-open')},restart(){runtime.close();runtime=createExamRuntime({store})}}
}

test('immediate return flushes model input before closing, survives restart, and leaves the solution intact',async t=>{
  const f=await fixture(t),input={input:'12100',choice:'payment-1',reveal:1}
  const original={reasoning:f.work.reasoning,answersByPart:f.work.answersByPart,episode:f.work.learningModel.id}
  f.edit(input)
  await flushModelDraft(f.read,f.persist)
  await f.learn('return')
  assert.equal(f.work.learning.open,false)
  f.restart();await f.reopen()
  assert.deepEqual(f.work.learningModel.state,input)
  assert.equal(f.work.learningModel.id,original.episode)
  assert.equal(f.work.reasoning,original.reasoning)
  assert.deepEqual(f.work.answersByPart,original.answersByPart)
  assert.deepEqual(f.work.attempts,[]);assert.deepEqual(f.work.evaluations,[])
})

test('quota refusal blocks dependent navigation; verified local fallback leaves, and reopening can sync it later',async t=>{
  const f=await fixture(t),input={input:'12100',choice:'payment-1',reveal:1},base=structuredClone(f.work.learningModel.state)
  f.edit(input)
  let saves=0,left=false
  f.store.assertCanStore=bytes=>{if(bytes>0)throw Object.assign(Error('quota'),{status:429})}
  await assert.rejects(flushModelDraft(f.read,async()=>{saves++;await f.persist()}).then(async()=>{await f.learn('return');left=true}),error=>error instanceof ModelSyncError&&error.reason==='save'&&error.cause.status===429)
  assert.equal(saves,1);assert.equal(left,false);assert.deepEqual(f.local.state,input)
  assert.deepEqual(f.work.learningModel.state,base)
  confirmModelDraftBackup(f.storage,f.work.id,f.local)
  await f.learn('return')
  assert.equal(f.work.learning.open,false)
  const backup=readModelDraft(f.storage,f.work.id)
  assert.deepEqual(backup.state,input)
  delete f.store.assertCanStore
  f.restart();await f.reopen()
  assert.equal(modelDraftConflicts(backup,f.work.learningModel),false)
  f.adopt();f.edit(backup.state)
  await flushModelDraft(f.read,f.persist)
  assert.deepEqual(f.work.learningModel.state,input)
  assert.deepEqual(f.work.attempts,[]);assert.deepEqual(f.work.evaluations,[])
})

test('new solo task follows confirmed model input while excluding the teaching episode',async t=>{
  const f=await fixture(t),input={input:'11550',choice:'interest-2',reveal:2},oldId=f.work.id
  f.edit(input)
  await flushModelDraft(f.read,f.persist)
  const {work:next}=await f.route('next',{workId:f.work.id,expectedRevision:f.work.revision,expectedModeEpoch:f.work.modeEpoch,requestId:'sync-next',sameTemplate:true})
  assert.notEqual(next.id,oldId);assert.equal(next.mode,'solo');assert.equal(next.priorExposure,false);assert.equal(next.learningModel,undefined)
  const {work:saved}=await f.route('open',{workId:oldId})
  assert.deepEqual(saved.learningModel.state,input)
  assert.deepEqual(saved.attempts,[]);assert.deepEqual(saved.evaluations,[])
})

test('another tab model edit refuses stale input without overwriting the newer server copy',async t=>{
  const f=await fixture(t),other={input:'12000',choice:'payment-2',reveal:1}
  f.edit({input:'11550',choice:'payment-1',reveal:1})
  await f.learn('model-save',{state:other})
  let calls=0
  await assert.rejects(flushModelDraft(f.read,async()=>{calls++;await f.persist()}),error=>error instanceof ModelSyncError&&error.reason==='conflict')
  assert.equal(calls,0)
  const {work:saved}=await f.route('open',{workId:f.work.id})
  assert.deepEqual(saved.learningModel.state,other)
  assert.equal(f.local.state.input,'11550')
})
