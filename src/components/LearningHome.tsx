import { learnerStorage } from '../visitor-session'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, Compass, Sparkles } from 'lucide-react'
import type { Problem, RootResult, WorkSummary } from '../api-types'
import { MathAnswer } from './MathAnswer'
import { MathText } from './MathContent'
import { learningEpisodes, type EpisodeProgress } from '../learning-content'

type Entry = 'explain' | 'refresh' | 'solve'
export function LearningHome({learning, solo, busy, works, problems = [], activeWorkId, onEntry, onResume, onMaterials, onOpenWork, onEpisode,resumeLabel}: {
  learning: {entry: Entry | null; episodeId: string | null; progress: Record<string, EpisodeProgress>}; solo: boolean; busy: boolean; works: WorkSummary[]; activeWorkId?: string;
  problems?: Problem[]; resumeLabel?: string; onEntry(entry: Entry): void; onResume(): void; onMaterials(): void; onOpenWork(id: string): void; onEpisode(id: string): void;
}) {
  const episode = learningEpisodes.find(item => item.id === learning.episodeId)
  return <section className="learning-home" aria-label="Начало занятия">
    <span className="eyebrow">ТРИГОНОМЕТРИЧЕСКИЕ УРАВНЕНИЯ</span>
    <h1>Разобраться. Попробовать.<br/>Решить самому.</h1>
    <p className="learning-intro">Начни с того, что нужно тебе сейчас. Можно остановиться в любой момент и продолжить позже.</p>
    {learning.entry && <button className="learning-resume" disabled={busy} onClick={onResume}><span><small>ПРОДОЛЖИТЬ</small><strong>{resumeLabel ?? (episode && !solo ? episode.title : solo ? 'Моя самостоятельная попытка' : 'Моё решение')}</strong></span><ArrowRight size={20}/></button>}
    <div className="learning-entries">
      <button disabled={busy} onClick={() => onEntry('explain')}><BookOpen size={23}/><h2>Объясните с начала</h2><p>Что такое синус, как читать запись и откуда берутся решения.</p><span>{solo ? 'Сохранить попытку и учиться' : 'Начать с основ'} <ArrowRight size={15}/></span></button>
      <button disabled={busy} onClick={() => onEntry('refresh')}><Compass size={23}/><h2>Немного помню</h2><p>Короткая проба покажет, к чему полезно вернуться.</p><span>{solo ? 'Сохранить попытку и повторить' : 'Проверить, что помню'} <ArrowRight size={15}/></span></button>
      <button disabled={busy} onClick={() => onEntry('solve')}><Sparkles size={23}/><h2>Хочу решать</h2><p>Новый вариант без подсказок. Помощь можно открыть позже.</p><span>Решить самостоятельно <ArrowRight size={15}/></span></button>
    </div>
    <div className="learning-library"><div><h2>Материалы всегда рядом</h2><p>Формулы, рисунки и объяснения — можно идти по ссылкам или обсуждать с наставником.</p></div><button className="outline-button" disabled={busy} onClick={onMaterials}>{solo ? 'Сохранить попытку и открыть материалы' : 'Открыть материалы'} <BookOpen size={16}/></button></div>
    {!solo && <details className="learning-topic-map"><summary>Выбрать тему самому</summary><div>{learningEpisodes.map(item => <button disabled={busy} key={item.id} onClick={() => onEpisode(item.id)}>{item.title}{learning.progress[item.id]?.skipped && <small>Пропущено</small>}</button>)}</div></details>}
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
