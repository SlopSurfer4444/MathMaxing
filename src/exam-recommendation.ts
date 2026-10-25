import type { ExamRecommendation } from './exam-ui-types'

export type ExamRecommendationAction =
  | { kind: 'open'; workId: string }
  | { kind: 'start'; familyId: string; mode: 'solo' }
  | { kind: 'mixed' }
  | { kind: 'choose'; familyId: string }

// The reason shown to the learner and the action must describe the same step.
export function examRecommendationAction(item: ExamRecommendation): ExamRecommendationAction {
  if (item.goal === 'transfer') return { kind: 'mixed' }
  if ((item.goal === 'repair' || item.goal === 'review') && item.source?.workId) {
    return { kind: 'open', workId: item.source.workId }
  }
  if (['independent', 'recall', 'new-structure'].includes(item.goal ?? '')) {
    return { kind: 'start', familyId: item.familyId, mode: 'solo' }
  }
  return { kind: 'choose', familyId: item.familyId }
}
