import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../store.mjs'
import { createExamPhotos, validateExamPhotoLines } from './photos.mjs'
import { createExamRuntime } from './runtime.mjs'
import { createExamSessions } from './sessions.mjs'

const image={name:'literal.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/k3sAAAAASUVORK5CYII='}
const line=(value='2+2=5',extra={})=>({kind:'math',value,uncertain:false,note:'',partId:null,...extra})
function fixture(options={}){
  const store=new Store(':memory:'),directory=mkdtempSync(join(tmpdir(),'exam-photo-'))
  store.db.exec('CREATE TABLE photo_test_work(id TEXT PRIMARY KEY,owner TEXT,data TEXT)')
  const work={id:crypto.randomUUID(),instance:{parts:[{id:'arbitrary-proof',label:'Доказательство'},{id:'number-6',label:'Ответ'}]},mode:'solo',modeEpoch:0,revision:0,reasoning:'Моя запись',answersByPart:{},completed:false}
  store.db.prepare('INSERT INTO photo_test_work VALUES(?,?,?)').run(work.id,store.owner,JSON.stringify(work))
  const readWork=(visitor,id)=>{const row=store.db.prepare('SELECT data FROM photo_test_work WHERE id=? AND owner=?').get(id,visitor.owner);if(!row)throw Object.assign(Error('missing'),{status:404});return JSON.parse(row.data)}
  let blocked=false
  const assertWritable=(visitor,id)=>{if(blocked||readWork(visitor,id).completed)throw Object.assign(Error('session expired/submitted'),{status:409})}
  const saveWork=(visitor,b)=>{assertWritable(visitor,b.workId);const saved=readWork(visitor,b.workId);if(b.expectedRevision!==saved.revision||b.expectedModeEpoch!==saved.modeEpoch)throw Object.assign(Error('stale'),{status:409});Object.assign(saved,{answersByPart:b.answersByPart,reasoning:b.reasoning,revision:saved.revision+1});store.db.prepare('UPDATE photo_test_work SET data=? WHERE id=?').run(JSON.stringify(saved),saved.id);return {work:saved}}
  const photos=createExamPhotos({store,config:{photoDir:directory,provider:'codex'},readWork,saveWork,assertWritable,...options})
  const call=(action,body={},visitor=store)=>photos.route('POST',`/api/exam/photo/${action}`,{workId:work.id,expectedRevision:readWork(store,work.id).revision,expectedModeEpoch:0,...body},visitor)
  return {store,work,call,photos,readWork,saveWork,directory,block(){blocked=true},upload:()=>call('upload',{images:[image]}),close(){photos.close();store.close();rmSync(directory,{force:true,recursive:true})}}
}

test('literal generic lines ignore provider answer metadata and retain incorrect expressions',()=>{
  const lines=validateExamPhotoLines([line('а) 2+2=5',{answer:'a',partId:'arbitrary-proof'})],{fromModel:true})
  assert.equal(lines[0].value,'а) 2+2=5');assert.equal(lines[0].partId,null);assert.equal(lines[0].checked,false)
  assert.equal(validateExamPhotoLines([line('2+2=5',{answer:'b'})],{fromModel:true})[0].value,'б) 2+2=5')
  assert.throws(()=>validateExamPhotoLines([line('x',{partId:'not-this-instance'})],{partIds:['arbitrary-proof']}))
  assert.throws(()=>validateExamPhotoLines(Array(151).fill(line())))
  assert.throws(()=>validateExamPhotoLines([line('x'.repeat(6001))]))
})

test('owner isolation, safe original projection and strict upload bounds',async()=>{
  const f=fixture();try{
    await assert.rejects(f.call('upload',{images:Array(4).fill(image)}),{status:400})
    await assert.rejects(f.call('upload',{images:[{...image,data:'a!!='}]}),{status:400})
    await assert.rejects(f.call('upload',{expectedRevision:999,images:[image]}),{status:409})
    const {photo}=await f.upload();assert.equal(photo.owner,undefined);assert.equal(photo.images[0].file,undefined)
    assert.equal((await f.call('original',{photoId:photo.id,imageId:photo.images[0].id})).dataUrl,`data:image/png;base64,${image.data}`)
    const other=f.store.forVisitor(crypto.randomUUID())
    for(const action of ['list','original','remove'])await assert.rejects(f.call(action,{photoId:photo.id,imageId:photo.images[0].id,expectedPhotoRevision:0},other),{status:404})
    await assert.rejects(f.call('remove',{photoId:photo.id,expectedPhotoRevision:1}),{status:409})
    await f.call('remove',{photoId:photo.id,expectedPhotoRevision:0});assert.deepEqual(readdirSync(f.directory),[])
  }finally{f.close()}
})

test('manual confirmation uses generic part IDs, keeps reasoning, requires uncertainty check and is idempotent',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload(),lines=[line('2+2=5',{uncertain:true,partId:'number-6'})]
    const body={photoId:photo.id,expectedPhotoRevision:0,requestId:'same',lines,confirmed:true,expectedRevision:0}
    await assert.rejects(f.call('confirm',body),/неясные/)
    body.lines[0].checked=true
    const first=await f.call('confirm',body),again=await f.call('confirm',body)
    assert.equal(first.work.answersByPart['number-6'],'2+2=5')
    assert.equal(first.work.reasoning,'Моя запись\n\n2+2=5');assert.equal(first.work.mode,'solo');assert.equal(again.work.revision,1)
    await assert.rejects(f.call('confirm',{...body,lines:[line('different')]}),{status:409})
    await assert.rejects(f.call('confirm',{...body,expectedRevision:1,expectedPhotoRevision:1,requestId:'different'}),{status:409})
  }finally{f.close()}
})

test('selected existing answers require explicit replacement; work and photo CAS preserve drafts',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload();f.saveWork(f.store,{workId:f.work.id,expectedRevision:0,expectedModeEpoch:0,reasoning:'Другой черновик',answersByPart:{'number-6':'9'}})
    const body={photoId:photo.id,expectedPhotoRevision:0,requestId:'replace',confirmed:true,lines:[line('5',{partId:'number-6'})]}
    await assert.rejects(f.call('save',{...body,expectedRevision:0}),{status:409})
    await assert.rejects(f.call('confirm',body),/замену/)
    assert.equal(f.readWork(f.store,f.work.id).answersByPart['number-6'],'9')
    const result=await f.call('confirm',{...body,replaceAnswersConfirmed:true})
    assert.equal(result.work.answersByPart['number-6'],'5');assert.equal(result.work.reasoning,'Другой черновик\n\n5')
  }finally{f.close()}
})

test('literal OCR completes for its photo generation after a concurrent work draft save',async()=>{
  let settle;const pending=new Promise(resolve=>settle=resolve),f=fixture({recognize:async()=>pending})
  try{
    const {photo}=await f.upload(),job=f.call('recognize',{photoId:photo.id,expectedPhotoRevision:0})
    f.saveWork(f.store,{workId:f.work.id,expectedRevision:0,expectedModeEpoch:0,reasoning:'Новый независимый черновик',answersByPart:{'number-6':'9'}})
    const draft=f.readWork(f.store,f.work.id)
    settle({lines:[line('2+2=5')]})
    const result=await job
    assert.equal(result.photo.status,'ready');assert.equal(result.photo.lines[0].value,'2+2=5')
    assert.deepEqual(f.readWork(f.store,f.work.id),draft)
    await assert.rejects(f.call('confirm',{photoId:photo.id,expectedPhotoRevision:result.photo.revision,expectedRevision:0,requestId:'stale-import',confirmed:true,lines:result.photo.lines}),{status:409})
    assert.deepEqual(f.readWork(f.store,f.work.id),draft)
  }finally{f.close()}
})

test('late literal OCR cannot overwrite manual edits, mode generation changes or expired session',async()=>{
  for(const change of ['manual','epoch','expiry']){
    let settle;const pending=new Promise(resolve=>settle=resolve),f=fixture({recognize:async()=>pending})
    try{
      const {photo}=await f.upload(),job=f.call('recognize',{photoId:photo.id,expectedPhotoRevision:0})
      if(change==='manual')await f.call('save',{photoId:photo.id,expectedPhotoRevision:1,lines:[line('Моя правка')]})
      if(change==='expiry')f.block()
      if(change==='epoch'){const work=f.readWork(f.store,f.work.id);work.modeEpoch++;f.store.db.prepare('UPDATE photo_test_work SET data=? WHERE id=?').run(JSON.stringify(work),work.id)}
      settle({lines:[line('поздняя строка',{answer:'a'})]});await assert.rejects(job,{status:409})
      const current=(await f.call('list')).photo
      assert.equal(current.lines[0]?.value,change==='manual'?'Моя правка':undefined)
    }finally{f.close()}
  }
})

test('unavailable provider keeps originals for manual transcription; writes after expiry denied',async()=>{
  const f=fixture();try{
    let {photo}=await f.upload()
    await assert.rejects(f.call('recognize',{photoId:photo.id,expectedPhotoRevision:0}),{status:503})
    photo=(await f.call('list')).photo;assert.equal(photo.status,'failed');assert.equal(photo.lines.length,0)
    const saved=await f.call('save',{photoId:photo.id,expectedPhotoRevision:photo.revision,lines:[line('Записал вручную')]})
    f.block()
    for(const action of ['save','remove','recognize','confirm'])await assert.rejects(f.call(action,{photoId:photo.id,expectedPhotoRevision:saved.photo.revision,lines:[line()],requestId:'x',confirmed:true}),{status:409})
    assert.equal((await f.call('list')).photo.lines[0].value,'Записал вручную')
  }finally{f.close()}
})

test('owner aggregate media and metadata quotas apply before writing',async()=>{
  const f=fixture();try{
    f.store.db.prepare('INSERT INTO photo_inputs VALUES(?,?,?,?)').run(crypto.randomUUID(),f.store.owner,'old',JSON.stringify({images:[{size:100*1024*1024}]}))
    await assert.rejects(f.upload(),{status:429});assert.deepEqual(readdirSync(f.directory),[])
    f.store.db.prepare('DELETE FROM photo_inputs').run()
    const original=f.store.profileBudget;f.store.profileBudget=()=>({bytes:99,limits:{bytes:1,editReserveBytes:0}})
    await assert.rejects(f.upload(),{status:429});assert.deepEqual(readdirSync(f.directory),[])
    f.store.profileBudget=original
  }finally{f.close()}
})

test('OCR completion at the exact profile cap becomes a visible terminal failure without losing saved data',async()=>{
  for(const outcome of ['result','provider-failure']){
    let settle,reject
    const pending=new Promise((resolve,fail)=>{settle=resolve;reject=fail}),f=fixture({recognize:async()=>pending})
    try{
      let {photo}=await f.upload()
      // Exercise the revision digit boundary as well as the strict byte cap.
      for(let i=0;i<8;i++)({photo}=await f.call('save',{photoId:photo.id,expectedPhotoRevision:photo.revision,lines:[line('Прежняя проверенная запись')]}))
      const workBefore=f.readWork(f.store,f.work.id),job=f.call('recognize',{photoId:photo.id,expectedPhotoRevision:photo.revision,replaceConfirmed:true})
      const before=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data)
      assert.equal(before.status,'recognizing');assert.equal(before.revision,9)
      const budget=f.store.profileBudget(),cap=budget.limits.bytes+budget.limits.editReserveBytes
      const filler='F'.repeat(cap-budget.bytes)
      f.store.assertCanStore(Buffer.byteLength(filler));f.store.setSetting('concurrent-writer',filler)
      assert.equal(f.store.profileBudget().bytes,12_000_000)
      if(outcome==='result')settle({lines:[line('Новая строка'.repeat(300))]})
      else reject(Object.assign(Error('Поставщик распознавания недоступен.'),{status:503}))
      await assert.rejects(job,{status:outcome==='result'?429:503})
      const current=(await f.call('list')).photo
      assert.equal(current.status,'failed');assert.equal(current.revision,10)
      assert.match(current.error,/сохранены/)
      assert.deepEqual(JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data),{...before,status:'failed',revision:10})
      assert.deepEqual(current.lines,photo.lines);assert.deepEqual(current.images,photo.images)
      assert.deepEqual(f.readWork(f.store,f.work.id),workBefore)
      assert.equal((await f.call('original',{photoId:photo.id,imageId:photo.images[0].id})).dataUrl,`data:image/png;base64,${image.data}`)
      assert.equal(f.store.setting('concurrent-writer'),filler)
      assert.equal(f.store.profileBudget().bytes,cap-4)
    }finally{f.close()}
  }
})

test('full-profile OCR failure never overwrites a newer manual edit or removed original',async()=>{
  for(const change of ['manual','remove']){
    let settle
    const pending=new Promise(resolve=>settle=resolve),f=fixture({recognize:async()=>pending})
    try{
      let {photo}=await f.upload()
      ;({photo}=await f.call('save',{photoId:photo.id,expectedPhotoRevision:photo.revision,lines:[line('Прежняя проверенная длинная запись')]}))
      const job=f.call('recognize',{photoId:photo.id,expectedPhotoRevision:photo.revision,replaceConfirmed:true})
      const budget=f.store.profileBudget(),cap=budget.limits.bytes+budget.limits.editReserveBytes
      f.store.setSetting('concurrent-writer','F'.repeat(cap-budget.bytes))
      assert.equal(f.store.profileBudget().bytes,12_000_000)
      await f.call(change==='manual'?'save':'remove',{photoId:photo.id,expectedPhotoRevision:photo.revision+1,lines:[line('Моя правка')]})
      const before=f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data
      settle({lines:[line('Поздний результат'.repeat(200))]})
      await assert.rejects(job,{status:409})
      assert.equal(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data,before)
      const current=(await f.call('list')).photo
      assert.notEqual(current.status,'recognizing')
      if(change==='manual')assert.equal(current.lines[0].value,'Моя правка')
      else{assert.deepEqual(current.images,[]);assert.deepEqual(current.lines,photo.lines);assert.deepEqual(readdirSync(f.directory),[])}
    }finally{f.close()}
  }
})

test('explicit originals removal retains photo transcription and frees owner media quota',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload(),saved=await f.call('save',{photoId:photo.id,expectedPhotoRevision:0,lines:[line('Сохранённая запись')]})
    f.store.db.prepare('INSERT INTO photo_inputs VALUES(?,?,?,?)').run(crypto.randomUUID(),f.store.owner,'old',JSON.stringify({images:[{size:100*1024*1024-photo.images[0].size}]}))
    const next={...f.work,id:crypto.randomUUID()}
    f.store.db.prepare('INSERT INTO photo_test_work VALUES(?,?,?)').run(next.id,f.store.owner,JSON.stringify(next))
    const uploadNext=()=>f.photos.route('POST','/api/exam/photo/upload',{workId:next.id,expectedRevision:0,expectedModeEpoch:0,images:[image]},f.store)
    await assert.rejects(uploadNext(),{status:429})
    const result=await f.call('remove',{photoId:photo.id,expectedPhotoRevision:saved.photo.revision,expectedRevision:-1,expectedModeEpoch:-1})
    assert.equal(result.removed,true);assert.deepEqual(result.photo.lines,saved.photo.lines);assert.deepEqual(result.photo.images,[])
    assert.ok(Number.isFinite(Date.parse(result.photo.originalsRemovedAt)))
    assert.deepEqual((await f.call('list')).photo,result.photo);assert.deepEqual(readdirSync(f.directory),[])
    await assert.rejects(f.call('original',{photoId:photo.id,imageId:photo.images[0].id}),{status:404})
    await uploadNext()
  }finally{f.close()}
})

test('fresh upload after originals removal preserves prior import history and permits a distinct import',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload()
    const first=await f.call('confirm',{photoId:photo.id,expectedPhotoRevision:0,requestId:'first-import',confirmed:true,lines:[line('Первая запись',{partId:'number-6'})]})
    const removed=await f.call('remove',{photoId:photo.id,expectedPhotoRevision:first.photo.revision})
    const old=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data)
    const before=f.readWork(f.store,f.work.id)
    await assert.rejects(f.call('upload',{photoId:photo.id,expectedPhotoRevision:removed.photo.revision-1,images:[image]}),{status:409})
    assert.deepEqual(readdirSync(f.directory),[])
    const fresh=await f.call('upload',{photoId:photo.id,expectedPhotoRevision:removed.photo.revision,images:[image]})
    assert.notEqual(fresh.photo.id,photo.id);assert.equal(fresh.photo.revision,0);assert.deepEqual(fresh.photo.lines,[])
    assert.equal(fresh.photo.receipt,undefined);assert.equal(fresh.photo.importedAt,undefined);assert.equal(fresh.photo.originalsRemovedAt,undefined)
    assert.equal(fresh.photo.history.length,1);assert.equal(fresh.photo.history[0].receipt,undefined)
    const {history,images,owner,workId,...oldRecord}=old
    const stored=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(fresh.photo.id).data)
    assert.deepEqual(stored.history,[oldRecord]);assert.equal(stored.receipt,undefined)
    assert.equal(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id),undefined)
    assert.deepEqual(f.readWork(f.store,f.work.id),before)
    await assert.rejects(f.call('confirm',{photoId:photo.id,expectedPhotoRevision:removed.photo.revision,requestId:'first-import',confirmed:true,lines:first.photo.lines}),{status:404})
    assert.deepEqual(f.readWork(f.store,f.work.id),before)
    const second=await f.call('confirm',{photoId:fresh.photo.id,expectedPhotoRevision:0,requestId:'second-import',confirmed:true,lines:[line('Вторая запись')]})
    assert.equal(second.work.reasoning,'Моя запись\n\nПервая запись\n\nВторая запись')
    assert.equal(second.work.answersByPart['number-6'],'Первая запись')
    const after=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(fresh.photo.id).data)
    assert.equal(after.receipt.id,'second-import');assert.equal(after.history[0].receipt.id,'first-import')
    assert.deepEqual(after.history,[oldRecord]);assert.deepEqual((await f.call('list')).photo.history,fresh.photo.history)
  }finally{f.close()}
})

test('full photo history refuses replacement without evicting records or leaking new originals',async()=>{
  const f=fixture();try{
    const {photo}=await f.upload()
    const saved=await f.call('save',{photoId:photo.id,expectedPhotoRevision:0,lines:[line('Текущая сохранённая запись')]})
    const removed=await f.call('remove',{photoId:photo.id,expectedPhotoRevision:saved.photo.revision})
    const current=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data)
    const {images,owner,workId,...record}=current
    current.history=Array.from({length:20},()=>({...record,id:crypto.randomUUID()}))
    const before=JSON.stringify(current)
    f.store.db.prepare('UPDATE photo_inputs SET data=? WHERE id=?').run(before,photo.id)
    await assert.rejects(f.call('upload',{photoId:photo.id,expectedPhotoRevision:removed.photo.revision,images:[image]}),{status:429})
    assert.equal(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data,before)
    assert.deepEqual(readdirSync(f.directory),[])
    assert.equal((await f.call('list')).photo.history.length,20)
  }finally{f.close()}
})

test('review and completed work allow originals-only removal with exact work and receipt preservation',async()=>{
  for(const endAction of ['submit','finish']){
    const store=new Store(':memory:'),directory=mkdtempSync(join(tmpdir(),'exam-photo-retention-')),runtime=createExamRuntime({store})
    let photos
    try{
      let work=(await runtime.route('POST','/api/exam/start',{familyId:'number.percent',mode:'solo',seed:15,requestId:`retention-${endAction}`},store)).work
      photos=createExamPhotos({store,config:{photoDir:directory},readWork:runtime.readPublicWork,saveWork:runtime.saveWork,assertWritable:runtime.assertWritable})
      const call=(action,body={},visitor=store)=>photos.route('POST',`/api/exam/photo/${action}`,{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,...body},visitor)
      let {photo}=await call('upload',{images:[image]})
      const confirmed=await call('confirm',{photoId:photo.id,expectedPhotoRevision:photo.revision,requestId:'retention-import',confirmed:true,lines:[line('2+2=5',{partId:work.instance.parts[0].id})]})
      work=confirmed.work;photo=confirmed.photo
      work=(await runtime.route('POST',`/api/exam/${endAction}`,{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:`retention-${endAction}-end`},store)).work
      assert.ok(work.attempts.length>0);assert.equal(endAction==='finish'?work.completed:work.mode==='review',true)
      const workBefore=store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data
      const photoBefore=JSON.parse(store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data)
      const other=store.forVisitor(crypto.randomUUID())
      await assert.rejects(call('remove',{photoId:photo.id,expectedPhotoRevision:photo.revision},other),{status:404})
      await assert.rejects(call('remove',{photoId:photo.id,expectedPhotoRevision:photo.revision+1}),{status:409})
      assert.equal(readdirSync(directory).length,1)
      const removed=await photos.route('POST','/api/exam/photo/remove',{workId:work.id,photoId:photo.id,expectedPhotoRevision:photo.revision},store)
      assert.equal(removed.removed,true);assert.deepEqual(removed.photo.images,[]);assert.deepEqual(removed.photo.lines,photo.lines)
      assert.equal(removed.photo.status,'confirmed');assert.equal(removed.photo.importedAt,photo.importedAt)
      assert.equal(removed.photo.revision,photo.revision+1);assert.ok(Number.isFinite(Date.parse(removed.photo.originalsRemovedAt)))
      assert.equal(removed.photo.receipt,undefined);assert.deepEqual(readdirSync(directory),[])
      const photoAfter=JSON.parse(store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data)
      assert.deepEqual(photoAfter.receipt,photoBefore.receipt);assert.deepEqual(photoAfter.lines,photoBefore.lines)
      assert.equal(store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data,workBefore)
      await assert.rejects(call('original',{photoId:photo.id,imageId:photo.images[0].id}),{status:404})
      assert.deepEqual((await call('list')).photo,removed.photo)
    }finally{photos?.close();runtime.close();store.close();rmSync(directory,{force:true,recursive:true})}
  }
})

test('original read and removal reject symbolic links without touching the linked file or photo record',async t=>{
  const f=fixture();try{
    const {photo}=await f.upload(),stored=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data)
    const originalPath=join(f.directory,stored.images[0].file),heldPath=join(f.directory,'held-original.bin'),held=Buffer.from('preserve this unrelated file')
    unlinkSync(originalPath);writeFileSync(heldPath,held)
    try{symlinkSync(heldPath,originalPath,'file')}catch(error){if(['EPERM','EACCES','ENOTSUP'].includes(error.code)){t.skip(`Symbolic links unavailable: ${error.code}`);return}throw error}
    const before=f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data
    await assert.rejects(f.call('original',{photoId:photo.id,imageId:photo.images[0].id}),{status:409})
    await assert.rejects(f.call('remove',{photoId:photo.id,expectedPhotoRevision:photo.revision}),{status:409})
    assert.deepEqual(readFileSync(heldPath),held);assert.equal(lstatSync(originalPath).isSymbolicLink(),true)
    assert.equal(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data,before)
  }finally{f.close()}
})

test('an owner-wide active full exam blocks cleanup of older completed work until submission',async()=>{
  const store=new Store(':memory:'),directory=mkdtempSync(join(tmpdir(),'exam-photo-exam-guard-')),runtime=createExamRuntime({store})
  let photos
  try{
    const sessions=createExamSessions({store,...runtime})
    runtime.setSessionGuard(sessions.activeForWork);runtime.setSessionPolicy(sessions.policyForWork)
    let work=(await runtime.route('POST','/api/exam/start',{familyId:'number.percent',mode:'solo',seed:15,requestId:'guard-old-work'},store)).work
    photos=createExamPhotos({store,config:{photoDir:directory},readWork:runtime.readPublicWork,saveWork:runtime.saveWork,assertWritable:runtime.assertWritable})
    const {photo}=await photos.route('POST','/api/exam/photo/upload',{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,images:[image]},store)
    work=(await runtime.route('POST','/api/exam/finish',{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:'guard-finish'},store)).work
    assert.equal(work.completed,true)
    const workBefore=store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data
    const photoBefore=store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data
    const other=store.forVisitor(crypto.randomUUID())
    sessions.route('POST','/api/exam/session/start',{edition:'2026',requestId:'guard-other-exam'},other)
    const session=sessions.route('POST','/api/exam/session/start',{edition:'2026',requestId:'guard-owner-exam'},store).session
    const remove=()=>photos.route('POST','/api/exam/photo/remove',{workId:work.id,photoId:photo.id,expectedPhotoRevision:photo.revision},store)
    await assert.rejects(remove(),{status:403})
    assert.equal(readdirSync(directory).length,1)
    assert.equal(store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data,photoBefore)
    const submitted=sessions.route('POST','/api/exam/session/submit',{sessionId:session.id,expectedRevision:session.revision,expectedSessionEpoch:session.sessionEpoch,requestId:'guard-submit',workRevisions:session.tasks.map(task=>({workId:task.workId,revision:task.work.revision,modeEpoch:task.work.modeEpoch}))},store).session
    assert.equal(submitted.status,'submitted')
    assert.equal(sessions.route('GET','/api/exam/session/state',{},other).session.status,'active')
    assert.equal((await remove()).removed,true);assert.deepEqual(readdirSync(directory),[])
    assert.equal(store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data,workBefore)
  }finally{photos?.close();runtime.close();store.close();rmSync(directory,{force:true,recursive:true})}
})

test('real exam runtime integrates atomic import without an attempt or solution, and enforces session deadline',async()=>{
  const store=new Store(':memory:'),directory=mkdtempSync(join(tmpdir(),'exam-photo-runtime-')),runtime=createExamRuntime({store})
  let photos
  try{
    let work=(await runtime.route('POST','/api/exam/start',{familyId:'number.percent',mode:'solo',seed:15,requestId:'photo-work'},store)).work
    let policy={status:'active',deadlineAt:new Date(Date.now()+60000).toISOString()}
    runtime.setSessionPolicy(()=>policy);runtime.setSessionGuard(()=>true)
    photos=createExamPhotos({store,config:{photoDir:directory},readWork:runtime.readPublicWork,saveWork:runtime.saveWork,assertWritable:runtime.assertWritable,recognize:async(images)=>{assert.deepEqual(Object.keys(images[0]).sort(),['data','type']);return {lines:[line('2+2=5')]}}})
    const call=(action,body={})=>photos.route('POST',`/api/exam/photo/${action}`,{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,...body},store)
    let {photo}=await call('upload',{images:[image]})
    ;({photo}=await call('recognize',{photoId:photo.id,expectedPhotoRevision:photo.revision}))
    const result=await call('confirm',{photoId:photo.id,expectedPhotoRevision:photo.revision,requestId:'real-import',confirmed:true,lines:photo.lines.map(item=>({...item,partId:work.instance.parts[0].id}))})
    work=result.work
    assert.equal(work.reasoning,'2+2=5');assert.equal(work.mode,'solo');assert.equal(work.attempts.length,0);assert.equal(work.evaluations.length,0)
    assert.equal(JSON.stringify(result).includes('expected'),false);assert.equal(JSON.stringify(result).includes('reference'),false)
    assert.equal((await call('list')).work.familyId,undefined)
    policy={status:'active',deadlineAt:new Date(Date.now()-1).toISOString()}
    await assert.rejects(call('save',{photoId:photo.id,expectedPhotoRevision:result.photo.revision,lines:[line('late')]}),{status:409})
    policy={status:'submitted',deadlineAt:new Date(Date.now()+60000).toISOString()}
    await assert.rejects(call('remove',{photoId:photo.id,expectedPhotoRevision:result.photo.revision}),{status:409})
  }finally{photos?.close();runtime.close();store.close();rmSync(directory,{force:true,recursive:true})}
})
