import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {createExamRuntime} from './runtime.mjs'
import {Store} from '../store.mjs'
import {createProfileArchive} from '../profile-archive.mjs'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
function fixture(t,tutor){
 const db=new DatabaseSync(':memory:'),store={db,owner:'local'},other={db,owner:'other'}
 let runtime=createExamRuntime({store,tutor}),n=0
 t.after(()=>{runtime.close();db.close()})
 const call=(action,body={},visitor=store)=>runtime.route('POST',`/api/exam/${action}`,body,visitor)
 const act=async(work,action,extra={})=>(await call('learn',{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:`model-${++n}`,action,...extra})).work
 const start=async(mode='guided')=>(await call('start',{familyId:'finance.debt',templateId:'two-equal-payments',mode,seed:0,requestId:`start-${++n}`})).work
 const pin=(work,interaction)=>{const w=JSON.parse(db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data);const i=JSON.parse(db.prepare('SELECT data FROM exam_instances WHERE id=?').get(w.instanceId).data);i.lesson.interaction=interaction;db.prepare('UPDATE exam_instances SET data=? WHERE id=?').run(JSON.stringify(i),w.instanceId)}
 return {db,store,other,call,act,start,pin,get runtime(){return runtime},restart(){runtime.close();runtime=createExamRuntime({store})}}
}
const descriptor={id:'debt-two-payments',version:1,kind:'debt-two-payments',title:'Два платежа',facts:{principal:21000,rate:10}}
const state={input:'12100',choice:'payment-1',reveal:1}
test('model has frozen facts, exact second-occurrence source, bounded state, restart and original return',async t=>{
 const f=fixture(t);let w=await f.start();f.pin(w,descriptor)
 w=(await f.call('save',{workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,answersByPart:w.answersByPart,reasoning:'платёж и платёж'})).work
 w=await f.act(w,'open',{returnPoint:{scrollY:42,start:9,end:15}})
 const context={quote:'платёж',origin:'reasoning',selection:{start:9,end:15,fieldDigest:hash(w.reasoning)}}
 w=await f.act(w,'model-open',{context,source:{quote:'forged'}})
 assert.equal(w.learningModel.source.start,9);assert.equal(w.learningModel.source.quote,'платёж');assert.equal(w.learningModel.source.revision,w.revision-1)
 const episode=w.learningModel.id
 w=await f.act(w,'model-check',{state});assert.equal(w.learningModel.result.mastery,false);assert.equal(w.learningModel.result.source,'local-model');assert.deepEqual(w.attempts,[]);assert.deepEqual(w.evaluations,[])
 const result=w.learningModel.result
 w=await f.act(w,'model-save',{state});assert.deepEqual(w.learningModel.result,result)
 const receipt=f.db.prepare('SELECT response FROM exam_requests ORDER BY rowid DESC LIMIT 1').get().response
 assert.ok(Buffer.byteLength(receipt)<300);assert.equal(receipt.includes('12100'),false);assert.equal(receipt.includes('meaning'),false)
 w=await f.act(w,'model-save',{state:{...state,input:'12000'}});assert.equal(w.learningModel.result,undefined)
 f.restart();w=(await f.call('open',{workId:w.id})).work
 w=await f.act(w,'model-open');assert.equal(w.learningModel.id,episode);assert.equal(w.learningModel.state.input,'12000')
 assert.equal(w.learning.returnPoint.scrollY,42)
 w=await f.act(w,'return');assert.equal(Boolean(w.learning.modelOpen),false);assert.equal(w.reasoning,'платёж и платёж')
 w=await f.act(w,'model-open');assert.equal(w.learningModel.id,episode)
 w=await f.act(w,'open');assert.equal(w.learning.modelOpen,false)
 await assert.rejects(f.act(w,'model-check',{state}),{status:409})
})
test('model admission rejects stale/tampered/foreign/solo/session and preserves idempotency',async t=>{
 const f=fixture(t);let w=await f.start();f.pin(w,descriptor)
 await assert.rejects(f.call('learn',{workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,requestId:'foreign',action:'model-open'},f.other),{status:404})
 await assert.rejects(f.act(w,'model-open',{context:{quote:'fake',origin:'reasoning',selection:{start:0,end:4,fieldDigest:hash('fake')}}}),{status:409})
 const body={workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,requestId:'one-model',action:'model-open'}
 const a=await f.call('learn',body),b=await f.call('learn',body);assert.equal(a.work.learningModel.id,b.work.learningModel.id);w=b.work
 await assert.rejects(f.act({...w,revision:0},'model-save',{state}),{status:409})
 for(const bad of [{...state,input:'1'.repeat(121)},{...state,choice:'forged'},{...state,reveal:3}])await assert.rejects(f.act(w,'model-save',{state:bad}),{status:400})
 f.runtime.setSessionGuard(()=>true);await assert.rejects(f.act(w,'model-open'),{status:403});assert.equal(f.runtime.readPublicWork(f.store,w.id).learningModel,undefined)
 f.runtime.setSessionGuard(()=>false);const solo=await f.start('solo');f.pin(solo,descriptor);await assert.rejects(f.act(solo,'model-open'),{status:403})
})
test('legacy descriptors fail helpfully without blocking ordinary lessons or return; return remains possible under zero growth quota',async t=>{
 const f=fixture(t);let w=await f.start();f.pin(w,descriptor);w=await f.act(w,'model-open')
 f.pin(w,undefined);await assert.rejects(f.act(w,'model-check',{state}),{status:422})
 f.store.assertCanStore=bytes=>{if(bytes>0)throw Object.assign(Error('quota'),{status:429})}
 w=await f.act(w,'return');assert.equal(w.learning.open,false)
 delete f.store.assertCanStore
 w=await f.act(w,'open');assert.equal(w.learning.modelOpen,false)
})
test('same-template next is unseen solo and cannot be requested without a supported episode',async t=>{
 const f=fixture(t);let w=await f.start();f.pin(w,descriptor)
 const next=work=>f.call('next',{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:`next-${work.id}`,sameTemplate:true})
 await assert.rejects(next(w),{status:409});w=await f.act(w,'model-open')
 const out=await next(w);assert.equal(out.work.mode,'solo');assert.equal(out.work.priorExposure,false)
 const raw=f.runtime.readWork(f.store,out.work.id);const row=JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(raw.id).data);const frozen=JSON.parse(f.db.prepare('SELECT data FROM exam_instances WHERE id=?').get(row.instanceId).data)
 assert.equal(frozen.templateId,'two-equal-payments');assert.notEqual(frozen.parameterSeed,0)
 assert.equal(out.work.learningModel,undefined)
})
test('archive remaps model sources, retains frozen facts and downgrades the local result',async t=>{
 const store=new Store(':memory:'),runtime=createExamRuntime({store}),a=store.forVisitor(randomUUID()),b=store.forVisitor(randomUUID()),archive=createProfileArchive({store})
 t.after(()=>{runtime.close();store.close()})
 let n=0
 const route=(action,body={},visitor=a)=>runtime.route('POST',`/api/exam/${action}`,body,visitor)
 let {work:w}=await route('start',{familyId:'finance.debt',templateId:'two-equal-payments',seed:0,mode:'guided',requestId:'archive-start'})
 w=(await route('save',{workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,answersByPart:w.answersByPart,reasoning:'Платёж 12100'})).work
 w=(await route('learn',{workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,requestId:`arc-${++n}`,action:'model-open',context:{quote:'12100',origin:'reasoning',selection:{start:7,end:12,fieldDigest:hash(w.reasoning)}}})).work
 w=(await route('learn',{workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,requestId:`arc-${++n}`,action:'model-check',state})).work
 assert.equal(w.learningModel.result.status,'correct')
 const source=structuredClone(w.learningModel.source),digest=w.learningModel.descriptorDigest
 const exported=archive.exportProfile(a),restored=archive.restoreProfile(exported,b),copy=runtime.readPublicWork(b,restored.idMap[w.id])
 assert.notEqual(copy.id,w.id);assert.equal(copy.learningModel.source.workId,copy.id)
 assert.equal(copy.learningModel.source.quote,source.quote);assert.equal(copy.learningModel.source.fieldDigest,source.fieldDigest)
 assert.equal(copy.learningModel.descriptorDigest,digest);assert.equal(copy.learningModel.result.status,'unknown');assert.equal(copy.learningModel.result.archivedStatus,'correct');assert.equal(copy.learningModel.result.mastery,false)
 assert.deepEqual(copy.attempts,[]);assert.deepEqual(copy.evaluations,[])
 const checked=(await route('learn',{workId:copy.id,expectedRevision:copy.revision,expectedModeEpoch:copy.modeEpoch,requestId:'imported-recheck',action:'model-check',state},b)).work
 assert.equal(checked.learningModel.result.status,'correct');assert.equal(checked.learningModel.result.provenance,undefined)
 assert.equal(runtime.readPublicWork(a,w.id).learningModel.result.status,'correct')
})
test('geometry model checks selected basis without certifying proof, and followup keeps the structure',async t=>{
 const f=fixture(t)
 let w=(await f.call('start',{familyId:'geom.plane.similarity',templateId:'converse-parallel',mode:'guided',seed:0,requestId:'geometry-start'})).work
 w=await f.act(w,'model-open')
 for(const [choice,expected] of [['parallel-angles','incorrect'],['other','unknown'],['sides-angle','correct']]){
  w=await f.act(w,'model-check',{state:{input:'',choice,reveal:1}})
  assert.equal(w.learningModel.result.status,expected);assert.equal(w.learningModel.result.mastery,false)
 }
 assert.deepEqual(w.attempts,[])
 const next=(await f.call('next',{workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,requestId:'geometry-next',sameTemplate:true})).work
 const raw=JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(next.id).data),instance=JSON.parse(f.db.prepare('SELECT data FROM exam_instances WHERE id=?').get(raw.instanceId).data)
 assert.equal(instance.templateId,'converse-parallel');assert.equal(next.mode,'solo');assert.equal(next.priorExposure,false)
 assert.equal(next.instance.stepModelAvailable,undefined);assert.equal(next.learningModel,undefined)
})
test('tutor receives only the currently opened frozen model and its admitted candidate',async t=>{
 const packets=[],f=fixture(t,{async respond({prompt}){packets.push(JSON.parse(prompt));return 'Во второй раз проценты считают от остатка после первого платежа.'}})
 let w=await f.start();w=await f.act(w,'model-open');w=await f.act(w,'model-check',{state:{input:'11550',choice:'interest-2',reveal:1}})
 const chat=async(work,id)=>(await f.call('chat',{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:id,message:'От какой суммы здесь проценты?',contexts:[]})).work
 w=await chat(w,'model-chat')
 assert.deepEqual(packets[0].learningModel.state,{input:'11550',choice:'interest-2',reveal:1});assert.equal(packets[0].learningModel.descriptor.facts.principal,21000)
 assert.equal(packets[0].learningModel.result.mastery,false);assert.equal(packets[0].learningModel.descriptor.expected,undefined)
 w=await f.act(w,'return');await chat(w,'closed-model-chat');assert.equal(packets[1].learningModel,undefined)
})
test('a late answer to a changed model belongs to the previous step and carries no old suggestions',async t=>{
 let release,entered
 const pending=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{entered=resolve})
 const f=fixture(t,{async respond(){entered();return pending}})
 let w=await f.start();w=await f.act(w,'model-open');w=await f.act(w,'model-save',{state:{input:'11550',choice:'interest-2',reveal:1}})
 const answering=f.call('chat',{workId:w.id,expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch,requestId:'pending-model-chat',message:'Поясни второй процент',contexts:[]})
 await started
 w=(await f.call('open',{workId:w.id})).work
 w=await f.act(w,'model-save',{state:{input:'12100',choice:'payment-2',reveal:2}})
 release('Обсудим прежнюю подстановку. [[family:number.percent]]')
 w=(await answering).work
 assert.equal(w.messages.at(-1).contextStatus,'previous');assert.deepEqual(w.messages.at(-1).suggestions,[])
 assert.equal(w.learningModel.state.input,'12100');assert.equal(w.messages.find(item=>item.role==='user').status,'answered')
})
