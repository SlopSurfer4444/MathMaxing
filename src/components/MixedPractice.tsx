import type { MixedPracticeState } from '../mixed-practice-types'
import './mixed-practice.css'

type CommonProps = { mixed: MixedPracticeState | null; busy: boolean; onResume(): void }
const results = { unattempted: 'Нет сданного ответа', correct: 'Ответ верный', incorrect: 'В ответе есть ошибка', unknown: 'Ответ не удалось проверить' }
const assistance = { none: 'Без подсказок', used: 'С помощью', unknown: 'Нет данных о помощи' }

function MixedResults({ mixed }: { mixed: MixedPracticeState }) {
  return <div className="mixed-results">
    <p>Результаты первых сданных попыток. Исправления остаются в решениях.</p>
    <ol>{mixed.items.map(item => <li key={item.index}>
      <strong>Задача {item.index + 1}</strong>
      <span className={`mixed-result-status is-${item.status}`}>{results[item.status]}</span>
      <span className="mixed-result-context">{assistance[item.assistance]}{item.repeated ? ' · уже встречалась' : item.repeated === false ? ' · новая задача' : ''}</span>
    </li>)}</ol>
    <p>Здесь проверены ответы. Правильность всего рассуждения или доказательства этим не подтверждается.</p>
  </div>
}

export function MixedPracticeCard({ mixed, busy, onStart, onResume }: CommonProps & { onStart(): void }) {
  const active = mixed?.status === 'active'
  return <section className="mixed-practice-card" aria-label="Смешанная практика">
    <h2>Задачи вперемешку</h2>
    <p>{active ? `Продолжи с задачи ${mixed.position + 1} из ${mixed.total}. Можно уйти и вернуться — ответы сохраняются.` : 'Три задачи из разных доступных тем. Попробуй сам выбрать способ решения. Это короткая тренировка, не полный вариант ЕГЭ.'}</p>
    {mixed?.status === 'complete' && <MixedResults mixed={mixed}/>}
    <button type="button" className="study-primary" disabled={busy} onClick={active ? onResume : onStart}>{active ? 'Продолжить подборку' : mixed ? 'Новая подборка' : 'Начать три задачи'}</button>
  </section>
}

/** No topic or method names before solving. Parent binds this to the saved set. */
export function MixedPracticeBanner({ mixed, busy, onNext, onResume, isCurrentWork = true }: CommonProps & { onNext(): void; isCurrentWork?: boolean }) {
  if (!mixed) return null
  if (mixed.status === 'complete') return <section className="mixed-practice-banner" aria-label="Результаты смешанной практики"><h2>Подборка завершена</h2><MixedResults mixed={mixed}/></section>
  const current = mixed.items[mixed.position]
  const submitted = current?.status !== 'unattempted' && Boolean(current?.submissionId)
  return <section className="mixed-practice-banner" aria-label="Смешанная практика">
    <div><strong>Задача {mixed.position + 1} из {mixed.total}</strong><p>{isCurrentWork ? 'Можно попросить помощь — в результате это будет отмечено.' : 'В подборке осталась незавершённая задача.'}</p></div>
    {!isCurrentWork ? <button type="button" disabled={busy} onClick={onResume}>Вернуться в подборку</button> : submitted ? <button type="button" disabled={busy} onClick={onNext}>{mixed.position + 1 === mixed.total ? 'Завершить подборку' : 'Следующая задача'}</button> : <span className="mixed-next-hint">Сначала сдай свой ответ</span>}
  </section>
}
