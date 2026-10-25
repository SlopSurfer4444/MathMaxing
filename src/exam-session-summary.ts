import type { ExamSession } from './exam-ui-types'
import { examResultStatus } from './exam-result-status.ts'

export type ExamSessionCounts = { confirmed: number; incorrect: number; skipped: number; pending: number }
export type ExamSessionSummaryModel =
  | { kind: 'active' }
  | { kind: 'closed' }
  | { kind: 'submitted'; total: number; counts: ExamSessionCounts; lowerBound?: { points: number; maxPoints: number } }

/** Counts tasks once, with partial checks kept separate from confirmed tasks. */
export function examSessionSummary(session: Pick<ExamSession, 'status' | 'tasks' | 'score'>): ExamSessionSummaryModel {
  if (session.status === 'active') return { kind: 'active' }
  if (session.status === 'closed') return { kind: 'closed' }
  const counts: ExamSessionCounts = { confirmed: 0, incorrect: 0, skipped: 0, pending: 0 }
  for (const task of session.tasks) {
    const { kind } = examResultStatus(task.work)
    if (kind === 'correct') counts.confirmed++
    else if (kind === 'incorrect') counts.incorrect++
    else if (kind === 'blank' || kind === 'skipped') counts.skipped++
    else counts.pending++
  }
  const score = session.score
  const lowerBound = score && Number.isSafeInteger(score.verifiedPoints) && Number.isSafeInteger(score.maxPoints)
    && score.verifiedPoints >= 0 && score.maxPoints > 0 && score.verifiedPoints <= score.maxPoints
    ? { points: score.verifiedPoints, maxPoints: score.maxPoints } : undefined
  return { kind: 'submitted', total: session.tasks.length, counts, ...(lowerBound ? { lowerBound } : {}) }
}
