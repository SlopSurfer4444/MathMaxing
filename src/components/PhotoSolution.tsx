import { useEffect, useRef, useState } from 'react'
import { learnerStorage, visitorHeaders } from '../visitor-session'
import type { Work } from '../api-types'
import { MathAnswer } from './MathAnswer'
import './PhotoSolution.css'

type Line={id:string;kind:'text'|'math';value:string;uncertain:boolean;note:string;answer:'a'|'b'|null;checked:boolean}
type Photo={id:string;workId:string;revision:number;status:string;error?:string;confirmedWorkRevision?:number;lines:Line[];images:{id:string;name:string;type:string;size:number}[]}
type Props={workId:string;revision:number;modeEpoch:number;disabled?:boolean;onImported:(work:Work)=>void|Promise<void>;onCheck:(work:Work)=>void|Promise<void>}
async function request<T>(action:string,body:unknown):Promise<T>{
  const response=await fetch(`/api/photo/${action}`,{method:'POST',headers:{...visitorHeaders(),'X-Pole-Client':'notebook-v1','Content-Type':'application/json'},body:JSON.stringify(body)})
  let data;try{data=await response.json()}catch{throw Error('Не удалось получить подтверждение сервера. Твои исправления остались на устройстве.')}
  if(!response.ok)throw Error(data.error??'Действие с фото не выполнено.')
  return data
}
const readFile=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('Не удалось прочитать снимок.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file)})

export function PhotoSolution({workId,revision,modeEpoch,disabled,onImported,onCheck}:Props){
  const [opened,setOpened]=useState(true),[photo,setPhoto]=useState<Photo|null>(null),[lines,setLines]=useState<Line[]>([])
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[originals,setOriginals]=useState<Record<string,string>>({})
  const [tab,setTab]=useState<'original'|'transcription'>('transcription'),[confirmed,setConfirmed]=useState(false),[dirty,setDirty]=useState(false),[draftConflict,setDraftConflict]=useState(false)
  const generation=useRef(0),fileInput=useRef<HTMLInputElement>(null),photoRef=useRef(photo),linesRef=useRef(lines)
  const confirmAttempt=useRef<{signature:string;id:string}|null>(null)
  photoRef.current=photo;linesRef.current=lines
  const storageKey=`pole.photo-draft.${workId}`
  const persist=(next:Line[],current=photoRef.current)=>{
    if(!current)return
    try{learnerStorage.setItem(storageKey,JSON.stringify({photoId:current.id,baseRevision:current.revision,lines:next}))}catch{setError('Не удалось сохранить исправления на устройстве. Скачай распознанную запись перед закрытием.')}
  }
  useEffect(()=>{generation.current++;setOpened(true);setPhoto(null);setLines([]);setOriginals({});setError('');setBusy('');setDirty(false);setConfirmed(false);setDraftConflict(false)},[workId])
  useEffect(()=>()=>{generation.current++},[])
  useEffect(()=>{void load()},[workId])
  async function load(){
    const run=++generation.current;setBusy('Открываем снимки');setError('')
    try{
      const data=await request<{photo:Photo|null}>('list',{workId});if(run!==generation.current)return
      setPhoto(data.photo);setLines(data.photo?.lines??[]);setDirty(false);setConfirmed(false);setDraftConflict(false)
      const raw=learnerStorage.getItem(storageKey)
      if(raw&&data.photo){const draft=JSON.parse(raw);if(draft.photoId===data.photo.id&&Array.isArray(draft.lines)){setLines(draft.lines);setDirty(true);if(draft.baseRevision!==data.photo.revision){setDraftConflict(true);setPhoto({...data.photo,revision:draft.baseRevision});setNotice('Восстановлены локальные исправления. Серверная версия изменилась; скачай свою копию, затем открой серверную запись.')}}}
      if(data.photo){const source=data.photo;const entries=await Promise.all(source.images.map(async image=>[image.id,(await request<{dataUrl:string}>('original',{workId,photoId:source.id,imageId:image.id})).dataUrl] as const));if(run===generation.current)setOriginals(Object.fromEntries(entries))}
    }catch(e){if(run===generation.current)setError((e as Error).message)}finally{if(run===generation.current)setBusy('')}
  }
  async function upload(files:FileList|null){
    if(!files?.length)return
    const chosen=Array.from(files),total=chosen.reduce((sum,file)=>sum+file.size,0)
    if(chosen.length>3||chosen.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)||total>25*1024*1024){setError('Выбери до трёх JPEG, PNG или WebP: до 10 МБ каждый, суммарно до 25 МБ.');return}
    const run=++generation.current;setBusy('Сохраняем оригиналы');setError('')
    try{
      const images=await Promise.all(chosen.map(async file=>({name:file.name,type:file.type,data:await readFile(file)})))
      const data=await request<{photo:Photo}>('upload',{workId,expectedRevision:revision,expectedModeEpoch:modeEpoch,images});if(run!==generation.current)return
      setPhoto(data.photo);setLines([]);setOriginals(Object.fromEntries(data.photo.images.map((image,i)=>[image.id,`data:${images[i].type};base64,${images[i].data}`])));setNotice('Оригиналы сохранены. Порядок снимков: слева направо, сверху вниз.');setDirty(false)
    }catch(e){if(run===generation.current)setError((e as Error).message)}finally{if(run===generation.current)setBusy('');if(fileInput.current)fileInput.current.value=''}
  }
  async function recognize(){
    if(!photo||draftConflict)return
    if(lines.length&&!window.confirm('Заново распознать фото и заменить строки в этой форме? Текст, уже перенесённый в тетрадь, сохранится до нового подтверждения.'))return
    const run=++generation.current;setBusy('Распознаём без исправления математики');setError('');setConfirmed(false)
    try{
      const data=await request<{photo:Photo}>('recognize',{workId,photoId:photo.id,expectedPhotoRevision:photo.revision,replaceConfirmed:lines.length>0});if(run!==generation.current)return
      setPhoto(data.photo);setLines(data.photo.lines);setDirty(false);setTab('transcription');learnerStorage.removeItem(storageKey)
    }catch(e){if(run===generation.current){setError((e as Error).message);try{const data=await request<{photo:Photo}>('list',{workId});if(run===generation.current)setPhoto(data.photo)}catch{}}}finally{if(run===generation.current)setBusy('')}
  }
  const edit=(next:Line[])=>{generation.current++;setBusy('');setLines(next);setDirty(true);setConfirmed(false);persist(next)}
  async function save(check=false){
    if(!photo||draftConflict)return
    const run=++generation.current;setBusy(check?'Подтверждаем запись':'Сохраняем исправления');setError('');persist(lines)
    try{
      const signature=JSON.stringify({workId,photoId:photo.id,lines,confirmed})
      if(check&&confirmAttempt.current?.signature!==signature)confirmAttempt.current={signature,id:crypto.randomUUID()}
      const data=await request<{photo:Photo;work?:Work}>(check?'confirm':'save',{workId,photoId:photo.id,expectedPhotoRevision:photo.revision,expectedRevision:revision,expectedModeEpoch:modeEpoch,lines,confirmed,requestId:check?confirmAttempt.current?.id:undefined});if(run!==generation.current)return
      setPhoto(data.photo);setLines(data.photo.lines);setDirty(false);learnerStorage.removeItem(storageKey)
      if(check&&data.work){setNotice('Подтверждённые строки сохранены в общей тетради.');await onImported(data.work);await onCheck(data.work)}else setNotice('Исправления сохранены. Для проверки сверь и подтверди запись.')
    }catch(e){if(run===generation.current)setError((e as Error).message)}finally{if(run===generation.current)setBusy('')}
  }
  async function viewOriginals(){
    if(!photo)return
    const run=generation.current;setTab('original');setError('')
    try{const entries=await Promise.all(photo.images.map(async image=>[image.id,originals[image.id]??(await request<{dataUrl:string}>('original',{workId,photoId:photo.id,imageId:image.id})).dataUrl] as const));if(run===generation.current)setOriginals(Object.fromEntries(entries))}catch(e){if(run===generation.current)setError((e as Error).message)}
  }
  async function remove(){
    if(!photo||!window.confirm('Удалить оригиналы этих фото с сервера? Уже перенесённые строки останутся в тетради.'))return
    const run=++generation.current;setBusy('Удаляем фото');setError('')
    try{await request('remove',{workId,photoId:photo.id,expectedPhotoRevision:photo.revision});if(run!==generation.current)return;setPhoto(null);setLines([]);setOriginals({});learnerStorage.removeItem(storageKey);setNotice('Оригиналы удалены.')}catch(e){if(run===generation.current)setError((e as Error).message)}finally{if(run===generation.current)setBusy('')}
  }
  const exportDraft=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({workId,photoId:photo?.id,lines},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pole-photo-transcription.json';a.click();URL.revokeObjectURL(url)}
  return <section className="photo-solution">
    <button type="button" disabled={disabled} aria-expanded={opened} onClick={()=>{if(opened){generation.current++;setBusy('');setOpened(false)}else{setOpened(true);void load()}}}>{opened?'Свернуть фото':'Добавить или открыть фото решения'}</button>
    {opened&&<div className="photo-panel">
      <p>Фото относится к текущей задаче. Переписываем буквально — ошибки решения исправляешь ты. Проверка начнётся после подтверждения.</p>
      {!photo&&<label className="photo-upload">Выбрать снимки<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!!busy||disabled} onChange={event=>void upload(event.currentTarget.files)}/><small>До 3 фото, JPEG / PNG / WebP; 10 МБ каждое, 25 МБ суммарно. Оригиналы доступны только в этой сессии браузера до явного удаления.</small></label>}
      {photo&&<>
        <div className="photo-actions"><button disabled={!!busy} onClick={()=>void viewOriginals()}>Оригиналы ({photo.images.length})</button><button disabled={!!busy} onClick={()=>setTab('transcription')}>Запись</button><button disabled={!!busy||disabled} onClick={()=>void recognize()}>{lines.length?'Распознать заново':'Распознать запись'}</button><button disabled={!!busy} onClick={()=>void remove()}>Удалить фото</button></div>
        <div className={`photo-compare show-${tab}`}>
          <div className="photo-originals">{photo.images.map((image,index)=><figure key={image.id}><figcaption>Снимок {index+1}: {image.name}</figcaption>{originals[image.id]?<a href={originals[image.id]} target="_blank" rel="noreferrer"><img src={originals[image.id]} alt={`Оригинал решения, снимок ${index+1}`}/></a>:<button onClick={()=>void viewOriginals()}>Открыть оригинал</button>}</figure>)}</div>
          <div className="photo-transcription">
            {lines.map((line,index)=><fieldset className={line.uncertain?'photo-line uncertain':'photo-line'} key={line.id} disabled={!!busy||disabled}>
              <legend>Строка {index+1}{line.uncertain?' · сверь с фото':''}</legend>
              <div className="photo-row"><select aria-label={`Тип строки ${index+1}`} value={line.kind} onChange={event=>edit(lines.map((item,i)=>i===index?{...item,kind:event.target.value as Line['kind']}:item))}><option value="text">Текст</option><option value="math">Формула</option></select><select aria-label={`Ответ в строке ${index+1}`} value={line.answer??''} onChange={event=>edit(lines.map((item,i)=>i===index?{...item,answer:(event.target.value||null) as Line['answer']}:item))}><option value="">Ход решения</option><option value="a">а) Все решения</option><option value="b">б) Корни на отрезке</option></select><button type="button" aria-label={`Удалить строку ${index+1}`} onClick={()=>edit(lines.filter((_,i)=>i!==index))}>×</button></div>
              {line.kind==='math'?<MathAnswer label={`Распознанная формула ${index+1}`} value={line.value} disabled={!!busy||disabled} onChange={value=>edit(lines.map((item,i)=>i===index?{...item,value,checked:false}:item))}/>:<textarea aria-label={`Распознанная строка ${index+1}`} value={line.value} rows={2} onChange={event=>edit(lines.map((item,i)=>i===index?{...item,value:event.target.value,checked:false}:item))}/>}
              {line.note&&<small>{line.note}</small>}{line.uncertain&&<label><input type="checkbox" checked={line.checked} onChange={event=>edit(lines.map((item,i)=>i===index?{...item,checked:event.target.checked}:item))}/>Сверил эту строку с фото</label>}
            </fieldset>)}
            <button disabled={!!busy||disabled} onClick={()=>edit([...lines,{id:crypto.randomUUID(),kind:'text',value:'',uncertain:false,note:'',answer:null,checked:false}])}>Добавить строку вручную</button>
            {lines.length>0&&<><p>Отметь готовые ответы а/б в строках. При переносе эти отметки заменят прежние отметки соответствующего пункта в тетради.</p><label className="photo-confirm"><input type="checkbox" checked={confirmed} disabled={!!busy} onChange={event=>setConfirmed(event.target.checked)}/>Сверил все строки с оригиналом, сохранил свою математику и отметил ответы</label><div className="photo-actions"><button disabled={!!busy||disabled||!dirty||draftConflict} onClick={()=>void save()}>Сохранить исправления</button><button disabled={!!busy||disabled||draftConflict||!confirmed||lines.some(line=>line.uncertain&&!line.checked)} onClick={()=>void save(true)}>Подтвердить запись и проверить</button><button onClick={exportDraft}>Скачать запись</button>{draftConflict&&<button onClick={()=>{if(window.confirm('Открыть серверную запись? Сначала скачай локальные исправления, если они нужны.')){learnerStorage.removeItem(storageKey);void load()}}}>Открыть серверную запись</button>}</div>{photo.status==='confirmed'&&!dirty&&<button onClick={()=>{setConfirmed(false);setNotice('Исправь строку и снова подтверди запись. Прежний разбор относится к прежней версии.')}}>На фото написано иначе</button>}</>}
          </div>
        </div>
      </>}
      {busy&&<p role="status">{busy}…</p>}{error&&<p className="photo-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    </div>}
  </section>
}
