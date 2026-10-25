import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { createPhotoRecognizer } from './photo-provider.mjs'
import { inspectPhotoDimensions } from './photo-dimensions.mjs'
import { deriveNotebookAnswers } from '../src/answer-bindings.ts'

const MiB=1024*1024
const fail=(message,status=400)=>Object.assign(Error(message),{status})
const stamp=()=>new Date().toISOString()
export const PHOTO_UPLOAD_BODY_LIMIT=35*MiB

export function validatePhotoImages(images){
  if(!Array.isArray(images)||images.length<1||images.length>3)throw fail('Выбери от одного до трёх снимков.')
  let total=0
  return images.map(image=>{
    if(!image||!['image/jpeg','image/png','image/webp'].includes(image.type)||typeof image.data!=='string'||image.data.length>14*MiB||image.data.length%4!==0||! /^[A-Za-z0-9+/]*={0,2}$/.test(image.data))throw fail('Поддерживаются только JPEG, PNG и WebP.')
    const bytes=Buffer.from(image.data,'base64');total+=bytes.length
    if(!bytes.length||bytes.length>10*MiB)throw fail('Каждый снимок должен быть не больше 10 МБ.',413)
    if(total>25*MiB)throw fail('Суммарный размер снимков — не больше 25 МБ.',413)
    const jpeg=bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255
    const png=bytes.length>8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    const webp=bytes.length>12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'
    if(!(image.type==='image/jpeg'?jpeg:image.type==='image/png'?png:webp))throw fail('Формат файла не соответствует изображению. Пересохрани его как JPEG, PNG или WebP.')
    const dimensions=inspectPhotoDimensions(bytes,image.type)
    return {id:crypto.randomUUID(),name:typeof image.name==='string'?image.name.slice(0,160):'Фото',type:image.type,size:bytes.length,...dimensions,bytes}
  })
}
export function validatePhotoLines(lines,{fromModel=false}={}){
  if(!Array.isArray(lines)||!lines.length||lines.length>150)throw fail('Нужны от одной до 150 строк распознанной записи.')
  let total=0;const ids=new Set()
  return lines.map(line=>{
    if(!line||!['text','math'].includes(line.kind)||typeof line.value!=='string'||line.value.length>6000||typeof line.uncertain!=='boolean'||(line.answer!==null&&!['a','b'].includes(line.answer)))throw fail('Не удалось прочитать формат строк распознавания.')
    total+=line.value.length;if(total>40000)throw fail('Распознанная запись слишком длинная.',413)
    const id=!fromModel&&typeof line.id==='string'&&/^[a-f0-9-]{36}$/.test(line.id)?line.id:crypto.randomUUID()
    if(ids.has(id))throw fail('В записи повторяются идентификаторы строк.');ids.add(id)
    let value=line.value
    // A visible part label is metadata, not part of the answer expression. Strip
    // only a literal leading label that agrees with the model's explicit marker.
    if(fromModel&&line.answer){const label=line.answer==='a'?'[aа]':'[bб]';value=value.replace(new RegExp(`^\\s*${label}\\s*[)）.:]\\s*`,'iu'),'')}
    return {id,kind:line.kind,value,uncertain:line.uncertain,note:typeof line.note==='string'?line.note.slice(0,600):'',answer:line.answer,checked:!fromModel&&line.checked===true}
  })
}

/** Private originals never enter public/, static URLs, notebook JSON or model logs. */
export function createPhotoRoutes({config,store,fetchImpl,checkWorkVersion,recognize:recognizeOverride}){
  const db=store.db,active=new Map()
  let closed=false,recognizing=false
  const directory=resolve(config.photoDir??join(config.dbPath&&config.dbPath!==':memory:'?dirname(config.dbPath):'.runtime','private-photos'))
  mkdirSync(directory,{recursive:true,mode:0o700})
  db.exec('CREATE TABLE IF NOT EXISTS photo_inputs (id TEXT PRIMARY KEY, owner TEXT NOT NULL, work_id TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(owner,work_id))')
  for(const row of db.prepare('SELECT id,data FROM photo_inputs').all()){
    const photo=JSON.parse(row.data)
    if(photo.status==='recognizing'){photo.status='failed';photo.error='Распознавание прервано перезапуском. Фото сохранены; автоматического повтора не было.';photo.revision++;db.prepare('UPDATE photo_inputs SET data=? WHERE id=?').run(JSON.stringify(photo),row.id)}
  }
  const recognize=recognizeOverride??createPhotoRecognizer({config,db,...(fetchImpl?{fetchImpl}:{})})
  const save=photo=>db.prepare('UPDATE photo_inputs SET data=? WHERE id=? AND owner=?').run(JSON.stringify(photo),photo.id,photo.owner)
  const find=(visitorStore,workId,id)=>{
    visitorStore.get(workId)
    const row=db.prepare('SELECT data FROM photo_inputs WHERE owner=? AND work_id=?').get(visitorStore.owner,workId)
    const photo=row?JSON.parse(row.data):null
    if(id&&photo?.id!==id)throw fail('Фото не найдено.',404)
    return photo
  }
  const publicPhoto=photo=>{if(!photo)return null;const {owner,images,importedNodes,confirmAction,...rest}=photo;return {...rest,images:images.map(({file,...image})=>image)}}
  const requireRevision=(photo,b)=>{if(!Number.isSafeInteger(b.expectedPhotoRevision)||b.expectedPhotoRevision!==photo.revision)throw fail('Распознанная запись изменилась в другой вкладке. Локальные исправления сохранены отдельно.',409)}
  const cancel=id=>{active.get(id)?.abort();active.delete(id)}
  async function route(method,path,b,visitorStore=store){
    if(!path.startsWith('/api/photo/'))return undefined
    if(method!=='POST')throw fail('Маршрут не найден.',404)
    if(typeof b.workId!=='string')throw fail('Не указана работа.')
    let work=visitorStore.get(b.workId)
    if(path==='/api/photo/list')return {photo:publicPhoto(find(visitorStore,b.workId))}
    if(path==='/api/photo/upload'){
      checkWorkVersion(work,b)
      if(find(visitorStore,b.workId))throw fail('В этой работе уже есть фото. Сначала удали прежние снимки, сохранив нужную запись.',409)
      const images=validatePhotoImages(b.images)
      const existing=db.prepare('SELECT data FROM photo_inputs WHERE owner=?').all(visitorStore.owner).reduce((sum,row)=>sum+JSON.parse(row.data).images.reduce((n,image)=>n+image.size,0),0)
      if(existing+images.reduce((n,image)=>n+image.size,0)>100*MiB)throw fail('Место для фото заполнено. Удали ненужные снимки из прежних работ.',429)
      const id=crypto.randomUUID(),written=[]
      try{
        const photo={id,owner:visitorStore.owner,workId:b.workId,revision:0,status:'uploaded',createdAt:stamp(),lines:[],images:images.map(({bytes,...image})=>{const file=`${id}-${image.id}.bin`;writeFileSync(join(directory,file),bytes,{flag:'wx',mode:0o600});written.push(file);return {...image,file}})}
        db.prepare('INSERT INTO photo_inputs(id,owner,work_id,data) VALUES(?,?,?,?)').run(id,photo.owner,photo.workId,JSON.stringify(photo))
        return {photo:publicPhoto(photo)}
      }catch(error){for(const file of written)try{unlinkSync(join(directory,file))}catch{};throw error}
    }
    const photo=find(visitorStore,b.workId,b.photoId)
    if(!photo)throw fail('Фото не найдено.',404)
    if(path==='/api/photo/original'){
      const image=photo.images.find(image=>image.id===b.imageId);if(!image)throw fail('Снимок не найден.',404)
      return {dataUrl:`data:${image.type};base64,${readFileSync(join(directory,image.file)).toString('base64')}`}
    }
    if(path==='/api/photo/remove'){
      requireRevision(photo,b);cancel(photo.id)
      for(const image of photo.images)try{unlinkSync(join(directory,image.file))}catch(error){if(error.code!=='ENOENT')throw error}
      db.prepare('DELETE FROM photo_inputs WHERE id=? AND owner=?').run(photo.id,visitorStore.owner)
      return {removed:true}
    }
    if(path==='/api/photo/recognize'){
      requireRevision(photo,b)
      if(active.has(photo.id))throw fail('Распознавание уже идёт.',429)
      if(recognizing)throw fail('Сейчас распознаётся другой снимок. Дождись завершения и повтори действие.',429)
      if(photo.lines.length&&!b.replaceConfirmed)throw fail('Повтор распознавания заменит исправленные строки. Подтверди это отдельным действием.',409)
      const controller=new AbortController();active.set(photo.id,controller);recognizing=true
      photo.status='recognizing';photo.revision++;delete photo.error;save(photo)
      const generation=photo.revision
      try{
        const result=await recognize(photo.images.map(image=>({type:image.type,data:readFileSync(join(directory,image.file)).toString('base64')})),controller.signal)
        if(closed)throw fail('Распознавание прервано остановкой сервера.',503)
        const latest=find(visitorStore,b.workId,b.photoId)
        if(controller.signal.aborted||latest.revision!==generation)throw fail('Позднее распознавание отменено: твои исправления важнее.',409)
        latest.lines=validatePhotoLines(result.lines,{fromModel:true});latest.status='ready';latest.revision++;delete latest.error;save(latest)
        return {photo:publicPhoto(latest)}
      }catch(error){
        if(closed)throw error
        const latest=find(visitorStore,b.workId)
        if(latest?.id===photo.id&&latest.revision===generation){latest.status='failed';latest.error=error.message;latest.revision++;save(latest)}
        throw error
      }finally{recognizing=false;if(active.get(photo.id)===controller)active.delete(photo.id)}
    }
    if(path==='/api/photo/save'||path==='/api/photo/confirm'){
      if(path==='/api/photo/confirm'&&typeof b.requestId==='string'&&photo.confirmAction?.id===b.requestId){
        if(photo.confirmAction.signature!==JSON.stringify({lines:b.lines,confirmed:b.confirmed}))throw fail('Идентификатор подтверждения уже использован для другой записи.',409)
        if(work.revision!==photo.confirmedWorkRevision||work.modeEpoch!==photo.confirmAction.modeEpoch)throw fail('Фото уже перенесено, но работа после этого изменилась. Открой текущую запись перед проверкой.',409)
        return {photo:publicPhoto(photo),work}
      }
      requireRevision(photo,b)
      const lines=validatePhotoLines(b.lines)
      if(path==='/api/photo/confirm'){
        checkWorkVersion(work,b)
        if(b.requestId!==undefined&&(typeof b.requestId!=='string'||!b.requestId||b.requestId.length>100))throw fail('Неверный идентификатор подтверждения.')
        if(b.confirmed!==true||lines.some(line=>line.uncertain&&!line.checked))throw fail('Сначала сверь запись с фото и подтверди все неясные строки.')
        if(!lines.some(line=>line.value.trim()))throw fail('Запись пуста. Добавь прочитанные строки.')
        const imported=photo.importedNodes??[]
        // Do not silently overwrite later edits made in the ordinary notebook.
        const sourceValue=node=>node.type==='mathBlock'?node.attrs?.latex??'':(node.content??[]).map(part=>part.type==='hardBreak'?'\n':part.text??'').join('')
        for(const node of imported){const current=work.document.content?.find(item=>item.attrs?.id===node.attrs.id);if(current&&(current.type!==node.type||sourceValue(current)!==sourceValue(node)||JSON.stringify([...(current.attrs?.answerParts??[])].sort())!==JSON.stringify([...(node.attrs?.answerParts??[])].sort())))throw fail('Строки фото уже исправлены в тетради. Сохрани эти изменения перед новым переносом; исходная запись не заменена.',409)}
        const oldIds=new Set(imported.map(node=>node.attrs.id))
        const selected=new Set(lines.filter(line=>line.answer).map(line=>line.answer))
        const kept=(work.document.content??[]).filter(node=>!oldIds.has(node.attrs?.id)).map(node=>node.attrs?.answerParts?{...node,attrs:{...node.attrs,answerParts:node.attrs.answerParts.filter(part=>!selected.has(part))}}:node)
        const nodes=lines.map(line=>({type:line.kind==='math'?'mathBlock':'paragraph',attrs:{id:`photo-${photo.id}-${line.id}`,answerParts:line.answer?[line.answer]:[],...(line.kind==='math'?{latex:line.value}:{})},...(line.kind==='text'&&line.value?{content:[{type:'text',text:line.value}]}:{})}))
        work.document={...work.document,content:[...kept,...nodes]};const answers=deriveNotebookAnswers(work.document)
        if(answers.generalAnswer.length>4000||answers.finalAnswer.length>2000||JSON.stringify(work.document).length>160000)throw fail('Запись или отмеченные ответы слишком длинные для тетради. Сократи их перед переносом.',413)
        work.generalAnswer=answers.generalAnswer;work.finalAnswer=answers.finalAnswer;work.revision++
        for(const message of work.messages)if(message.role==='assistant')message.stale=true
        photo.lines=lines;photo.status='confirmed';photo.revision++;photo.confirmedAt=stamp();photo.importedNodes=nodes;photo.confirmedWorkRevision=work.revision;delete photo.error
        if(b.requestId)photo.confirmAction={id:b.requestId,signature:JSON.stringify({lines:b.lines,confirmed:b.confirmed}),modeEpoch:work.modeEpoch}
        db.exec('BEGIN')
        try{visitorStore.put(work);save(photo);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
        cancel(photo.id)
        return {photo:publicPhoto(photo),work}
      }
      cancel(photo.id);photo.lines=lines;photo.revision++;photo.status='ready';delete photo.error;save(photo)
      return {photo:publicPhoto(photo)}
    }
    throw fail('Маршрут не найден.',404)
  }
  return {route,close(){closed=true;for(const controller of active.values())controller.abort();active.clear()}}
}
