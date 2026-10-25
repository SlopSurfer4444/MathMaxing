import { useEffect, useState } from 'react'
import { visitorHeaders } from '../visitor-session'
import './ProfileRecovery.css'

async function request<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Pole-Client':'notebook-v1',...visitorHeaders()},...(body===undefined?{}:{body:JSON.stringify(body)})})
  const result=await response.json()
  if(!response.ok)throw Error(result.error??'Не удалось открыть профиль. Попробуй ещё раз.')
  return result
}

export function ProfileRecovery({beforeSwitch,onSwitchFailed}:{beforeSwitch:()=>Promise<void>;onSwitchFailed?:()=>void}){
  const [open,setOpen]=useState(false),[status,setStatus]=useState<{available:boolean;hasCode:boolean}|null>(null)
  const [issued,setIssued]=useState(''),[code,setCode]=useState(''),[saved,setSaved]=useState(false),[confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{if(!open)return;let active=true;request<{available:boolean;hasCode:boolean}>('/api/profile').then(value=>{if(active)setStatus(value)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[open])
  async function create(){setBusy(true);setError('');try{const result=await request<{code:string}>('/api/profile/recovery',{});setIssued(result.code);setSaved(false);setStatus({available:true,hasCode:true})}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  async function restore(){setBusy(true);setError('');try{await beforeSwitch();await request('/api/profile/restore',{code,confirmSwitch:confirmed,savedCurrentCode:saved});window.location.reload()}catch(e){setError(e instanceof Error?e.message:String(e));setBusy(false);onSwitchFailed?.()}}
  return <details className="profile-recovery" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>Продолжить на другом устройстве</summary>
    {open&&<div className="profile-recovery-content">
      {error&&<p role="alert">{error}</p>}
      {!status&&!error&&<p role="status">Открываем профиль…</p>}
      {status&&!status.available&&<p>Сейчас открыта локальная версия. Её тетрадь хранится на этом компьютере. Перенос между устройствами доступен на опубликованном сайте.</p>}
      {status?.available&&<>
        <p>Сохрани личный код. На другом устройстве открой этот сайт и введи его здесь — появятся твои работы и маршрут. Код даёт доступ к ним: не отправляй его другим.</p>
        <button type="button" disabled={busy} onClick={()=>void create()}>{status.hasCode?'Заменить код доступа':'Получить код доступа'}</button>
        {status.hasCode&&!issued&&<p>Код уже создан. Если потерял его, получи новый: предыдущий перестанет работать.</p>}
        {issued&&<label>Твой код — сохрани его сейчас<textarea className="profile-recovery-code" readOnly value={issued} rows={3} autoComplete="off" spellCheck={false} onFocus={event=>event.currentTarget.select()}/></label>}
        <hr/>
        <h3>Открыть другой свой профиль</h3>
        <p>Работы этого браузера останутся в текущем профиле. Они не объединятся с другим. Для возврата понадобится его код.</p>
        <label className="profile-recovery-check"><input type="checkbox" checked={saved} disabled={busy||!status.hasCode} onChange={event=>setSaved(event.target.checked)}/>Я сохранил код текущего профиля</label>
        <label>Код профиля с другого устройства<input type="password" value={code} maxLength={100} autoComplete="off" spellCheck={false} disabled={busy} onChange={event=>setCode(event.target.value)}/></label>
        <label className="profile-recovery-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/>Переключиться на этот профиль, оставив текущие работы отдельно</label>
        <button type="button" disabled={busy||!saved||!confirmed||!code.trim()} onClick={()=>void restore()}>{busy?'Подожди…':'Открыть профиль'}</button>
      </>}
    </div>}
  </details>
}
