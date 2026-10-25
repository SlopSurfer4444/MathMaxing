import { learnerStorage } from '../visitor-session'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ChevronRight, MessageSquarePlus, Search } from 'lucide-react'
import { materials, materialRelations, materialSource, type Material } from '../materials'
import type { ChatContext } from '../notebook-state'
import { MathText } from './MathContent'
import { KnowledgeDiagram } from './KnowledgeDiagram'
import { contextualMaterials, hasMaterialContext } from '../material-context'
import '../knowledge.css'

const foundationIds = ['right-triangle', 'sine', 'cosine', 'radians', 'unit-circle', 'angle-addition']
const terms: [string, string][] = [
  ['прямоугольного треугольника', 'right-triangle'], ['прямоугольном треугольнике', 'right-triangle'], ['прямоугольный треугольник', 'right-triangle'],
  ['единичной окружности', 'unit-circle'], ['единичную окружность', 'unit-circle'], ['единичная окружность', 'unit-circle'],
  ['формулу синуса суммы', 'angle-addition'], ['формула суммы', 'angle-addition'], ['формулы двойного угла', 'double-angle'], ['формула двойного угла', 'double-angle'],
  ['косинуса', 'cosine'], ['косинусы', 'cosine'], ['косинус', 'cosine'], ['синуса', 'sine'], ['синусы', 'sine'], ['синус', 'sine'],
  ['радианах', 'radians'], ['радианы', 'radians'], ['радиан', 'radians'], ['радианная мера', 'radians'], ['градусы', 'radians'],
]
const termPattern = new RegExp(`(?<![\\p{L}])(${terms.map(([term]) => term).join('|')})(?![\\p{L}])`, 'giu')

function LinkedText({ text, current, onNavigate }: { text: string; current: string; onNavigate(id: string): void }) {
  const nodes: ReactNode[] = []
  let start = 0
  for (const match of text.matchAll(termPattern)) {
    const target = terms.find(([term]) => term === match[0].toLocaleLowerCase('ru'))?.[1]
    const index = match.index
    nodes.push(text.slice(start, index))
    nodes.push(target && target !== current
      ? <button key={index} className="knowledge-term" onClick={() => onNavigate(target)} title={`Открыть статью «${materials.find(item => item.id === target)?.title}»`}>{match[0]}</button>
      : match[0])
    start = index + match[0].length
  }
  nodes.push(text.slice(start))
  return <>{nodes}</>
}

const practiceForMaterial: Record<string, { id: string; label: string }> = {
  sine: { id: 'K3', label: 'Определить синус по точке' },
  cosine: { id: 'K3', label: 'Определить обе координаты' },
  'right-triangle': { id: 'K3', label: 'Попробовать на окружности' },
  radians: { id: 'K2', label: 'Разобраться с поворотом' },
  'unit-circle': { id: 'K4', label: 'Найти все подходящие углы' },
  'double-angle': { id: 'M1', label: 'Применить формулу в уравнении' },
  'angle-addition': { id: 'M1', label: 'Перейти к двойному углу' },
  'zero-product': { id: 'K7', label: 'Сохранить все случаи' },
  division: { id: 'K7', label: 'Проверить потерянный случай' },
  interval: { id: 'K6', label: 'Самому отобрать корни' },
}
type TheoryProps = { onAttach(context: ChatContext): void; requestedMaterialId?: string | null; requestToken?: number; onPractice?(episodeId: string): void; family?: string | null; solo?: boolean }

export function Theory({ onAttach, requestedMaterialId, requestToken, onPractice, family, solo = false }: TheoryProps) {
  const root = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const hasNavigated = useRef(false)
  const [savedNavigation] = useState(() => {
    try {
      const saved = JSON.parse(learnerStorage.getItem('pole.library.navigation.v1') ?? 'null')
      const valid = (id: unknown) => id === null || materials.some(item => item.id === id)
      return saved && valid(saved.activeId) && Array.isArray(saved.history) && saved.history.every(valid)
        ? {activeId: saved.activeId as string | null, history: saved.history.slice(-30) as (string | null)[]}
        : {activeId: null, history: []}
    } catch { return {activeId: null, history: []} }
  })
  const [activeId, setActiveId] = useState<string | null>(savedNavigation.activeId)
  const [history, setHistory] = useState<(string | null)[]>(savedNavigation.history)
  const [query, setQuery] = useState('')
  const [navigationError, setNavigationError] = useState('')
  useEffect(() => {
    try { learnerStorage.setItem('pole.library.navigation.v1', JSON.stringify({activeId, history: history.slice(-30)})) }
    catch { setNavigationError('Статья открыта, но её место не удалось сохранить на устройстве.') }
  }, [activeId, history])
  const [selection, setSelection] = useState<{ context: ChatContext; left: number; top: number } | null>(null)
  const material = materials.find(item => item.id === activeId)
  const relations = material ? materialRelations[material.id] : null
  const cleanQuery = query.trim().toLocaleLowerCase('ru')
  const results = cleanQuery ? materials.filter(item => `${item.title} ${item.statement} ${item.explanation} ${item.tag} ${item.sections?.map(section => `${section.title} ${section.text}`).join(' ') ?? ''}`.toLocaleLowerCase('ru').includes(cleanQuery)) : []
  const contextFor = (item: Material, quote: string, latex?: string): ChatContext => ({
    anchor: { blockId: item.id, origin: 'material', title: item.title, kind: latex ? 'math' : 'text', quote, ...(latex ? { latex } : {}) },
    source: materialSource(item.id) ?? '',
  })
  const navigate = (id: string | null) => {
    if (id !== null && !materials.some(item => item.id === id)) { setNavigationError('Эта статья больше недоступна. Найди нужную тему в библиотеке.'); return }
    hasNavigated.current = true
    setNavigationError(''); setSelection(null); setQuery('')
    if (id !== activeId) { setHistory(previous => [...previous, activeId]); setActiveId(id) }
  }
  useEffect(() => {
    if (requestedMaterialId) navigate(requestedMaterialId === 'library' ? null : requestedMaterialId)
  }, [requestedMaterialId, requestToken])
  useEffect(() => {
    setSelection(null)
    if (hasNavigated.current) {
      heading.current?.focus({ preventScroll: true })
      root.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
    }
  }, [activeId, history.length, requestToken])
  useEffect(() => {
    const clear = () => setSelection(null)
    window.addEventListener('scroll', clear, true)
    return () => window.removeEventListener('scroll', clear, true)
  }, [])
  const readSelection = () => {
    const native = window.getSelection()
    if (!native || native.isCollapsed || !native.rangeCount) { setSelection(null); return }
    const range = native.getRangeAt(0)
    const element = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
    const card = element?.closest<HTMLElement>('[data-material]')
    const item = materials.find(entry => entry.id === card?.dataset.material)
    const quote = native.toString().trim()
    if (!item || !quote || !card || !root.current?.contains(card) || !card.contains(range.startContainer) || !card.contains(range.endContainer)) { setSelection(null); return }
    const rect = range.getBoundingClientRect()
    setSelection({ context: contextFor(item, quote), left: Math.max(8, Math.min(rect.left + rect.width / 2 - 82, window.innerWidth - 180)), top: Math.max(8, rect.top - 45) })
  }
  const text = (value: string) => <LinkedText text={value} current={activeId ?? ''} onNavigate={navigate} />
  const articleLink = (id: string) => {
    const item = materials.find(entry => entry.id === id)
    return item ? <button key={id} className="knowledge-related-link" onClick={() => navigate(id)}>{item.title}<ChevronRight size={13} /></button> : null
  }
  return <div className="theory knowledge" ref={root} onMouseUp={readSelection} onKeyUp={readSelection}>
    <div className="theory-intro"><BookOpen size={20} /><div><h2>Библиотека знаний</h2><p>От нужной формулы — к самым основам. Переходи по понятиям и задавай вопросы по любому фрагменту.</p></div></div>
    <div className="knowledge-toolbar">
      <button className="knowledge-back" disabled={!history.length} onClick={() => {
        const previous = history.at(-1)
        if (previous === undefined) return
        hasNavigated.current = true
        setActiveId(previous); setHistory(items => items.slice(0, -1)); setQuery(''); setSelection(null); setNavigationError('')
      }} aria-label="Назад к предыдущей статье"><ArrowLeft size={14} /><span>Назад</span></button>
      <label className="knowledge-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти понятие или формулу" aria-label="Поиск по библиотеке знаний" /></label>
    </div>
    {navigationError && <p className="knowledge-notice" role="status">{navigationError}</p>}
    {cleanQuery ? <div className="knowledge-results"><p className="knowledge-eyebrow" role="status">Найдено статей: {results.length}</p>{results.length ? results.map(item => <button key={item.id} className="knowledge-entry" onClick={() => navigate(item.id)}><span><strong>{item.title}</strong><small>{item.statement}</small></span><ArrowUpRight size={15} /></button>) : <p>Попробуй «синус», «окружность» или «радианы».</p>}<button className="knowledge-text-button" onClick={() => setQuery('')}>Закрыть поиск</button></div> : <>
      <nav className="knowledge-breadcrumb" aria-label="Путь в библиотеке"><button onClick={() => navigate(null)}>Все статьи · {materials.length}</button>{material && <><ChevronRight size={12} /><span aria-current="page">{material.title}</span></>}</nav>
      {!material ? <div className="knowledge-directory"><h3 tabIndex={-1} ref={heading}>С чего начнём?</h3><p>Можно найти нужное понятие или разобраться с тригонометрией с нуля.</p>{!solo && <><h4>{hasMaterialContext(family) ? 'Понятия для этой задачи' : 'Часто используемые правила'}</h4><div className="knowledge-topic-grid">{contextualMaterials(family).map(item => <button className="knowledge-topic" key={item.id} onClick={() => navigate(item.id)}><small>{item.tag}</small><strong>{item.title}</strong><ArrowUpRight size={15} /></button>)}</div></>}<h4>Разобраться с самого начала</h4><div className="knowledge-learning-path">{foundationIds.map((id, index) => <div key={id}><span>{String(index + 1).padStart(2, '0')}</span>{articleLink(id)}</div>)}</div></div> : <article className="theory-card" data-material={material.id} id={`material-${material.id}`} key={material.id}>
        <div className="theory-card-top"><span>{material.tag} · СТАТЬЯ</span><button onClick={() => onAttach(contextFor(material, material.statement))} title="Прикрепить статью к вопросу"><MessageSquarePlus size={14} /> В чат</button></div>
        <h3 ref={heading} tabIndex={-1}>{material.title}</h3><p>{text(material.explanation)}</p>
        {material.diagram && <KnowledgeDiagram kind={material.diagram} />}
        <p className="theory-statement">{text(material.statement)}</p>
        <div className="theory-formula"><MathText value={material.formula} /><button aria-label={`Добавить формулу «${material.title}» в чат`} onClick={() => onAttach(contextFor(material, material.formula, material.formula))}><ArrowUpRight size={16} /></button></div>
        {relations && relations.prerequisites.length > 0 && <aside className="knowledge-prerequisites"><span>Нужно вспомнить основы?</span><p>Открой любое понятие. К этой статье можно вернуться кнопкой «Назад».</p><div>{relations.prerequisites.map(articleLink)}</div></aside>}
        {material.sections?.map(section => <section className="knowledge-section" key={section.title}><h4>{section.title}</h4><p>{text(section.text)}</p>{section.formula && <div className="knowledge-section-formula"><MathText value={section.formula} /></div>}</section>)}
        <details className="theory-proof"><summary>Почему это работает <span>Объяснение и пример</span></summary><div>{material.proof.map((step, i) => <div className="proof-step" key={i}><span>{i + 1}</span><div><p>{text(step.text)}</p>{step.formula && <MathText value={step.formula} />}</div></div>)}</div></details>
        <p className="theory-caution"><span>Обрати внимание</span>{text(material.caution)}</p>
        {onPractice && practiceForMaterial[material.id] && <div className="knowledge-practice"><p>Теперь можно попробовать самому. К своей записи ты вернёшься в любой момент.</p><button className="outline-button" onClick={() => onPractice(practiceForMaterial[material.id].id)}>{practiceForMaterial[material.id].label}<ArrowRight size={15}/></button></div>}
        {relations && relations.related.length > 0 && <nav className="knowledge-related" aria-label="Связанные статьи"><h4>Куда дальше</h4><div>{relations.related.map(articleLink)}</div></nav>}
      </article>}
      {material && <button className="knowledge-library-link" onClick={() => navigate(null)}><BookOpen size={14} /> Посмотреть все темы <ArrowRight size={14} /></button>}
    </>}
    <p className="theory-source">Авторские учебные статьи · {materials.length} тем · выдели текст, чтобы добавить его в чат</p>
    {selection && <div className="editor-context-action" style={{ position: 'fixed', left: selection.left, top: selection.top }}><button className="editor-context-action__button" onMouseDown={event => event.preventDefault()} onClick={() => { onAttach(selection.context); setSelection(null); window.getSelection()?.removeAllRanges() }}><MessageSquarePlus size={14} /> Добавить в чат</button></div>}
  </div>
}
