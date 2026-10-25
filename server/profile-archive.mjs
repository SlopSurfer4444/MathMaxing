import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, lstatSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'

// Storage stays at 10 MB + 2 MB edit reserve, photos at 100 MiB. JSON can
// escape one stored byte as six characters. Bound its row/key envelope
// separately; 256 MiB also covers base64 media and the restore request wrapper.
export const PROFILE_ARCHIVE_BODY_LIMIT=256*1024*1024
const PHOTO_BYTES=100*1024*1024,DECODED_BYTES=12*1000000,METADATA_BYTES=16*1024*1024,ROWS=20000
// Exam photo transcriptions live until explicit profile removal: no TTL purge.
// Keep the producer's 20 previous records / 1.8 MB per-row caps during restore;
// historical receipts contain identity only and never become verified claims.
const EXAM_PHOTO_HISTORY_LIMIT=20,EXAM_PHOTO_METADATA_LIMIT=1_800_000
const fail=(message,status=400)=>Object.assign(Error(message),{status})
const hash=value=>createHash('sha256').update(value).digest('hex')
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const filename=/^[a-f0-9-]{36,80}\.bin$/
const schemas={
  works:'id TEXT PRIMARY KEY,data TEXT NOT NULL,owner TEXT NOT NULL',
  evidence:'id TEXT PRIMARY KEY,data TEXT NOT NULL,owner TEXT NOT NULL',
  learning_event_archive:'key TEXT PRIMARY KEY,owner TEXT NOT NULL,value TEXT NOT NULL',
  photo_inputs:'id TEXT PRIMARY KEY,owner TEXT NOT NULL,work_id TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(owner,work_id)',
  exam_instances:'id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL',
  exam_works:'id TEXT PRIMARY KEY,owner TEXT NOT NULL,family_id TEXT NOT NULL,updated_at TEXT NOT NULL,completed INTEGER NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL',
  exam_requests:'owner TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(owner,request_id)',
  exam_observations:'id TEXT PRIMARY KEY,owner TEXT NOT NULL,work_id TEXT NOT NULL,family_id TEXT NOT NULL,attempt_id TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL',
  exam_current:'owner TEXT PRIMARY KEY,work_id TEXT NOT NULL',
  exam_sessions:'id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL',
  exam_mixed:'id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL',
}
const columns=Object.fromEntries(Object.entries(schemas).map(([name,definition])=>[name,definition.split(',').filter(c=>!c.startsWith('PRIMARY')&&!c.startsWith('UNIQUE')&&!c.includes(')')).map(c=>c.split(' ')[0])]))
columns.photo_inputs=['id','owner','work_id','data'];columns.exam_requests=['owner','request_id','fingerprint','response']
const jsonColumns=new Set(['data','value','response'])
const parse=value=>{try{return JSON.parse(value)}catch{throw fail('Архив содержит повреждённую JSON-запись.')}}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))
function inspect(value,visit,depth=0){
  if(depth>80)throw fail('Слишком глубокая структура архива.')
  if(typeof value==='string')visit(value)
  else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
    if(['__proto__','prototype','constructor'].includes(key))throw fail('Недопустимый ключ архива.')
    visit(key);inspect(child,visit,depth+1)
  }
}
const scopeKey=(visitor,key)=>visitor.owner==='local'?key:`visitor:${visitor.owner}:${key}`
const stripKey=(owner,key)=>owner==='local'?key:key.slice(`visitor:${owner}:`.length)
const validKey=key=>typeof key==='string'&&key.length>0&&key.length<=400&&!key.startsWith('visitor:')&&!key.includes('\0')
const storedColumns=name=>columns[name].includes('data')?['data']:columns[name].includes('value')?['value']:columns[name].filter(key=>key!=='owner')
// Match Store.profileBudget: raw UTF-8 payload values, not JSON escaping or row
// wrappers. Check decoded size before parsing embedded notebooks or hashing a
// potentially much larger archive. Metadata has its own encoded byte ceiling.
function archiveSizes(tables,settings){
  let count=0,decodedBytes=0,metadataBytes=128
  const add=(row,payloadColumns)=>{
    if(!plain(row))throw fail('Неверная запись архива.')
    count++;if(count>ROWS)throw fail('Слишком много записей архива.',413)
    let encodedPayload=0,rawMetadata=0
    for(const [key,value] of Object.entries(row)){
      if(value!==null&&typeof value!=='string'&&typeof value!=='number')throw fail('Неверное значение архива.')
      const raw=value===null?0:Buffer.byteLength(String(value))
      if(payloadColumns.includes(key))decodedBytes+=raw
      else rawMetadata+=raw+Buffer.byteLength(key)+4
    }
    if(decodedBytes>DECODED_BYTES)throw fail('Данные архива превышают лимит хранилища профиля.',413)
    if(rawMetadata>METADATA_BYTES-metadataBytes)throw fail('Метаданные архива превышают лимит.',413)
    for(const key of payloadColumns)if(row[key]!==undefined&&row[key]!==null){const value=row[key];encodedPayload+=Buffer.byteLength(JSON.stringify(value))-(typeof value==='string'?2:0)}
    metadataBytes+=Buffer.byteLength(JSON.stringify(row))-encodedPayload+1
    if(metadataBytes>METADATA_BYTES)throw fail('Метаданные архива превышают лимит.',413)
  }
  for(const [name,rows] of Object.entries(tables)){
    if(!Object.hasOwn(schemas,name)||!Array.isArray(rows))throw fail('Неизвестная таблица архива.')
    metadataBytes+=Buffer.byteLength(name)+6
    for(const row of rows)add(row,storedColumns(name))
  }
  for(const row of settings)add(row,['value'])
  return {count,decodedBytes}
}

/** Portable logical snapshot: SQLite transaction includes committed WAL state; no raw database copy.
 * Auth/session/recovery credentials and model-budget tables are deliberately outside a profile.
 * The hash detects damage, not authorship; imports are explicit user-owned historical data.
 */
export function createProfileArchive({config={},store}){
  const db=store.db,directory=resolve(config.photoDir??join(config.dbPath&&config.dbPath!==':memory:'?dirname(config.dbPath):'.runtime','private-photos'))
  const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
  function accessBlock(visitor){
    try{if(JSON.parse(visitor.setting('mixed-practice:v1')??'null')?.status==='active')return 'Сначала заверши смешанную практику. Полный архив до завершения содержит будущие темы и закрытые ответы.'}catch{return 'Не удалось проверить состояние смешанной практики. Архив временно недоступен.'}
    if(exists('exam_sessions')&&db.prepare("SELECT 1 FROM exam_sessions WHERE owner=? AND json_extract(data,'$.status')='active' LIMIT 1").get(visitor.owner))return 'Сначала сдай активный экзаменационный вариант. Полный архив содержит закрытые ответы и до сдачи недоступен.'
    if(exists('exam_mixed')&&db.prepare("SELECT 1 FROM exam_mixed WHERE owner=? AND json_extract(data,'$.status') IN ('active','paused') LIMIT 1").get(visitor.owner))return 'Сначала заверши смешанную практику. Полный архив до завершения содержит скрытые темы и ответы.'
    if(db.prepare("SELECT 1 FROM works WHERE owner=? AND json_extract(data,'$.mode')='solo' LIMIT 1").get(visitor.owner)||(exists('exam_works')&&db.prepare("SELECT 1 FROM exam_works WHERE owner=? AND json_extract(data,'$.mode')='solo' AND COALESCE(json_extract(data,'$.completed'),0)=0 LIMIT 1").get(visitor.owner)))return 'Сначала сдай или закончи все самостоятельные работы и перейди к разбору. Полный архив содержит закрытые ответы; до завершения самостоятельных попыток экспорт и восстановление недоступны.'
    return null
  }
  function clearBlock(visitor){
    const block=accessBlock(visitor);if(block)return block
    if(db.prepare("SELECT 1 FROM works WHERE owner=? AND (NOT EXISTS (SELECT 1 FROM json_each(works.data,'$.submissions') WHERE json_extract(value,'$.reason')='submitted') OR EXISTS(SELECT 1 FROM json_tree(works.data) WHERE key IN ('status','reviewStatus') AND value='pending') OR json_extract(data,'$.preparation.open')=1 OR json_extract(data,'$.numericPreparation.open')=1) LIMIT 1").get(visitor.owner))return 'Сначала заверши сохранённые работы, подготовку и ожидающие запросы. Незавершённые записи не удаляются.'
    if(exists('exam_works')&&db.prepare("SELECT 1 FROM exam_works WHERE owner=? AND (COALESCE(json_extract(data,'$.completed'),0)=0 OR EXISTS(SELECT 1 FROM json_tree(exam_works.data) WHERE key='status' AND value='pending')) LIMIT 1").get(visitor.owner))return 'Сначала закончи все занятия и дождись завершения запросов. Незавершённые работы не удаляются.'
    if(exists('photo_inputs')&&db.prepare("SELECT 1 FROM photo_inputs WHERE owner=? AND json_extract(data,'$.status')='recognizing' LIMIT 1").get(visitor.owner))return 'Дождись завершения распознавания фото перед удалением данных.'
    if(exists('exam_requests')&&db.prepare("SELECT 1 FROM exam_requests WHERE owner=? AND json_extract(response,'$.pending')=1 LIMIT 1").get(visitor.owner))return 'Дождись завершения запросов наставнику перед удалением данных.'
    try{if(JSON.parse(visitor.setting('mixed-practice:v1')??'null')?.status==='active')return 'Сначала заверши смешанную практику.'}catch{return 'Не удалось проверить состояние смешанной практики. Данные сохранены.'}
    return null
  }
  const snapshotDigest=payload=>hash(JSON.stringify({sourceOwner:payload.sourceOwner,tables:payload.tables,settings:payload.settings,attachments:payload.attachments.map(({data,...attachment})=>attachment)}))
  function exportProfile(visitor=store){
    const blocked=accessBlock(visitor);if(blocked)throw fail(blocked,409)
    return visitor.transaction(()=>{
      const tables={}
      for(const name of Object.keys(schemas)){
        if(!exists(name))continue
        const rows=db.prepare(`SELECT ${columns[name].join(',')} FROM ${name} WHERE owner=? ORDER BY rowid`).all(visitor.owner)
        tables[name]=rows
      }
      const prefix=`visitor:${visitor.owner}:`
      const settings=(visitor.owner==='local'?db.prepare("SELECT key,value FROM settings WHERE key NOT LIKE 'visitor:%' ORDER BY rowid").all():db.prepare('SELECT key,value FROM settings WHERE substr(key,1,?)=? ORDER BY rowid').all(prefix.length,prefix)).map(row=>({...row,key:stripKey(visitor.owner,row.key)}))
      archiveSizes(tables,settings)
      const attachments=[];let attachmentBytes=0
      for(const row of tables.photo_inputs??[]){
        const photo=parse(row.data)
        for(const image of photo.images??[]){
          if(!filename.test(image.file??''))throw fail('Небезопасное имя сохранённого снимка.')
          const path=join(directory,image.file),stat=lstatSync(path)
          if(!stat.isFile()||stat.isSymbolicLink())throw fail('Снимок не является обычным файлом.')
          attachmentBytes+=stat.size;if(attachmentBytes>PHOTO_BYTES)throw fail('Снимки превышают размер архива.',413)
          const bytes=readFileSync(path)
          if(bytes.length!==image.size)throw fail('Сохранённый снимок повреждён; архив не создан.',409)
          attachments.push({file:image.file,size:bytes.length,sha256:hash(bytes),data:bytes.toString('base64')})
        }
      }
      const payload={version:1,sourceOwner:visitor.owner,createdAt:new Date().toISOString(),tables,settings,attachments}
      return {format:'schooltest-profile',payload,sha256:hash(JSON.stringify(payload)),snapshotSha256:snapshotDigest(payload)}
    })
  }
  function validate(archive){
    if(!plain(archive)||archive.format!=='schooltest-profile'||!plain(archive.payload)||archive.payload.version!==1||!uuid.test(archive.payload.sourceOwner)&&archive.payload.sourceOwner!=='local')throw fail('Неизвестный формат архива.')
    const payload=archive.payload
    if(!plain(payload.tables)||!Array.isArray(payload.settings)||!Array.isArray(payload.attachments))throw fail('Неполный архив.')
    const {decodedBytes}=archiveSizes(payload.tables,payload.settings)
    if(Buffer.byteLength(JSON.stringify(archive))>PROFILE_ARCHIVE_BODY_LIMIT)throw fail('Архив слишком большой.',413)
    if(hash(JSON.stringify(payload))!==archive.sha256)throw fail('Контрольная сумма архива не совпала.')
    inspect(payload,()=>{})
    let attachmentBytes=0
    const ids=new Map(),photos=new Map(),workIds=new Set(),examWorkIds=new Set(),instanceIds=new Set()
    for(const [name,rows] of Object.entries(payload.tables)){
      if(!Object.hasOwn(schemas,name)||!Array.isArray(rows))throw fail('Неизвестная таблица архива.')
      const unique=new Set()
      for(const row of rows){
        if(!plain(row)||Object.keys(row).length!==columns[name].length||columns[name].some(key=>!Object.hasOwn(row,key))||row.owner!==payload.sourceOwner)throw fail('Неверная область данных архива.')
        for(const [key,value] of Object.entries(row))if(value!==null&&typeof value!=='string'&&typeof value!=='number')throw fail('Неверное значение архива.')
        const primary=row.id??row.key??row.request_id??row.owner
        if(typeof primary!=='string'||!primary||primary.length>500||unique.has(primary))throw fail('Повторяющийся идентификатор архива.');unique.add(primary)
        if(row.id)ids.set(row.id,randomUUID());if(row.request_id)ids.set(row.request_id,randomUUID())
        for(const key of jsonColumns)if(row[key]!==undefined){if(typeof row[key]!=='string')throw fail('Неверная JSON-запись.');inspect(parse(row[key]),value=>{if(uuid.test(value)&&value!==payload.sourceOwner&&!ids.has(value))ids.set(value,randomUUID())})}
        if(name==='works'){const work=parse(row.data);if(work.id!==row.id||!Array.isArray(work.submissions)||!Array.isArray(work.messages)||!plain(work.document))throw fail('Повреждённая работа.');workIds.add(row.id)}
        if(name==='exam_works'){const work=parse(row.data);if(work.id!==row.id||!Array.isArray(work.attempts)||!Array.isArray(work.evaluations))throw fail('Повреждённая экзаменационная работа.');examWorkIds.add(row.id)}
        if(name==='exam_instances')instanceIds.add(row.id)
      }
    }
    for(const row of payload.tables.exam_works??[])if(!instanceIds.has(parse(row.data).instanceId))throw fail('Нет сохранённого условия экзаменационной работы.')
    for(const row of payload.tables.exam_current??[])if(!examWorkIds.has(row.work_id))throw fail('Текущая экзаменационная работа отсутствует.')
    for(const row of payload.tables.exam_observations??[])if(!examWorkIds.has(row.work_id))throw fail('Наблюдение ссылается на отсутствующую работу.')
    for(const row of payload.tables.exam_sessions??[])for(const task of parse(row.data).tasks??[])if(!examWorkIds.has(task.workId))throw fail('В экзаменационной сессии отсутствует работа.')
    for(const row of payload.tables.exam_mixed??[])for(const task of parse(row.data).tasks??[])if(task.workId&&!examWorkIds.has(task.workId))throw fail('В смешанном наборе отсутствует работа.')
    const keys=new Set()
    for(const row of payload.settings){if(!plain(row)||!validKey(row.key)||typeof row.value!=='string'||keys.has(row.key))throw fail('Повреждены настройки архива.');keys.add(row.key);try{inspect(JSON.parse(row.value),value=>{if(uuid.test(value)&&value!==payload.sourceOwner&&!ids.has(value))ids.set(value,randomUUID())})}catch(error){if(error.status)throw error}if(row.key==='current'&&!workIds.has(row.value))throw fail('Текущая работа отсутствует в архиве.')}
    for(const row of payload.tables.photo_inputs??[]){
      if(!workIds.has(row.work_id)&&!examWorkIds.has(row.work_id))throw fail('Снимок ссылается на отсутствующую работу.')
      const photo=parse(row.data),removed=record=>typeof record.originalsRemovedAt==='string'&&Number.isFinite(Date.parse(record.originalsRemovedAt))
      if(photo.id!==row.id||photo.owner!==payload.sourceOwner||photo.workId!==row.work_id||!Array.isArray(photo.images)||photo.images.length>3||photo.images.length===0&&(photo.kind!=='exam-literal'||!removed(photo)))throw fail('Повреждены метаданные снимка.')
      if(photo.kind==='exam-literal'){
        if(Buffer.byteLength(row.data)>EXAM_PHOTO_METADATA_LIMIT||photo.history!==undefined&&(!Array.isArray(photo.history)||photo.history.length>EXAM_PHOTO_HISTORY_LIMIT))throw fail('История фото превышает допустимый размер.')
        for(const previous of photo.history??[])if(!plain(previous)||previous.kind!=='exam-literal'||!uuid.test(previous.id??'')||!Array.isArray(previous.lines)||!removed(previous)||Object.hasOwn(previous,'images')||Object.hasOwn(previous,'history'))throw fail('Повреждена прежняя запись фото.')
        for(const record of [photo,...(photo.history??[])])if(record.receipt!==undefined){
          const receipt=record.receipt
          if(!plain(receipt)||typeof receipt.id!=='string'||!receipt.id||receipt.id.length>100||typeof receipt.signature!=='string'||!plain(parse(receipt.signature))||!Number.isSafeInteger(receipt.workRevision)||receipt.workRevision<0||!Number.isSafeInteger(receipt.modeEpoch)||receipt.modeEpoch<0)throw fail('Повреждено подтверждение переноса фото.')
        }
      }
      for(const image of photo.images){if(!filename.test(image.file??'')||photos.has(image.file)||!Number.isSafeInteger(image.size)||image.size<1||image.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(image.type))throw fail('Небезопасное вложение.');photos.set(image.file,image)}
    }
    const files=new Map()
    for(const attachment of payload.attachments){
      if(!plain(attachment)||!photos.has(attachment.file)||files.has(attachment.file)||typeof attachment.data!=='string'||attachment.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.data))throw fail('Небезопасное вложение архива.')
      const bytes=Buffer.from(attachment.data,'base64');attachmentBytes+=bytes.length
      if(bytes.length!==attachment.size||bytes.length!==photos.get(attachment.file).size||hash(bytes)!==attachment.sha256)throw fail('Вложение повреждено.')
      if(attachmentBytes>PHOTO_BYTES)throw fail('Снимки превышают лимит.',413)
      files.set(attachment.file,bytes)
    }
    if(files.size!==photos.size)throw fail('В архиве отсутствуют оригиналы снимков.')
    return {payload,ids,files,decodedBytes,attachmentBytes}
  }
  function importedRecord(value){
    if(!value||typeof value!=='object')return value
    const taggedArrays=new Set(['attempts','submissions','evaluations','messages','objections','advisories','retractions'])
    function visit(record){
      if(!record||typeof record!=='object')return
      for(const [key,child] of Object.entries(record)){
        if(key.startsWith('archived'))continue
        if(Array.isArray(child)){for(const item of child){if(taggedArrays.has(key)&&item&&typeof item==='object')item.provenance='imported-unverified';visit(item)}}else if(child&&typeof child==='object')visit(child)
      }
      if(record.pending===true){record.archivedPending=true;record.pending=false}
      if(Object.hasOwn(record,'independent')){if(!Object.hasOwn(record,'archivedIndependent'))record.archivedIndependent=record.independent;record.independent=false;record.provenance='imported-unverified'}
      if(record.attemptContext){if(!Object.hasOwn(record,'archivedAttemptContext'))record.archivedAttemptContext=structuredClone(record.attemptContext);record.attemptContext={...record.attemptContext,priorExposure:true,numericHelpSeen:null,preparationUsed:null}}
      if(['correct','incorrect'].includes(record.status)){record.archivedStatus=record.status;record.status='unknown';record.provenance='imported-unverified'}
      if(record.score&&typeof record.score==='object'){
        if(!Object.hasOwn(record,'archivedScore'))record.archivedScore=structuredClone(record.score);record.score={...record.score,verifiedPoints:0,verifiedAnswers:0,final:false,provenance:'imported-unverified',summary:'Импортированный архив: исходные баллы сохранены как неподтверждённая запись. Подтверждённый итог экзамена не установлен.',tasks:(record.score.tasks??[]).map(task=>({...task,verifiedPoints:0,status:'unknown',provenance:'imported-unverified'}))}
      }
    }
    visit(value);value.provenance='imported-unverified'
    if(value.source){if(!Object.hasOwn(value,'archivedSource'))value.archivedSource=value.source;value.source='imported-unverified'}
    if(value.summary){if(!Object.hasOwn(value,'archivedSummary'))value.archivedSummary=value.summary;value.summary=`Импортированная неподтверждённая запись. ${value.archivedSummary}`}
    return value
  }
  function restoreProfile(archive,visitor=store){
    const blocked=accessBlock(visitor);if(blocked)throw fail(blocked,409)
    const {payload,ids,files,decodedBytes,attachmentBytes}=validate(archive),budget=visitor.profileBudget()
    if(visitor.owner!=='local'&&budget.count+(payload.tables.works?.length??0)+(payload.tables.exam_works?.length??0)>budget.limits.works)throw fail('В профиле недостаточно места для всех работ архива. Существующие записи сохранены.',429)
    if((payload.tables.exam_mixed?.length??0)+(exists('exam_mixed')?db.prepare('SELECT COUNT(*) n FROM exam_mixed WHERE owner=?').get(visitor.owner).n:0)>20)throw fail('В профиле недостаточно места для смешанных наборов архива.',429)
    if((payload.tables.exam_sessions?.length??0)+(exists('exam_sessions')?db.prepare('SELECT COUNT(*) n FROM exam_sessions WHERE owner=?').get(visitor.owner).n:0)>20)throw fail('В профиле недостаточно места для экзаменационных сессий архива.',429)
    const existingPhotoBytes=exists('photo_inputs')?db.prepare("SELECT COALESCE(SUM(CAST(json_extract(image.value,'$.size') AS INTEGER)),0) AS bytes FROM photo_inputs p,json_each(p.data,'$.images') image WHERE p.owner=?").get(visitor.owner).bytes:0
    if(existingPhotoBytes+attachmentBytes>PHOTO_BYTES)throw fail('Снимки архива не помещаются в профиль. Существующие снимки сохранены.',429)
    if(budget.bytes+decodedBytes>budget.limits.bytes+budget.limits.editReserveBytes)throw fail('Архив не помещается в профиль. Существующие записи сохранены.',429)
    const replaceString=(value,key='')=>{
      if(value===payload.sourceOwner&&key==='owner')return visitor.owner
      if(ids.has(value))return ids.get(value)
      if(['id','key','file'].includes(key))for(const [oldId,newId] of ids)value=value.replaceAll(oldId,newId)
      return value
    }
    function remap(value,key=''){
      if(typeof value==='string')return replaceString(value,key)
      if(Array.isArray(value))return value.map(v=>remap(v))
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[replaceString(k,'key'),remap(v,k)]))
      return value
    }
    const renamedFiles=new Map([...files].map(([file,bytes])=>[`${randomUUID()}-${randomUUID()}.bin`,{old:file,bytes}]))
    const fileMap=new Map([...renamedFiles].map(([file,value])=>[value.old,file]))
    const written=[]
    try{
      if(files.size)mkdirSync(directory,{recursive:true,mode:0o700})
      for(const [file,{bytes}] of renamedFiles){writeFileSync(join(directory,file),bytes,{flag:'wx',mode:0o600});written.push(file)}
      return visitor.transaction(()=>{
        for(const [name,rows] of Object.entries(payload.tables)){
          if(!exists(name))db.exec(`CREATE TABLE ${name} (${schemas[name]})`)
          for(const original of rows){
            const row={...original,owner:visitor.owner}
            for(const key of Object.keys(row))if(key!=='owner'){
              if(jsonColumns.has(key)){
                let value=parse(row[key]);value=remap(value)
                if(name!=='exam_instances')value=importedRecord(value)
                if(['works','exam_works'].includes(name)){if(!Object.hasOwn(value,'archivedPriorExposure'))value.archivedPriorExposure=value.priorExposure;value.priorExposure=true;if(name==='exam_works'){if(!Object.hasOwn(value,'archivedExposure'))value.archivedExposure=value.exposure;value.exposure=true}}
                if(name==='works'||name==='exam_works'){
                  for(const message of value.messages??[])if(message.status==='pending'){message.status='failed';message.error='Запрос прерван восстановлением архива. Автоматического повтора не было.'}
                  for(const submission of value.submissions??[]){
                    if(submission.reviewStatus==='pending'){submission.reviewStatus='failed';submission.reviewVersion=(submission.reviewVersion??0)+1;submission.reviewError='Разбор прерван восстановлением архива. Автоматического повтора не было.'}
                    for(const finding of submission.findings??[])for(const objection of finding.objections??[])if(objection.status==='pending'){objection.status='failed';objection.error='Пересмотр прерван восстановлением архива. Автоматического повтора не было.';submission.reviewVersion=(submission.reviewVersion??0)+1}
                  }
                }
                if(name==='photo_inputs'){
                  for(let i=0;i<value.images.length;i++)value.images[i].file=fileMap.get(parse(original.data).images[i].file)
                  if(value.kind==='exam-literal')for(const record of [value,...(value.history??[])]){
                    record.provenance='imported-unverified'
                    if(record.receipt){record.receipt.signature=JSON.stringify(remap(parse(record.receipt.signature)));record.receipt.provenance='imported-unverified'}
                  }
                  // An archived in-flight OCR is a failed historical request, never replayed.
                  if(value.status==='recognizing'){value.status='failed';value.revision++;value.error='Распознавание было прервано до восстановления архива. Автоматического повтора не было.'}
                }
                row[key]=JSON.stringify(value)
              }else row[key]=replaceString(row[key],key)
            }
            if(name==='learning_event_archive')row.key=scopeKey(visitor,stripKey(payload.sourceOwner,original.key).split(':').map(s=>ids.get(s)??s).join(':'))
            if(name==='exam_current')db.prepare('INSERT INTO exam_current(owner,work_id) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET work_id=excluded.work_id').run(row.owner,row.work_id)
            else db.prepare(`INSERT INTO ${name}(${columns[name].join(',')}) VALUES(${columns[name].map(()=>'?').join(',')})`).run(...columns[name].map(k=>row[k]))
          }
        }
        for(const row of payload.settings){
          let key=replaceString(row.key,'key'),value
          try{
            let restored=remap(JSON.parse(row.value))
            if(!key.startsWith('problem-instance:')&&!key.startsWith('numeric-preparation:'))restored=importedRecord(restored)
            if(key==='learning'&&restored?.progress){if(!Object.hasOwn(restored,'archivedProgress'))restored.archivedProgress=structuredClone(restored.progress);for(const progress of Object.values(restored.progress))for(const outcome of Object.keys(progress.outcomes??{}))progress.outcomes[outcome]='unknown'}
            if(key==='study-route:v1')key=`archived-setting:${key}`
            value=JSON.stringify(restored)
          }catch{value=replaceString(row.value)}
          db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(scopeKey(visitor,key),value)
        }
        if(visitor.profileBudget().bytes>budget.limits.bytes+budget.limits.editReserveBytes)throw fail('Восстановленные данные с отметками происхождения не помещаются в профиль. Прежние записи сохранены.',429)
        return {restored:true,provenance:'imported-unverified',works:(payload.tables.works?.length??0)+(payload.tables.exam_works?.length??0),attachments:files.size,idMap:Object.fromEntries(ids),sourceCreatedAt:payload.createdAt}
      })
    }catch(error){for(const file of written)try{unlinkSync(join(directory,file))}catch{};throw error}
  }
  function clearProfile(body,visitor=store){
    if(body?.confirmSavedArchive!==true||body?.confirmDeleteProfile!==true||typeof body.snapshotSha256!=='string'||!/^[a-f0-9]{64}$/.test(body.snapshotSha256))throw fail('Сначала сохрани полный архив, затем отдельно подтверди удаление завершённых данных профиля.',409)
    let snapshot
    visitor.transaction(()=>{
      const blocked=clearBlock(visitor);if(blocked)throw fail(blocked,409)
      snapshot=exportProfile(visitor)
      if(snapshot.snapshotSha256!==body.snapshotSha256)throw fail('После экспорта профиль изменился. Сохрани новый полный архив перед удалением.',409)
      for(const name of Object.keys(schemas))if(exists(name))db.prepare(`DELETE FROM ${name} WHERE owner=?`).run(visitor.owner)
      if(visitor.owner==='local')db.prepare("DELETE FROM settings WHERE key NOT LIKE 'visitor:%'").run()
      else{const prefix=`visitor:${visitor.owner}:`;db.prepare('DELETE FROM settings WHERE substr(key,1,?)=?').run(prefix.length,prefix)}
    })
    let deletedAttachments=0,deletedBytes=0,cleanupPending=0,retainedBytes=0;const cleanupFiles=[]
    for(const attachment of snapshot.payload.attachments){
      try{const path=join(directory,attachment.file),stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==attachment.size||hash(readFileSync(path))!==attachment.sha256)throw fail('Файл изменился');unlinkSync(path);deletedAttachments++;deletedBytes+=attachment.size}
      catch{cleanupPending++;retainedBytes+=attachment.size;cleanupFiles.push({file:attachment.file,size:attachment.size,sha256:attachment.sha256})}
    }
    return {cleared:true,snapshotSha256:body.snapshotSha256,deletedAttachments,deletedBytes,cleanupPending,retainedBytes,cleanupFiles,summary:cleanupPending?'Данные профиля удалены. Часть оригиналов осталась в закрытом хранилище; владельцу сервера нужна ручная очистка по журналу архива.':'Завершённые данные профиля удалены. Сохранённый архив можно восстановить; доступ к профилю сохранён.'}
  }
  return {exportProfile,restoreProfile,clearProfile,validate,route(method,path,body,visitor=store){
    if(path==='/api/profile/archive/status'&&method==='GET')return {storage:visitor.profileBudget(),canExport:!accessBlock(visitor),exportBlockReason:accessBlock(visitor),canClear:!clearBlock(visitor),clearBlockReason:clearBlock(visitor),backupIncludes:['works','frozenInstances','attempts','evaluations','learning','sessions','photos'],recoveryIsBackup:false}
    if(path==='/api/profile/archive/export'&&method==='POST')return {archive:exportProfile(visitor)}
    if(path==='/api/profile/archive/clear'&&method==='POST')return clearProfile(body,visitor)
    if(path==='/api/profile/archive/restore'&&method==='POST'){if(body?.confirmRestore!==true)throw fail('Подтверди восстановление архива в текущий профиль.',409);return restoreProfile(body.archive,visitor)}
    if(path.startsWith('/api/profile/archive'))throw fail('Маршрут архива не найден.',404)
    return undefined
  }}
}
