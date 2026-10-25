import { useEffect, useId, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ArrowRight, BookOpen, MessageCircle, RefreshCw } from 'lucide-react'
import type { AssistanceGuidance, Work } from '../api-types'
import { MathContent } from './MathContent'
import { ExplanationTransition } from './ExplanationTransition'
import { assistanceContextKey } from '../assistance-context'
import { learnerStorage } from '../visitor-session'
import { acknowledgeClarification, clarificationKey, clarificationSource, loadClarification, sameClarificationSource, type ClarificationDraft, type ClarificationSource } from '../assistance-draft'
import './adaptive-help.css'

export type AdaptiveGuidance = AssistanceGuidance
type AssistanceResponse = { workId: string; guidance: AdaptiveGuidance }
type HelpIntent = 'recommend' | 'ask' | 'different'
type HelpAttempt = { intent: HelpIntent; reply?: string; basedOn?: string; draftSnapshot?: string; draftSource?: ClarificationSource }
type Props = {
  work: Work; saved: boolean; busy: boolean; enabled?: boolean;
  onEnabled?(value: boolean): void;
  onHelp(): Promise<boolean>;
  request<T>(path: string, body: Record<string, unknown>): Promise<T>;
  onPreparation(resource: 'foundation' | 'example'): void;
  onDiscuss(text: string): void;
  onExercise?(id: string): void;
}

function hasWriting(node: JSONContent): boolean {
  return Boolean(node.text?.trim() || (typeof node.attrs?.latex === 'string' && node.attrs.latex.trim()) || node.content?.some(hasWriting))
}
function storedResponse(work: Work): AssistanceResponse | null {
  const guidance = work.assistance?.guidance
  return work.mode !== 'solo' && guidance && guidance.revision === work.revision && guidance.modeEpoch === work.modeEpoch && guidance.contextKey === assistanceContextKey(work) && typeof guidance.id === 'string' && typeof guidance.text === 'string' ? { workId: work.id, guidance } : null
}

/** Assistance stays beside the student's work. Responses are bound to its saved version. */
export function AdaptiveHelp({ work, saved, busy, enabled = true, onEnabled, onHelp, request, onPreparation, onDiscuss, onExercise }: Props) {
  const contentId = useId()
  const replyId = useId()
  const initialClarification = useRef(loadClarification(learnerStorage, work.id))
  const [response, setResponse] = useState<AssistanceResponse | null>(() => storedResponse(work))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(initialClarification.current.entry?.text ?? '')
  const [draftSource, setDraftSource] = useState<ClarificationSource | null>(initialClarification.current.entry?.source ?? null)
  const [draftStorageFailed, setDraftStorageFailed] = useState(initialClarification.current.failed)
  const draftValue = useRef(draft)
  draftValue.current = draft
  const draftSourceValue = useRef(draftSource)
  draftSourceValue.current = draftSource
  const draftWorkId = useRef(work.id)
  const [pending, setPending] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [failure, setFailure] = useState<HelpAttempt | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const sequence = useRef(0)
  const lastRecommended = useRef('')
  const previous = useRef({ id: work.id, saved })
  const dirtyGeneration = useRef(0)
  const latest = useRef({ work, saved, busy, enabled, onHelp, request })
  latest.current = { work, saved, busy, enabled, onHelp, request }
  if (previous.current.id !== work.id || (previous.current.saved && !saved)) dirtyGeneration.current += 1
  previous.current = { id: work.id, saved }
  const contextKey = assistanceContextKey(work)
  const guidance = saved && work.mode !== 'solo' && response?.workId === work.id && response.guidance.revision === work.revision && response.guidance.modeEpoch === work.modeEpoch && response.guidance.contextKey === contextKey ? response.guidance : undefined
  const currentDraftSource = guidance?.question ? clarificationSource(guidance) : null
  const staleDraft = !!draft && !sameClarificationSource(draftSource, currentDraftSource)
  const blocked = busy || pending
  const writing = hasWriting(work.document) || Boolean(work.finalAnswer.trim() || work.generalAnswer?.trim())
  const versionKey = `${work.id}:${work.revision}:${work.modeEpoch}:${contextKey}`
  const updateDraft = (text: string, source: ClarificationSource | null) => {
    const bounded = text.slice(0, 4000)
    draftValue.current = bounded; draftSourceValue.current = source
    setDraft(bounded); setDraftSource(source)
    try {
      if (bounded) learnerStorage.setItem(clarificationKey(work.id), JSON.stringify({ version: 1, workId: work.id, text: bounded, source, updatedAt: new Date().toISOString() } satisfies ClarificationDraft))
      else learnerStorage.removeItem(clarificationKey(work.id))
      setDraftStorageFailed(false)
    } catch { setDraftStorageFailed(true) }
  }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; sequence.current += 1 }
  }, [])
  useEffect(() => {
    setResponse(storedResponse(work)); setOpen(false); setFailure(null)
    if (draftWorkId.current !== work.id) {
      const recovered = loadClarification(learnerStorage, work.id)
      draftWorkId.current = work.id
      draftValue.current = recovered.entry?.text ?? ''; draftSourceValue.current = recovered.entry?.source ?? null
      setDraft(draftValue.current); setDraftSource(draftSourceValue.current); setDraftStorageFailed(recovered.failed)
    }
    sequence.current += 1
  }, [work.id])
  useEffect(() => {
    const stored = storedResponse(work)
    if (stored) setResponse(stored)
  }, [work.id, work.assistance?.guidance.id])
  useEffect(() => { setFailure(null) }, [work.id, work.revision, work.modeEpoch])

  const perform = async (attempt: HelpAttempt) => {
    const current = latest.current
    if (inFlight.current || current.busy) return
    if (attempt.intent === 'recommend' && (!current.enabled || current.work.mode !== 'guided' || !current.saved)) return
    inFlight.current = true
    const token = ++sequence.current
    const workId = current.work.id
    let source: { revision: number; modeEpoch: number; generation: number } | null = null
    setPending(true); setRegenerating(attempt.intent === 'different'); setFailure(null)
    if (attempt.intent !== 'recommend') setOpen(true)
    try {
      if (current.work.mode === 'solo') {
        if (!await current.onHelp()) { setOpen(false); return }
        // onHelp saves the solo attempt and changes its epoch. Read the fresh props;
        // request itself also uses the parent's current saved-work guard.
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      if (!mounted.current || token !== sequence.current || latest.current.work.id !== workId) return
      const generation = dirtyGeneration.current
      source = { revision: latest.current.work.revision, modeEpoch: latest.current.work.modeEpoch, generation }
      const result = await latest.current.request<AssistanceResponse>('/api/assistance', {
        intent: attempt.intent,
        ...(attempt.reply ? { reply: attempt.reply } : {}),
        ...(attempt.basedOn ? { basedOn: attempt.basedOn } : {}),
      })
      // An acknowledged reply may outlive this panel. Clear only its exact durable snapshot.
      if (result.workId === workId && attempt.draftSnapshot !== undefined && attempt.draftSource) {
        try { acknowledgeClarification(learnerStorage, workId, attempt.draftSnapshot, attempt.draftSource) }
        catch { if (mounted.current && latest.current.work.id === workId) setDraftStorageFailed(true) }
      }
      // The parent accepts the server readback before resolving; let React
      // commit its new source revision before checking the current UI version.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (!mounted.current || token !== sequence.current || latest.current.work.id !== workId || !latest.current.saved || (attempt.intent === 'recommend' && !latest.current.enabled) || generation !== dirtyGeneration.current || result.workId !== workId || result.guidance.revision !== latest.current.work.revision || result.guidance.modeEpoch !== latest.current.work.modeEpoch) return
      // The render guard uses the response's source revision/epoch, including the
      // new epoch after explicit solo help. Late responses never label newer work.
      setResponse(result)
      if (attempt.intent === 'recommend') setOpen(false)
      if (attempt.draftSnapshot !== undefined && draftValue.current === attempt.draftSnapshot && sameClarificationSource(draftSourceValue.current, attempt.draftSource ?? null)) {
        draftValue.current = ''; draftSourceValue.current = null; setDraft(''); setDraftSource(null)
      }
    } catch {
      if (mounted.current && token === sequence.current && latest.current.work.id === workId && (!source || (latest.current.saved && source.revision === latest.current.work.revision && source.modeEpoch === latest.current.work.modeEpoch && source.generation === dirtyGeneration.current))) setFailure(attempt)
    } finally {
      inFlight.current = false
      if (mounted.current) { setPending(false); setRegenerating(false) }
    }
  }
  const performRef = useRef(perform)
  performRef.current = perform

  useEffect(() => {
    if (!enabled || busy || pending || !saved || work.mode !== 'guided' || !writing || guidance || lastRecommended.current === versionKey) return
    const timer = window.setTimeout(() => {
      lastRecommended.current = versionKey
      void performRef.current({ intent: 'recommend' })
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [enabled, busy, pending, saved, work.mode, writing, guidance, versionKey])

  const ask = () => void perform({ intent: 'ask' })
  const reply = (text: string, fromDraft = false) => {
    if (!guidance?.question || !text.trim() || (fromDraft && staleDraft)) return
    void perform({ intent: 'ask', reply: text.trim(), basedOn: guidance.id, ...(fromDraft && draftSource ? { draftSnapshot: text, draftSource } : {}) })
  }
  const discuss = async () => {
    if (latest.current.busy || inFlight.current) return
    const origin = latest.current.work.id
    if (latest.current.work.mode === 'solo' && !await latest.current.onHelp()) { setOpen(false); return }
    if (!mounted.current || latest.current.work.id !== origin) return
    const question = draftValue.current.trim()
    const source = question ? draftSourceValue.current : guidance ? clarificationSource(guidance) : null
    const context = source
      ? `${staleDraft ? 'Сохранённый текст к прежнему пояснению.\n' : ''}Пояснение наставника:\n${source.text}${source.question ? `\n\nВопрос наставника:\n${source.question}` : ''}`
      : question ? 'Это сохранённый текст из помощи к задаче.' : 'Помоги разобраться с моим текущим решением.'
    onDiscuss(question ? `${question}\n\n${context}` : context)
    // onDiscuss opens a chat draft; it does not acknowledge a send. Keep this copy.
  }

  return <section className="adaptive-help" aria-label="Помощь с решением">
    <div className="adaptive-help-heading">
      <h3>Наставник</h3>
      {!open && <button type="button" className="adaptive-help-ask" disabled={busy || (pending && !guidance)} aria-expanded="false" aria-controls={guidance || draft ? contentId : undefined} onClick={guidance || draft ? () => setOpen(true) : ask}>{guidance ? 'Открыть пояснение' : draft ? 'Открыть сохранённый ответ' : 'Нужна помощь'} <ArrowRight size={15} aria-hidden="true"/></button>}
      {open && <button type="button" className="adaptive-help-collapse" aria-expanded="true" aria-controls={contentId} onClick={() => setOpen(false)}>Свернуть</button>}
    </div>
    {!open && guidance && <div className="adaptive-help-offer">
      <div className="adaptive-help-preview"><MathContent text={guidance.text}/></div>
    </div>}
    {!open && failure && <div className="adaptive-help-offer"><p className="adaptive-help-unavailable">Пояснение пока недоступно.</p><button type="button" disabled={blocked} aria-expanded="false" aria-controls={contentId} onClick={() => setOpen(true)}>Открыть варианты помощи <ArrowRight size={14} aria-hidden="true"/></button></div>}
    <p className="adaptive-help-status" role="status">{pending && !regenerating ? 'Смотрим на твою запись…' : !saved && open ? 'Сохраняем запись…' : ''}</p>
    {draftStorageFailed && <p className="adaptive-help-unavailable" role="status">Не удалось сохранить ответ на устройстве. Оставь эту вкладку открытой.</p>}
    {open && <div id={contentId} className="adaptive-help-body">
      {staleDraft && <div className="adaptive-help-fallback" role="status"><p>{draftSource ? 'Сохранённый ответ относится к прежнему пояснению. Его можно перенести в чат.' : 'Здесь остался сохранённый вопрос. Его можно перенести в чат.'}</p><MathContent text={draft}/><div><button type="button" disabled={blocked} onClick={discuss}><MessageCircle size={15} aria-hidden="true"/>Перенести в чат</button><button type="button" disabled={blocked} onClick={() => updateDraft('', null)}>Очистить сохранённый ответ</button></div></div>}
      {guidance && <>
        <ExplanationTransition changing={regenerating} contentKey={guidance.id}>
        <div className="adaptive-help-copy"><MathContent text={guidance.text}/></div>
        {guidance.question && <div className="adaptive-help-question">
          <MathContent text={guidance.question.prompt}/>
          {!!guidance.question.choices?.length && <div className="adaptive-help-choices">{guidance.question.choices.map(choice => <button type="button" key={choice.id} disabled={blocked || !saved} onClick={() => reply(choice.label)}>{choice.label}</button>)}</div>}
        </div>}
        {(guidance.resource || (guidance.exerciseId && onExercise)) && <div className="adaptive-help-resources">
          {guidance.resource && <button type="button" disabled={blocked} onClick={() => onPreparation(guidance.resource!)}><BookOpen size={15} aria-hidden="true"/>{guidance.resource === 'example' ? 'Разобрать похожий пример' : 'Открыть объяснение'}<ArrowRight size={14} aria-hidden="true"/></button>}
          {guidance.exerciseId && onExercise && <button type="button" disabled={blocked} onClick={() => onExercise(guidance.exerciseId!)}>Попробовать небольшую подготовку <ArrowRight size={14} aria-hidden="true"/></button>}
        </div>}
        </ExplanationTransition>
        {guidance.question && !staleDraft && <form className="adaptive-help-reply" onSubmit={event => { event.preventDefault(); reply(draft, true) }}>
          <label className="adaptive-help-accessible-label" htmlFor={replyId}>Ответ наставнику</label>
          <textarea id={replyId} value={draft} rows={2} maxLength={4000} onChange={event => updateDraft(event.target.value, currentDraftSource)} placeholder="Ответь своими словами…"/>
          <div><button type="submit" className="adaptive-help-send" disabled={blocked || !saved || !draft.trim()}>Отправить <ArrowRight size={14} aria-hidden="true"/></button>{draft && <button type="button" disabled={blocked} onClick={() => updateDraft('', null)}>Очистить ответ</button>}</div>
        </form>}
        <button type="button" disabled={blocked || !saved} onClick={() => void perform({ intent: 'different', basedOn: guidance.id })}>Объясни иначе</button>
      </>}
      {failure && <div className="adaptive-help-fallback" role="status">
        <p>Сейчас не получилось получить пояснение. Можно повторить запрос или открыть материал.</p>
        <div><button type="button" disabled={blocked} onClick={() => void perform(failure)}><RefreshCw size={14} aria-hidden="true"/>Попробовать ещё раз</button><button type="button" disabled={blocked} onClick={() => onPreparation('foundation')}><BookOpen size={14} aria-hidden="true"/>Открыть материал</button></div>
      </div>}
      {!guidance && !pending && !failure && <button type="button" className="adaptive-help-ask" disabled={blocked} onClick={ask}>Попросить пояснение <ArrowRight size={15} aria-hidden="true"/></button>}
      {guidance && !staleDraft && <button type="button" className="adaptive-help-discuss" disabled={blocked} onClick={discuss}><MessageCircle size={15} aria-hidden="true"/>Задать вопрос в чате</button>}
    </div>}
    {onEnabled && <button type="button" className="adaptive-help-auto" role="switch" aria-label="Предлагать помощь по моей записи" aria-checked={enabled} onClick={() => onEnabled(!enabled)}>Предлагать помощь <span>{enabled ? 'Вкл' : 'Выкл'}</span></button>}
  </section>
}
