import { useEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import { ArrowLeft, ArrowRight, BookOpen, MessageCircle } from 'lucide-react'
import type { NumericHelp, NumericPreparation, NumericPreparationReturnPoint, Problem, RootResult, Work } from '../api-types'
import { learnerStorage } from '../visitor-session'
import { isCurrentSubmission } from '../submission-current'
import { MathContent } from './MathContent'
import { TopicGraph } from './TopicGraph'
import { AdaptiveHelp } from './AdaptiveHelp'
import './percentage-work.css'

type HelpDraft = { open: boolean; help?: NumericHelp; answer: string; result?: RootResult; preparationId?:string; preparationRevision?:number; dirty?:boolean }
type PreparationResponse = {help?:NumericHelp;preparation:NumericPreparation;work:Work;result?:RootResult}
const fromPreparation = (preparation:NumericPreparation):HelpDraft => ({open:preparation.open&&!preparation.completed,help:preparation.help,answer:preparation.answer,result:preparation.result,preparationId:preparation.id,preparationRevision:preparation.revision,dirty:false})
type Props = {
  neutralTitle?: boolean; hideNext?: boolean; work: Work; problem: Problem; answer: string; onAnswer(value: string): void;
  reasoning: JSONContent; onReasoning(document: JSONContent): void;
  busy: boolean; saveState: string; onSubmit(): void; onNext(): void; onAdvance?(): void; onAsk(context?: string): void;
  onHelp(): Promise<boolean>; request<T>(path: string, body: Record<string, unknown>): Promise<T>;
  startWithHelp?: boolean; onReturnToWork?(): void; onHome?(): void;
}
function plainText(document: JSONContent): string {
  if (document.type === 'text') return document.text ?? ''
  return (document.content ?? []).map(plainText).join(document.type === 'doc' ? '\n' : '')
}
function readDraft(key: string): HelpDraft {
  try {
    const value = JSON.parse(learnerStorage.getItem(key) ?? 'null')
    if (value && typeof value.answer === 'string' && typeof value.open === 'boolean') {
      const h = value.help
      if (h && typeof h.title === 'string' && Array.isArray(h.steps) && Array.isArray(h.example?.steps) && typeof h.check?.prompt === 'string') return value
    }
  } catch { /* Storage is optional; the mathematical work stays on the server. */ }
  return { open: false, answer: '' }
}

/** Plain-text entry keeps the exact server notation; the palette only inserts characters. */
function ScalarAnswer({ id, value, onChange, unit, interval = false, disabled, hintId }: {
  id: string; value: string; onChange(value: string): void; unit?: string; interval?: boolean; disabled: boolean; hintId?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const symbols: { text: string; value: string; label: string; inside?: boolean }[] = interval
    ? [{ text: '−', value: '-', label: 'Минус' }, { text: '∞', value: 'inf', label: 'Бесконечность' }, { text: '∪', value: ' U ', label: 'Объединение промежутков' }, { text: ';', value: ';', label: 'Разделить границы' }, { text: '[ ]', value: '[]', label: 'Квадратные скобки', inside: true }, { text: '( )', value: '()', label: 'Круглые скобки', inside: true }]
    : [{ text: '−', value: '-', label: 'Минус' }, { text: '/', value: '/', label: 'Дробная черта' }, { text: ',', value: ',', label: 'Десятичная запятая' }]
  return <div className={`percentage-answer-entry${interval ? ' is-interval' : ''}`}>
    <div className="percentage-answer-box">
      <input ref={input} className={`percentage-answer${interval ? ' topic-interval-answer' : ''}`} id={id} value={value} onChange={event => onChange(event.target.value)} maxLength={2000} inputMode={interval ? 'text' : 'decimal'} autoComplete="off" spellCheck={false} aria-describedby={[hintId, !interval && unit ? `${id}-unit` : undefined].filter(Boolean).join(' ') || undefined} disabled={disabled}/>
      {!interval && unit && <span className="percentage-answer-unit" id={`${id}-unit`}>{unit}</span>}
    </div>
    <div className="percentage-symbols" role="group" aria-label="Символы для ответа">
      {symbols.map(symbol => <button key={symbol.label} type="button" title={symbol.label} aria-label={symbol.label} disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => {
        const field = input.current
        if (!field) return
        const start = field.selectionStart ?? value.length, end = field.selectionEnd ?? start
        const selected = value.slice(start, end)
        const insertion = symbol.inside ? `${symbol.value[0]}${selected}${symbol.value[1]}` : symbol.value
        onChange(`${value.slice(0, start)}${insertion}${value.slice(end)}`)
        field.focus({ preventScroll: true })
        const caret = start + (symbol.inside ? insertion.length - 1 : insertion.length)
        requestAnimationFrame(() => field.setSelectionRange(caret, caret))
      }}>{symbol.text}</button>)}
    </div>
  </div>
}

/** Mounted with key={work.id}; preparation never replaces the main answer. */
export function PercentageWork({ neutralTitle=false, hideNext=false, work, problem, answer, onAnswer, reasoning, onReasoning, busy, saveState, onSubmit, onNext, onAdvance, onAsk, onHelp, request, startWithHelp = false, onReturnToWork, onHome }: Props) {
  const isInterval = problem.kind === 'interval'
  const topicLabel = problem.packageId === 'graphs' ? 'Графики и таблицы' : problem.packageId === 'inequalities' ? 'Неравенства' : 'Проценты'
  const endpoint = problem.packageId && problem.packageId !== 'percentages' ? '/api/topics' : '/api/percentages'
  const storageKey = `pole.percentage-help.v1.${work.id}`
  const initialDraft = useRef(readDraft(storageKey))
  const [draft, setDraft] = useState<HelpDraft>(() => {
    const server=work.numericPreparation,local=initialDraft.current
    if(!server)return {...local,open:false}
    return local.dirty&&local.preparationId===server.id?{...fromPreparation(server),...local,help:server.help,open:server.open&&!server.completed}:fromPreparation(server)
  })
  const draftRef=useRef(draft)
  const preparationRef=useRef(work.numericPreparation)
  const latestServer=useRef(work.numericPreparation)
  const preparationQueue=useRef<Promise<unknown>>(Promise.resolve())
  const savePreparationRef=useRef<()=>Promise<void>>(async()=>{})
  const autosaveTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const [preparationSave,setPreparationSave]=useState<'saved'|'pending'|'saving'|'failed'>(draft.dirty?'pending':'saved')
  const [conflict,setConflict]=useState(Boolean(draft.dirty&&work.numericPreparation&&draft.preparationRevision!==work.numericPreparation.revision))
  const [conflictRead,setConflictRead]=useState(Boolean(draft.dirty&&work.numericPreparation&&draft.preparationRevision!==work.numericPreparation.revision))
  const conflictRef=useRef(conflict)
  const [recovered,setRecovered]=useState<HelpDraft|null>(()=>{
    const local=initialDraft.current,saved=readDraft(`${storageKey}.recovery`)
    return local.dirty&&local.preparationId!==work.numericPreparation?.id?local:saved.dirty?saved:null
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [solution, setSolution] = useState('')
  const [helpSection, setHelpSection] = useState<'foundation'|'example'>('foundation')
  const helpPanel = useRef<HTMLElement>(null)
  const helpHeading = useRef<HTMLHeadingElement>(null)
  const mainWork = useRef<HTMLDivElement>(null)
  const lastMainPlace = useRef<{ id: string; point: NumericPreparationReturnPoint } | null>(null)
  const helpOpener = useRef<HTMLButtonElement | null>(null)
  const restoreMain = useRef(false)
  const helpReturn = useRef<NumericPreparationReturnPoint|undefined>(work.numericPreparation?.returnPoint)
  const revealHelp = useRef(false)
  const initialHelpRequested = useRef(false)
  const blocked = busy || pending
  const update = (next: HelpDraft) => {
    draftRef.current=next
    setDraft(next)
    try { learnerStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Main work is independently saved. */ }
  }
  const keepRecovery=(local:HelpDraft)=>{setRecovered(local);try{learnerStorage.setItem(`${storageKey}.recovery`,JSON.stringify(local))}catch{/* The local field stays visible. */}}
  const clearRecovery=()=>{setRecovered(null);try{learnerStorage.removeItem(`${storageKey}.recovery`)}catch{/* Storage is optional. */}}
  const acceptPreparation=(preparation:NumericPreparation,preserveTyping=false)=>{
    preparationRef.current=preparation;latestServer.current=preparation
    const local=draftRef.current
    const typed=preserveTyping&&local.dirty&&local.preparationId===preparation.id
    update(typed?{...fromPreparation(preparation),answer:local.answer,result:undefined,dirty:true}:fromPreparation(preparation))
    setPreparationSave(typed?'pending':'saved')
    conflictRef.current=false;setConflict(false)
    if(preparation.returnPoint)helpReturn.current=preparation.returnPoint
  }
  const serializePreparation=<T,>(operation:()=>Promise<T>):Promise<T>=>{
    const next=preparationQueue.current.catch(()=>undefined).then(operation)
    preparationQueue.current=next
    return next
  }
  savePreparationRef.current=()=>serializePreparation(async()=>{
    const local=draftRef.current,p=preparationRef.current
    if(!p||!p.open||p.completed||!local.dirty)return
    if(conflictRef.current)throw Error('В другой вкладке изменился ответ подготовки. Выбери, какую запись сохранить.')
    setPreparationSave('saving')
    try{
      const response=await request<PreparationResponse>(`${endpoint}/draft`,{preparationId:p.id,expectedPreparationRevision:local.preparationRevision,answer:local.answer})
      const changed=draftRef.current.answer!==local.answer
      acceptPreparation(response.preparation,changed)
    }catch(failure){
      setPreparationSave('failed')
      // A conflict never rebases a dirty draft on a revision the learner has not reviewed.
      if(failure instanceof Error&&/измен|вклад|устар|верси/i.test(failure.message)){conflictRef.current=true;setConflict(true);setConflictRead(false)}
      throw failure
    }
  })
  useEffect(()=>{
    const p=work.numericPreparation
    if(!p)return
    const old=preparationRef.current
    if(old?.id===p.id&&old.revision>p.revision)return
    latestServer.current=p
    const local=draftRef.current
    if(local.dirty&&local.preparationId===p.id){
      if(!p.open||p.completed){keepRecovery(local);acceptPreparation(p);return}
      if(local.preparationRevision!==p.revision){conflictRef.current=true;setConflict(true);setConflictRead(true);setPreparationSave('failed')}
      preparationRef.current=p
      return
    }
    if(local.dirty&&local.preparationId!==p.id)keepRecovery(local)
    acceptPreparation(p)
    // A server revision hydrates the preparation; main answer/reasoning stay under their existing owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[work.numericPreparation?.id,work.numericPreparation?.revision,work.numericPreparation?.open,work.numericPreparation?.completed])
  useEffect(()=>{
    if(autosaveTimer.current)clearTimeout(autosaveTimer.current)
    if(draft.dirty&&draft.open&&!conflict){
      autosaveTimer.current=setTimeout(()=>{void savePreparationRef.current().catch(failure=>setError(failure instanceof Error?failure.message:'Ответ подготовки сохранён на устройстве.'))},550)
    }
    return()=>{if(autosaveTimer.current)clearTimeout(autosaveTimer.current)}
  },[draft.answer,draft.dirty,draft.open,conflict])
  const perform = async (operation: () => Promise<void>) => {
    setError(''); setPending(true)
    try { await operation() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось загрузить. Попробуй ещё раз.') }
    finally { setPending(false) }
  }
  const rememberMainPlace = (target: EventTarget | null) => {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || !mainWork.current?.contains(target)) return
    const field = target.id === `percentage-answer-${work.id}` ? 'answer' : target.id === `percentage-reasoning-${work.id}` ? 'reasoning' : undefined
    if (!field) return
    lastMainPlace.current = { id: target.id, point: { field, selectionStart: target.selectionStart ?? 0, selectionEnd: target.selectionEnd ?? 0, scrollY: Math.max(0, window.scrollY) } }
  }
  const openHelp = (opener?: HTMLButtonElement) => void perform(async () => {
    if (opener) helpOpener.current = opener
    const point:NumericPreparationReturnPoint=lastMainPlace.current?.point??{scrollY:Math.max(0,window.scrollY),field:'reasoning',selectionStart:0,selectionEnd:0}
    helpReturn.current=point
    if(!await onHelp())return
    const response = await request<PreparationResponse>(`${endpoint}/help`, {returnPoint:point})
    revealHelp.current=true
    if(draftRef.current.dirty&&draftRef.current.preparationId!==response.preparation.id)keepRecovery(draftRef.current)
    acceptPreparation(response.preparation)
  })
  const checkPreparation = () => void perform(async () => {
    await savePreparationRef.current()
    await serializePreparation(async()=>{
      const p=preparationRef.current,local=draftRef.current
      if(!p||conflictRef.current)throw Error('Сначала восстанови актуальную подготовку.')
      const response=await request<PreparationResponse>(`${endpoint}/preparation`,{preparationId:p.id,expectedPreparationRevision:p.revision,answer:local.answer})
      acceptPreparation(response.preparation)
    })
  })
  const refreshPreparation=()=>void perform(async()=>{
    const local=draftRef.current
    const response=await request<PreparationResponse>(`${endpoint}/help`,{})
    latestServer.current=response.preparation;preparationRef.current=response.preparation
    if(local.dirty){conflictRef.current=true;setConflict(true);setConflictRead(true)}
    else acceptPreparation(response.preparation)
  })
  const resolvePreparation=(mine:boolean)=>{
    const server=latestServer.current
    if(!server||!conflictRead)return
    const local=draftRef.current
    if(mine){acceptPreparation(server);update({...fromPreparation(server),answer:local.answer,result:undefined,dirty:true});setPreparationSave('pending')}
    else acceptPreparation(server)
    setError('')
  }
  const showSolution = () => void perform(async () => {
    const response = await request<{ solution: string }>(`${endpoint}/solution`, {})
    setSolution(response.solution)
  })
  const askMentor = () => void perform(async () => {
    if (work.mode === 'solo' && !await onHelp()) return
    if(draftRef.current.open)await savePreparationRef.current()
    onAsk(draft.open && draft.help ? `Я разбираю подготовку «${draft.help.title}». Вопрос: ${draft.help.check.prompt}\nМой ответ: ${draft.answer || "пока не записан"}. ${draft.result ? `Проверка: ${draft.result.summary}` : ""}\nПомоги понять, почему так получается, чтобы я мог восстановить рассуждение сам.` : undefined)
  })
  const saveLabel = ({ saved: 'Сохранено', pending: 'Сохраняем…', saving: 'Сохраняем…', failed: 'Не удалось сохранить', error: 'Не удалось сохранить' } as Record<string, string>)[saveState] ?? ''
  useEffect(() => {
    if (!startWithHelp) { initialHelpRequested.current = false; return }
    if (work.mode === 'solo' || initialHelpRequested.current) return
    initialHelpRequested.current = true
    if(!work.numericPreparation?.open)openHelp()
    // Only the entry action opens materials; answer changes must not reopen them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWithHelp, work.mode])
  useEffect(()=>{if(draft.open&&revealHelp.current){revealHelp.current=false;helpPanel.current?.scrollIntoView({block:'start',behavior:'instant'});helpHeading.current?.focus({preventScroll:true})}},[draft.open,draft.help])
  useEffect(()=>{
    if(!restoreMain.current||pending||draft.open)return
    const point=helpReturn.current
    const frame=requestAnimationFrame(()=>{
      restoreMain.current=false
      const id=point?`percentage-${point.field}-${work.id}`:lastMainPlace.current?.id
      const candidate=id?document.getElementById(id):null
      const field=candidate instanceof HTMLInputElement||candidate instanceof HTMLTextAreaElement?candidate:null
      const opener=helpOpener.current?.isConnected&&!helpOpener.current.disabled?helpOpener.current:null
      const fallback=document.getElementById(`percentage-reasoning-${work.id}`)
      const target=field&&mainWork.current?.contains(field)?field:opener??fallback
      if(point)window.scrollTo({top:point.scrollY,behavior:'instant'})
      target?.focus({preventScroll:true})
      if(field&&target===field&&point)field.setSelectionRange(point.selectionStart,point.selectionEnd)
    })
    return()=>cancelAnimationFrame(frame)
  },[pending,draft.open,work.id])
  const returnToWork = () => void perform(async()=>{
    await savePreparationRef.current()
    await serializePreparation(async()=>{
      const p=preparationRef.current
      if(!p||conflictRef.current)throw Error('Сначала выбери, какую запись подготовки сохранить.')
      const response=await request<PreparationResponse>(`${endpoint}/return`,{preparationId:p.id,expectedPreparationRevision:p.revision,returnPoint:helpReturn.current})
      acceptPreparation(response.preparation)
      helpReturn.current=response.preparation.returnPoint??helpReturn.current
      restoreMain.current=true
      onReturnToWork?.()
    })
  })
  const submitted = [...work.submissions].reverse().find(item => item.reason === 'submitted')
  const currentSubmission = isCurrentSubmission(submitted, reasoning, answer) ? submitted : undefined
  const help = work.mode !== 'solo' && draft.open ? draft.help : undefined
  const preparationSaveLabel={saved:'Подготовка сохранена',pending:'Сохраняем ответ подготовки…',saving:'Сохраняем ответ подготовки…',failed:'Ответ подготовки остался на устройстве'}[preparationSave]
  const leavePreparation=(action:()=>void)=>void perform(async()=>{if(draftRef.current.open)await savePreparationRef.current();action()})
  return <section className="percentage-work" aria-label={neutralTitle ? 'Учебная задача' : `Учебная задача: ${topicLabel}`}>
    <div ref={mainWork} className="percentage-main-work" onFocusCapture={event=>{rememberMainPlace(event.target);if(event.target instanceof HTMLButtonElement)helpOpener.current=event.target}} onSelectCapture={event=>rememberMainPlace(event.target)}>
      <header className="percentage-condition">
      <div className="percentage-meta"><p className="percentage-eyebrow">{neutralTitle ? 'Смешанная практика' : topicLabel}</p><span className={`percentage-mode${work.mode === 'solo' ? ' is-solo' : ''}`}>{work.mode === 'solo' ? 'Самостоятельно' : work.mode === 'review' ? 'Разбор результата' : 'С помощью'}</span></div>
      {work.priorExposure && <p className="percentage-hint">Эта задача уже встречалась. Сейчас это повторение.</p>}
      <h1>{neutralTitle ? 'Реши задачу' : problem.title}</h1>
      <div className="percentage-prompt"><MathContent text={problem.prompt ?? problem.description}/></div>{problem.graph && <TopicGraph graph={problem.graph}/>}
      </header>
      <div className="percentage-working">
      <form onSubmit={event => { event.preventDefault(); leavePreparation(onSubmit) }}>
        <div className="percentage-writing">
          <div className="percentage-writing-head"><label htmlFor={`percentage-reasoning-${work.id}`}>Твоя запись</label><span role="status" className={['failed', 'error'].includes(saveState) ? 'has-error' : ''}>{saveLabel}</span></div>
          <textarea id={`percentage-reasoning-${work.id}`} value={plainText(reasoning)} onChange={event => onReasoning({ type: 'doc', content: event.target.value.split('\n').map((line, index) => ({ type: 'paragraph', attrs: {id: reasoning.content?.[index]?.attrs?.id ?? crypto.randomUUID()}, ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) })} disabled={blocked} rows={3} placeholder="Можно записать вычисления или объяснить ход мысли…"/>
        </div>
        <div className="percentage-answer-row"><div className="percentage-answer-control">
        <label className="percentage-answer-label" htmlFor={`percentage-answer-${work.id}`}>Твой ответ</label>
        <ScalarAnswer id={`percentage-answer-${work.id}`} value={answer} onChange={value => { onAnswer(value); setSolution('') }} unit={problem.answerUnit} interval={isInterval} disabled={blocked} hintId={`percentage-answer-hint-${work.id}`}/>
        </div><button className="primary-button" disabled={blocked || !answer.trim()}>Проверить <ArrowRight size={16}/></button></div>
        <p className="percentage-hint" id={`percentage-answer-hint-${work.id}`}>{isInterval ? 'Запиши промежуток или объединение промежутков.' : 'Число или дробь, например 12,5 или 25/2. Без единицы измерения.'} Проверяется итоговый ответ.</p>
        {isInterval && <details className="topic-notation"><summary>Как записать промежуток</summary><p>Круглая скобка исключает границу, квадратная включает: (1; 4] означает числа больше 1 и не больше 4. Эти числа — только пример записи.</p><p>Бесконечность можно написать inf. Для нескольких промежутков используй U или ∪. Например: (−inf; 0) U (5; inf). У бесконечности всегда круглая скобка.</p></details>}
      </form>
      {submitted && !currentSubmission && <p className="changed-work-note" role="status">Запись изменилась после проверки. Прежняя попытка сохранена ниже; обновлённую можно проверить ещё раз.</p>}
      {currentSubmission && <div className={`percentage-feedback is-${currentSubmission.result.status}`} role="status"><strong>{currentSubmission.result.status === 'correct' ? 'Ответ верный' : currentSubmission.result.status === 'incorrect' ? 'Ответ пока не совпадает' : 'Не удалось проверить запись'}</strong><MathContent text={currentSubmission.result.summary}/>{currentSubmission.result.status === 'correct' && <p>{currentSubmission.mode === 'solo' && !currentSubmission.helpCount && currentSubmission.attemptContext && !currentSubmission.attemptContext.priorExposure && !currentSubmission.attemptContext.numericHelpSeen && !currentSubmission.attemptContext.preparationUsed ? 'Эту задачу ты решил самостоятельно.' : 'Теперь можно попробовать следующую задачу без подсказок.'}</p>}</div>}
      {currentSubmission && <div className="percentage-actions">{!hideNext && <button className={currentSubmission?.result.status === 'correct' ? 'primary-button' : 'percentage-back'} onClick={()=>leavePreparation(onNext)} disabled={blocked}>{problem.packageId==='percentages' ? 'Новый вариант самостоятельно' : 'Следующая задача самостоятельно'} <ArrowRight size={16}/></button>}{!hideNext&&onAdvance&&currentSubmission.result.status==='correct'&&<button className="percentage-back" disabled={blocked} onClick={()=>leavePreparation(onAdvance)}>К следующему занятию</button>}{work.mode === 'review' && <button className="percentage-back" onClick={showSolution} disabled={blocked}>Посмотреть решение</button>}</div>}
      {problem.id === 'percent-transfer-v1' && currentSubmission?.result.status === 'correct' && <p>Это последнее задание в подборке. <button className="percentage-back" onClick={onHome}>К занятиям</button></p>}
      {solution && <div className="percentage-example"><h2>Один из способов решения</h2><MathContent text={solution}/></div>}
      <AdaptiveHelp work={work} saved={saveState==='saved'} busy={blocked} enabled={!draft.open} onHelp={onHelp} request={request} onPreparation={resource=>{setHelpSection(resource);openHelp()}} onDiscuss={text=>onAsk(text)}/>
      </div>
    </div>
    {help ? <aside ref={helpPanel} className="percentage-resource" aria-label="Объяснение к задаче">
      <div className="percentage-condition percentage-preparation">
      <button className="percentage-back" onClick={returnToWork} disabled={blocked}><ArrowLeft size={16}/> К моей задаче</button>
      <p className="percentage-eyebrow">Короткая подготовка · {topicLabel.toLocaleLowerCase('ru-RU')}</p>
      <h1 ref={helpHeading} tabIndex={-1}>{help.title}</h1>
      {helpSection==='foundation'&&<><MathContent text={help.introduction}/>{help.graph && <TopicGraph graph={help.graph}/>}
      <ol className="percentage-steps">{help.steps.map((step, index) => <li key={index}><MathContent text={step}/></li>)}</ol>
      </>}
      <div className="percentage-example"><h2>На другом примере</h2><MathContent text={help.example.prompt}/>{help.example.graph && <TopicGraph graph={help.example.graph}/>}{help.example.steps.map((step, index) => <MathContent key={index} text={step}/>)}</div>
      {help.why && <details className="topic-notation"><summary>Почему это работает</summary><MathContent text={help.why}/></details>}
      </div>
      <div className="percentage-working">
      <p role="status" className={`percentage-preparation-save${preparationSave==='failed'?' has-error':''}`}>{preparationSaveLabel}</p>
      {preparationSave==='failed'&&!conflict&&<button type="button" className="percentage-back" disabled={blocked} onClick={()=>void perform(()=>savePreparationRef.current())}>Повторить сохранение ответа подготовки</button>}
      {conflict&&<div className="percentage-preparation-conflict" role="alert"><p>В другой вкладке изменился ответ подготовки. Твоя запись остаётся в поле и на этом устройстве.</p>{conflictRead?<><p>Сохранённый ответ: <code>{latestServer.current?.answer||'пусто'}</code></p><div><button type="button" className="percentage-back" disabled={blocked} onClick={()=>resolvePreparation(false)}>Взять сохранённый ответ</button><button type="button" className="percentage-back" disabled={blocked||!latestServer.current?.open} onClick={()=>resolvePreparation(true)}>Сохранить мою запись</button></div></>:<button type="button" className="percentage-back" disabled={blocked} onClick={refreshPreparation}>Сравнить с сохранённым ответом</button>}</div>}
      <form className="percentage-check" onSubmit={event => { event.preventDefault(); checkPreparation() }}>
        <h2>Теперь попробуй</h2><MathContent text={help.check.prompt}/>{help.check.math&&<MathContent text={`\\(${help.check.math}\\)`}/>}{help.check.graph && <TopicGraph graph={help.check.graph}/>}
        <label htmlFor={`percentage-check-${work.id}`}>Твой ответ</label>
        <ScalarAnswer id={`percentage-check-${work.id}`} value={draft.answer} onChange={value => {update({ ...draftRef.current, answer: value, result: undefined,dirty:true });setPreparationSave('pending')}} unit={help.check.answerUnit} interval={help.check.kind === 'interval'} disabled={blocked} hintId={help.check.answerFormat ? `percentage-check-hint-${work.id}` : undefined}/>
        {help.check.answerFormat && <p className="percentage-hint" id={`percentage-check-hint-${work.id}`}>{help.check.answerFormat}</p>}
        <button className="primary-button" disabled={blocked || conflict || !draft.answer.trim()}>Проверить</button>
      </form>
      {draft.result && <div className={`percentage-feedback is-${draft.result.status}`} role="status"><strong>{draft.result.status === 'correct' ? 'Верно' : draft.result.status === 'incorrect' ? 'Пока не получилось' : 'Уточни запись'}</strong><MathContent text={draft.result.summary}/></div>}
      <button className={draft.result?.status === 'correct' ? 'primary-button' : 'percentage-back'} disabled={blocked} onClick={returnToWork}>Вернуться к своей задаче <ArrowRight size={16}/></button>
      </div>
    </aside> : null}
    {recovered&&<div className="percentage-preparation-conflict"><p>На этом устройстве остался несохранённый ответ другой пробы: <code>{recovered.answer||'пусто'}</code>. Основная задача не менялась.</p>{help&&<button className="percentage-back" disabled={blocked} onClick={()=>{update({...draftRef.current,answer:recovered.answer,result:undefined,dirty:true});setPreparationSave('pending');clearRecovery()}}>Перенести его в эту пробу</button>}<button className="percentage-back" onClick={clearRecovery}>Убрать локальную копию</button></div>}
    {error && <p className="percentage-error" role="alert">{error}</p>}
    {pending && <p role="status" className="percentage-hint">Загружаем…</p>}
    <footer className="percentage-footer">
      {!help && <div className="percentage-help-entry"><button className="percentage-back" onClick={event=>{setHelpSection('foundation');openHelp(event.currentTarget)}} disabled={blocked}><BookOpen size={16}/> Материалы по теме</button>{work.mode === 'solo' && <p>Перед объяснением сохраним самостоятельную попытку.</p>}</div>}
      {help && <button className="percentage-back" onClick={askMentor} disabled={blocked}><MessageCircle size={16}/> Спросить об этом примере</button>}
    </footer>
  </section>
}
