import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'

const version = work => ({ expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch })
function fixture() {
  const packets = [], app = makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:true}),close(){},respond:async args=>{
    const packet=JSON.parse(args.prompt);packets.push(packet)
    if(packet.intent)return {text:JSON.stringify({text:'Обсудим именно твой переход.',kind:'comment'})}
    if(packets.filter(item=>item.question).length===1)throw Error('Temporary provider failure')
    return {text:'Объяснение по сохранённому контексту'}
  }}})
  return {...app,packets}
}
const ask = (app, work, id='question') => app.route('POST','/api/chat',{workId:work.id,requestId:id,message:'Почему этот переход допустим?',contexts:[]})

test('a failed question retries within its original scope and a completed reply replays without new model work',async()=>{
  const app=fixture();try{
    const work=app.store.current()
    await assert.rejects(ask(app,work),{status:502})
    const failed=app.store.get(work.id).messages[0]
    assert.equal(failed.requestScope.workId,work.id)
    const retried=await app.route('POST','/api/chat/retry',{workId:work.id,requestId:'question'})
    assert.equal(retried.work.messages[0].text,failed.text)
    assert.equal(retried.work.messages.length,2)
    const edited=(await app.route('POST','/api/work/save',{workId:work.id,expectedRevision:0,document:work.document,finalAnswer:'new'})).work
    const replay=await app.route('POST','/api/chat/retry',{workId:edited.id,requestId:'question'})
    assert.equal(replay.reply,retried.reply)
    assert.equal(app.packets.length,2)
  }finally{await app.close()}
})

test('a failed question is never rebound to another preparation and remains available to ask anew',async()=>{
  const app=fixture();try{
    const work=app.store.current()
    await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'root-selection'})
    await assert.rejects(ask(app,work),{status:502})
    let current=app.store.get(work.id)
    await app.route('POST','/api/preparation/return',{workId:work.id,preparationId:current.preparation.id,expectedRevision:current.preparation.revision})
    await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'sine-basics'})
    const before=structuredClone(app.store.get(work.id).preparation)
    await assert.rejects(app.route('POST','/api/chat/retry',{workId:work.id,requestId:'question'}),{status:409})
    current=app.store.get(work.id)
    assert.deepEqual(current.preparation,before)
    assert.equal(current.messages[0].retryContextChanged,true)
    assert.equal(current.messages[0].status,'failed')
    assert.equal(app.packets.length,1)
    await ask(app,current,'new-question')
    assert.equal(app.packets[1].activeExercise.id,'sine-basics')
    assert.equal(current.document.type,'doc')
  }finally{await app.close()}
})

test('new explicit requests invalidate adaptive recommendations without requiring a notebook edit',async()=>{
  const app=fixture();try{
    const work=app.store.current(),base={workId:work.id,...version(work),intent:'recommend'}
    const initial=await app.route('POST','/api/assistance',base)
    const cached=await app.route('POST','/api/assistance',base)
    assert.equal(cached.guidance.id,initial.guidance.id)
    await assert.rejects(ask(app,work),{status:502})
    await assert.rejects(app.route('POST','/api/assistance',{...base,intent:'different',basedOn:initial.guidance.id}),{status:409})
    const updated=await app.route('POST','/api/assistance',base)
    assert.notEqual(updated.guidance.contextKey,initial.guidance.contextKey)
    assert.equal(updated.work.revision,work.revision)
    assert.equal(updated.work.modeEpoch,work.modeEpoch)
    assert.deepEqual(app.packets.at(-1).recentRequests,[{text:'Почему этот переход допустим?'}])
  }finally{await app.close()}
})
