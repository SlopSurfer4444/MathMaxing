import { GlassSurface } from './glass'
import { learnerStorage } from '../visitor-session'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './AnnotationPreview.css'
import './chat-workspace.css'
import { ArrowDown, ArrowUpRight, LoaderCircle, MessageCircle, Paperclip, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import type { ChatContext, Annotation } from '../notebook-state'
import { MathContent, MathText } from './MathContent'
import { materials, materialSource } from '../materials'
import type { ProviderStatus } from '../api-types'
import { providerPresentation } from '../provider-status'

export type Message = { id: string; role: 'user' | 'assistant'; text: string; contexts: ChatContext[]; requestId: string; createdAt: string; status: 'pending' | 'sent' | 'failed'; error?: string; stale?: boolean; retryContextChanged?: boolean }
export type Provider = ProviderStatus
const countLabel = (n: number) => `${n} ${n === 1 ? 'аннотация' : n < 5 ? 'аннотации' : 'аннотаций'}`
type OutgoingDraft = { id: string; scope: string; text: string; contexts: ChatContext[]; createdAt: string; state: 'pending' | 'restored' }
function readOutgoing(scope: string): OutgoingDraft[] {
  const raw = learnerStorage.getItem(`${scope}.outgoing`)
  if (!raw) return []
  try { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value.filter((item): item is OutgoingDraft => !!item && item.scope === scope && typeof item.id === 'string' && typeof item.text === 'string' && Array.isArray(item.contexts) && (item.state === 'pending' || item.state === 'restored')) : [] } catch { return [] }
}
function mergeDraftText(current: string, recovered: string): string {
  return current === recovered || current.startsWith(`${recovered}\n\n`) ? current : current.trim() ? `${recovered}\n\n${current}` : recovered
}
function mergeDraftContexts(current: ChatContext[], recovered: ChatContext[]): ChatContext[] {
  const seen = new Set(current.map(context => JSON.stringify(context)))
  return [...current, ...recovered.filter(context => { const key = JSON.stringify(context); if (seen.has(key)) return false; seen.add(key); return true })]
}
function readDraftContexts(scope: string): ChatContext[] {
  const raw = learnerStorage.getItem(`${scope}.contexts`)
  if (!raw) return []
  try { const value: unknown = JSON.parse(raw); return Array.isArray(value) ? value.filter((item): item is ChatContext => !!item?.anchor && typeof item.anchor.blockId === 'string' && typeof item.anchor.quote === 'string' && typeof item.source === 'string') : [] } catch { return [] }
}
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
  const content = <div id={id} ref={popup} className={`annotation-preview-popup chat-fragment-preview ${narrow ? 'is-embedded' : ''}`} role="dialog" aria-label="Прикреплённые фрагменты" style={narrow ? undefined : { left: position.left, top: position.top }} onPointerEnter={cancelClose} onPointerLeave={narrow ? undefined : deferClose} onBlur={narrow ? undefined : deferClose}>
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
  const narrow = useNarrowChat()
  const panel = useRef<HTMLElement>(null)
  const headingId = useId()
  const [draft, setDraft] = useState(() => { try { return draftKey ? learnerStorage.getItem(draftKey) ?? '' : '' } catch { return '' } })
  const connection = providerPresentation(provider)
  const [draftError, setDraftError] = useState(false)
  const [recoveries, setRecoveries] = useState<OutgoingDraft[]>(() => { try { return draftKey ? readOutgoing(draftKey).filter(item => item.state === 'pending') : [] } catch { return [] } })
  const [contextsHydrated, setContextsHydrated] = useState(false)
  const [pending, setPending] = useState<{ text: string; contexts: ChatContext[] } | null>(null)
  const sending = useRef(false)
  const draftValue = useRef(draft)
  draftValue.current = draft
  const contextValue = useRef(contexts)
  contextValue.current = contexts
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
    if (draftKey) { try { const saved = readDraftContexts(draftKey); if (saved.length) onContexts(mergeDraftContexts(contextValue.current, saved)) } catch { setDraftError(true) } }
    setContextsHydrated(true)
  }, [draftKey])
  useEffect(() => {
    if (!draftKey || !contextsHydrated) return
    try { learnerStorage.setItem(`${draftKey}.contexts`, JSON.stringify(contexts)) } catch { setDraftError(true) }
  }, [draftKey, contexts, contextsHydrated])
  const restoreOutgoing = (outgoing: OutgoingDraft) => {
    if (!draftKey || outgoing.scope !== draftKey) return
    try {
      const text = mergeDraftText(draftValue.current, outgoing.text)
      const fragments = mergeDraftContexts(contextValue.current, outgoing.contexts)
      learnerStorage.setItem(draftKey, text)
      learnerStorage.setItem(`${draftKey}.contexts`, JSON.stringify(fragments))
      learnerStorage.setItem(`${draftKey}.outgoing`, JSON.stringify(readOutgoing(draftKey).map(item => item.id === outgoing.id ? { ...item, state: 'restored' } : item)))
      draftValue.current = text; setDraft(text); onContexts(fragments)
      setRecoveries(readOutgoing(draftKey).filter(item => item.state === 'pending'))
    } catch { setDraftError(true) }
  }
  const askAgain = (message: Message) => {
    if (blocked) return
    const text = mergeDraftText(draftValue.current, message.text)
    const fragments = mergeDraftContexts(contextValue.current, message.contexts)
    draftValue.current = text; contextValue.current = fragments
    setDraft(text); onContexts(fragments)
    composer.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    const recovered = (event: Event) => {
      const detail = (event as CustomEvent<{ scope: string; failed?: OutgoingDraft }>).detail
      if (detail.scope !== draftKey) return
      if (detail.failed) restoreOutgoing(detail.failed)
      else { try { setRecoveries(readOutgoing(detail.scope).filter(item => item.state === 'pending')) } catch { setDraftError(true) } }
    }
    window.addEventListener('pole:chat-draft-recovered', recovered)
    return () => window.removeEventListener('pole:chat-draft-recovered', recovered)
  }, [draftKey])
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
    const keyboard = (event: KeyboardEvent) => {
      const root = panel.current
      if (!root || event.defaultPrevented) return
      // A fragment preview or another dialog owns its own keys until it closes.
      const preview = document.querySelector('.annotation-preview-popup')
      if ((preview && (event.key === 'Escape' || !root.contains(preview))) || (document.activeElement?.closest('[role="dialog"]') && !root.contains(document.activeElement))) return
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (!narrow || event.key !== 'Tab') return
      const stops = Array.from(root.querySelectorAll<HTMLElement>('button, a[href], textarea, input, select, summary, [tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && !element.closest('[inert]') && element.getClientRects().length > 0)
      const first = stops[0]
      const last = stops.at(-1)
      if (!first || !last) { event.preventDefault(); root.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => document.removeEventListener('keydown', keyboard)
  }, [open, narrow, onClose])
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
    if (!draft.trim() || blocked || sending.current) return
    const text = draft.trim()
    const outgoing: OutgoingDraft = { id: crypto.randomUUID(), scope: draftKey ?? '', text, contexts: [...contexts], createdAt: new Date().toISOString(), state: 'pending' }
    // The immutable outgoing copy survives clearing the composer and component unmounts.
    if (draftKey) {
      try { learnerStorage.setItem(`${draftKey}.outgoing`, JSON.stringify([...readOutgoing(draftKey), outgoing])) }
      catch { setDraftError(true); return }
    }
    sending.current = true
    composer.current?.focus({ preventScroll: true })
    setPending({ text, contexts: [...contexts] }); setDraft(''); pinned.current = true
    const restore = () => {
      if (!draftKey) { setDraft(current => mergeDraftText(current, text)); return }
      try {
        learnerStorage.setItem(draftKey, mergeDraftText(learnerStorage.getItem(draftKey) ?? '', text))
        learnerStorage.setItem(`${draftKey}.contexts`, JSON.stringify(mergeDraftContexts(readDraftContexts(draftKey), outgoing.contexts)))
        learnerStorage.setItem(`${draftKey}.outgoing`, JSON.stringify(readOutgoing(draftKey).map(item => item.id === outgoing.id ? { ...item, state: 'restored' } : item)))
        window.dispatchEvent(new CustomEvent('pole:chat-draft-recovered', { detail: { scope: draftKey, failed: outgoing } }))
      } catch { setDraftError(true) }
    }
    let accepted = false
    try { accepted = await onSend(text) } catch { /* An unaccepted request remains recoverable below. */ }
    try {
      if (!accepted) restore()
      else if (draftKey) {
        const remaining = readOutgoing(draftKey).filter(item => item.id !== outgoing.id && item.state !== 'restored')
        if (remaining.length) learnerStorage.setItem(`${draftKey}.outgoing`, JSON.stringify(remaining)); else learnerStorage.removeItem(`${draftKey}.outgoing`)
        window.dispatchEvent(new CustomEvent('pole:chat-draft-recovered', { detail: { scope: draftKey } }))
      }
    }
    // A storage failure after acknowledgement must never restore an accepted send.
    catch { setDraftError(true) }
    finally {
      sending.current = false
      setPending(null)
      // A late response must never pull the cursor out of the learner's solution.
      if (isOpen.current && (document.activeElement === composer.current || document.activeElement === sendButton.current)) composer.current?.focus({ preventScroll: true })
    }
  }
  return <aside ref={panel} className={`notes-panel chat-panel chat-workspace ${open ? 'is-open' : ''}`} role={open && narrow ? 'dialog' : undefined} aria-modal={open && narrow ? true : undefined} aria-labelledby={headingId} aria-hidden={!open} inert={!open} tabIndex={-1}>
    <GlassSurface material="clear" className="chat-header"><div className="notes-heading"><div><span className="tutor-avatar"><Sparkles size={20} /></span><div><h2 id={headingId}>Наставник</h2></div></div><button className="chat-return" aria-label="Закрыть чат" onClick={onClose}><span>К занятию</span><X size={19} /></button></div><div className="connection-line"><span className={`connection-dot ${connection.state === 'connected' ? 'connected' : ''}`} /><span>{checking ? 'Обновляем статус…' : connection.label}</span><button className="icon-button" title="Обновить статус наставника" aria-label="Обновить статус наставника" disabled={checking} onClick={onCheck}><RefreshCw size={13} className={checking ? 'is-spinning' : ''} /></button></div></GlassSurface>
    {connection.state === 'ready' && <p className="chat-footnote">Связь проверится при первом вопросе.</p>}
    {connection.warning && <div className="connection-warning" role="status">{connection.warning}</div>}
    <div className="chat-scroll-area"><div className="chat-timeline" ref={scroll} role="log" aria-label="Переписка с наставником" tabIndex={0} onScroll={() => { const el=scroll.current; if(el) { pinned.current=el.scrollHeight-el.clientHeight-el.scrollTop<48; setAway(!pinned.current) } }}>
      {messages.length === 0 && !pending && <div className="chat-empty"><div className="chat-empty-icon"><MessageCircle size={25} /><span>?</span></div><p>Спроси своими словами или прикрепи фрагмент решения.</p>{['Объясни, почему это правило работает', 'Помоги разобраться, с чего начать'].map(text => <button key={text} onClick={() => { setDraft(text); composer.current?.focus() }}>{text}<ArrowUpRight size={14} /></button>)}</div>}
      {messages.map(message => <article className={`chat-message is-${message.role}`} key={message.id}><div className="chat-message-meta"><strong>{message.role === 'user' ? 'Ты' : 'Наставник'}</strong><time>{new Date(message.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</time></div><div className="chat-bubble">{message.role === 'user' ? <><AnnotationBundle contexts={message.contexts} onLocate={onLocate} /><MathContent text={message.text} /></> : <AssistantText message={message} onLocate={onLocate} exercises={exercises} onOpenExercise={onOpenExercise} />}{message.stale && <p className="chat-stale">Ответ к прежней версии решения — запись уже изменилась.</p>}{message.status === 'failed' && <div className="chat-request-error" role="alert"><span>{message.error || 'Ответ не получен. Вопрос сохранён.'}</span><button disabled={blocked} onClick={() => message.retryContextChanged ? askAgain(message) : onRetry(message.requestId)}><RefreshCw size={12} /> {message.retryContextChanged ? 'Задать заново' : 'Повторить запрос'}</button></div>}</div></article>)}
      {pending && busy && <article className="chat-message is-user"><div className="chat-message-meta"><strong>Ты</strong><span>Отправляем…</span></div><div className="chat-bubble"><AnnotationBundle contexts={pending.contexts} /><MathContent text={pending.text} /></div></article>}
      {busy && <div className="chat-thinking" role="status"><LoaderCircle size={15} className="is-spinning" /><span>Сейчас разберёмся…</span></div>}
      {notes.length > 0 && <details className="legacy-notes"><summary>Прежние заметки · {notes.length}</summary>{notes.map(note => <article key={note.id}><ContextQuote context={{ anchor: note.anchor, source: note.source }} />{note.messages.map(message => <p key={message.id}>{message.text}</p>)}<button onClick={() => onContexts([...contexts, { anchor: note.anchor, source: note.source }])}>Обсудить фрагмент <ArrowUpRight size={12} /></button></article>)}</details>}
    </div>{away && <button className="chat-jump" onClick={toBottom}><ArrowDown size={14} /> К последним сообщениям</button>}</div>
    {recoveries.length > 0 && <div className="chat-recovery" role="status"><p>Вопрос сохранён, но отправку не удалось подтвердить.</p>{recoveries.map(item => <div key={item.id}><span>{item.text}</span><AnnotationBundle contexts={item.contexts} onLocate={onLocate} /><button onClick={() => restoreOutgoing(item)}>Вернуть в черновик</button></div>)}</div>}
    <div className="chat-compose"><div className="pending-contexts"><AnnotationBundle contexts={contexts} onLocate={onLocate} onRemove={index => onContexts(contexts.filter((_, i) => i !== index))} /></div><textarea ref={composer} value={draft} onChange={event => { draftValue.current = event.target.value; setDraft(event.target.value) }} aria-label="Сообщение наставнику" placeholder={contexts.length ? 'Вопрос к фрагментам…' : 'Твой вопрос…'} disabled={blocked && !busy} rows={2} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() } }} /><div className="chat-compose-footer"><span>Enter — отправить · Shift + Enter — новая строка</span><button ref={sendButton} className="chat-send" aria-label="Отправить сообщение" disabled={blocked || !draft.trim()} onClick={() => void send()}>{busy ? <LoaderCircle size={17} className="is-spinning" /> : <Send size={17} />}</button></div></div>
    {draftError && <p className="chat-draft-error" role="alert">Черновик вопроса не сохранён. Не закрывай страницу до отправки.</p>}
  </aside>
}
