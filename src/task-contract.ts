import type { Problem } from './api-types'

export type TaskContract = {
  packageId: 'percentages' | 'trigonometry' | 'graphs' | 'inequalities'
  contentVersion: number
  input: 'number' | 'interval' | 'notebook'
  requirements: { id: 'answer' | 'a' | 'b'; label: string; answerField: 'generalAnswer' | 'finalAnswer' }[]
  capabilities: { exactFinalAnswer: true; exactGeneralAnswer: boolean; photo: boolean; reasoningVerdict: false }
  examAlignment: { kind: 'preparation'; label: string } | { kind: 'exam-task'; year: 2026; position: 13; label: string }
}

export const isNumericProblem = (problem: Pick<Problem, 'kind'> | null | undefined): boolean => problem?.kind === 'numeric'

export const isScalarProblem = (problem: Pick<Problem, 'kind'> | null | undefined): boolean => problem?.kind === 'numeric' || problem?.kind === 'interval'

// The old persisted/public trig shape remains valid. New packages describe their
// requirements explicitly; this adapter does not infer a task number from a topic.
export function taskContract(problem: Problem): TaskContract {
  if (isScalarProblem(problem)) return {
    packageId: (problem.packageId ?? 'percentages') as TaskContract['packageId'], contentVersion: problem.contentVersion ?? 1, input: problem.kind === 'interval' ? 'interval' : 'number',
    requirements: [{ id: 'answer', label: 'Ответ', answerField: 'finalAnswer' }],
    capabilities: { exactFinalAnswer: true, exactGeneralAnswer: false, photo: false, reasoningVerdict: false },
    examAlignment: { kind: 'preparation', label: `${problem.packageId === 'graphs' ? 'Графики' : problem.packageId === 'inequalities' ? 'Неравенства' : 'Проценты'} · подготовка к профильному ЕГЭ` },
  }
  return {
    packageId: 'trigonometry', contentVersion: problem.contentVersion ?? 1, input: 'notebook',
    requirements: [{ id: 'a', label: 'а) Решить уравнение', answerField: 'generalAnswer' }, { id: 'b', label: 'б) Отобрать корни на отрезке', answerField: 'finalAnswer' }],
    capabilities: { exactFinalAnswer: true, exactGeneralAnswer: true, photo: true, reasoningVerdict: false },
    examAlignment: { kind: 'exam-task', year: 2026, position: 13, label: 'Профильный ЕГЭ · задание 13 · формат 2026' },
  }
}
