import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'
import { loadServerConfig } from './config.mjs'

function fixture(overrides={}) {
  let calls=0
  const app=makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:true,provider:'test'}),respond:async()=>{calls++;return {text:'Ответ'}},close(){},...overrides}})
  return {...app,calls:()=>calls}
}

test('learning revisions reject unversioned and stale tab writes without replacing answers',async()=>{
  const app=fixture()
  try {
    const work=app.store.current(),initial=(await app.route('GET','/api/learning')).session
    assert.equal(initial.revision,0)
    for(const expectedRevision of [undefined,'0',-1,0.5])await assert.rejects(app.route('POST','/api/learning',{expectedRevision,view:'home'}),{status:400})
    const progress={step:1,answers:{'K1-a':'-1/2'},outcomes:{},attempts:{}}
    const saved=await app.route('POST','/api/learning',{workId:work.id,expectedRevision:initial.revision,view:'episode',episodeId:'K1',progress:{K1:progress}})
    assert.equal(saved.session.revision,1)
    await assert.rejects(app.route('POST','/api/learning',{workId:work.id,expectedRevision:initial.revision,progress:{K1:{step:0,answers:{}}}}),{status:409})
    assert.deepEqual((await app.route('GET','/api/learning')).session,saved.session)
    assert.equal(app.store.learningEvidence().length,1)
  } finally {await app.close()}
})

test('legacy learning records acquire a stable numeric revision',async()=>{
  const store=new Store(':memory:')
  try {
    store.db.prepare("INSERT INTO settings(key,value) VALUES('learning',?)").run(JSON.stringify({entry:null,episodeId:null,progress:{},view:'home',updatedAt:'old'}))
    assert.equal(store.learning().revision,0)
    assert.equal(store.learning().revision,0)
    assert.equal(JSON.parse(store.db.prepare("SELECT value FROM settings WHERE key='learning'").get().value).revision,0)
  } finally {store.close()}
})

test('old preparation draft, answer and return cannot mutate a later instance even of same exercise',async()=>{
  const app=fixture()
  try {
    const work=app.store.current()
    const first=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'root-selection'})).work.preparation
    await app.route('POST','/api/preparation/return',{workId:work.id,preparationId:first.id})
    const second=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'root-selection'})).work.preparation
    assert.notEqual(first.id,second.id)
    assert.equal(second.exerciseId,'root-selection')
    const before=app.store.get(work.id)
    for(const action of ['draft','answer','return']){
      for(const preparationId of [undefined,first.id])await assert.rejects(app.route('POST',`/api/preparation/${action}`,{workId:work.id,preparationId,answer:'-5π/3;-2π/3;π/3'}),{status:409})
      assert.deepEqual(app.store.get(work.id),before)
    }
  } finally {await app.close()}
})

test('visiting, failing or clearing a successful selection never raises difficulty',async()=>{
  const app=fixture()
  try {
    const work=app.store.current()
    for(const answer of ['', '0', '-5π/3;-2π/3;π/3']){
      const preparation=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'root-selection'})).work.preparation
      assert.equal(preparation.exerciseId,'root-selection')
      if(answer){await app.route('POST','/api/preparation/answer',{workId:work.id,preparationId:preparation.id,answer})}
      if(answer.includes(';'))await app.route('POST','/api/preparation/draft',{workId:work.id,preparationId:preparation.id,answer:'0'})
      await app.route('POST','/api/preparation/return',{workId:work.id,preparationId:preparation.id})
    }
    const repeated=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'root-selection'})).work.preparation
    assert.equal(repeated.exerciseId,'root-selection')
    await app.route('POST','/api/preparation/return',{workId:work.id,preparationId:repeated.id})
    const harder=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'root-selection',harder:true})).work.preparation
    assert.match(harder.exerciseId,/^selection-v1-/)
  } finally {await app.close()}
})

test('unresolved status does not block state, authored content, notebook or exact checks',{timeout:2000},async()=>{
  let finishStatus,statusCalls=0
  const app=fixture({status:()=>{statusCalls++;return new Promise(resolve=>{finishStatus=resolve})}})
  try {
    const pending=app.route('GET','/api/status')
    const state=await app.route('GET','/api/state')
    assert.equal(statusCalls,1)
    assert.equal(state.provider.loading,true)
    assert.equal((await app.route('GET','/api/learning')).session.view,'home')
    const work=state.work
    const saved=await app.route('POST','/api/work/save',{workId:work.id,expectedRevision:work.revision,document:work.document,finalAnswer:'π'})
    assert.equal(saved.work.finalAnswer,'π')
    const exact=await app.route('POST','/api/learning/diagnostic',{workId:work.id,generalAnswer:'x=π/2+πk',answer:'-π/2;π/2;3π/2'})
    assert.equal(exact.rootResult.status,'correct')
    finishStatus({connected:true,provider:'test'})
    await pending
    assert.equal((await app.route('GET','/api/state')).provider.connected,true)
    assert.equal(statusCalls,1)
  } finally {await app.close()}
})

test('lost submission response is recovered by request ID with one immutable attempt and model review',async()=>{
  let finishReview,reviewCalls=0
  const app=fixture({respond:()=>{reviewCalls++;return new Promise(resolve=>{finishReview=resolve})}})
  try {
    const work=app.store.current(),request={workId:work.id,requestId:'durable-request'}
    assert.equal((await app.route('POST','/api/submit/lookup',request)).submission,null)
    await app.route('POST','/api/submit',request) // Client loses this response.
    const recovered=await app.route('POST','/api/submit/lookup',request)
    assert.equal(recovered.submission.reviewStatus,'pending')
    await app.route('POST','/api/work/save',{workId:work.id,expectedRevision:0,document:work.document,finalAnswer:'new draft'})
    const repeated=await app.route('POST','/api/submit',request)
    assert.equal(repeated.submission.id,recovered.submission.id)
    assert.equal(repeated.work.submissions.length,1)
    assert.equal(repeated.submission.finalAnswer,'')
    assert.equal(repeated.work.finalAnswer,'new draft')
    assert.equal(reviewCalls,1)
    finishReview({text:'Разбор'})
    await new Promise(setImmediate)
    assert.equal((await app.route('POST','/api/submit/lookup',request)).submission.reviewVersion,2)
    assert.equal(app.store.memory().length,1)
  } finally {await app.close()}
})

test('tutor receives current general solution and unverified preparation draft, and late reply becomes stale',async()=>{
  let packet,finish
  const app=fixture({respond:args=>{packet=JSON.parse(args.prompt);return new Promise(resolve=>{finish=resolve})}})
  try {
    const work=app.store.current()
    await app.route('POST','/api/work/save',{workId:work.id,expectedRevision:0,document:work.document,finalAnswer:'',generalAnswer:'x=πk'})
    const preparation=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'root-selection'})).work.preparation
    await app.route('POST','/api/preparation/answer',{workId:work.id,preparationId:preparation.id,answer:'-5π/3;-2π/3;π/3'})
    await app.route('POST','/api/preparation/draft',{workId:work.id,preparationId:preparation.id,answer:'π/3'})
    const pending=app.route('POST','/api/chat',{workId:work.id,requestId:'current-draft',message:'Посмотри мою запись'})
    assert.equal(packet.generalAnswer,'x=πk')
    assert.equal(packet.activeExercise.currentAnswer,'π/3')
    assert.equal(packet.activeExercise.currentResult,null)
    assert.equal(packet.activeExercise.currentAnswerStatus,'unverified')
    assert.equal(packet.activeExercise.attempts[0].result.status,'correct')
    assert.equal(packet.activeExercise.preparationId,preparation.id)
    await app.route('POST','/api/preparation/draft',{workId:work.id,preparationId:preparation.id,answer:'π/3;0'})
    finish({text:'Объяснение прежней записи'})
    const response=await pending
    assert.equal(response.work.messages.at(-1).stale,true)
  } finally {await app.close()}
})

test('editing preparation after a completed tutor reply marks the existing reply stale',async()=>{
  const app=fixture()
  try {
    const work=app.store.current()
    const preparation=(await app.route('POST','/api/preparation/start',{workId:work.id,exerciseId:'lost-branch'})).work.preparation
    const chat=await app.route('POST','/api/chat',{workId:work.id,requestId:'old-draft',message:'Помоги'})
    assert.equal(chat.work.messages.at(-1).stale,false)
    const edited=await app.route('POST','/api/preparation/draft',{workId:work.id,preparationId:preparation.id,answer:'cos-zero'})
    assert.equal(edited.work.messages.at(-1).stale,true)
  } finally {await app.close()}
})

test('hosted HTTP integration requires a visitor cookie and exact origin before accessing or changing state',async()=>{
  const config=loadServerConfig({POLE_MODE:'hosted',POLE_TUTOR_PROVIDER:'openai',POLE_ALLOWED_ORIGINS:'https://review.example',POLE_DB_PATH:'.runtime/integration-unused.sqlite',OPENAI_API_KEY:'integration-key',OPENAI_MODEL:'integration-model',POLE_MAX_BODY_BYTES:'1024'})
  const app=makeApp({config,store:new Store(':memory:'),tutor:{status:async()=>({connected:false,provider:'test'}),close(){}}})
  try {
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve))
    const base=`http://127.0.0.1:${app.server.address().port}`
    const headers={'X-Pole-Client':'notebook-v1',Origin:'https://review.example'}
    const denied=await fetch(`${base}/api/state`,{headers})
    assert.equal(denied.status,409)
    assert.equal(denied.headers.get('Set-Cookie'),null)
    assert.equal(app.store.list().length,0)
    const bootstrap=await fetch(`${base}/api/session`,{headers})
    const session=await bootstrap.json()
    headers.Cookie=bootstrap.headers.get('Set-Cookie').split(';')[0]
    headers['X-Pole-Session']=session.id
    const state=await fetch(`${base}/api/state`,{headers})
    assert.equal(state.status,200)
    assert.equal(state.headers.get('Cache-Control'),'no-store')
    const work=(await state.json()).work
    assert.equal((await fetch(`${base}/api/state`,{headers:{...headers,Origin:'https://review.example.evil'}})).status,403)
    assert.equal((await fetch(`${base}/api/learning`,{method:'POST',headers,body:JSON.stringify({expectedRevision:0,view:'home',padding:'x'.repeat(1100)})})).status,413)
    assert.equal(app.store.forVisitor(session.id).learning().revision,0)
    const saved=await fetch(`${base}/api/learning`,{method:'POST',headers,body:JSON.stringify({workId:work.id,expectedRevision:0,entry:'refresh',view:'diagnostic'})})
    assert.equal(saved.status,200)
    assert.equal((await saved.json()).session.revision,1)
  } finally {await app.close()}
})
