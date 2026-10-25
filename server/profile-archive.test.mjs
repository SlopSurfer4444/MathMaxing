import {test} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {mkdtempSync,writeFileSync,rmSync,readdirSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Store,PROFILE_LIMITS} from './store.mjs'
import {createProfileArchive,PROFILE_ARCHIVE_BODY_LIMIT} from './profile-archive.mjs'
import {createExamRuntime} from './exam/runtime.mjs'
import {createExamPhotos} from './exam/photos.mjs'
const fixture=()=>{const directory=mkdtempSync(join(tmpdir(),'school-profile-')),store=new Store(':memory:'),api=createProfileArchive({config:{photoDir:directory},store});return {store,api,directory,close(){store.close();rmSync(directory,{recursive:true,force:true})}}}
const sign=archive=>{archive.sha256=createHash('sha256').update(JSON.stringify(archive.payload)).digest('hex');return archive}

test('complete logical archive restores frozen legacy work, immutable attempts, learning, evidence and photo originals into an isolated visitor',()=>{
 const f=fixture();try{
 const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID()),w=a.create('double-angle-cos','solo'),submissionId=randomUUID()
 w.mode='review';w.submissions=[{id:submissionId,createdAt:w.createdAt,mode:'solo',helpCount:0,result:{status:'correct'},snapshot:{document:structuredClone(w.document)},evaluations:[{id:randomUUID(),status:'unknown'}]}];a.put(w);a.evidence(w.submissions[0],w);a.learning();for(let i=0;i<305;i++)a.learningChecked({workId:w.id,summary:`fact ${i}`})
 const photoId=randomUUID(),imageId=randomUUID(),file=`${photoId}-${imageId}.bin`,bytes=Buffer.from('photo original')
 f.store.db.exec('CREATE TABLE photo_inputs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL)')
 const photo={id:photoId,owner:a.owner,workId:w.id,status:'uploaded',revision:0,images:[{id:imageId,file,size:bytes.length,type:'image/png'}]}
 writeFileSync(join(f.directory,file),bytes);f.store.db.prepare('INSERT INTO photo_inputs VALUES(?,?,?,?)').run(photoId,a.owner,w.id,JSON.stringify(photo))
 const archive=f.api.exportProfile(a),restored=f.api.restoreProfile(archive,b),id=restored.idMap[w.id],copy=b.get(id)
 assert.notEqual(id,w.id);assert.equal(copy.submissions[0].result.status,'unknown');assert.equal(copy.submissions[0].result.archivedStatus,'correct');assert.equal(copy.submissions[0].provenance,'imported-unverified');assert.equal(copy.submissions[0].evaluations[0].status,'unknown');assert.deepEqual(b.problem(copy),a.problem(w));assert.equal(b.current().id,id);assert.equal(b.memory()[0].submissionId,restored.idMap[submissionId]);assert.equal(b.learningEvidence().length,60)
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM learning_event_archive WHERE owner=?').get(b.owner).n,5)
 assert.equal(restored.attachments,1);assert.equal(readdirSync(f.directory).length,2);assert.throws(()=>b.get(w.id),{status:404});assert.equal(a.current().id,w.id)
 const roundtrip=f.api.exportProfile(b);assert.equal(Buffer.from(roundtrip.payload.attachments[0].data,'base64').toString(),bytes.toString())
 }finally{f.close()}
})

test('all separate exam tables, three-part answers, immutable evaluations and sessions survive restore',()=>{
 const f=fixture();try{
 const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID()),id=randomUUID(),instanceId=randomUUID(),attemptId=randomUUID(),evaluationId=randomUUID(),sessionId=randomUUID()
 f.store.db.exec(`CREATE TABLE exam_instances(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE exam_works(id TEXT PRIMARY KEY,owner TEXT NOT NULL,family_id TEXT NOT NULL,updated_at TEXT NOT NULL,completed INTEGER NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL);CREATE TABLE exam_sessions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE exam_current(owner TEXT PRIMARY KEY,work_id TEXT NOT NULL);CREATE TABLE exam_observations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,work_id TEXT NOT NULL,family_id TEXT NOT NULL,attempt_id TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);CREATE TABLE exam_requests(owner TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(owner,request_id))`)
 const instance={id:'frozen-template',familyId:'removed-family',parts:[{id:'a',expected:'1'},{id:'b',expected:'2'},{id:'proof',expected:'rubric'}]},work={id,instanceId,answersByPart:{a:'1',b:'2',proof:'my proof'},reasoning:'preserved',attempts:[{id:attemptId,answersByPart:{a:'1',b:'2',proof:'my proof'}}],evaluations:[{id:evaluationId,attemptId,partId:'proof',status:'unknown'}]}
 f.store.db.prepare('INSERT INTO exam_instances VALUES(?,?,?)').run(instanceId,a.owner,JSON.stringify(instance));f.store.db.prepare('INSERT INTO exam_works VALUES(?,?,?,?,?,?,?)').run(id,a.owner,'removed-family','2026',0,1,JSON.stringify(work));f.store.db.prepare('INSERT INTO exam_sessions VALUES(?,?,?)').run(sessionId,a.owner,JSON.stringify({id:sessionId,tasks:[{workId:id}],blueprint:{edition:'2026'}}));f.store.db.prepare('INSERT INTO exam_current VALUES(?,?)').run(a.owner,id);f.store.db.prepare('INSERT INTO exam_observations VALUES(?,?,?,?,?,?,?)').run(randomUUID(),a.owner,id,'removed-family',attemptId,'2026',JSON.stringify({attemptId,evaluationId}));f.store.db.prepare('INSERT INTO exam_requests VALUES(?,?,?,?)').run(a.owner,'request-a','fingerprint',JSON.stringify({work}))
 const archive=f.api.exportProfile(a),r=f.api.restoreProfile(archive,b),copy=JSON.parse(f.store.db.prepare('SELECT data FROM exam_works WHERE owner=?').get(b.owner).data)
 assert.equal(copy.id,r.idMap[id]);assert.equal(copy.instanceId,r.idMap[instanceId]);assert.deepEqual(copy.answersByPart,work.answersByPart);assert.equal(copy.evaluations[0].status,'unknown');assert.equal(copy.evaluations[0].attemptId,r.idMap[attemptId]);assert.equal(f.store.db.prepare('SELECT work_id FROM exam_current WHERE owner=?').get(b.owner).work_id,copy.id)
 for(const table of ['exam_instances','exam_requests','exam_observations','exam_sessions'])assert.equal(f.store.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE owner=?`).get(b.owner).n,1)
 assert.equal(JSON.parse(f.store.db.prepare('SELECT data FROM exam_instances WHERE owner=?').get(b.owner).data).parts[2].expected,'rubric')
 }finally{f.close()}
})

test('restore rejects corruption, traversal, missing attachments and cross-owner records before writing any data',()=>{
 const f=fixture();try{const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID());a.current();const base=f.api.exportProfile(a)
 for(const mutate of [archive=>archive.sha256='bad',archive=>{archive.payload.tables.works[0].owner=b.owner;sign(archive)},archive=>{archive.payload.tables['works; DROP TABLE settings']=[];sign(archive)},archive=>{archive.payload.settings.push({key:`visitor:${a.owner}:current`,value:a.current().id});sign(archive)},archive=>{archive.payload.attachments.push({file:'../../secret',size:1,data:'YQ==',sha256:'x'});sign(archive)}]){const candidate=structuredClone(base);mutate(candidate);assert.throws(()=>f.api.restoreProfile(candidate,b));assert.equal(b.list().length,0);assert.equal(readdirSync(f.directory).length,0)}
 }finally{f.close()}
})

test('restore rolls back all database records and newly written files on an insert failure',()=>{
 const f=fixture();try{const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID());a.current();const photoId=randomUUID(),imageId=randomUUID(),file=`${photoId}-${imageId}.bin`,bytes=Buffer.from('photo kept')
 f.store.db.exec('CREATE TABLE photo_inputs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL)');writeFileSync(join(f.directory,file),bytes);f.store.db.prepare('INSERT INTO photo_inputs VALUES(?,?,?,?)').run(photoId,a.owner,a.current().id,JSON.stringify({id:photoId,owner:a.owner,workId:a.current().id,images:[{id:imageId,file,size:bytes.length,type:'image/png'}]}))
 const archive=f.api.exportProfile(a);f.store.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON works BEGIN SELECT RAISE(ABORT,'injected failure'); END")
 assert.throws(()=>f.api.restoreProfile(archive,b),/injected/);assert.equal(b.list().length,0);assert.equal(b.setting('current'),undefined);assert.deepEqual(readdirSync(f.directory),[file])
 }finally{f.close()}
})

test('archive routes require explicit restore and distinguish access recovery from data backup',()=>{
 const f=fixture();try{f.store.current();const archive=f.api.route('POST','/api/profile/archive/export',{}).archive;assert.throws(()=>f.api.route('POST','/api/profile/archive/restore',{archive}),{status:409});assert.equal(f.api.route('GET','/api/profile/archive/status',{}).recoveryIsBackup,false)}finally{f.close()}
})


test('logical export includes committed WAL writes and restores into a separate database',()=>{
 const directory=mkdtempSync(join(tmpdir(),'school-wal-')),source=new Store(join(directory,'source.sqlite')),target=new Store(join(directory,'target.sqlite'))
 try{const a=source.forVisitor(randomUUID()),b=target.forVisitor(randomUUID()),work=a.current();work.finalAnswer='WAL snapshot';a.put(work);assert.ok(statSync(join(directory,'source.sqlite-wal')).size>0)
 const archive=createProfileArchive({store:source}).exportProfile(a),result=createProfileArchive({store:target}).restoreProfile(archive,b);assert.equal(b.current().id,result.idMap[work.id]);assert.equal(b.current().finalAnswer,'WAL snapshot');assert.deepEqual(b.problem(b.current()),a.problem(work))
 }finally{source.close();target.close();rmSync(directory,{recursive:true,force:true})}
})


test('ownerwide solo and active exam gates never return private oracle in export or permit restore during a protected attempt',()=>{
 const f=fixture();try{
 const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID()),base=f.store.current(),archive=f.api.exportProfile()
 const solo=a.create('double-angle-cos','solo');a.create('double-angle-sin','guided')
 assert.equal(f.api.route('GET','/api/profile/archive/status',{},a).canExport,false)
 for(const operation of [()=>f.api.exportProfile(a),()=>f.api.restoreProfile(archive,a)])assert.throws(operation,error=>error.status===409&&!error.message.includes('roots'))
 solo.mode='review';solo.submissions=[{id:randomUUID(),reason:'submitted',result:{status:'unknown'}}];a.put(solo);assert.ok(f.api.exportProfile(a).payload.tables.works.length===2)
 f.store.db.exec('CREATE TABLE exam_sessions(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)');f.store.db.prepare('INSERT INTO exam_sessions VALUES(?,?,?)').run(randomUUID(),b.owner,JSON.stringify({status:'active',private:'ORACLE-MUST-NOT-LEAK'}))
 assert.throws(()=>f.api.exportProfile(b),error=>error.status===409&&!error.message.includes('ORACLE-MUST-NOT-LEAK'));assert.throws(()=>f.api.restoreProfile(archive,b),{status:409});assert.equal(f.store.get(base.id).id,base.id)
 }finally{f.close()}
})

test('explicit archive clear requires an unchanged verified snapshot, completed records, separate confirmations and preserves access credentials and peer data',()=>{
 const f=fixture();try{
 const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID()),work=a.current(),peer=b.current()
 work.mode='review';work.submissions=[{id:randomUUID(),reason:'submitted',result:{status:'unknown'}}];a.put(work);a.learning()
 f.store.db.exec('CREATE TABLE profile_recovery(owner TEXT PRIMARY KEY,code_hash TEXT);CREATE TABLE visitors(id TEXT PRIMARY KEY,token_hash TEXT);CREATE TABLE model_request_budget(day TEXT PRIMARY KEY,count INTEGER)');f.store.db.prepare('INSERT INTO profile_recovery VALUES(?,?)').run(a.owner,'retained-recovery-hash');f.store.db.prepare('INSERT INTO visitors VALUES(?,?)').run(a.owner,'retained-token-hash');f.store.db.prepare('INSERT INTO model_request_budget VALUES(?,?)').run('test',3)
 const photoId=randomUUID(),imageId=randomUUID(),file=`${photoId}-${imageId}.bin`,bytes=Buffer.from('private original')
 f.store.db.exec('CREATE TABLE photo_inputs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL)');writeFileSync(join(f.directory,file),bytes);f.store.db.prepare('INSERT INTO photo_inputs VALUES(?,?,?,?)').run(photoId,a.owner,work.id,JSON.stringify({id:photoId,owner:a.owner,workId:work.id,status:'ready',images:[{id:imageId,file,size:bytes.length,type:'image/png'}]}))
 let archive=f.api.exportProfile(a);assert.equal(archive.snapshotSha256,f.api.exportProfile(a).snapshotSha256)
 const confirm=()=>({snapshotSha256:archive.snapshotSha256,confirmSavedArchive:true,confirmDeleteProfile:true})
 assert.throws(()=>f.api.clearProfile({snapshotSha256:archive.snapshotSha256},a),{status:409})
 work.finalAnswer='changed after download';a.put(work);assert.throws(()=>f.api.clearProfile(confirm(),a),{status:409});assert.equal(a.list().length,1)
 archive=f.api.exportProfile(a);const result=f.api.route('POST','/api/profile/archive/clear',confirm(),a)
 assert.equal(result.cleared,true);assert.equal(result.deletedBytes,bytes.length);assert.equal(result.cleanupPending,0);assert.equal(a.list().length,0);assert.equal(a.setting('current'),undefined);assert.equal(readdirSync(f.directory).length,0);assert.equal(b.current().id,peer.id)
 assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM profile_recovery WHERE owner=?').get(a.owner).n,1);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM visitors WHERE id=?').get(a.owner).n,1);assert.equal(f.store.db.prepare('SELECT count FROM model_request_budget').get().count,3)
 const restored=f.api.restoreProfile(archive,a);assert.equal(a.current().id,restored.idMap[work.id]);assert.equal(a.current().finalAnswer,'changed after download');assert.equal(readdirSync(f.directory).length,1)
 }finally{f.close()}
})

test('clear blocks unfinished and pending holds and rollback leaves profile and originals intact',()=>{
 const f=fixture();try{
 const a=f.store.forVisitor(randomUUID()),work=a.current();let archive=f.api.exportProfile(a)
 const body=()=>({snapshotSha256:archive.snapshotSha256,confirmSavedArchive:true,confirmDeleteProfile:true})
 assert.throws(()=>f.api.clearProfile(body(),a),{status:409})
 work.mode='review';work.submissions=[{id:randomUUID(),reason:'submitted',result:{status:'unknown'}}];work.messages=[{id:randomUUID(),status:'pending'}];a.put(work);archive=f.api.exportProfile(a);assert.throws(()=>f.api.clearProfile(body(),a),{status:409})
 work.messages=[];a.put(work);archive=f.api.exportProfile(a);f.store.db.exec("CREATE TRIGGER fail_clear BEFORE DELETE ON settings BEGIN SELECT RAISE(ABORT,'clear failed'); END");assert.throws(()=>f.api.clearProfile(body(),a),/clear failed/);assert.equal(a.current().id,work.id);assert.equal(a.list().length,1)
 }finally{f.close()}
})

test('restored verification and independence become historical unverified claims while original claims and learning outcomes remain available',()=>{
 const f=fixture();try{
 const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID()),work=a.current();work.submissions=[{id:randomUUID(),reason:'submitted',mode:'solo',helpCount:0,independent:true,attemptContext:{priorExposure:false,numericHelpSeen:false,preparationUsed:false},result:{status:'correct'},seriesResult:{status:'correct'}}];a.put(work);a.evidence(work.submissions[0],work)
 const learning=a.learning();learning.progress={K1:{step:1,answers:{},outcomes:{probe:'correct'},attempts:{probe:1}}};a.setSetting('learning',JSON.stringify(learning));const result=f.api.restoreProfile(f.api.exportProfile(a),b),restored=b.get(result.idMap[work.id])
 assert.equal(restored.provenance,'imported-unverified');assert.equal(restored.submissions[0].independent,false);assert.equal(restored.submissions[0].archivedIndependent,true);assert.equal(restored.submissions[0].attemptContext.priorExposure,true);assert.equal(restored.submissions[0].result.status,'unknown');assert.equal(restored.submissions[0].result.archivedStatus,'correct');assert.equal(b.memory()[0].independent,false);assert.equal(b.learning().progress.K1.outcomes.probe,'unknown');assert.equal(b.learning().archivedProgress.K1.outcomes.probe,'correct');const c=f.store.forVisitor(randomUUID()),again=f.api.restoreProfile(f.api.exportProfile(b),c),cycled=c.get(again.idMap[restored.id]);assert.equal(cycled.submissions[0].archivedIndependent,true);assert.equal(cycled.submissions[0].archivedAttemptContext.priorExposure,false);assert.equal(cycled.submissions[0].result.archivedStatus,'correct');assert.equal(c.learning().archivedProgress.K1.outcomes.probe,'correct')
 }finally{f.close()}
})

test('exam photo text and private import receipts roundtrip after originals removal with coherent history IDs',async()=>{
 for(const withHistory of [false,true]){
  const f=fixture(),runtime=createExamRuntime({store:f.store})
  let photos
  try{
   const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID())
   let work=(await runtime.route('POST','/api/exam/start',{familyId:'number.percent',mode:'guided',seed:15,requestId:'photo-archive-start'},a)).work
   photos=createExamPhotos({store:f.store,config:{photoDir:f.directory},readWork:runtime.readPublicWork,saveWork:runtime.saveWork,assertWritable:runtime.assertWritable})
   const image={name:'archive.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/k3sAAAAASUVORK5CYII='}
   const call=(action,body={})=>photos.route('POST',`/api/exam/photo/${action}`,{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,...body},a)
   let {photo}=await call('upload',{images:[image]})
   let result=await call('confirm',{photoId:photo.id,expectedPhotoRevision:photo.revision,requestId:randomUUID(),confirmed:true,lines:[{id:randomUUID(),kind:'math',value:'Первая запись 2+2=5',uncertain:false,partId:work.instance.parts[0].id}]})
   work=result.work;photo=(await call('remove',{photoId:photo.id,expectedPhotoRevision:result.photo.revision})).photo
   if(withHistory){
    photo=(await call('upload',{photoId:photo.id,expectedPhotoRevision:photo.revision,images:[image]})).photo
    result=await call('confirm',{photoId:photo.id,expectedPhotoRevision:photo.revision,requestId:'photo-archive-second',confirmed:true,lines:[{id:randomUUID(),kind:'text',value:'Вторая запись',uncertain:false,partId:null}]})
    work=result.work;photo=(await call('remove',{photoId:photo.id,expectedPhotoRevision:result.photo.revision})).photo
   }
   work=(await runtime.route('POST','/api/exam/submit',{workId:work.id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:'photo-archive-submit'},a)).work
   const sourcePhoto=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data)
   const sourceWork=f.store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data
   const archive=f.api.exportProfile(a)
   assert.deepEqual(archive.payload.attachments,[]);assert.deepEqual(readdirSync(f.directory),[])
   const restored=f.api.restoreProfile(archive,b),copyWorkId=restored.idMap[work.id]
   assert.equal(restored.attachments,0)
   const row=f.store.db.prepare('SELECT id,work_id,data FROM photo_inputs WHERE owner=?').get(b.owner),copy=JSON.parse(row.data)
   assert.notEqual(row.id,photo.id);assert.equal(row.id,restored.idMap[photo.id]);assert.equal(row.work_id,copyWorkId)
   assert.equal(copy.id,row.id);assert.equal(copy.workId,copyWorkId);assert.equal(copy.owner,b.owner);assert.deepEqual(copy.images,[])
   assert.equal(copy.provenance,'imported-unverified');assert.equal(copy.originalsRemovedAt,sourcePhoto.originalsRemovedAt)
   const compareRecord=(actual,source)=>{
    assert.equal(actual.provenance,'imported-unverified')
    assert.equal(actual.id,restored.idMap[source.id]);assert.equal(actual.revision,source.revision)
    assert.equal(actual.createdAt,source.createdAt);assert.equal(actual.importedAt,source.importedAt);assert.equal(actual.originalsRemovedAt,source.originalsRemovedAt)
    const signature=JSON.parse(source.receipt.signature)
    signature.lines=signature.lines.map(line=>({...line,...(line.id?{id:restored.idMap[line.id]??line.id}:{})}))
    assert.deepEqual(actual.receipt,{...source.receipt,id:restored.idMap[source.receipt.id]??source.receipt.id,signature:JSON.stringify(signature),provenance:'imported-unverified'})
    assert.deepEqual(actual.lines,source.lines.map(line=>({...line,id:restored.idMap[line.id]})))
   }
   compareRecord(copy,sourcePhoto)
   assert.equal(copy.history?.length??0,withHistory?1:0)
   for(let i=0;i<(sourcePhoto.history?.length??0);i++)compareRecord(copy.history[i],sourcePhoto.history[i])
   const restoredWork=JSON.parse(f.store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(copyWorkId).data)
   assert.equal(restoredWork.provenance,'imported-unverified');assert.deepEqual(restoredWork.answersByPart,work.answersByPart);assert.equal(restoredWork.reasoning,work.reasoning)
   assert.equal(restoredWork.attempts[0].provenance,'imported-unverified');assert.equal(restoredWork.attempts[0].independent,false)
   const publicPhoto=(await photos.route('POST','/api/exam/photo/list',{workId:copyWorkId},b)).photo
   assert.equal(publicPhoto.receipt,undefined);assert.ok((publicPhoto.history??[]).every(item=>item.receipt===undefined))
   const corrected=(await runtime.route('POST','/api/exam/correct',{workId:copyWorkId,expectedRevision:restoredWork.revision,expectedModeEpoch:restoredWork.modeEpoch,requestId:'photo-archive-correct'},b)).work
   const next=(await photos.route('POST','/api/exam/photo/upload',{workId:copyWorkId,expectedRevision:corrected.revision,expectedModeEpoch:corrected.modeEpoch,photoId:copy.id,expectedPhotoRevision:copy.revision,images:[image]},b)).photo
   assert.notEqual(next.id,copy.id);assert.equal(next.history.length,(copy.history?.length??0)+1)
   const nextStored=JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(next.id).data)
   assert.deepEqual(nextStored.history.slice(0,-1),copy.history??[]);assert.deepEqual(nextStored.history.at(-1).receipt,copy.receipt);assert.deepEqual(nextStored.history.at(-1).lines,copy.lines)
   assert.equal(f.store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data,sourceWork)
   assert.deepEqual(JSON.parse(f.store.db.prepare('SELECT data FROM photo_inputs WHERE id=?').get(photo.id).data),sourcePhoto)
  }finally{photos?.close();runtime.close();f.close()}
 }
})

test('archive rejects empty legacy photos, invalid removed-original markers and excessive retained photo metadata before restore',()=>{
 const f=fixture();try{
  const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID()),work=a.current(),photoId=randomUUID()
  f.store.db.exec('CREATE TABLE photo_inputs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL)')
  const photo={id:photoId,owner:a.owner,workId:work.id,kind:'exam-literal',status:'ready',revision:1,images:[],lines:[{id:randomUUID(),kind:'text',value:'Сохранённая запись',uncertain:false,note:'',checked:false,partId:null}],originalsRemovedAt:new Date().toISOString()}
  f.store.db.prepare('INSERT INTO photo_inputs VALUES(?,?,?,?)').run(photoId,a.owner,work.id,JSON.stringify(photo))
  const base=f.api.exportProfile(a)
  const {owner,workId,images,...historical}=photo
  const variants=[
   record=>{delete record.kind},
   record=>{delete record.originalsRemovedAt},
   record=>{record.originalsRemovedAt='not-a-date'},
   record=>{record.history=Array.from({length:21},()=>({...historical,id:randomUUID()}))},
   record=>{record.history=[{...historical,id:randomUUID(),retainedMetadata:'x'.repeat(1_800_001)}]},
  ]
  for(const [index,mutate] of variants.entries()){
   const candidate=structuredClone(base),row=candidate.payload.tables.photo_inputs[0],record=JSON.parse(row.data)
   mutate(record);row.data=JSON.stringify(record);sign(candidate)
   assert.throws(()=>f.api.restoreProfile(candidate,b),index<3?/Повреждены метаданные снимка/:/История фото превышает допустимый размер/)
   assert.equal(b.list().length,0);assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM photo_inputs WHERE owner=?').get(b.owner).n,0)
   assert.deepEqual(readdirSync(f.directory),[])
  }
 }finally{f.close()}
})

test('a Store profile at its exact decoded payload limit exports despite larger JSON framing',()=>{
 const f=fixture();try{
  const a=f.store.forVisitor(randomUUID()),work=a.current(),limit=PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes
  const remaining=limit-a.profileBudget().bytes
  a.setSetting('archive-boundary','x'.repeat(remaining))
  assert.equal(a.profileBudget().bytes,12_000_000)
  const archive=f.api.exportProfile(a)
  assert.equal(archive.payload.tables.works[0].id,work.id)
  assert.equal(archive.payload.settings.find(row=>row.key==='archive-boundary').value.length,remaining)
  assert.ok(Buffer.byteLength(JSON.stringify(archive))>limit)
 }finally{f.close()}
})

test('escape-heavy settings restore by decoded Store bytes with exact content and provenance headroom',()=>{
 const f=fixture();try{
  const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID()),work=a.current()
  const value=String.fromCharCode(34,92,1,10).repeat(1_025_000)
  a.setSetting('escaped-archive-setting',value)
  const sourceBytes=a.profileBudget().bytes
  assert.ok(sourceBytes<PROFILE_LIMITS.bytes)
  const archive=f.api.exportProfile(a)
  assert.ok(Buffer.byteLength(JSON.stringify(archive))>PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes)
  const restored=f.api.restoreProfile(archive,b)
  assert.equal(b.current().id,restored.idMap[work.id]);assert.equal(b.current().provenance,'imported-unverified')
  assert.equal(b.setting('escaped-archive-setting'),value)
  assert.equal(Buffer.byteLength(b.setting('escaped-archive-setting')),Buffer.byteLength(value))
  assert.ok(b.profileBudget().bytes>=sourceBytes);assert.ok(b.profileBudget().bytes<PROFILE_LIMITS.bytes)
 }finally{f.close()}
})

test('signed archives over the decoded Store limit fail before parsing records or writing target data',()=>{
 const f=fixture();try{
  const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID())
  a.current();const archive=f.api.exportProfile(a)
  archive.payload.settings.push({key:'oversized-decoded-setting',value:'x'.repeat(PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes+1)})
  archive.payload.tables.works[0].data='{deliberately malformed JSON'
  sign(archive)
  assert.throws(()=>f.api.restoreProfile(archive,b),{status:413})
  assert.equal(b.list().length,0);assert.equal(b.setting('oversized-decoded-setting'),undefined)
  assert.deepEqual(readdirSync(f.directory),[])
 }finally{f.close()}
})

test('archive metadata has its own bounded budget even when decoded Store payload is small',()=>{
 const f=fixture(),runtime=createExamRuntime({store:f.store});try{
  const a=f.store.forVisitor(randomUUID()),b=f.store.forVisitor(randomUUID())
  runtime.createWork(a,{familyId:'number.percent',mode:'guided',seed:15})
  const archive=f.api.exportProfile(a)
  assert.ok(a.profileBudget().bytes<100_000)
  archive.payload.tables.exam_works[0].family_id='x'.repeat(16*1024*1024+1)
  sign(archive)
  assert.throws(()=>f.api.restoreProfile(archive,b),{status:413})
  assert.equal(f.store.db.prepare('SELECT COUNT(*) n FROM exam_works WHERE owner=?').get(b.owner).n,0)
  assert.deepEqual(readdirSync(f.directory),[])
 }finally{runtime.close();f.close()}
})

test('physical archive body bound covers media base64 plus worst-case JSON escaping and row metadata',()=>{
 const mediaBase64Bytes=Math.ceil(100*1024*1024/3)*4
 const escapedPayloadBytes=6*(PROFILE_LIMITS.bytes+PROFILE_LIMITS.editReserveBytes)
 const rowMetadataBytes=16*1024*1024
 assert.equal(PROFILE_ARCHIVE_BODY_LIMIT,256*1024*1024)
 assert.ok(PROFILE_ARCHIVE_BODY_LIMIT>mediaBase64Bytes+escapedPayloadBytes+rowMetadataBytes)
})
