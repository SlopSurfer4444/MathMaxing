import { learnerStorage } from '../visitor-session'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen } from 'lucide-react'
import type { Problem, RootResult, WorkSummary } from '../api-types'
import { MathAnswer } from './MathAnswer'
import { MathText } from './MathContent'
import { learningEpisodes, type EpisodeProgress } from '../learning-content'

type Entry = 'explain' | 'refresh' | 'solve'
export function LearningHome({learning, solo, busy, works, problems = [], activeWorkId, onEntry, onResume, onMaterials, onOpenWork, onEpisode,resumeLabel}: {
  learning: {entry: Entry | null; episodeId: string | null; progress: Record<string, EpisodeProgress>}; solo: boolean; busy: boolean; works: WorkSummary[]; activeWorkId?: string;
  problems?: Problem[]; resumeLabel?: string; onEntry(entry: Entry): void; onResume(): void; onMaterials(): void; onOpenWork(id: string): void; onEpisode(id: string, intent?: 'practice'): void;
}) {
  const episode = learningEpisodes.find(item => item.id === learning.episodeId)
  const canResume = !!learning.entry || !!episode
  return <section className="learning-home" aria-label="Начало занятия">
    <span className="eyebrow">ПРОФИЛЬНЫЙ УРОВЕНЬ · ФОРМАТ 2026</span>
    <h1>Тригонометрия в задании №13 ЕГЭ</h1>
    <p className="learning-intro">Находи все решения уравнения в пункте а) и отбирай корни на отрезке в пункте б).</p>
    <div className="learning-start">
      <p>{canResume ? 'Вернись к тому месту, где остановился.' : 'Первый шаг — понять синус на рисунке и ответить на один вопрос.'}</p>
      <button className="primary-button learning-home-primary" disabled={busy} onClick={canResume ? onResume : () => onEntry('explain')}>
        {canResume ? `Продолжить: ${resumeLabel ?? (episode && !solo ? episode.title : 'моё решение')}` : 'Начать с синуса'} <ArrowRight size={18}/>
      </button>
      <div className="learning-shortcuts">
        <details className="learning-repeat"><summary>Повторить один шаг</summary><div>
          {[['K3', 'Путаю синус и косинус'], ['K5', 'Не понимаю запись всех корней'], ['K6', 'Ошибаюсь при отборе на отрезке'], ['K7', 'Теряю решения при преобразовании']].map(([id, title]) => <button type="button" disabled={busy} key={id} onClick={() => onEpisode(id, 'practice')}>{title} <ArrowRight size={15}/></button>)}
          <button type="button" disabled={busy} onClick={() => onEntry('refresh')}>Не знаю, где пробел — короткая проба <ArrowRight size={15}/></button>
          <details className="learning-topic-map"><summary>Все учебные темы</summary><div>{learningEpisodes.map(item => <button disabled={busy} key={item.id} onClick={() => onEpisode(item.id)}>{item.title}</button>)}</div></details>
        </div></details>
        <button type="button" className="learning-solo-entry" disabled={busy} onClick={() => onEntry('solve')}>Решать без подсказок <ArrowRight size={15}/></button>
      </div>
    </div>
    <details className="learning-scope"><summary>Какие задачи здесь есть</summary><p>Двойной угол и разложение на множители; уравнения, сводящиеся к квадратному относительно синуса; равенство синусов. Отдельно — отбор корней на отрезке. Это часть тригонометрических задач формата 2026.</p></details>
    <button className="learning-material-link" disabled={busy} onClick={onMaterials}><BookOpen size={16}/>Формулы и объяснения</button>
    {!!works.length && <details className="recent-work"><summary>Недавние решения</summary>{works.slice(0,5).map(item => {
      const problem = problems.find(candidate => candidate.id === item.problemId)
      return <button key={item.id} disabled={busy} onClick={() => onOpenWork(item.id)}><span><strong>{problem?.title ?? 'Решение задачи'}{item.id === activeWorkId ? ' · текущее' : ''}</strong>{problem && <MathText value={problem.equation}/>}<small>{item.mode === 'solo' ? 'Самостоятельно' : item.mode === 'review' ? 'Разбор' : 'С помощью'}</small></span><time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time></button>
    })}</details>}
  </section>
}

export function LearningDiagnostic({workId,onRecommend,onSolve,check}: {workId: string; onRecommend(id:string):void;onSolve():void;check(body:unknown):Promise<{seriesResult:RootResult;rootResult:RootResult}>}) {
  const draftKey = `pole.diagnostic.v1.${workId}`
  const [initial] = useState(() => { try { const raw = learnerStorage.getItem(draftKey); const value = raw ? JSON.parse(raw) : null; return value?.workId === workId && typeof value.general === 'string' && typeof value.roots === 'string' ? {general:value.general, roots:value.roots, error:''} : {general:'',roots:'',error:''} } catch { return {general:'',roots:'',error:'Черновик пробы не удалось прочитать. Исходная запись на устройстве сохранена.'} } })
  const [general,setGeneral]=useState(initial.general); const [roots,setRoots]=useState(initial.roots)
  const [draftError,setDraftError]=useState(initial.error)
  useEffect(() => { if (initial.error) return; try { learnerStorage.setItem(draftKey, JSON.stringify({workId,general,roots})); setDraftError('') } catch { setDraftError('Черновик пробы не сохранён на устройстве. Не закрывай страницу до проверки.') } }, [draftKey,workId,general,roots,initial.error])
  const [result,setResult]=useState<{seriesResult:RootResult;rootResult:RootResult}|null>(null)
  const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  const generation = useRef(0)
  const currentAnswers = useRef({ general, roots })
  currentAnswers.current = { general, roots }
  useEffect(() => () => { generation.current += 1 }, [])
  const change = (field: 'general' | 'roots', value: string) => {
    generation.current += 1
    currentAnswers.current = { ...currentAnswers.current, [field]: value }
    if (field === 'general') setGeneral(value); else setRoots(value)
    setResult(null); setError(''); setBusy(false)
  }
  const run = async () => {
    const request = ++generation.current
    const snapshot = { general, roots }
    const isCurrent = () => request === generation.current && snapshot.general === currentAnswers.current.general && snapshot.roots === currentAnswers.current.roots
    setBusy(true); setError(''); setResult(null)
    try {
      const next = await check({ workId, generalAnswer: snapshot.general, answer: snapshot.roots })
      if (isCurrent()) setResult(next)
    } catch (e) { if (isCurrent()) setError(e instanceof Error ? e.message : 'Проверка недоступна.') }
    finally { if (isCurrent()) setBusy(false) }
  }
  const recommendation=result?.seriesResult.status==='correct'?'K6':'K5'
  const unknown = result?.seriesResult.status === 'unknown' || result?.rootResult.status === 'unknown'
  const editUnknown = () => {
    const id = result?.seriesResult.status === 'unknown' ? 'diagnostic-general' : 'diagnostic-roots'
    document.getElementById(id)?.focus()
  }
  return <section className="learning-diagnostic"><span className="eyebrow">КОРОТКАЯ ПРОБА · БЕЗ ОЦЕНКИ</span><h1>Что уже получается?</h1><p>Реши простое уравнение, затем выбери корни на отрезке. Если запись пока незнакома, начни с объяснения — это нормально.</p><div className="diagnostic-equation"><MathText value={'\\cos x=0,\\quad x\\in[-\\pi;2\\pi]'}/></div><MathAnswer id="diagnostic-general" label="Общее решение" value={general} onChange={value=>change('general',value)}/><p className="answer-format">Можно записать x = a + T·n, n ∈ ℤ. Если серий несколько, раздели их точкой с запятой.</p><MathAnswer id="diagnostic-roots" label="Корни на отрезке" multiple value={roots} onChange={value=>change('roots',value)}/><div className="diagnostic-actions"><button className="primary-button" disabled={busy||(!general.trim()&&!roots.trim())} onClick={()=>void run()}>{busy?'Проверяем…':'Проверить'}</button><button className="outline-button" onClick={()=>onRecommend('K1')}>Пока не понимаю запись</button><button onClick={onSolve}>Сразу к полной задаче →</button></div>{draftError&&<p role="alert">{draftError}</p>}{error&&<p role="alert">{error}</p>}{result&&<div className="diagnostic-feedback" role="status"><h2>Что показала эта попытка</h2><p>Общее решение: {result.seriesResult.summary}</p><p>Отбор корней: {result.rootResult.summary}</p>{result.seriesResult.status==='correct'&&result.rootResult.status==='correct'?<><p>Здесь получилось. Попробуем полную задачу, где метод предстоит выбрать самому.</p><button className="primary-button" onClick={onSolve}>К полной задаче</button></>:unknown?<><p>Часть записи проверка не распознала. Уточни её и проверь ещё раз.</p><button className="primary-button" onClick={editUnknown}>Уточнить запись</button><button className="outline-button" onClick={()=>onRecommend('K5')}>Открыть объяснение общего решения</button></>:<><p>Полезно повторить этот шаг.</p><button className="primary-button" onClick={()=>onRecommend(recommendation)}>{recommendation==='K6'?'Повторить отбор корней':'Повторить общее решение'}</button></>}</div>}</section>
}
