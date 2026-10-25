import test from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'

function fixture(t) {
  const app=makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:false}),respond:async()=>{throw Error('offline')},close(){}}})
  t.after(()=>app.close());return app
}
test('route start binds an unfinished work, preserves draft and does not create a duplicate on resume',async t=>{
  const app=fixture(t)
  let {route}=await app.route('GET','/api/study-route')
  let {work}=await app.route('POST','/api/work/new',route.current.action)
  const id=work.id
  ;({work}=await app.route('POST','/api/work/save',{workId:id,expectedRevision:work.revision,document:work.document,finalAnswer:'1300'}))
  ;({route}=await app.route('POST','/api/study-route',{expectedRevision:route.revision,preferredPackage:'percentages'}))
  assert.equal(route.current.action.type,'open');assert.equal(route.current.action.workId,id)
  const count=app.store.list().length
  const resumed=await app.route('POST','/api/work/open',{workId:route.current.action.workId})
  assert.equal(resumed.work.finalAnswer,'1300');assert.equal(app.store.list().length,count)
})
test('route creates a fresh trig variant atomically while preserving a numeric draft',async t=>{
  const app=fixture(t)
  const first=await app.route('POST','/api/work/new',{packageId:'percentages',mode:'guided'})
  await app.route('POST','/api/work/save',{workId:first.work.id,expectedRevision:0,document:first.work.document,finalAnswer:'1350'})
  const next=await app.route('POST','/api/work/new',{packageId:'trigonometry',mode:'solo',generate:true})
  assert.match(next.work.problemId,/^gen-v1-/)
  assert.equal(next.work.mode,'solo')
  assert.equal(app.store.get(first.work.id).finalAnswer,'1350')
  assert.equal(app.store.current().id,next.work.id)
})
