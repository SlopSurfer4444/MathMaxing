import { useEffect, useRef, useState } from 'react'
import { learnerStorage, visitorHeaders } from '../visitor-session'

type Line={id:string;kind:'text'|'math';value:string;uncertain:boolean;note:string;checked:boolean;partId:string|null}
type Photo={id:string;revision:number;status:string;error?:string;importedAt?:string;originalsRemovedAt?:string;lines:Line[];history?:{id:string;createdAt:string;lines:Line[]}[];images:{id:string;name:string;type:string;size:number}[]}
export type ExamPhotoWork={id:string;revision:number;modeEpoch:number;reasoning:string;answersByPart:Record<string,string>;completed:boolean;instance:{parts:{id:string;label:string}[]}}
type Props<T extends ExamPhotoWork>={work:T;onWork:(work:T)=>void;disabled?:boolean;removalDisabled?:boolean;onImportBusyChange?:(busy:boolean)=>void}
const blank=():Line=>({id:crypto.randomUUID(),kind:'text',value:'',uncertain:false,note:'',checked:false,partId:null})

async function api(action:string,body:Record<string,unknown>){
  const response=await fetch(`/api/exam/photo/${action}`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Pole-Client':'notebook-v1',...visitorHeaders()},body:JSON.stringify(body),signal:AbortSignal.timeout(action==='recognize'?120000:30000)})
  const data=await response.json()
  if(!response.ok)throw Error(typeof data.error==='string'?data.error:'Не удалось сохранить фото. Твои исправления остались здесь.')
  return data
}
function download(lines:Line[]){
  const url=URL.createObjectURL(new Blob([lines.map(line=>line.value).join('\n')],{type:'text/plain;charset=utf-8'}))
  const link=document.createElement('a');link.href=url;link.download='моя-запись-с-фото.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
async function readFile(file:File):Promise<{name:string;type:string;data:string}>{
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(Error('Не удалось прочитать файл.'));reader.readAsDataURL(file)})
  return {name:file.name,type:file.type,data}
}

/** Literal photo transcription is available in solo work, including a timed
 * session. Parent disables import for unsaved drafts and holds its editor while
 * onImportBusyChange is true. OCR never holds the parent's editor. */
export function ExamPhoto<T extends ExamPhotoWork>({work,onWork,disabled=false,removalDisabled=disabled,onImportBusyChange}:Props<T>){
  const [photo,setPhoto]=useState<Photo|null>(null),[lines,setLines]=useState<Line[]>([])
  const [busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const [confirmed,setConfirmed]=useState(false),[replaceAnswers,setReplaceAnswers]=useState(false),[replaceOCR,setReplaceOCR]=useState(false)
  const [draftConflict,setDraftConflict]=useState(false)
  const [previews,setPreviews]=useState<Record<string,string>>({})
  const confirmation=useRef<{signature:string;id:string}|null>(null)
  const operation=useRef(false),importBusy=useRef(false),notifyImportBusy=useRef(onImportBusyChange)
  const originalsGeneration=useRef(0)
  notifyImportBusy.current=onImportBusyChange
  const workId=useRef(work.id);workId.current=work.id
  const draftKey=`exam.photo.draft.${work.id}`
  const readonly=disabled||work.completed
  useEffect(()=>()=>{if(importBusy.current){importBusy.current=false;notifyImportBusy.current?.(false)}},[])
  useEffect(()=>{
    let live=true;originalsGeneration.current++;setPhoto(null);setLines([]);setLoaded(false);setPreviews({});setError('');setNotice('');setConfirmed(false);setBusy(false);setDraftConflict(false)
    api('list',{workId:work.id}).then(data=>{
      if(!live)return
      const saved=data.photo as Photo|null;setPhoto(saved)
      let draft: {photoId?:string;revision?:number;lines?:Line[]}|null=null
      try{draft=JSON.parse(learnerStorage.getItem(draftKey)??'null')}catch{}
      if(saved&&draft?.photoId===saved.id&&Array.isArray(draft.lines)&&draft.lines.length<=150){
        setLines(draft.lines);if(draft.revision!==saved.revision){setPhoto({...saved,revision:draft.revision??saved.revision});setDraftConflict(true);setNotice('Восстановлен твой локальный черновик. Запись на сервере изменилась: скачай текст, затем открой сохранённую серверную запись.')}
      }else setLines(saved?.lines.length?saved.lines:[blank()])
    }).catch(cause=>{if(live)setError(cause.message)}).finally(()=>{if(live)setLoaded(true)})
    return()=>{live=false}
  },[work.id,draftKey])
  useEffect(()=>{
    if(!loaded||!photo)return
    try{learnerStorage.setItem(draftKey,JSON.stringify({photoId:photo.id,revision:photo.revision,lines}))}catch{setNotice('Браузер не смог сохранить локальный черновик. Скачай текст перед закрытием страницы.')}
  },[lines,photo,loaded,draftKey])
  const accept=(next:Photo)=>{setPhoto(next);setLines(next.lines.length?next.lines:[blank()]);setConfirmed(false);setReplaceOCR(false);setReplaceAnswers(false);setDraftConflict(false);setNotice('')}
  const run=async(action:string,extra:Record<string,unknown>={})=>{
    if(operation.current)return
    operation.current=true
    if(action==='remove')originalsGeneration.current++
    if(action==='confirm'){importBusy.current=true;notifyImportBusy.current?.(true)}
    const id=work.id;setBusy(true);setError('');setNotice('')
    try{
      const data=await api(action,{workId:id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,...(photo?{photoId:photo.id,expectedPhotoRevision:photo.revision}:{}),...extra})
      if(workId.current!==id)return
      if(data.photo){if(action==='remove')setPhoto(data.photo);else accept(data.photo)}
      if(data.work)onWork(data.work as T)
      if(data.removed){setPreviews({});setNotice('Оригиналы удалены. Текст с фото и перенесённая запись сохранены.')}
      if(action==='save')setNotice('Строки сохранены отдельно. В работу они попадут после сверки и подтверждения.')
      return data
    }catch(cause){
      if(workId.current!==id)return
      setError(cause instanceof Error?cause.message:'Не удалось выполнить действие. Скачай свои исправления.')
      // Refresh the server generation while preserving every local text edit.
      try{
        const current=await api('list',{workId:id})
        if(workId.current===id){
          if(action==='confirm'&&current.photo?.importedAt){setPhoto(current.photo);onWork(current.work as T)}
          else if(['save','confirm','remove'].includes(action)&&current.photo?.revision!==photo?.revision){setDraftConflict(true);setNotice('Серверная запись изменилась. Скачай свои исправления, затем открой серверную запись.')}
          else if(current.photo)setPhoto(current.photo)
        }
      }catch{}
    }finally{operation.current=false;if(action==='confirm'&&importBusy.current){importBusy.current=false;notifyImportBusy.current?.(false)};if(workId.current===id)setBusy(false)}
  }
  const change=(id:string,patch:Partial<Line>)=>{setLines(current=>current.map(line=>line.id===id?{...line,...patch}:line));setConfirmed(false);setReplaceAnswers(false)}
  const upload=async(files:FileList|null)=>{
    if(!files?.length)return
    if(files.length>3||Array.from(files).some(file=>file.size>10*1024*1024)||Array.from(files).reduce((n,file)=>n+file.size,0)>25*1024*1024){setError('Выбери до трёх фото: каждое до 10 МБ, вместе до 25 МБ.');return}
    const id=work.id;setBusy(true)
    try{
      const images=await Promise.all(Array.from(files).map(readFile))
      if(workId.current!==id)return
      let revision=photo?.revision
      if(photo&&!photo.images.length&&(photo.lines.length||lines.some(line=>line.value.trim()))){
        const saved=await run('save',{lines})
        if(!saved)return
        revision=saved.photo.revision
      }
      await run('upload',{images,...(revision!==undefined?{expectedPhotoRevision:revision}:{})})
    }catch(cause){if(workId.current===id)setError(cause instanceof Error?cause.message:'Не удалось прочитать фото.')}
    finally{if(workId.current===id)setBusy(false)}
  }
  const preview=async(imageId:string)=>{
    const id=work.id,generation=originalsGeneration.current;try{const result=await api('original',{workId:id,photoId:photo?.id,imageId});if(workId.current===id&&originalsGeneration.current===generation)setPreviews(current=>({...current,[imageId]:result.dataUrl}))}catch(cause){if(workId.current===id&&originalsGeneration.current===generation)setError(cause instanceof Error?cause.message:'Не удалось открыть оригинал.')}
  }
  const occupied=lines.some(line=>line.partId&&(work.answersByPart[line.partId]??'').trim())
  return <details className="exam-photo">
    <summary>Перенести свою запись с фото</summary>
    <p>Здесь можно буквально переписать свой лист, сохранив даже ошибочные шаги. Сначала сверь текст с оригиналом. Решение и подсказки при распознавании не добавляются.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {!loaded?<p>Открываем фото…</p>:!photo?<label>JPEG, PNG или WebP · до трёх фото<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={readonly||busy} onChange={event=>{void upload(event.currentTarget.files);event.currentTarget.value=''}}/></label>:<>
      <div>{photo.images.map(image=><figure key={image.id}>
        <button type="button" onClick={()=>void preview(image.id)}>Открыть оригинал: {image.name}</button>
        {previews[image.id]&&<img src={previews[image.id]} alt={`Оригинал твоей записи: ${image.name}`} style={{maxWidth:'100%',maxHeight:480,objectFit:'contain'}}/>}
      </figure>)}</div>
      {photo.error&&<p role="status">{photo.error} Можно переписать строки вручную.</p>}
      {photo.images.length>0?<><p>Автоматическое распознавание запускается только кнопкой. Оно может ошибаться в знаках и символах.</p>
      {(photo.lines.length>0||lines.some(line=>line.value.trim()))&&<label><input type="checkbox" checked={replaceOCR} disabled={readonly||busy} onChange={event=>setReplaceOCR(event.target.checked)}/>Заменить строки новым распознаванием; свой текст уже скачал</label>}
      <button type="button" disabled={readonly||busy||draftConflict||((photo.lines.length>0||lines.some(line=>line.value.trim()))&&!replaceOCR)} onClick={()=>void run('recognize',{replaceConfirmed:replaceOCR})}>{busy?'Выполняется…':'Распознать буквально'}</button></>:<><p role="status">Оригиналы удалены. Текст с фото сохранён ниже.</p>{!work.completed&&<label>Приложить новые снимки · прежний текст останется в истории<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={readonly||busy||draftConflict} onChange={event=>{void upload(event.currentTarget.files);event.currentTarget.value=''}}/></label>}</>}
      {!!photo.history?.length&&<details><summary>Прежние записи с фото · {photo.history.length}</summary>{photo.history.map(record=><p key={record.id}><button type="button" onClick={()=>download(record.lines)}>Скачать текст от {new Date(record.createdAt).toLocaleDateString('ru-RU')}</button></p>)}</details>}
      <p>Можно сразу написать текст вручную. «Только запись» добавляет строку в рассуждение; конкретный пункт дополнительно получает её как ответ.</p>
      {lines.map((line,index)=><fieldset key={line.id} disabled={readonly||busy}>
        <legend>Строка {index+1}{line.uncertain?' · нужно сверить':''}</legend>
        <label>Запись<textarea value={line.value} maxLength={6000} onChange={event=>change(line.id,{value:event.target.value})}/></label>
        <label>Формат<select value={line.kind} onChange={event=>change(line.id,{kind:event.target.value as Line['kind']})}><option value="text">Текст</option><option value="math">Математика / LaTeX</option></select></label>
        <label>Куда перенести<select value={line.partId??''} onChange={event=>change(line.id,{partId:event.target.value||null})}><option value="">Только в запись рассуждения</option>{work.instance.parts.map(part=><option value={part.id} key={part.id}>Ответ: {part.label}</option>)}</select></label>
        {line.note&&<p>{line.note}</p>}
        {line.uncertain&&<label><input type="checkbox" checked={line.checked} onChange={event=>change(line.id,{checked:event.target.checked})}/>Сверил неясную строку с фото</label>}
        <button type="button" disabled={lines.length===1} onClick={()=>{setLines(current=>current.filter(item=>item.id!==line.id));setConfirmed(false)}}>Удалить строку</button>
      </fieldset>)}
      <button type="button" disabled={readonly||busy||lines.length>=150} onClick={()=>{setLines(current=>[...current,blank()]);setConfirmed(false)}}>Добавить строку</button>
      <button type="button" onClick={()=>download(lines)}>Скачать мой текст</button>
      {draftConflict&&<button type="button" disabled={busy} onClick={async()=>{if(window.confirm('Открыть серверные строки вместо локальных? Сначала скачай свой текст.')){try{const current=await api('list',{workId:work.id});if(current.photo)accept(current.photo);else{setPhoto(null);setLines([]);setDraftConflict(false);learnerStorage.removeItem(draftKey)}}catch(cause){setError(cause instanceof Error?cause.message:'Не удалось открыть запись.')}}}}>Открыть сохранённую серверную запись</button>}
      <button type="button" disabled={readonly||busy||draftConflict} onClick={()=>void run('save',{lines})}>Сохранить строки отдельно</button>
      {photo.importedAt?<p role="status">Запись перенесена в работу. Дальнейшие исправления вноси в самой работе.</p>:<>
        {occupied&&<label><input type="checkbox" checked={replaceAnswers} disabled={readonly||busy} onChange={event=>setReplaceAnswers(event.target.checked)}/>Заменить уже записанные ответы выбранных пунктов текстом с фото</label>}
        <label><input type="checkbox" checked={confirmed} disabled={readonly||busy} onChange={event=>setConfirmed(event.target.checked)}/>Сверил все строки с фото и выбрал пункты сам</label>
        <button type="button" disabled={readonly||busy||draftConflict||!confirmed||(occupied&&!replaceAnswers)||lines.some(line=>line.uncertain&&!line.checked)||!lines.some(line=>line.value.trim())} onClick={()=>{const signature=JSON.stringify({lines,replaceAnswers,photoId:photo.id});if(confirmation.current?.signature!==signature)confirmation.current={signature,id:crypto.randomUUID()};void run('confirm',{lines,confirmed:true,replaceAnswersConfirmed:replaceAnswers,requestId:confirmation.current.id})}}>Добавить в мою работу</button>
      </>}
      {photo.images.length>0&&<button type="button" disabled={removalDisabled||busy||draftConflict} onClick={()=>{if(window.confirm('Удалить только оригиналы фото? Сохранённый текст, перенесённая запись и попытки останутся. Это действие нельзя отменить.'))void run('remove')}}>Удалить оригиналы фото</button>}
    </>}
    {readonly&&<p>Сейчас работа доступна только для чтения либо содержит несохранённые изменения. Сохрани её перед переносом фото.</p>}
  </details>
}
