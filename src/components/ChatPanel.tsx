import { learnerStorage } from '../visitor-session'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './AnnotationPreview.css'
import { ArrowDown, ArrowUpRight, LoaderCircle, MessageCircle, Paperclip, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import type { ChatContext, Annotation } from '../notebook-state'
import { MathContent, MathText } from './MathContent'
import { materials, materialSource } from '../materials'

export type Message = { id: string; role: 'user' | 'assistant'; text: string; contexts: ChatContext[]; requestId: string; createdAt: string; status: 'pending' | 'sent' | 'failed'; error?: string; stale?: boolean }
export type Provider = { connected: boolean; provider: string; model?: string; error?: string }
const countLabel = (n: number) => `${n} ${n === 1 ? 'аннотация' : n < 5 ? 'аннотации' : 'аннотаций'}`
function useNarrowChat() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)')
    const update = () => setNarrow(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return narrow
}

export function ContextQuote({ context, onRemove, onLocate }: { context: ChatContext; onRemove?(): void; onLocate?(): void }) {
  return <div className="context-quote"><div className="context-quote-heading"><span><Paperclip size={12} />{context.anchor.origin === 'material' ? context.anchor.title ?? 'Материал темы' : 'Из моего решения'}</span>{onRemove && <button className="icon-button" aria-label="Убрать фрагмент из вопроса" onClick={onRemove}><X size={14} /></button>}</div>{context.anchor.kind === 'math' ? <MathText value={context.anchor.latex || context.anchor.quote} /> : <p>{context.anchor.quote}</p>}{onLocate && <button className="quote-locate" onClick={onLocate}>К источнику <ArrowUpRight size={13} /></button>}</div>
}
function AnnotationPreview({ label, inline = false, children }: { label: ReactNode; inline?: boolean; children(close: () => void): ReactNode }) {
  const id = useId()
  const narrow = useNarrowChat()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 8, top: 8 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const pinned = useRef(false)
  const ignoreFocus = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current) }
  const close = () => { cancelClose(); pinned.current = false; setOpen(false) }
  const reveal = () => {
    cancelClose()
    window.dispatchEvent(new CustomEvent('pole:annotation-preview', { detail: id }))
    setOpen(true)
  }
  const deferClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => {
      if (!pinned.current && !popup.current?.contains(document.activeElement) && document.activeElement !== trigger.current) setOpen(false)
    }, 160)
  }
  useEffect(() => {
    const other = (event: Event) => { if ((event as CustomEvent).detail !== id) { pinned.current = false; setOpen(false) } }
    window.addEventListener('pole:annotation-preview', other)
    return () => { cancelClose(); window.removeEventListener('pole:annotation-preview', other) }
  }, [id])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (narrow) return
      const anchor = trigger.current?.getBoundingClientRect()
      if (!anchor || !trigger.current?.getClientRects().length) { setOpen(false); return }
      const width = popup.current?.offsetWidth ?? 360
      const height = popup.current?.offsetHeight ?? 200
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
      const below = anchor.bottom + 8
      const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, anchor.top - height - 8)
      setPosition({ left, top })
    }
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close()
      if (popup.current?.contains(document.activeElement)) { ignoreFocus.current = true; trigger.current?.focus() }
    }
    const focusOutside = (event: FocusEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close() }
    place()
    const observer = new ResizeObserver(place)
    if (popup.current) observer.observe(popup.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('focusin', focusOutside)
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); document.removeEventListener('focusin', focusOutside) }
  }, [open, narrow])
  const content = <div id={id} ref={popup} className={`annotation-preview-popup ${narrow ? 'is-embedded' : ''}`} role="dialog" aria-label="Прикреплённые фрагменты" style={narrow ? undefined : { left: position.left, top: position.top }} onPointerEnter={cancelClose} onPointerLeave={narrow ? undefined : deferClose} onBlur={narrow ? undefined : deferClose}>
    <div className="annotation-preview-header"><span>Фрагменты вопроса</span><button aria-label="Закрыть предпросмотр" onClick={() => { close(); ignoreFocus.current = true; trigger.current?.focus() }}><X size={15}/></button></div>
    {children(close)}
  </div>
  return <span className={`annotation-preview ${inline ? 'is-inline' : ''}`}>
    <button ref={trigger} className="annotation-preview-trigger" aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      onPointerEnter={event => { if (!narrow && event.pointerType === 'mouse') reveal() }} onPointerLeave={narrow ? undefined : deferClose}
      onFocus={() => { if (ignoreFocus.current) { ignoreFocus.current = false; return } if (!narrow) reveal() }}
      onBlur={narrow ? undefined : deferClose}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; reveal() } }}
      onKeyDown={event => { if ((event.key === 'ArrowDown' || event.key === 'Tab' && !event.shiftKey) && open) { const first = popup.current?.querySelector<HTMLButtonElement>('button'); if (first) { event.preventDefault(); pinned.current = true; first.focus() } } }}>
      {label}
    </button>
    {open && (narrow ? content : createPortal(content, document.body))}
  </span>
}
function AnnotationLink({ index, context, onLocate }: { index: number; context: ChatContext; onLocate(): void }) {
  return <AnnotationPreview inline label={<>Аннотация {index}</>}>{close => <div className="annotation-preview-item"><span className="annotation-preview-number">{index}.</span><ContextQuote context={context} onLocate={() => { close(); onLocate() }}/></div>}</AnnotationPreview>
}
function AnnotationBundle({ contexts, onLocate, onRemove }: { contexts: ChatContext[]; onLocate?(context: ChatContext): void; onRemove?(index: number): void }) {
  if (!contexts.length) return null
  return <AnnotationPreview label={<><MessageCircle size={14}/>{countLabel(contexts.length)}</>}>{close => <>{contexts.map((context, i) => <div className="annotation-preview-item" key={`${context.anchor.blockId}-${i}`}><span className="annotation-preview-number">{i + 1}.</span><ContextQuote context={context} onLocate={onLocate ? () => { close(); onLocate(context) } : undefined} onRemove={onRemove ? () => { onRemove(i); if (contexts.length === 1) close() } : undefined}/></div>)}</>}</AnnotationPreview>
}
function AssistantText({ message, onLocate, exercises, onOpenExercise }: { message: Message; onLocate(context: ChatContext): void; exercises?: { id: string; title: string }[]; onOpenExercise?(id: string): void }) {
  const used = new Set([...message.text.matchAll(/\[\[annotation:(\d+)\]\]/g)].map(m => Number(m[1])))
  return <><MathContent text={message.text} exercises={exercises} onOpenExercise={onOpenExercise} onOpenMaterial={id => { const article = materials.find(item => item.id === id); if (article) onLocate({ anchor: { blockId: id, origin: 'material', kind: 'text', title: article.title, quote: article.statement }, source: materialSource(id) ?? '' }) }} renderAnnotation={index => message.contexts[index - 1] ? <AnnotationLink index={index} context={message.contexts[index - 1]} onLocate={() => onLocate(message.contexts[index - 1])} /> : null} />{message.contexts.some((_, i) => !used.has(i + 1)) && <div className="answer-references"><span>К твоим фрагментам:</span>{message.contexts.map((context, i) => !used.has(i + 1) && <AnnotationLink key={i} index={i + 1} context={context} onLocate={() => onLocate(context)} />)}</div>}</>
}
export function ChatPanel({ open, onClose, provider, messages, contexts, onContexts, onSend, onRetry, onCheck, onLocate, busy, blocked, checking, notes, exercises, onOpenExercise, draftRequest, draftKey, onDraftConsumed }: {
  open: boolean; onClose(): void; provider: Provider | null; messages: Message[]; contexts: ChatContext[]; onContexts(value: ChatContext[]): void;
  onSend(message: string): Promise<boolean>; onRetry(requestId: string): void; onCheck(): void; onLocate(context: ChatContext): void; busy: boolean; blocked: boolean; checking: boolean; notes: Annotation[]; exercises?: { id: string; title: string }[]; onOpenExercise?(id: string): void;
  draftRequest?: { text: string; token: number }; draftKey?: string; onDraftConsumed?(token: number): void;
}) {
  const [draft, setDraft] = useState(() => { try { return draftKey ? learnerStorage.getItem(draftKey) ?? '' : '' } catch { return '' } })
  const [draftError, setDraftError] = useState(false)
  const [pending, setPending] = useState<{ text: string; contexts: ChatContext[] } | null>(null)
  const [away, setAway] = useState(false)
  const composer = useRef<HTMLTextAreaElement>(null)
  const sendButton = useRef<HTMLButtonElement>(null)
  const isOpen = useRef(open)
  isOpen.current = open
  const scroll = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const previousCount = useRef(contexts.length)
  const appliedDraft = useRef<number | null>(null)
  useEffect(() => {
    if (!draftKey) return
    try {
      if (draft) learnerStorage.setItem(draftKey, draft); else learnerStorage.removeItem(draftKey)
      setDraftError(false)
    } catch { setDraftError(true) }
  }, [draftKey, draft])
  useEffect(() => {
    if (!open) window.dispatchEvent(new CustomEvent('pole:annotation-preview', { detail: null }))
  }, [open])
  useEffect(() => {
    if (!open) return
    if (draftRequest && appliedDraft.current !== draftRequest.token) {
      setDraft(current => current.trim() ? `${current}\n\n${draftRequest.text}` : draftRequest.text)
      appliedDraft.current = draftRequest.token
      onDraftConsumed?.(draftRequest.token)
    }
    composer.current?.focus({ preventScroll: true })
  }, [open, draftRequest?.token])
  const lastId = messages.at(-1)?.id
  const toBottom = () => { if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; pinned.current = true; setAway(false) }
  useEffect(() => {
    if (open && contexts.length > previousCount.current) composer.current?.focus({ preventScroll: true })
    previousCount.current = contexts.length
  }, [contexts.length, open])
  useEffect(() => { if (open && pinned.current) toBottom() }, [lastId, busy, open, pending])
  useEffect(() => { if (composer.current) { composer.current.style.height = 'auto'; composer.current.style.height = `${Math.min(composer.current.scrollHeight, 128)}px` } }, [draft])
  const send = async () => {
    if (!draft.trim() || blocked) return
    const text = draft.trim()
    composer.current?.focus({ preventScroll: true })
    setPending({ text, contexts: [...contexts] }); setDraft(''); pinned.current = true
    const restore = () => setDraft(current => current.trim() ? `${text}\n\n${current}` : text)
    try { const accepted = await onSend(text); if (!accepted) restore() }
    catch { restore() }
    finally {
      setPending(null)
      // A late response must never pull the cursor out of the learner's solution.
      if (isOpen.current && (document.activeElement === composer.current || document.activeElement === sendButton.current)) composer.current?.focus({ preventScroll: true })
    }
  }
  return <aside className={`notes-panel chat-panel ${open ? 'is-open' : ''}`} aria-label="Чат с ИИ">
    <header className="chat-header"><div className="notes-heading"><div><span className="tutor-avatar"><Sparkles size={20} /></span><div><h2>Разберём вместе</h2><p>Можно спросить с самого начала</p></div></div><button className="chat-return" aria-label="Закрыть чат" onClick={onClose}><span>Закрыть</span><X size={19} /></button></div><div className="connection-line"><span className={`connection-dot ${provider?.connected ? 'connected' : ''}`} /><span>{checking ? 'Проверяем связь…' : provider?.connected ? 'Наставник на связи' : 'Нет подключения'}</span><button className="icon-button" title="Проверить связь с наставником" aria-label="Проверить связь с наставником" disabled={checking} onClick={onCheck}><RefreshCw size={13} className={checking ? 'is-spinning' : ''} /></button></div></header>
    {provider && !provider.connected && <div className="connection-warning">Наставник пока недоступен. Можно продолжать решать и пользоваться материалами. Чтобы проверить связь, нажми ↻.</div>}
    <div className="chat-scroll-area"><div className="chat-timeline" ref={scroll} role="log" aria-label="Переписка с наставником" tabIndex={0} onScroll={() => { const el=scroll.current; if(el) { pinned.current=el.scrollHeight-el.clientHeight-el.scrollTop<48; setAway(!pinned.current) } }}>
      {messages.length === 0 && !pending && <div className="chat-empty"><div className="chat-empty-icon"><MessageCircle size={25} /><span>?</span></div><h3>Что разберём?</h3><p>Можно не знать, с чего начать. Спроси своими словами или прикрепи фрагмент из тетради.</p>{['Я пока не понимаю, что такое синус', 'Помоги разобраться, с чего начать'].map(text => <button key={text} onClick={() => { setDraft(text); composer.current?.focus() }}>{text}<ArrowUpRight size={14} /></button>)}</div>}
      {messages.map(message => <article className={`chat-message is-${message.role}`} key={message.id}><div className="chat-message-meta"><strong>{message.role === 'user' ? 'Ты' : 'Наставник'}</strong><time>{new Date(message.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</time></div><div className="chat-bubble">{message.role === 'user' ? <><AnnotationBundle contexts={message.contexts} onLocate={onLocate} /><MathContent text={message.text} /></> : <AssistantText message={message} onLocate={onLocate} exercises={exercises} onOpenExercise={onOpenExercise} />}{message.stale && <p className="chat-stale">Ответ к прежней версии решения — запись уже изменилась.</p>}{message.status === 'failed' && <div className="chat-request-error" role="alert"><span>{message.error || 'Ответ не получен. Вопрос сохранён.'}</span><button disabled={blocked} onClick={() => onRetry(message.requestId)}><RefreshCw size={12} /> Повторить запрос</button></div>}</div></article>)}
      {pending && busy && <article className="chat-message is-user"><div className="chat-message-meta"><strong>Ты</strong><span>Отправлено</span></div><div className="chat-bubble"><AnnotationBundle contexts={pending.contexts} /><MathContent text={pending.text} /></div></article>}
      {busy && <div className="chat-thinking" role="status"><LoaderCircle size={15} className="is-spinning" /><span>Сейчас разберёмся…</span></div>}
      {notes.length > 0 && <details className="legacy-notes"><summary>Прежние заметки · {notes.length}</summary>{notes.map(note => <article key={note.id}><ContextQuote context={{ anchor: note.anchor, source: note.source }} />{note.messages.map(message => <p key={message.id}>{message.text}</p>)}<button onClick={() => onContexts([...contexts, { anchor: note.anchor, source: note.source }])}>Обсудить фрагмент <ArrowUpRight size={12} /></button></article>)}</details>}
    </div>{away && <button className="chat-jump" onClick={toBottom}><ArrowDown size={14} /> К последним сообщениям</button>}</div>
    <div className="chat-compose"><div className="pending-contexts"><AnnotationBundle contexts={contexts} onLocate={onLocate} onRemove={index => onContexts(contexts.filter((_, i) => i !== index))} /></div><textarea ref={composer} value={draft} onChange={event => setDraft(event.target.value)} aria-label="Сообщение наставнику" placeholder={contexts.length ? 'Что непонятно в этих фрагментах?' : 'Спроси о чём угодно по теме…'} disabled={blocked && !busy} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} /><div className="chat-compose-footer"><span>Enter — отправить · Shift + Enter — новая строка</span><button ref={sendButton} className="chat-send" aria-label="Отправить сообщение" disabled={blocked || !draft.trim()} onClick={() => void send()}>{busy ? <LoaderCircle size={17} className="is-spinning" /> : <Send size={17} />}</button></div></div>
    {draftError && <p className="chat-footnote" role="alert">Черновик вопроса не сохранён. Не закрывай страницу до отправки.</p>}
  </aside>
}
