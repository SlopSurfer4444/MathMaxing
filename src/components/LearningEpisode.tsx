import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, MessageCircle } from 'lucide-react'
import { MathAnswer } from './MathAnswer'
import { MathContent } from './MathContent'
import { learningEpisodes, learningCheck, type EpisodeProgress, emptyEpisodeProgress, type CheckStatus } from '../learning-content'
import '../learning.css'

function CircleExplorer({ beginner = false }: { beginner?: boolean }) {
  const [turns, setTurns] = useState(0)
  const angle = turns * Math.PI / 12, u = Math.cos(angle), v = Math.sin(angle)
  const x = 150 + 94 * u, y = 125 - 94 * v
  const number = (n: number) => Math.abs(n) < 0.0001 ? '0' : Number(n.toFixed(2)).toLocaleString('ru-RU')
  const angleLabel = (steps: number) => {
    if (!steps) return '0'
    let n = Math.abs(steps), d = 12
    while (d) { const r = n % d; n = d; d = r }
    const numerator = steps / n, denominator = 12 / n
    return `${numerator === 1 ? '' : numerator === -1 ? '−' : numerator}π${denominator === 1 ? '' : `/${denominator}`}`
  }
  return <figure className="learning-circle">
    <svg viewBox="0 0 300 250" role="img" aria-label={`Точка на окружности; горизонталь примерно ${number(u)}, высота и синус примерно ${number(v)}`}>
      <line x1="28" y1="125" x2="275" y2="125" className="circle-axis"/><line x1="150" y1="15" x2="150" y2="237" className="circle-axis"/>
      <circle cx="150" cy="125" r="94" fill="none" stroke="currentColor" strokeWidth="1.5"/>
      <text x="278" y="130">u</text><text x="157" y="18">v</text><text x="252" y="143">1</text><text x="157" y="35">1</text><text x="37" y="143">−1</text><text x="157" y="224">−1</text>
      <line x1="150" y1="125" x2={x} y2={y} className="circle-radius"/>
      <line x1={x} y1="125" x2={x} y2={y} className="circle-sine"/><line x1="150" y1={y} x2={x} y2={y} className="circle-cosine"/>
      <circle cx={x} cy={y} r="6" className="circle-point"/>
    </svg>
    <figcaption><strong>Поверни точку</strong><span>Вправо по шкале — против часовой стрелки</span></figcaption>
    <label>{beginner ? `Поворот: ${number(turns / 24)} оборота` : `Угол: ${angleLabel(turns)} радиан`}<input aria-label="Поворот точки" type="range" min={-24} max={48} step={1} value={turns} onChange={e => setTurns(Number(e.target.value))}/></label>
    {!beginner && <div className="circle-presets" aria-label="Опорные углы">{[0, 2, 3, 4, 6].map(value => <button type="button" aria-pressed={turns === value} key={value} onClick={() => setTurns(value)}>{angleLabel(value)}</button>)}</div>}
    <div className="circle-values">{!beginner && <span>Горизонталь · cos ≈ {number(u)}</span>}<span>Высота · sin ≈ {number(v)}</span></div>
    <small>Координаты на рисунке округлены. {beginner ? 'Нулевой поворот начинается справа; высота отсчитывается от центра.' : 'Каждые 24 шага — полный оборот; угол меняется на 2π.'}</small>
  </figure>
}

function RadianDiagram() {
  return <figure className="learning-circle learning-diagram">
    <svg viewBox="0 0 340 240" role="img" aria-label="Радиус от центра до окружности и дуга той же длины задают угол один радиан">
      <circle cx="155" cy="125" r="85" fill="none" stroke="currentColor"/>
      <line x1="155" y1="125" x2="240" y2="125" className="circle-radius"/>
      <line x1="155" y1="125" x2="200.93" y2="53.47" className="circle-radius"/>
      <path d="M240 125 A85 85 0 0 0 200.93 53.47" className="circle-arc"/>
      <path d="M180 125 A25 25 0 0 0 168.51 103.96" fill="none" className="circle-radius"/>
      <circle cx="155" cy="125" r="3" className="circle-point"/>
      <text x="142" y="145">центр</text><text x="174" y="145">радиус r</text><text x="246" y="77">дуга длины r</text><text x="174" y="108">1 рад</text>
    </svg>
    <figcaption><strong>Один радиан</strong><span>Радиус — от центра до края. Дуга — выделенная часть края. Здесь их длины равны.</span></figcaption>
  </figure>
}
function IntersectionDiagram() {
  return <figure className="learning-circle learning-diagram">
    <svg viewBox="0 0 340 250" role="img" aria-label="Прямая v равно одной второй пересекает окружность в двух точках: углы π/6 и 5π/6">
      <line x1="30" y1="135" x2="306" y2="135" className="circle-axis"/><line x1="165" y1="20" x2="165" y2="235" className="circle-axis"/>
      <circle cx="165" cy="135" r="90" fill="none" stroke="currentColor"/>
      <line x1="28" y1="90" x2="308" y2="90" className="circle-intersection"/>
      <line x1="165" y1="135" x2="242.94" y2="90" className="circle-radius"/><line x1="165" y1="135" x2="87.06" y2="90" className="circle-radius"/>
      <circle cx="242.94" cy="90" r="5" className="circle-point"/><circle cx="87.06" cy="90" r="5" className="circle-point"/>
      <text x="244" y="77">π/6</text><text x="65" y="77">5π/6</text><text x="275" y="109">v = 1/2</text><text x="309" y="139">u</text><text x="172" y="25">v</text><text x="170" y="151">0</text>
    </svg>
    <figcaption><strong>Две точки на одной высоте</strong><span>Оба угла дают sin x = 1/2 за один оборот. Каждый из них — корень уравнения.</span></figcaption>
  </figure>
}
function ReferenceTable() {
  const rows = [['0', '0', '1'], ['\\pi/6', '1/2', '\\sqrt{3}/2'], ['\\pi/4', '\\sqrt{2}/2', '\\sqrt{2}/2'], ['\\pi/3', '\\sqrt{3}/2', '1/2'], ['\\pi/2', '1', '0']]
  return <div className="learning-table-wrap"><table className="learning-table"><caption>Опорные значения на первой четверти</caption><thead><tr><th scope="col">Угол</th><th scope="col">Синус · высота</th><th scope="col">Косинус · горизонталь</th></tr></thead><tbody>{rows.map(([angle, sine, cosine]) => <tr key={angle}>{[angle, sine, cosine].map((value, i) => <td key={i}><MathContent text={`$${value}$`}/></td>)}</tr>)}</tbody></table></div>
}
function ParameterTable() {
  return <div className="learning-table-wrap"><table className="learning-table"><caption>Подставляем каждое целое k в x = π/3 + πk</caption><thead><tr><th scope="col">k</th><th scope="col">Подстановка</th><th scope="col">Угол x</th></tr></thead><tbody>{[['−2', '\\pi/3-2\\pi', '-5\\pi/3'], ['−1', '\\pi/3-\\pi', '-2\\pi/3'], ['0', '\\pi/3+0', '\\pi/3']].map(([k, substitution, x]) => <tr key={k}><th scope="row">{k}</th><td><MathContent text={`$${substitution}$`}/></td><td><MathContent text={`$${x}$`}/></td></tr>)}</tbody></table></div>
}

export function LearningEpisode({ episodeId, progress, onProgress, onComplete, onAsk, onMaterial, onBack, onCheck }: {
  episodeId: string; progress: EpisodeProgress; onProgress(next: EpisodeProgress): void; onComplete(next?: EpisodeProgress): void;
  onAsk(text: string): void; onMaterial(id: string): void; onBack(): void
  onCheck?(checkId: string, answer: string): Promise<{status: CheckStatus; message: string}>
}) {
  const generation = useRef(0)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    window.mathVirtualKeyboard?.hide()
    heading.current?.focus({preventScroll:true})
    heading.current?.scrollIntoView({block:'start',behavior:'instant'})
  }, [episodeId, progress.step])
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const latest = useRef({ episodeId, progress })
  latest.current = { episodeId, progress }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const episode = learningEpisodes.find(item => item.id === episodeId)
  if (!episode) return <section className="learning-episode"><p>Это объяснение пока недоступно.</p><button onClick={onBack}>К тренировке</button></section>
  const step = Math.min(Math.max(0, progress.step), episode.checks.length + 1)
  const check = episode.checks[step - 1]
  const outcome = check ? progress.outcomes[check.id] : undefined
  const recalculated = check && outcome ? learningCheck(check, progress.answers[check.id] ?? '') : null
  const result = recalculated && recalculated.status !== outcome
    ? {status: 'unknown', message: 'Проверка записи обновилась. Проверь этот ответ ещё раз, чтобы сохранить новый результат.'}
    : recalculated
  const patch = (next: Partial<EpisodeProgress>) => onProgress({ ...progress, ...next })
  const answer = (value: string) => {
    generation.current++; setChecking(false); setCheckError('')
    const outcomes = { ...progress.outcomes }; delete outcomes[check.id]
    patch({ answers: { ...progress.answers, [check.id]: value }, outcomes })
  }
  const ask = () => onAsk(`Разбираю «${episode.title}». ${check ? `Задание: ${check.prompt}. Мой ответ: ${progress.answers[check.id] || 'пока не записан'}. ` : ''}Объясни иначе, простым языком.`)
  return <section className="learning-episode" aria-label={episode.title}>
    <header className="learning-top"><button type="button" className="learning-quiet" onClick={onBack}><ArrowLeft size={16}/>К тренировке</button><span>{step === 0 ? 'Объяснение' : check ? `Проба ${step} из ${episode.checks.length}` : 'Можно двигаться дальше'}</span></header>
    <div className="learning-heading"><p className="learning-eyebrow">Небольшой шаг к полной задаче</p><h1 ref={heading} tabIndex={-1}>{episode.title}</h1><p>{episode.goal}</p></div>
    {step === 0 ? <>
      {episode.explanation.map((text, i) => <MathContent key={i} text={text}/>)}
      {episode.id === 'K2' && <RadianDiagram/>}
      {episode.circle && <CircleExplorer key={episode.id} beginner={episode.id === 'K1'}/>}
      {episode.id === 'K3' && <ReferenceTable/>}
      {episode.id === 'K4' && <IntersectionDiagram/>}
      {episode.id === 'K6' && <ParameterTable/>}
      <div className="learning-example"><span className="learning-eyebrow">Посмотрим на примере</span><MathContent text={episode.example}/>{episode.exampleSteps && <ol className="learning-worked-steps">{episode.exampleSteps.map((text, i) => <li key={i}><MathContent text={text}/></li>)}</ol>}</div>
      <details className="learning-why"><summary>Почему это работает</summary><MathContent text={episode.why}/></details>
      <button className="learning-primary" onClick={() => patch({ step: 1 })}>Попробовать самому <ArrowRight size={17}/></button>
    </> : check ? <div className="learning-check" key={check.id}>
      <p className="learning-eyebrow">{episode.id === 'M1' ? 'Собираем решение по шагам' : episode.id === 'M2' && step > 1 ? 'Продолжаем тот же пример' : check.transfer ? 'Теперь другой пример' : 'Попробуем на коротком примере'}</p>
      <MathContent text={check.prompt}/>
      {check.kind === 'series' && <p className="learning-muted">Разделяй серии точкой с запятой. Шаблон: x = a + Tk; вместо a и T подставь начальный угол и шаг. Параметры считаются целыми.</p>}
      {check.kind === 'choice' ? <div className="learning-options" role="radiogroup" aria-label="Ответ">
        {check.options?.map((option, index) => <button type="button" role="radio" aria-checked={progress.answers[check.id] === String(index)} key={index} onClick={() => answer(String(index))} className={progress.answers[check.id] === String(index) ? 'selected' : ''}><MathContent text={option}/></button>)}
      </div> : <MathAnswer label="Твой ответ" multiple={check.kind === 'series' || check.answer.includes(';')} value={progress.answers[check.id] ?? ''} onChange={answer}/>}
      {result && <div className={`learning-feedback ${result.status}`} role="status"><strong>{result.status === 'correct' ? 'Получилось' : result.status === 'unknown' ? 'Уточним запись' : 'Посмотрим на этот шаг'}</strong><MathContent text={result.message}/>{(progress.attempts[check.id] ?? 0) > 1 && result.status !== 'correct' && <p>Можно вернуться к примеру или обсудить это место с наставником. Проходить дальше тоже можно.</p>}</div>}
      {checkError && <p role="alert">{checkError}</p>}
      <div className="learning-actions">{outcome === 'correct' && result?.status === 'correct' ? <button className="learning-primary" onClick={() => patch({ step: step + 1 })}>Дальше <ArrowRight size={17}/></button> : <button className="learning-primary" disabled={checking || !progress.answers[check.id]?.trim()} onClick={async () => {
        const requestGeneration = ++generation.current
        setChecking(true); setCheckError('')
        try {
          const checked = onCheck ? await onCheck(check.id, progress.answers[check.id] ?? '') : learningCheck(check, progress.answers[check.id] ?? '')
          if (!mounted.current || generation.current !== requestGeneration || latest.current.episodeId !== episodeId || latest.current.progress.step !== progress.step || latest.current.progress.answers[check.id] !== progress.answers[check.id]) return
          patch({ skipped: episode.checks.every(item => item.id === check.id ? checked.status === 'correct' : progress.outcomes[item.id] === 'correct') ? false : progress.skipped, outcomes: { ...progress.outcomes, [check.id]: checked.status }, attempts: { ...progress.attempts, [check.id]: (progress.attempts[check.id] ?? 0) + 1 } })
        } catch { if (generation.current === requestGeneration) setCheckError('Не удалось сохранить проверку. Ответ остался здесь; попробуй ещё раз.') }
        finally { if (generation.current === requestGeneration) setChecking(false) }
      }}>{checking ? 'Проверяем…' : 'Проверить'}</button>}<button className="learning-quiet" onClick={() => patch({ step: 0 })}>Вернуться к объяснению</button></div>
    </div> : <div className="learning-finished"><h2>Можно продолжить в своём темпе</h2><p>Верных ответов: {episode.checks.filter(item => progress.outcomes[item.id] === 'correct').length} из {episode.checks.length}. Следующий шаг — применить это в новом примере или вернуться к своей задаче.</p>{progress.skipped && <p className="learning-muted">К пропущенным пробам можно вернуться.</p>}<div className="learning-actions"><button className="learning-primary" onClick={() => onComplete(progress)}>Продолжить тренировку <ArrowRight size={17}/></button><button type="button" className="learning-quiet" onClick={() => patch({ step: 0 })}>Открыть объяснение</button><button type="button" className="learning-quiet" onClick={() => { generation.current++; setChecking(false); setCheckError(''); onProgress({ ...emptyEpisodeProgress(), step: 1 }) }}>Попробовать ещё раз</button></div></div>}
    <footer className="learning-footer"><button className="learning-quiet" onClick={ask}><MessageCircle size={16}/>Объяснить иначе</button>{episode.materialId && <button className="learning-quiet" onClick={() => onMaterial(episode.materialId!)}><BookOpen size={16}/>Подробнее в материалах</button>}
      {check && <button className="learning-quiet" onClick={() => patch({ step: step + 1, skipped: true })}>Пропустить эту пробу</button>}
      <button className="learning-quiet" onClick={() => { const next = { ...progress, skipped: true }; onProgress(next); onComplete(next) }}>Перейти дальше без проверки</button>
    </footer>
  </section>
}
