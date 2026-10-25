import { ArrowRight, ChevronRight, RefreshCw } from 'lucide-react'
import type { StudyPackageId, StudyRouteAction, StudyRouteState } from '../study-route-types'
import { HomeGeometry } from './HomeGeometry'
import './study-route.css'

export function StudyRoute({ route, busy, onAction, onRefresh, onChoose, onSkip }: {
  route: StudyRouteState; busy: boolean;
  onAction(action: StudyRouteAction): void;
  onRefresh(): void;
  onChoose(packageId: StudyPackageId): void;
  onSkip(): void;
}) {
  const continuing = route.current.action.type === 'open'
  return <section className="learning-route" aria-label="Ближайшие занятия">
    <article className="learning-route-current">
      <div className="learning-route-current-copy">
      <span className="study-label">{continuing ? 'Продолжить занятие' : 'Ближайшее занятие'}</span>
      <h2>{route.current.title}</h2>
      <p>{route.current.reason}</p>
      <div className="learning-route-actions">
        <button type="button" className="study-primary" disabled={busy} onClick={() => onAction(route.current.action)}>{continuing ? 'Продолжить' : 'Начать занятие'}<ArrowRight size={16} aria-hidden="true"/></button>
        <button type="button" className="study-text-button" disabled={busy} onClick={onSkip}>Пока пропустить</button>
      </div>
      </div>
      <HomeGeometry/>
    </article>
    <section className="learning-route-next" aria-label="Следующие занятия">
      <div className="learning-route-next-heading"><h3>Дальше по плану</h3><span>Можно поменять</span></div>
      <ol>{route.next.map((card, index) => <li key={card.id}><button type="button" disabled={busy} onClick={() => onAction(card.action)}><span className="learning-route-number" aria-hidden="true">{index + 1}</span><span className="learning-route-next-copy"><strong>{card.title}</strong><span>{card.reason}</span></span><ChevronRight size={15} aria-hidden="true"/></button></li>)}</ol>
      {route.next.length === 0 && <p>Следующие занятия появятся после обновления плана.</p>}
    </section>
    <details className="learning-route-settings"><summary>Настроить занятия</summary>
      <p className="learning-route-goal">{route.goal}</p>
      <p className="learning-route-note">План предварительный. Можно выбрать другую задачу — сохранённые решения останутся.</p>
      <div className="learning-route-controls">
        <label>Тема <select aria-label="Тема ближайших занятий" disabled={busy} value={route.preferredPackage} onChange={event => onChoose(event.target.value as StudyPackageId)}><option value="percentages">Проценты</option><option value="trigonometry">Тригонометрия · №13</option><option value="graphs">Графики и таблицы</option><option value="inequalities">Неравенства</option></select></label>
        <button type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={13} aria-hidden="true"/>Обновить по моим решениям</button>
      </div>
    </details>
  </section>
}
