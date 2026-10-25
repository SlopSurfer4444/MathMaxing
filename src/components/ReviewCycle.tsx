import { useRef, useState } from 'react'
import type { Submission, Work } from '../api-types'
import type { ReviewAnchor, ReviewFinding } from '../review-types'
import { MathContent } from './MathContent'
import './review-cycle.css'

export type ReviewActionBody = {
  workId: string; submissionId: string; action: 'correct' | 'object'; findingId?: string; explanation?: string;
  requestId: string; expectedRevision: number; expectedModeEpoch: number; expectedReviewVersion: number;
}
type Props = {
  submission: Submission; work: Work; busy: boolean;
  onAction(body: ReviewActionBody): Promise<void>; onLocate(anchor: ReviewAnchor): void;
  requestSelfcheck(): Promise<{ checklist: string[] }>; onRetry(): void;
}
const statusLabels = { open: 'Стоит проверить', withdrawn: 'Замечание снято', upheld: 'Замечание остаётся', uncertain: 'Нужна дополнительная проверка' }

function Finding({ finding, blocked, onLocate, onObject }: {
  finding: ReviewFinding; blocked: boolean; onLocate(anchor: ReviewAnchor): void;
  onObject(findingId: string, explanation: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const pending = finding.objections.some(item => item.status === 'pending')
  const disabled = blocked || pending || sending
  const send = async () => {
    setSending(true); setError('')
    try { await onObject(finding.id, explanation.trim()); setExplanation(''); setOpen(false) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось отправить возражение. Текст сохранён здесь.') }
    finally { setSending(false) }
  }
  return <article className={`review-finding is-${finding.status}`}>
    <span className="review-finding-status">{statusLabels[finding.status]}</span>
    <button type="button" className="review-anchor" onClick={() => onLocate(finding.anchor)} title="Перейти к этому месту в решении">
      <span>В твоём решении</span><MathContent text={finding.anchor.quote}/>
    </button>
    <MathContent text={finding.message}/>
    {finding.suggestion && finding.status !== 'withdrawn' && <div className="review-suggestion"><MathContent text={finding.suggestion}/></div>}
    {finding.objections.length > 0 && <details className="review-objections" open={pending || undefined}>
      <summary>Обсуждение замечания ({finding.objections.length})</summary>
      {finding.objections.map(item => <div className="review-objection" key={item.id}>
        <p className="review-objection-user"><strong>Ты:</strong> {item.explanation}</p>
        {item.status === 'pending' ? <p role="status">Наставник проверяет твой довод…</p> : item.status === 'failed' ? <p role="alert">{item.error || 'Не удалось проверить возражение.'} Можно отправить его ещё раз.</p> : <>
          <strong>{item.verdict === 'withdrawn' ? 'Наставник снял замечание' : item.verdict === 'upheld' ? 'Наставник оставил замечание' : 'Наставник не смог уверенно решить'}</strong>
          {item.message && <MathContent text={item.message}/>}
        </>}
      </div>)}
    </details>}
    {finding.status !== 'withdrawn' && !open && <button type="button" className="review-text-button" disabled={disabled} onClick={() => setOpen(true)}>Не согласен / уже обосновал</button>}
    {open && <form className="review-object-form" onSubmit={event => { event.preventDefault(); void send() }}>
      <label htmlFor={`objection-${finding.id}`}>Что наставник не учёл?</label>
      <textarea id={`objection-${finding.id}`} value={explanation} onChange={event => setExplanation(event.target.value)} rows={3} maxLength={4000} placeholder="Например: нужное условие я проверил в предыдущей строке…" disabled={disabled}/>
      <div className="review-cycle-actions"><button type="submit" className="outline-button" disabled={disabled || !explanation.trim()}>{sending ? 'Отправляем…' : 'Проверить мой довод'}</button><button type="button" className="review-text-button" disabled={sending} onClick={() => setOpen(false)}>Закрыть</button></div>
    </form>}
    {error && <p role="alert" className="review-cycle-error">{error}</p>}
  </article>
}

/** A submitted snapshot stays immutable; correction only opens the working draft. */
export function ReviewCycle({ submission, work, busy, onAction, onLocate, requestSelfcheck, onRetry }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [checklist, setChecklist] = useState<string[] | null>(null)
  const requestIds = useRef(new Map<string, string>())
  const blocked = busy || pending || work.mode === 'solo'
  const findings = submission.findings ?? []
  const latest = [...work.submissions].reverse().find(item => item.reason === 'submitted')
  const correcting = work.correctionOf === submission.id
  const act = async (action: 'correct' | 'object', findingId?: string, explanation?: string) => {
    // An interrupted response is not proof the server rejected the action.
    // Reusing the intent key lets an explicit retry retrieve its original result.
    const intent = JSON.stringify([submission.id, action, findingId, explanation])
    const requestId = requestIds.current.get(intent) ?? crypto.randomUUID()
    requestIds.current.set(intent, requestId)
    await onAction({ action, findingId, explanation, workId: work.id, submissionId: submission.id,
      requestId, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch,
      expectedReviewVersion: submission.reviewVersion ?? 0 })
    requestIds.current.delete(intent)
  }
  const perform = async (operation: () => Promise<void>) => {
    setPending(true); setError('')
    try { await operation() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось выполнить действие. Попробуй ещё раз.') }
    finally { setPending(false) }
  }
  const renderFinding = (finding: ReviewFinding) => <Finding key={finding.id} finding={finding} blocked={blocked} onLocate={onLocate} onObject={(id, explanation) => act('object', id, explanation)}/>
  return <section className="review-cycle" aria-label="Разбор рассуждения">
    <h3>Разбор рассуждения</h3>
    {submission.correctionOf && <p className="review-cycle-note">Это проверка исправленного решения. Исходная попытка сохранена.</p>}
    {(findings.length > 0 || submission.reviewSummary || submission.review) && <p className="review-cycle-note">Это комментарии ИИ к ходу решения. Можно исправить запись или оспорить замечание.</p>}
    {submission.reviewSummary && <MathContent text={submission.reviewSummary}/>}
    {findings.slice(0, 2).map(renderFinding)}
    {findings.length > 2 && <details className="review-more"><summary>Ещё замечания ({findings.length - 2})</summary>{findings.slice(2).map(renderFinding)}</details>}
    {submission.review && submission.review!==submission.reviewSummary && <details className="review-more"><summary>Полный комментарий наставника</summary><MathContent text={submission.review}/></details>}
    {submission.reviewStatus === 'pending' && <p role="status">Наставник читает рассуждение…</p>}
    {submission.reviewStatus === 'failed' && <div className="review-cycle-failed"><p>{submission.reviewError || 'Наставник сейчас не смог разобрать рассуждение.'}</p><button type="button" className="review-text-button" disabled={blocked} onClick={onRetry}>Повторить разбор</button></div>}
    <div className="review-cycle-actions">
      {latest?.id === submission.id && <button type="button" className="outline-button" disabled={blocked || correcting} onClick={() => void perform(() => act('correct'))}>{correcting ? 'Исправь запись и проверь снова' : 'Исправить своё решение'}</button>}
      <button type="button" className="review-text-button" disabled={blocked} onClick={() => void perform(async () => { const result = await requestSelfcheck(); setChecklist(result.checklist) })}>Что проверить самому</button>
    </div>
    {correcting && <p className="review-cycle-note">Замечания относятся к прошлой записи. После исправлений нажми «Проверить» — получится новая попытка.</p>}
    {checklist && <div className="review-selfcheck"><h4>Самопроверка</h4><ul>{checklist.map((item, index) => <li key={index}><MathContent text={item}/></li>)}</ul></div>}
    {error && <p className="review-cycle-error" role="alert">{error}</p>}
  </section>
}
