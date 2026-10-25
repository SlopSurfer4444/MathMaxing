import { lazy } from 'react'
import type { ExamEvaluation } from '../exam-ui-types'

const MathContent = lazy(() => import('./MathContent').then(module => ({ default: module.MathContent })))
const statuses = { correct: 'Подтверждено', incorrect: 'Нужно исправить', unknown: 'Нужна проверка' }

/** Concise presentation; original evaluations and scopes remain unchanged. */
export function ExamEvaluationResult({ evaluation, label, disabled, onObject }: {
  evaluation: ExamEvaluation; label?: string; disabled: boolean; onObject(): void
}) {
  const isEmpty = evaluation.summary === 'Ответ не указан.'
  const defaultProofMessage = evaluation.claim === 'reasoning' && evaluation.status === 'unknown'
    && evaluation.summary.startsWith('Обоснование сохранено. Автоматическая проверка числа')
  const summary = defaultProofMessage ? 'Текст сохранён. Доказательство целиком пока не проверено.' : evaluation.summary
  return <div className={`exam-feedback is-${evaluation.status}`}>
    <div><strong>{isEmpty ? 'Нет ответа' : statuses[evaluation.status]}</strong><span>{label}</span></div>
    <MathContent text={summary}/>
    {evaluation.scope && <details className="exam-check-scope"><summary>Что проверено</summary><MathContent text={evaluation.scope}/></details>}
    <button type="button" className="exam-text" disabled={disabled} onClick={onObject}>Не согласен с проверкой</button>
    {evaluation.objections?.map((object, index) => <p key={index} className="exam-objection-note">Возражение сохранено. {object.summary ?? ''}</p>)}
  </div>
}
