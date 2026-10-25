import type { ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ArrowRight, BookOpen, ChevronRight } from 'lucide-react'
import type { Problem, Work, WorkSummary } from '../api-types'
import { HomeGeometry } from './HomeGeometry'
import './study-home.css'

export type StudyPackage = { id: string; title: string; description: string }
const defaultPackages: StudyPackage[] = [
  { id: 'percentages', title: 'Проценты', description: 'Скидки и изменения цены: одно или два изменения подряд, поиск начальной величины.' },
  { id: 'trigonometry', title: 'Тригонометрия · №13', description: 'Найти все решения уравнения и отобрать корни на отрезке. Можно начать с синуса и окружности.' },
  { id: 'graphs', title: 'Графики и таблицы', description: 'Прочитать значение, разобраться со шкалами и понять, как меняется величина.' },
  { id: 'inequalities', title: 'Неравенства', description: 'Понять, какие числа подходят, как записать промежуток и проверить его границы.' },
]

export type StudySection = 'study' | 'tasks' | 'materials'

function hasWriting(node: JSONContent): boolean {
  return Boolean(node.text?.trim() || (node.type === 'mathBlock' && node.attrs?.latex?.trim()) || node.content?.some(hasWriting))
}

const topicSymbols: Record<string, string> = { percentages: '%', trigonometry: '∿', graphs: '↗', inequalities: '≤' }

export function StudyHome({ section, work, works, problems, busy, resumeLabel, studyContent, secondaryContent, packages = defaultPackages, onDirection, onResume, onPercentStart, onTrigStart, onTrigMaterials, onPercentMaterials, onOpenWork }: {
  section: StudySection; onSection(section: StudySection): void; work: Work | undefined; works: WorkSummary[]; problems: Problem[]; busy: boolean;
  packages?: StudyPackage[]; onDirection?(packageId: string, destination: 'work' | 'materials'): void;
  studyContent?: ReactNode; secondaryContent?: ReactNode; resumeLabel?: string; onResume(): void; onPercentStart(): void; onTrigStart(): void; onTrigMaterials(): void; onPercentMaterials(): void; onOpenWork(id: string): void;
}) {
  const problem = problems.find(item => item.id === work?.problemId)
  const numeric = work?.kind === 'numeric' || work?.kind === 'interval' || problem?.kind === 'numeric' || problem?.kind === 'interval'
  const canResume = Boolean(resumeLabel || (work && (numeric || work.finalAnswer.trim() || work.generalAnswer?.trim() || work.submissions.length || work.messages.length || hasWriting(work.document))))
  const continuingTrig = canResume && !numeric
  const canOpen = (id: string) => Boolean(onDirection || ['percentages', 'trigonometry'].includes(id))
  const openPackage = (id: string, destination: 'work' | 'materials') => {
    if (onDirection) onDirection(id, destination)
    else if (id === 'percentages') (destination === 'materials' ? onPercentMaterials : onPercentStart)()
    else if (id === 'trigonometry') (destination === 'materials' ? onTrigMaterials : onTrigStart)()
  }
  return <section className="study-home" aria-label="Тренажёр по математике">
    <header className="study-heading"><h1>{section === 'study' ? 'Заниматься' : section === 'tasks' ? 'Выбери тему' : 'Объяснения и примеры'}</h1>{section !== 'study' && <span>{section === 'tasks' ? 'Выбери, в чём хочешь разобраться сегодня.' : 'Можно начать с объяснения, а затем попробовать самому.'}</span>}</header>
    <a className="study-exam-entry" href="#exam"><span><strong>Все задания профильного ЕГЭ</strong><span>Выбрать тему, продолжить обучение или решить вариант целиком.</span></span><ArrowRight size={20} aria-hidden="true"/></a>
    {section === 'study' && <div className={`study-home-grid ${studyContent ? 'has-study-route' : 'has-fallback-route'}`}><div className="study-home-main">{studyContent ?? <>
      <div className="study-current">
        <div className="study-current-copy">
        <span className="study-label">{canResume ? 'Текущее задание' : 'Первое задание'}</span>
        <h2>{canResume ? resumeLabel ?? problem?.title ?? (numeric ? 'Задача на проценты' : 'Тригонометрическое уравнение') : 'Сколько стоит товар после скидки?'}</h2>
        <p>{canResume ? 'Продолжи с сохранённого места.' : 'Попробуй решить. Если пока непонятно, рядом будет объяснение с небольшим упражнением.'}</p>
        <button type="button" className="study-primary" disabled={busy} onClick={canResume ? onResume : onPercentStart}>{canResume ? 'Продолжить' : 'Начать'}<ArrowRight size={18}/></button>
        {canResume && !numeric && <button type="button" className="study-text-button" disabled={busy} onClick={onPercentStart}>Начать проценты</button>}
        </div>
        <HomeGeometry/>
      </div>
      <details className="study-route"><summary>Что будем разбирать</summary><ol>{continuingTrig ? <><li><strong>Синус и косинус</strong><span>Понять их на рисунке окружности.</span></li><li><strong>Решение уравнения</strong><span>Найти корни и записать все серии решений.</span></li><li><strong>Отбор корней</strong><span>Оставить те, что лежат на заданном отрезке.</span></li><li><strong>Новый вариант самостоятельно</strong><span>Решить уравнение и выполнить отбор без подсказок.</span></li></> : <><li><strong>Цена после скидки</strong><span>Найти процент от исходной величины.</span></li><li><strong>Два изменения подряд</strong><span>Понять, почему скидка и повышение не отменяют друг друга.</span></li><li><strong>Начальная цена</strong><span>Пройти от результата к тому, что было до изменений.</span></li><li><strong>Сравнить результат с началом</strong><span>Самостоятельно найти, на сколько процентов величина изменилась в итоге.</span></li></>}</ol><p>Можно остановиться и вернуться к текущему заданию позже.</p></details>
      <div className="study-alternative"><span>Хочешь другую тему?</span><button type="button" disabled={busy} onClick={continuingTrig ? onPercentStart : onTrigStart}>{continuingTrig ? 'Проценты и изменения цены' : 'Тригонометрия · №13'} <ArrowRight size={16}/></button></div>
    </>}</div><aside className="study-home-side" aria-label="Темы и практика"><section className="study-topic-module"><h2>Темы</h2><div className="study-topics">{packages.map(pack => <button type="button" className="study-topic" key={pack.id} disabled={busy || !canOpen(pack.id)} onClick={() => openPackage(pack.id, 'work')}><span className={`study-topic-symbol is-${pack.id}`} aria-hidden="true">{topicSymbols[pack.id] ?? '·'}</span><span>{pack.title}</span><ChevronRight size={15} aria-hidden="true"/></button>)}</div></section>{secondaryContent}</aside></div>}
    {(section === 'tasks' || section === 'materials') && <div className="study-cards">
      {packages.map((pack, index) => <article key={pack.id}>
        <div className="study-card-meta"><span className={`study-topic-symbol is-${pack.id}`} aria-hidden="true">{section === 'materials' ? <BookOpen size={20}/> : topicSymbols[pack.id] ?? '·'}</span><span className="study-label">{pack.id === 'trigonometry' ? 'Задание №13 · формат 2026' : 'Подготовительные задачи'}</span></div>
        <h2>{pack.title}</h2><p>{pack.description}</p>
        <button type="button" className={index === 0 ? 'study-primary' : 'study-secondary'} disabled={busy || !canOpen(pack.id)} onClick={() => openPackage(pack.id, section === 'materials' ? 'materials' : 'work')}>{section === 'materials' ? 'Объяснение и пример' : 'Начать'} <ArrowRight size={17}/></button>
      </article>)}
    </div>}
    {section === 'tasks' && <p><a href="#exam">Все темы и покрытие экзамена →</a></p>}
    {section !== 'materials' && works.length > 1 && <details className="study-recent"><summary>Последние решения</summary><div>{works.slice(0, 3).map(item => {
      const itemProblem = problems.find(candidate => candidate.id === item.problemId)
      return <button type="button" key={item.id} disabled={busy} onClick={() => onOpenWork(item.id)}><span>{itemProblem?.title ?? 'Решение задачи'}{item.id === work?.id && <small>Текущее</small>}</span><ArrowRight size={16}/></button>
    })}</div></details>}
  </section>
}
