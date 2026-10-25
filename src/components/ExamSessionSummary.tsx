import { useId } from 'react'
import type { ExamSession } from '../exam-ui-types'
import { examSessionSummary } from '../exam-session-summary'
import './ExamSessionSummary.css'

export function ExamTrainingVariantLabel({ edition, editionStatus }: { edition: string; editionStatus?: string }) {
  return <p className="exam-training-variant-label"><span>Авторский тренировочный вариант</span><span>ЕГЭ {edition}{editionStatus === 'draft' ? ' · проект редакции' : ''}</span></p>
}

export function ExamCoverageWarnings({ warnings }: { warnings?: readonly string[] }) {
  const unique = [...new Set((warnings ?? []).map(value => value.trim()).filter(Boolean))]
  if (!unique.length) return null
  return <details className="exam-coverage-warnings"><summary>Состав и границы варианта</summary><ul>{unique.map(warning => <li key={warning}>{warning}</li>)}</ul></details>
}

/** The caller owns task navigation and every action after this read-only summary. */
export function ExamSessionSummary({ session }: { session: ExamSession }) {
  const headingId = useId()
  const countNoteId = useId()
  const result = examSessionSummary(session)
  if (result.kind === 'active') return null
  return <section className="exam-session-summary" aria-labelledby={headingId}>
    <ExamTrainingVariantLabel edition={session.edition} editionStatus={session.editionStatus}/>
    <h1 id={headingId}>{result.kind === 'closed' ? 'Вариант завершён без проверки' : 'Проверка варианта'}</h1>
    {result.kind === 'closed' ? <p className="exam-session-summary-intro">Записи задач сохранены. Вариант закрыт без общей сдачи: проверка и баллы для этого завершения не рассчитывались. Можно открыть свои записи.</p> : <>
      <p className="exam-session-summary-intro">Сданные записи сохранены. Задач в варианте: {result.total}.</p>
      <dl className="exam-session-counts" aria-label="Задачи по состоянию проверки" aria-describedby={countNoteId}>
        <div className="is-confirmed"><dt>С подтверждёнными ответами</dt><dd>{result.counts.confirmed}</dd></div>
        <div className="is-incorrect"><dt>Нужно исправить</dt><dd>{result.counts.incorrect}</dd></div>
        <div className="is-skipped"><dt>Пропуски</dt><dd>{result.counts.skipped}</dd></div>
        <div className="is-pending"><dt>Нужна проверка</dt><dd>{result.counts.pending}</dd></div>
      </dl>
      <p id={countNoteId} className="exam-session-count-note">Каждая задача учтена один раз. Частичная проверка и неподтверждённое обоснование входят в «Нужна проверка». Если уже найдено расхождение, задача учтена в «Нужно исправить».</p>
      {result.lowerBound ? <div className="exam-session-score-bound"><p>Подтверждено не менее <strong>{result.lowerBound.points} из {result.lowerBound.maxPoints} первичных баллов</strong>.</p><p>Это нижняя граница по кратким ответам. Развёрнутые решения требуют проверки по критериям редакции. Итоговый результат и тестовые баллы не установлены.</p></div> : <p className="exam-session-score-unavailable">Подтверждённые первичные баллы пока недоступны. Итоговый результат не установлен.</p>}
    </>}
    <ExamCoverageWarnings warnings={session.coverageWarnings}/>
  </section>
}
