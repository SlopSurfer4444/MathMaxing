import { useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { visitorHeaders } from '../visitor-session'

// Transport may contain escaped JSON and embedded photos; decoded storage keeps
// its separate server-side 12 MB budget. Keep aligned with the archive route.
const MAX_ARCHIVE_FILE_BYTES=256*1024*1024

export function downloadExamFile(name:string,value:unknown) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}))
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
async function request<T>(action:string,body?:unknown):Promise<T> {
  const response=await fetch(`/api/profile/archive/${action}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'X-Pole-Client':'notebook-v1',...visitorHeaders(),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)})
  const data=await response.json();if(!response.ok)throw Error(data.error??'Не удалось открыть архив.');return data
}
export function ExamProfile({beforeAction,onRestored,onCleared,disabled}:{beforeAction:()=>Promise<unknown>;onRestored:()=>Promise<void>;onCleared?:()=>Promise<void>;disabled:boolean}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  type Status={storage:{bytes:number;count:number;limits:{bytes:number;works:number};archiveRecommended?:boolean};canExport:boolean;exportBlockReason?:string;canClear:boolean;clearBlockReason?:string}
  const [status,setStatus]=useState<Status|null>(null)
  const storage=status?.storage
  const [archive,setArchive]=useState<unknown>(null),[fileName,setFileName]=useState(''),[confirmed,setConfirmed]=useState(false)
  const [snapshotSha256,setSnapshotSha256]=useState(''),[savedArchive,setSavedArchive]=useState(false),[deletePhrase,setDeletePhrase]=useState('')
  const clearPhrase='Удалить сохранённые работы из этого профиля'
  const refreshStatus=async()=>setStatus(await request<Status>('status'))
  const run=async(action:()=>Promise<void>)=>{if(busy)return;setBusy(true);setError('');try{await beforeAction();await action()}catch(cause){setError(cause instanceof Error?cause.message:'Не удалось выполнить действие.')}finally{setBusy(false)}}
  return <details className="exam-profile" open={open} onToggle={event=>{setOpen(event.currentTarget.open);if(event.currentTarget.open)void refreshStatus().catch(cause=>setError(cause.message))}}>
    <summary>Сохранность записей</summary>
    {open&&<div><p>Архив сохраняет твои работы, попытки, разборы, варианты и фото. Код входа на другом устройстве не заменяет запасную копию.</p>{storage&&<p className="exam-muted">{storage.count} из {storage.limits.works} работ · {(storage.bytes/1000000).toFixed(1)} из {(storage.limits.bytes/1000000).toFixed(0)} МБ{storage.archiveRecommended&&' · пора сохранить архив'}</p>}<button type="button" disabled={disabled||busy||!status?.canExport} onClick={()=>void run(async()=>{const result=await request<{archive:{snapshotSha256?:string}}>('export',{});downloadExamFile(`мои-занятия-${new Date().toISOString().slice(0,10)}.json`,result.archive);setSnapshotSha256(result.archive.snapshotSha256??'');setSavedArchive(false);setDeletePhrase('');setNotice('Архив подготовлен для скачивания. Проверь, что файл сохранился.');await refreshStatus()})}><Download size={14}/>Скачать полный архив</button>{status?.exportBlockReason&&<p className="exam-muted">{status.exportBlockReason}</p>}
      <label className="exam-archive-upload"><Upload size={14}/>Открыть свой архив<input type="file" accept="application/json,.json" disabled={disabled||busy} onChange={event=>{const file=event.target.files?.[0];if(!file)return;setError('');setConfirmed(false);setArchive(null);if(file.size>MAX_ARCHIVE_FILE_BYTES){setError('Файл слишком большой для архива.');return}void file.text().then(text=>{const value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||!('format'in value)||value.format!=='schooltest-profile')throw Error('Это не архив занятий.');setArchive(value);setFileName(file.name)}).catch(cause=>setError(cause.message));event.target.value=''}}/></label>
      {archive!==null&&<div className="exam-archive-confirm"><p>Выбран файл: {fileName}. Восстановление добавит его записи в текущий профиль.</p><label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>Восстановить записи из этого архива</label><button type="button" disabled={disabled||busy||!confirmed} onClick={()=>void run(async()=>{const result=await request<{works:number}>('restore',{archive,confirmRestore:true});setArchive(null);setConfirmed(false);setSnapshotSha256('');setSavedArchive(false);setDeletePhrase('');setNotice(`Записи восстановлены: ${result.works}. Импортированные оценки сохранены как неподтверждённые; исходная история есть в архиве.`);await refreshStatus();await onRestored()})}>Восстановить</button></div>}
      <details className="exam-profile-clear"><summary>Удалить сохранённые работы</summary><p>Это навсегда удалит сохранённые работы, попытки, разборы и фото из текущего профиля. Вернуть записи можно будет только из сохранённого архива.</p>{status?.clearBlockReason&&<p>{status.clearBlockReason}</p>}{!snapshotSha256&&<p>Сначала скачай полный архив выше и проверь, что файл сохранился.</p>}<label><input type="checkbox" checked={savedArchive} disabled={disabled||busy||!snapshotSha256||!status?.canClear} onChange={event=>setSavedArchive(event.target.checked)}/>Я сохранил полный архив и проверил файл</label><label>Для подтверждения напиши: «{clearPhrase}»<input type="text" value={deletePhrase} onChange={event=>setDeletePhrase(event.target.value)} autoComplete="off" disabled={disabled||busy||!savedArchive||!status?.canClear}/></label><button type="button" className="exam-profile-danger" disabled={disabled||busy||!status?.canClear||!snapshotSha256||!savedArchive||deletePhrase!==clearPhrase} onClick={()=>void run(async()=>{const result=await request<{summary:string}>('clear',{snapshotSha256,confirmSavedArchive:true,confirmDeleteProfile:true});setSnapshotSha256('');setSavedArchive(false);setDeletePhrase('');setArchive(null);setNotice(result.summary);await refreshStatus();await (onCleared??onRestored)()})}>{clearPhrase}</button></details>
      {notice&&<p role="status">{notice}</p>}{error&&<p className="exam-profile-error" role="alert">{error}</p>}
    </div>}
  </details>
}
