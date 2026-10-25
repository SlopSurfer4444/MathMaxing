import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseReview, parseReconsideration, selfCheck } from './review.mjs'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'
const tick=()=>new Promise(resolve=>setImmediate(resolve))
const version=w=>({expectedRevision:w.revision,expectedModeEpoch:w.modeEpoch})
const response=JSON.stringify({summary:'Проверь переход.',findings:[{anchor:{kind:'answer_a',quote:'x=0'},message:'Этот переход нужно проверить.',suggestion:'Подставь значение.'}]})
const fixture=(respond=async()=>({text:response}))=>makeApp({store:new Store(':memory:'),tutor:{status:async()=>({connected:true}),respond,close(){}}})
async function submitted(app){let w=app.store.current();w=(await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:0,document:w.document,generalAnswer:'x=0',finalAnswer:''})).work;await app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:'s1'});await tick();return app.store.get(w.id)}
const action=(w,extra={})=>({workId:w.id,submissionId:w.submissions.at(-1).id,expectedReviewVersion:w.submissions.at(-1).reviewVersion,...version(w),requestId:'action',action:'correct',...extra})
test('structured review drops hallucinated anchors and keeps unknown exact verdict separate',()=>{
 const s={generalAnswer:'x=0',finalAnswer:'',document:{type:'doc'}}
 const r=parseReview(JSON.stringify({summary:'Другой способ допустим',findings:[{anchor:{kind:'answer_b',quote:'π'},message:'Ошибка'},{anchor:{kind:'answer_a',quote:'x=0'},message:'Проверь'}]}),s)
 assert.equal(r.findings.length,1);assert.equal(r.findings[0].source,'model');assert.equal(parseReview('plain legacy',s).review,'plain legacy')
 assert.equal(parseReconsideration('broken').verdict,'uncertain');assert.equal(parseReconsideration('{"verdict":"correct"}').verdict,'uncertain')
 assert.ok(!selfCheck(s).some(t=>t.includes('границы')))
})
test('correction appends linked snapshot, replays and preserves original answer and evidence',async()=>{
 const app=fixture();try{let w=await submitted(app);const original=structuredClone(w.submissions[0]),request=action(w)
 await assert.rejects(app.route('POST','/api/review/action',{...request,expectedRevision:999}),{status:409})
 w=(await app.route('POST','/api/review/action',request)).work;assert.equal(w.correctionOf,original.id)
 const epoch=w.modeEpoch;assert.equal((await app.route('POST','/api/review/action',request)).work.modeEpoch,epoch)
 w=(await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:w.revision,document:w.document,generalAnswer:'x=πk',finalAnswer:''})).work
 w=(await app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:'s2'})).work
 assert.equal(w.submissions.length,2);assert.equal(w.submissions[1].correctionOf,original.id);assert.equal(w.submissions[0].generalAnswer,original.generalAnswer);assert.equal(w.submissions[0].result.status,'unknown');assert.equal(app.store.memory().length,2)
 await assert.rejects(app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:'action'}),{status:409})
 }finally{await app.close()}
})
test('objection accepts alternative method without altering exact results; pinned late reply and receipt',async()=>{
 let release,calls=0;const app=fixture(async()=>++calls===1?{text:response}:await new Promise(r=>release=r))
 try{let w=await submitted(app);const s=w.submissions[0],before=structuredClone(s.result),memory=app.store.memory(),request=action(w,{action:'object',findingId:s.findings[0].id,explanation:'Использован другой способ'})
 w=(await app.route('POST','/api/review/action',request)).work;assert.equal(w.submissions[0].findings[0].objections[0].status,'pending')
 await app.route('POST','/api/review/action',request);assert.equal(calls,2)
 await assert.rejects(app.route('POST','/api/review/action',{...request,explanation:'changed'}),{status:409})
 await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:w.revision,document:w.document,finalAnswer:'new draft'})
 release({text:'{"verdict":"withdrawn","message":"Другой способ корректен; замечание снимаю."}'});await tick()
 w=app.store.get(w.id);assert.equal(w.finalAnswer,'new draft');assert.equal(w.submissions[0].findings[0].status,'withdrawn');assert.deepEqual(w.submissions[0].result,before);assert.deepEqual(app.store.memory(),memory)
 const other=app.store.forVisitor(crypto.randomUUID());await assert.rejects(app.route('POST','/api/review/action',request,other),{status:404})
 }finally{await app.close()}
})
test('partial a review prompt excludes answer key; unavailable model leaves authored selfcheck usable',async()=>{
 let prompt;const app=fixture(async args=>{prompt=JSON.parse(args.prompt);throw Error('offline')})
 try{const w=await submitted(app);assert.equal(w.submissions[0].reviewStatus,'failed');assert.equal(prompt.task.roots,undefined);assert.equal(prompt.task.series,undefined);assert.equal(prompt.submission.finalAnswer,'');const r=await app.route('POST','/api/review/selfcheck',{workId:w.id,submissionId:w.submissions[0].id});assert.ok(r.checklist.length>0)}finally{await app.close()}
})
test('solo review actions cannot expose help and numeric corrections keep exact checker',async()=>{
 const app=fixture(async()=>({text:JSON.stringify({summary:'Проверь исходную величину',findings:[]})}));try{
 let w=(await app.route('POST','/api/work/new',{packageId:'percentages',mode:'solo'})).work
 for(const path of ['/api/review/action','/api/review/selfcheck'])await assert.rejects(app.route('POST',path,{workId:w.id,...version(w),requestId:'solo',action:'correct',submissionId:'missing'}))
 w=(await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:0,document:w.document,finalAnswer:'1200'})).work
 await app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:'num1'});await tick();w=app.store.get(w.id)
 assert.equal(w.submissions[0].result.status,'correct');assert.equal(w.submissions[0].seriesResult,undefined)
 w=(await app.route('POST','/api/review/action',action(w))).work
 w=(await app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:'num2'})).work
 assert.equal(w.submissions[1].result.status,'correct');assert.equal(w.submissions[1].correctionOf,w.submissions[0].id)
 assert.equal(app.store.memory()[0].independent,false)
 }finally{await app.close()}
})
test('failed objection is retryable with a fresh receipt and never changes checker evidence',async()=>{
 let calls=0;const app=fixture(async()=>{if(++calls===1)return {text:response};throw Error('offline')});try{
 let w=await submitted(app),request=action(w,{action:'object',findingId:w.submissions[0].findings[0].id,explanation:'Мой способ другой'})
 await app.route('POST','/api/review/action',request);await tick();w=app.store.get(w.id)
 assert.equal(w.submissions[0].findings[0].objections[0].status,'failed')
 await app.route('POST','/api/review/action',request);assert.equal(calls,2)
 await app.route('POST','/api/review/action',action(w,{action:'object',requestId:'retry',findingId:request.findingId,explanation:request.explanation}));await tick()
 assert.equal(app.store.get(w.id).submissions[0].findings[0].objections.length,2);assert.equal(app.store.memory().length,1)
 }finally{await app.close()}
})
test('direct editing and resubmission links each correction without rewriting the independent original',async()=>{
 const app=fixture();try{
 let w=(await app.route('POST','/api/work/new',{packageId:'percentages',mode:'solo'})).work
 w=(await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:w.revision,document:w.document,finalAnswer:'1200'})).work
 await app.route('POST','/api/submit',{workId:w.id,...version(w),requestId:'direct1'});await tick();w=app.store.get(w.id)
 const first=structuredClone(w.submissions[0]),firstEvidence=app.store.memory().find(e=>e.submissionId===first.id)
 assert.equal(firstEvidence.independent,true);assert.equal(first.correctionOf,undefined)
 for(const [answer,requestId] of [['1100','direct2'],['1200','direct3']]){
   w=(await app.route('POST','/api/work/save',{workId:w.id,expectedRevision:w.revision,document:w.document,finalAnswer:answer})).work
   await app.route('POST','/api/submit',{workId:w.id,...version(w),requestId});await tick();w=app.store.get(w.id)
 }
 assert.equal(w.submissions[1].correctionOf,first.id);assert.equal(w.submissions[2].correctionOf,w.submissions[1].id)
 assert.deepEqual(w.submissions[0],first);assert.deepEqual(app.store.memory().find(e=>e.submissionId===first.id),firstEvidence)
 assert.equal(app.store.memory().filter(e=>e.independent).length,1)
 }finally{await app.close()}
})

test('malformed structured review is retryable rather than displayed as JSON or math failure',()=>{assert.throws(()=>parseReview('{\"summary\":',{}),/неполный разбор/);assert.throws(()=>parseReview('{\"summary\":\"ok\"}',{}),/неполный разбор/)})

test('fresh strict review rejects non-JSON, missing schema and malformed or uncited findings',()=>{
 const s={generalAnswer:'x=0',finalAnswer:'',document:{type:'doc'}},strict={strict:true}
 const valid={anchor:{kind:'answer_a',quote:'x=0'},message:'Проверь подстановкой.',suggestion:'Подставь значение.'}
 for(const raw of ['Ты неправильно решил задачу.','```json\n{"summary":"Проверь","findings":[]}\n```',JSON.stringify({summary:'Решение ошибочно.'}),JSON.stringify({summary:'Проверь',findings:null}),JSON.stringify({summary:'Проверь',findings:[],verdict:'incorrect'})])assert.throws(()=>parseReview(raw,s,false,strict),/неполный разбор/)
 for(const item of [null,{}, {...valid,anchor:{kind:'answer_b',quote:'π'}}, {...valid,anchor:{kind:'answer_a',quote:'x=1'}}, {...valid,message:''}, {...valid,message:'x'.repeat(3001)}, {...valid,action:'fail'}, {...valid,anchor:{...valid.anchor,position:3}}])assert.throws(()=>parseReview(JSON.stringify({summary:'Ошибка',findings:[valid,item]}),s,false,strict),/неполный разбор/)
 assert.throws(()=>parseReview(JSON.stringify({summary:'Проверь',findings:Array.from({length:6},()=>valid)}),s,false,strict),/неполный разбор/)
 // The compatibility path still reads historical prose and tolerates the old
 // provider format; opting in applies only to fresh review acceptance.
 assert.equal(parseReview('Ты неправильно решил задачу.',s).review,'Ты неправильно решил задачу.')
 assert.equal(parseReview(JSON.stringify({summary:'Старый разбор',findings:[{anchor:{kind:'answer_b',quote:'π'},message:'Ошибка'}]}),s).findings.length,0)
})

test('strict review exposes only cited disputable findings and a neutral programmatic summary',()=>{
 const s={generalAnswer:'x=0',finalAnswer:'12',document:{type:'doc',content:[{type:'paragraph',attrs:{id:'own-line'},content:[{type:'text',text:'Мой другой способ'}]}]}},before=structuredClone(s)
 const r=parseReview(JSON.stringify({summary:'UNANCHORED_ACCUSATION',findings:[{anchor:{kind:'block',blockId:'own-line',quote:'другой способ'},message:'Уточни этот переход.',suggestion:'Запиши использованное условие.'}]}),s,true,{strict:true})
 assert.equal(r.findings.length,1);assert.equal(r.findings[0].anchor.blockId,'own-line');assert.equal(r.findings[0].anchor.quote,'другой способ')
 assert.equal(r.findings[0].message,'Уточни этот переход.');assert.equal(r.findings[0].status,'open');assert.equal(r.findings[0].source,'model');assert.deepEqual(r.findings[0].objections,[]);assert.equal(typeof r.findings[0].id,'string')
 assert.ok(!r.review.includes('UNANCHORED_ACCUSATION'));assert.equal(r.review,r.reviewSummary);assert.deepEqual(s,before)
 const noIssues=parseReview(JSON.stringify({summary:'Любой способ ученика ошибочен.',findings:[]}),s,true,{strict:true})
 assert.deepEqual(noIssues,{review:'Замечаний к записи не выделено. Это не подтверждает правильность каждого перехода.',reviewSummary:'Замечаний к записи не выделено. Это не подтверждает правильность каждого перехода.',findings:[]})
 assert.equal(parseReview(JSON.stringify({summary:'',findings:[]}),s,true,{strict:true}).findings.length,0)
 assert.throws(()=>parseReview(JSON.stringify({summary:'Проверь',findings:[{anchor:{kind:'block',blockId:'somebody-else',quote:'другой способ'},message:'Ошибка'}]}),s,true,{strict:true}),/неполный разбор/)
})
