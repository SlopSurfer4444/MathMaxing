import type { ExamWork } from './exam-ui-types'

export type ExamResultKind = 'blank' | 'skipped' | 'unsubmitted' | 'pending' | 'pending-proof' | 'partial' | 'incorrect' | 'correct'
export type ExamResultStatus = { kind: ExamResultKind; label: string; detail: string }

/** Describes public, current evidence only. It never estimates a score or mastery. */
export function examResultStatus(work: ExamWork, taskStatus?: string): ExamResultStatus {
  if (taskStatus === 'skipped') return { kind: 'skipped', label: 'Пропуск', detail: 'Задача оставлена с пропуском' }
  const latest = work.attempts.at(-1)
  const parts = work.instance.parts
  const proofPart = (kind: string) => kind === 'text' || kind === 'proof'
  const hasContent = parts.some(part => (work.answersByPart[part.id] ?? '').trim() || proofPart(part.kind) && work.reasoning.trim())
  if (!hasContent) return { kind: 'blank', label: 'Нет ответа', detail: 'Ответ не указан' }
  if (!latest) return { kind: 'unsubmitted', label: 'Не сдавалась', detail: 'Запись есть, попытка не сдавалась' }

  // An old confirmation cannot describe an edited answer or an unknown snapshot.
  const unchanged = latest.answersByPart !== undefined && parts.every(part =>
    (latest.answersByPart?.[part.id] ?? '') === (work.answersByPart[part.id] ?? '')
  ) && (!parts.some(part => proofPart(part.kind)) || (latest.reasoning ?? '') === work.reasoning)
  if (!unchanged) return { kind: 'pending', label: 'Не проверено', detail: 'Текущая запись отличается от сданной или её проверка не подтверждена' }

  const evaluations = work.evaluations.filter(item => item.active && item.attemptId === latest.id)
  const checkedParts = parts.map(part => {
    const supplied = (latest.answersByPart?.[part.id] ?? '').trim() || proofPart(part.kind) && (latest.reasoning ?? '').trim()
    const claims = evaluations.filter(item => item.partId === part.id)
    const status = !supplied ? 'missing' : claims.some(item => item.status === 'incorrect') ? 'incorrect'
      : claims.length > 0 && claims.every(item => item.status === 'correct') ? 'correct' : 'unknown'
    return { part, status }
  })
  const correct = checkedParts.filter(item => item.status === 'correct').length
  const proofPending = checkedParts.some(item => proofPart(item.part.kind) && item.status === 'unknown')
  const proofMissing = checkedParts.some(item => proofPart(item.part.kind) && item.status === 'missing')
  if (checkedParts.some(item => item.status === 'incorrect')) return {
    kind: 'incorrect', label: 'Есть расхождение',
    detail: `В ответе есть расхождение${proofPending ? '; обоснование не проверено' : ''}`,
  }
  if (parts.length > 0 && correct === parts.length) return { kind: 'correct', label: 'Ответы подтверждены', detail: 'Ответы последней попытки подтверждены; это не оценка освоения темы' }
  if (proofPending) return {
    kind: 'pending-proof', label: 'Обоснование не проверено',
    detail: correct > 0 ? 'Часть ответов подтверждена; обоснование ждёт проверки' : 'Обоснование не проверено; автоматическая проверка ответа не подтверждает доказательство',
  }
  if (correct > 0) return { kind: 'partial', label: 'Проверено частично', detail: `Подтверждено ответов: ${correct} из ${parts.length}; ${proofMissing ? 'обоснование не записано' : 'остальное не проверено или не заполнено'}` }
  return { kind: 'pending', label: 'Не проверено', detail: 'Запись сохранена, подтверждённого результата проверки нет' }
}
