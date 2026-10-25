import { mkdirSync, writeFileSync, readFileSync, unlinkSync, lstatSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { validatePhotoImages, PHOTO_UPLOAD_BODY_LIMIT } from '../photo.mjs'
import { createPhotoRecognizer } from '../photo-provider.mjs'

export { PHOTO_UPLOAD_BODY_LIMIT }
const MiB=1024*1024
const PHOTO_METADATA_LIMIT=1_800_000,PHOTO_HISTORY_LIMIT=20
const PHOTO_FAILURE_MESSAGE='Распознавание не завершено. Фото и прежний текст сохранены; повтор запускается отдельно.'
const fail=(message,status=400)=>Object.assign(Error(message),{status})
const now=()=>new Date().toISOString()

// Recognition supplies literal text only. A learner, never the model, chooses
// which arbitrary instance part receives an answer.
export function validateExamPhotoLines(lines,{fromModel=false,partIds=[]}={}){
  if(!Array.isArray(lines)||lines.length<1||lines.length>150)throw fail('Нужны от одной до 150 строк записи.')
  let size=0;const ids=new Set()
  return lines.map(line=>{
    if(!line||!['text','math'].includes(line.kind)||typeof line.value!=='string'||line.value.length>6000||typeof line.uncertain!=='boolean')throw fail('Неверный формат строки распознавания.')
    size+=line.value.length;if(size>40000)throw fail('Запись слишком длинная.',413)
    const partId=fromModel?null:line.partId??null
    if(partId!==null&&(typeof partId!=='string'||!partIds.includes(partId)))throw fail('Выбери существующий пункт этой работы.')
    const id=!fromModel&&typeof line.id==='string'&&/^[a-f0-9-]{36}$/.test(line.id)?line.id:crypto.randomUUID()
    if(ids.has(id))throw fail('Идентификаторы строк повторяются.');ids.add(id)
    // The shared literal provider moves a visible а)/б) label into `answer`.
    // Preserve it as text; this never selects an answer target in the instance.
    let value=line.value
    if(fromModel&&['a','b'].includes(line.answer)){
      const label=line.answer==='a'?'[aа]':'[bб]'
      if(!new RegExp(`^\\s*${label}\\s*[)）.:]`,'iu').test(value))value=`${line.answer==='a'?'а':'б'}) ${value}`
    }
    return {id,kind:line.kind,value,uncertain:line.uncertain,note:typeof line.note==='string'?line.note.slice(0,600):'',checked:!fromModel&&line.checked===true,partId}
  })
}

/** Reuses private photo_inputs/media ownership and profile archive lifecycle.
 * Originals persist until explicit removal/profile deletion; at most 100 MiB
 * per owner across legacy and exam photos, 25 MiB/upload, no background retry.
 * JSON metadata is charged to the existing profile budget. Replacing explicitly
 * removed originals retains at most 20 previous transcriptions, within 1.8 MB
 * for the whole row. Nothing is evicted: full history blocks replacement until
 * the learner exports it and chooses another work/profile lifecycle action. */
export function createExamPhotos({config,store,readWork,saveWork,assertWritable,recognize:override,fetchImpl}){
  if(![readWork,saveWork,assertWritable].every(fn=>typeof fn==='function'))throw Error('Exam photos require runtime readWork/saveWork/assertWritable callbacks')
  const db=store.db,active=new Map()
  const directory=resolve(config.photoDir??join(config.dbPath&&config.dbPath!==':memory:'?dirname(config.dbPath):'.runtime','private-photos'))
  mkdirSync(directory,{recursive:true,mode:0o700})
  db.exec('CREATE TABLE IF NOT EXISTS photo_inputs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, work_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(owner,work_id))')
  for(const row of db.prepare('SELECT id,data FROM photo_inputs').all()){
    const photo=JSON.parse(row.data)
    if(photo.kind==='exam-literal'&&photo.status==='recognizing'){
      photo.status='failed';photo.error='Распознавание прервано перезапуском. Фото сохранены; автоматического повтора не было.';photo.revision++
      db.prepare('UPDATE photo_inputs SET data=? WHERE id=?').run(JSON.stringify(photo),row.id)
    }
  }
  const recognize=override??createPhotoRecognizer({config,db,...(fetchImpl?{fetchImpl}:{})})
  let closed=false,busy=false
  const filePath=file=>{if(typeof file!=='string'||! /^[a-f0-9-]{36}-[a-f0-9-]{36}\.bin$/.test(file))throw fail('Повреждена ссылка на снимок.',409);return join(directory,file)}
  const find=(visitor,id,photoId)=>{
    const row=db.prepare('SELECT data FROM photo_inputs WHERE owner=? AND work_id=?').get(visitor.owner,id)
    const photo=row?JSON.parse(row.data):null
    if(photo&&(photo.kind!=='exam-literal'||photo.owner!==visitor.owner))throw fail('Фото не найдено.',404)
    if(photoId&&photo?.id!==photoId)throw fail('Фото не найдено.',404)
    return photo
  }
  const publicPhoto=photo=>{if(!photo)return null;const {owner,receipt,history,...result}=photo;return {...result,...(photo.status==='failed'&&!photo.error?{error:PHOTO_FAILURE_MESSAGE}:{}),images:photo.images.map(({file,...image})=>image),...(history?{history:history.map(({receipt,...record})=>record)}:{})}}
  const persist=(visitor,photo,insert=false)=>{
    const data=JSON.stringify(photo),old=insert?0:Buffer.byteLength(db.prepare('SELECT data FROM photo_inputs WHERE id=? AND owner=?').get(photo.id,visitor.owner)?.data??'')
    if(Buffer.byteLength(data)>PHOTO_METADATA_LIMIT)throw fail('История фото заполнена. Скачай тексты или архив профиля; прежние записи сохранены. Для новых снимков выбери другую работу.',429)
    const budget=visitor.profileBudget?.(),delta=Buffer.byteLength(data)-old
    if(budget&&delta>0&&budget.bytes+delta>budget.limits.bytes+budget.limits.editReserveBytes)throw fail('Профиль заполнен. Скачай запись и освободи место.',429)
    if(insert)db.prepare('INSERT INTO photo_inputs(id,owner,work_id,data) VALUES(?,?,?,?)').run(photo.id,visitor.owner,photo.workId,data)
    else db.prepare('UPDATE photo_inputs SET data=? WHERE id=? AND owner=?').run(data,photo.id,visitor.owner)
  }
  const workVersion=(work,b)=>{if(!Number.isSafeInteger(b.expectedRevision)||work.revision!==b.expectedRevision||work.modeEpoch!==b.expectedModeEpoch)throw fail('Работа изменилась. Исправления фото сохранены отдельно; открой текущую работу.',409)}
  const photoVersion=(photo,b)=>{if(!Number.isSafeInteger(b.expectedPhotoRevision)||photo.revision!==b.expectedPhotoRevision)throw fail('Запись фото изменилась в другой вкладке. Скачай свои исправления перед обновлением.',409)}
  const cancel=id=>{active.get(id)?.abort()}
  const activeExam=visitor=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exam_sessions'").get()&&db.prepare("SELECT 1 FROM exam_sessions WHERE owner=? AND json_extract(data,'$.status')='active' LIMIT 1").get(visitor.owner))
  const ownedFile=(photo,image,allowMissing=false)=>{
    const path=filePath(image.file)
    if(db.prepare("SELECT 1 FROM photo_inputs p,json_each(p.data,'$.images') image WHERE p.id<>? AND json_extract(image.value,'$.file')=? LIMIT 1").get(photo.id,image.file))throw fail('Снимок используется другой записью. Оригиналы не удалены.',409)
    try{const stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile())throw fail('Ссылка на оригинал изменилась. Оригиналы не изменены.',409)}catch(error){if(error.code!=='ENOENT'||!allowMissing)throw error}
    return path
  }
  async function route(method,path,b,visitor=store){
    if(!path.startsWith('/api/exam/photo/'))return undefined
    if(method!=='POST')throw fail('Маршрут не найден.',404)
    if(!b||typeof b.workId!=='string')throw fail('Не указана работа.')
    let work=readWork(visitor,b.workId)
    if(path==='/api/exam/photo/list')return {photo:publicPhoto(find(visitor,b.workId)),work}
    if(path==='/api/exam/photo/original'){
      const photo=find(visitor,b.workId,b.photoId),image=photo?.images.find(item=>item.id===b.imageId)
      if(!image)throw fail('Снимок не найден.',404)
      return {dataUrl:`data:${image.type};base64,${readFileSync(ownedFile(photo,image)).toString('base64')}`}
    }
    if(closed)throw fail('Сервер останавливается.',503)
    const photo=find(visitor,b.workId,b.photoId)
    if(path==='/api/exam/photo/remove'){
      if(activeExam(visitor))throw fail('Сначала сдай экзаменационный вариант. Оригиналы сохранены.',403)
      if(!work.completed&&work.mode!=='review')assertWritable(visitor,b.workId)
      if(!photo)throw fail('Фото не найдено.',404)
      photoVersion(photo,b)
      const files=photo.images.map(image=>ownedFile(photo,image,true))
      if(!files.length)return {removed:true,photo:publicPhoto(photo)}
      cancel(photo.id)
      for(const file of files)try{unlinkSync(file)}catch(error){if(error.code!=='ENOENT')throw error}
      photo.images=[];photo.originalsRemovedAt=now();photo.revision++
      if(photo.status==='recognizing')photo.status=photo.lines.length?'ready':'uploaded'
      delete photo.error;persist(visitor,photo)
      return {removed:true,photo:publicPhoto(photo)}
    }
    assertWritable(visitor,b.workId)
    if(path==='/api/exam/photo/confirm'&&photo?.receipt?.id===b.requestId){
      if(photo.receipt.signature!==JSON.stringify({lines:b.lines,confirmed:b.confirmed,replaceAnswersConfirmed:b.replaceAnswersConfirmed??false})||work.revision!==photo.receipt.workRevision||work.modeEpoch!==photo.receipt.modeEpoch)throw fail('Подтверждение уже использовано или работа изменилась.',409)
      return {photo:publicPhoto(photo),work}
    }
    workVersion(work,b)
    if(path==='/api/exam/photo/upload'){
      if(photo?.images.length)throw fail('Фото уже добавлены. Сохрани нужную запись и удали прежние оригиналы.',409)
      if(photo)photoVersion(photo,b)
      const history=[...(photo?.history??[])]
      if(photo&&(photo.lines.length||photo.receipt)){
        if(history.length>=PHOTO_HISTORY_LIMIT)throw fail('Сохранено 20 прежних записей фото. Скачай тексты или архив профиля; для новых снимков выбери другую работу.',429)
        const {history:previousHistory,images,owner,workId,...previous}=photo
        history.push(previous)
      }
      const images=validatePhotoImages(b.images)
      const used=db.prepare('SELECT data FROM photo_inputs WHERE owner=?').all(visitor.owner).reduce((sum,row)=>sum+JSON.parse(row.data).images.reduce((n,image)=>n+image.size,0),0)
      if(used+images.reduce((n,image)=>n+image.size,0)>100*MiB)throw fail('Лимит фото профиля — 100 МБ. Удали ненужные снимки.',429)
      const id=crypto.randomUUID(),written=[]
      try{
        const next={id,kind:'exam-literal',owner:visitor.owner,workId:work.id,revision:0,status:'uploaded',createdAt:now(),lines:[],...(history.length?{history}:{}),images:images.map(({bytes,...image})=>{const file=`${id}-${image.id}.bin`;writeFileSync(filePath(file),bytes,{flag:'wx',mode:0o600});written.push(file);return {...image,file}})}
        return store.transaction(()=>{if(photo)db.prepare('DELETE FROM photo_inputs WHERE id=? AND owner=?').run(photo.id,visitor.owner);persist(visitor,next,true);return {photo:publicPhoto(next)}})
      }catch(error){for(const file of written)try{unlinkSync(filePath(file))}catch{};throw error}
    }
    if(!photo)throw fail('Фото не найдено.',404)
    photoVersion(photo,b)
    if(path==='/api/exam/photo/recognize'){
      if(!photo.images.length)throw fail('Оригиналы удалены. Сохранённый текст можно скачать или исправить вручную.',409)
      if(busy||active.has(photo.id))throw fail('Дождись завершения текущего распознавания.',429)
      if(photo.lines.length&&b.replaceConfirmed!==true)throw fail('Повтор заменит строки фото. Подтверди замену отдельным действием.',409)
      const controller=new AbortController()
      photo.status='recognizing';photo.revision++;delete photo.error;persist(visitor,photo)
      active.set(photo.id,controller);busy=true
      const generation=photo.revision
      try{
        const result=await recognize(photo.images.map(image=>({type:image.type,data:readFileSync(ownedFile(photo,image)).toString('base64')})),controller.signal)
        if(closed)throw fail('Распознавание прервано остановкой сервера.',503)
        assertWritable(visitor,b.workId)
        if(readWork(visitor,b.workId).modeEpoch!==b.expectedModeEpoch)throw fail('Режим работы изменился. Фото сохранены; повторное распознавание запускается отдельно.',409)
        const latest=find(visitor,b.workId,b.photoId)
        if(controller.signal.aborted||!latest||latest.revision!==generation)throw fail('Позднее распознавание отменено: твои изменения сохранены.',409)
        latest.lines=validateExamPhotoLines(result.lines,{fromModel:true});latest.status='ready';latest.revision++;delete latest.error;persist(visitor,latest)
        return {photo:publicPhoto(latest)}
      }catch(error){
        if(!closed){const latest=find(visitor,b.workId);if(latest?.id===photo.id&&latest.revision===generation){
          latest.status='failed';latest.error=error.status?error.message:'Распознавание прервано. Фото сохранены.';latest.revision++
          try{persist(visitor,latest)}catch(storageError){
            if(storageError.status!==429)throw storageError
            // recognizing -> failed frees five bytes, even a revision digit
            // boundary costs only one. Project the generic error without storing
            // it so terminalization always shrinks the admitted generation.
            delete latest.error;persist(visitor,latest)
          }
        }}
        throw error
      }finally{busy=false;if(active.get(photo.id)===controller)active.delete(photo.id)}
    }
    if(path==='/api/exam/photo/save'||path==='/api/exam/photo/confirm'){
      const lines=validateExamPhotoLines(b.lines,{partIds:work.instance.parts.map(part=>part.id)})
      if(path.endsWith('/confirm')){
        if(typeof b.requestId!=='string'||!b.requestId||b.requestId.length>100)throw fail('Нужен идентификатор подтверждения.')
        if(photo.importedAt)throw fail('Эта запись уже перенесена. Исправь её в работе; повторный перенос не меняет черновик.',409)
        if(b.confirmed!==true||lines.some(line=>line.uncertain&&!line.checked))throw fail('Сверь запись с фото и подтверди все неясные строки.')
        if(!lines.some(line=>line.value.trim()))throw fail('Запись пуста.')
        const answersByPart={...work.answersByPart},chosen=new Set(lines.filter(line=>line.partId).map(line=>line.partId))
        for(const partId of chosen){
          if((answersByPart[partId]??'').trim()&&b.replaceAnswersConfirmed!==true)throw fail('В выбранном пункте уже есть ответ. Подтверди его замену явно.',409)
          answersByPart[partId]=lines.filter(line=>line.partId===partId).map(line=>line.value).join('\n')
        }
        const reasoning=[work.reasoning,lines.map(line=>line.value).join('\n')].filter(Boolean).join('\n\n')
        return store.transaction(()=>{
          const result=saveWork(visitor,{workId:work.id,expectedRevision:b.expectedRevision,expectedModeEpoch:b.expectedModeEpoch,answersByPart,reasoning})
          if(result?.then)throw Error('saveWork must be synchronous for atomic photo confirmation')
          work=result.work;photo.lines=lines;photo.status='confirmed';photo.importedAt=now();photo.revision++;delete photo.error
          photo.receipt={id:b.requestId,signature:JSON.stringify({lines:b.lines,confirmed:b.confirmed,replaceAnswersConfirmed:b.replaceAnswersConfirmed??false}),workRevision:work.revision,modeEpoch:work.modeEpoch}
          persist(visitor,photo);cancel(photo.id);return {photo:publicPhoto(photo),work}
        })
      }
      cancel(photo.id);photo.lines=lines;photo.status='ready';photo.revision++;delete photo.error;persist(visitor,photo)
      return {photo:publicPhoto(photo)}
    }
    throw fail('Маршрут не найден.',404)
  }
  return {route,close(){closed=true;for(const controller of active.values())controller.abort();active.clear()}}
}
