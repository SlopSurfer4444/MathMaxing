import { Check, CircleDashed, Minus, PencilLine, TriangleAlert } from 'lucide-react'
import type { ExamWork } from '../exam-ui-types'
import { examResultStatus, type ExamResultKind } from '../exam-result-status'

type ResultTask = { position: number; work: ExamWork; status?: string }
type Props = { tasks: ResultTask[]; selectedWorkId?: string; onSelect(work: ExamWork): void; mode: 'exam' | 'mixed' }

function StatusIcon({ kind }: { kind: ExamResultKind }) {
  const Icon = kind === 'correct' ? Check : kind === 'incorrect' ? TriangleAlert : kind === 'blank' || kind === 'skipped' ? Minus : kind === 'unsubmitted' ? PencilLine : CircleDashed
  return <Icon size={13} aria-hidden="true" />
}

export function ExamResultNavigation({ tasks, selectedWorkId, onSelect, mode }: Props) {
  const results = tasks.map(task => ({ ...task, result: examResultStatus(task.work, task.status) }))
  const legend = [...new Map(results.map(task => [task.result.kind, task.result])).values()]
  return <section className={`exam-result-navigation is-${mode}`} aria-label={mode === 'exam' ? 'Сохранённые задачи варианта' : 'Разбор задач завершённой подборки'}>
    <div className="exam-result-task-list">
      {results.map(task => <button key={task.work.id} type="button"
        className={`exam-result-task is-${task.result.kind}`}
        aria-current={selectedWorkId === task.work.id ? 'step' : undefined}
        aria-label={`Задача ${task.position}. ${task.result.detail}. Открыть запись`}
        title={task.result.detail} onClick={() => onSelect(task.work)}>
        <span className="exam-result-position">{mode === 'mixed' ? `Задача ${task.position}` : task.position}</span>
        <StatusIcon kind={task.result.kind} />
        {mode === 'mixed' && <span className="exam-result-description">{task.result.label}<small>{task.work.attempts.length > 0 ? task.work.attempts.at(-1)?.independent ? 'Самостоятельная попытка' : 'Попытка с помощью' : 'Без сданной попытки'}</small></span>}
      </button>)}
    </div>
    {mode === 'exam' && <ul className="exam-result-legend" aria-label="Состояния задач">{legend.map(result => <li className={`is-${result.kind}`} key={result.kind}><StatusIcon kind={result.kind} /><span>{result.label}</span></li>)}</ul>}
    <p className="exam-result-review-note">Выбери задачу, чтобы открыть свою запись.</p>
  </section>
}
