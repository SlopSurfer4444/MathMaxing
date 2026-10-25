import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { GlassSurface } from './glass'
import './WorkspaceDialog.css'

export function WorkspaceDialog({ title, onClose, children }: {title:string; onClose():void; children:ReactNode}) {
  const panel=useRef<HTMLElement>(null)
  const close=useRef(onClose);close.current=onClose
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null
    const root=document.querySelector<HTMLElement>('.app-shell')
    const wasInert=root?.inert
    if(root)root.inert=true
    panel.current?.focus()
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();return}
      if(event.key!=='Tab')return
      const items=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]')??[]).filter(el=>el.getClientRects().length)
      const first=items[0],last=items.at(-1)
      if(!first){event.preventDefault();return}
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus()}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel.current)){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',key)
    return()=>{document.removeEventListener('keydown',key);if(root)root.inert=!!wasInert;if(previous?.isConnected)previous.focus({preventScroll:true})}
  },[])
  return createPortal(<div className="workspace-dialog-backdrop" onClick={event=>{if(event.target===event.currentTarget)onClose()}}><section className="workspace-dialog" role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}><GlassSurface material="frost" className="workspace-dialog-material"><button className="icon-button workspace-dialog-close" aria-label="Закрыть окно" onClick={onClose}><X size={19}/></button><h2>{title}</h2>{children}</GlassSurface></section></div>,document.body)
}
