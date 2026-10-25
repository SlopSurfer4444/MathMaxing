import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Clock3, HelpCircle, LoaderCircle, MessageCircle, Paperclip, Redo2, Search, Send, Undo2, X } from 'lucide-react'
import { visitorHeaders, learnerStorage } from '../visitor-session'
import { examMessageContexts } from '../exam-message-contexts'
import { examFigureSource } from '../exam-figure-source'
import { examRecommendationAction } from '../exam-recommendation'
import { existingFormulaAt, insertExamFormula } from '../exam-formula-insertion'
import {readExamChatDraft,writeExamChatDraft} from '../exam-chat-draft'
import {captureExamQuote,examQuoteFieldDigest,locateExamQuote} from '../exam-quote-selection'
import {readProbeDrafts,writeProbeDrafts} from '../exam-local-learning'
import {readModelDraft,writeModelDraft,clearModelDraft,modelDraftConflicts,flushModelDraft,ModelSyncError,confirmModelDraftBackup,createModelAutosave,modelBindingOf,assertModelBinding,type ModelBinding,type ModelSaveAdmission,type ModelSyncContext} from '../exam-local-model'
import type {StepModelState} from '../../shared/step-model.mjs'
import {canRebaseExamSave,examRefreshDecision} from '../exam-save-rebase'
import type {ExamReturnPoint as ReturnPoint} from '../exam-contract'
import { GlassSurface } from './glass'
import { HomeGeometry } from './HomeGeometry'
import { ExamPhoto } from './ExamPhoto'
import { ExamResultNavigation } from './ExamResultNavigation'
import { ExamSessionSummary } from './ExamSessionSummary'
import { ExamLearningEntry } from './ExamLearningEntry'
import { ExamProbeInput } from './ExamProbeInput'
import { ExamEvaluationResult } from './ExamEvaluationResult'
import { BrandWordmark } from './BrandWordmark'
import { ExamProfile, downloadExamFile } from './ExamProfile'
import type { ExamContext, ExamEdition, ExamFamily, ExamLesson, ExamMixed, ExamRecommendation, ExamReply, ExamSession, ExamState, ExamWork, ExamWorkSummary } from '../exam-ui-types'
import './exam-trainer.css'

const MathAnswer=lazy(()=>import('./MathAnswer').then(module=>({default:module.MathAnswer})))
const MathContent=lazy(()=>import('./MathContent').then(module=>({default:module.MathContent})))
const ExamMaterialArticle=lazy(()=>import('./ExamMaterialArticle').then(module=>({default:module.ExamMaterialArticle})))
const ExamQuoteSourceDialog=lazy(()=>import('./ExamQuoteSourceDialog').then(module=>({default:module.ExamQuoteSourceDialog})))
const ExamFormulaComposer=lazy(()=>import('./ExamFormulaComposer').then(module=>({default:module.ExamFormulaComposer})))
const ExamStepModel=lazy(()=>import('./ExamStepModel').then(module=>({default:module.ExamStepModel})))

type View = 'home'|'catalog'|'materials'|'route'|'history'|'work'|'session'
type Draft = {answersByPart:Record<string,string>;reasoning:string}
type FormulaTarget = {workId:string;partId?:string;start:number;end:number;snapshot:string;initialValue:string;editing:boolean}
const draftOf = (work:ExamWork):Draft => ({answersByPart:{...work.answersByPart},reasoning:work.reasoning})
const sameDraft = (a:Draft,b:Draft) => JSON.stringify(a) === JSON.stringify(b)
const statusText = {correct:'Подтверждено',incorrect:'Нужно исправить',unknown:'Нужна проверка'}
const dateText = (value:string) => new Date(value).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})
const requestId = () => crypto.randomUUID()
class ExamApiError extends Error { status:number; constructor(message:string,status:number){super(message);this.status=status} }
class SourceWorkUnavailable extends Error {}
async function api<T>(path:string,body?:unknown):Promise<T> {
  const response = await fetch(`/api/exam/${path}`,{method:body === undefined ? 'GET':'POST',headers:{'X-Pole-Client':'notebook-v1',...visitorHeaders(),...(body === undefined?{}:{'Content-Type':'application/json'})},credentials:'same-origin',cache:'no-store',...(body === undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)})
  const data = await response.json()
  if (!response.ok) throw new ExamApiError(data.error || data.message || 'Не удалось выполнить действие. Твой черновик остался на этом устройстве.',response.status)
  return data as T
}
function QuoteChip({context,index,onRemove,onOpen}:{context:ExamContext;index:number;onRemove?:()=>void;onOpen?:()=>void}) {
  return <span className="exam-quote-chip"><button type="button" className="exam-quote-trigger" onClick={onOpen} aria-label={`Фрагмент ${index+1}: ${context.quote}`}><svg className="exam-quote-bracket" width="12" height="18" viewBox="0 0 12 20" fill="none" aria-hidden="true"><path d="M9 2H3V18H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>Фрагмент {index+1}<span className="exam-quote-preview"><MathContent text={context.quote}/></span></button>{onRemove && <button type="button" aria-label={`Убрать фрагмент ${index+1}`} onClick={onRemove}><X size={12}/></button>}</span>
}
export function ExamTrainer({onExit}:{onExit:()=>void}) {
  const [state,setState] = useState<ExamState|null>(null)
  const [work,setWork] = useState<ExamWork|null>(null)
  const workRef = useRef<ExamWork|null>(null)
  const [draft,setDraft] = useState<Draft>({answersByPart:{},reasoning:''})
  const draftRef = useRef(draft)
  const history = useRef<Draft[]>([]), historyPosition = useRef(0)
  const [,setHistoryTick] = useState(0)
  const [view,setView] = useState<View>('home')
  const [requestBusy,setBusy] = useState(false), [photoImportBusy,setPhotoImportBusy]=useState(false), [assistantThinking,setAssistantThinking]=useState(false), [error,setError] = useState(''), [saveLabel,setSaveLabel] = useState('')
  const busy=requestBusy||photoImportBusy
  const [query,setQuery] = useState(''), [group,setGroup] = useState('all'), [edition,setEdition] = useState('2026')
  const [mixed,setMixed]=useState<ExamMixed|null>(null)
  const [selected,setSelected] = useState<string|null>(null)
  const [routeNotice,setRouteNotice]=useState('')
  const [lesson,setLesson] = useState<ExamLesson|null>(null), [probeAnswer,setProbeAnswer] = useState('')
  const [modelState,setModelState]=useState<StepModelState|null>(null),[modelRecovery,setModelRecovery]=useState<StepModelState|null>(null),[modelSaveLabel,setModelSaveLabel]=useState('')
  const modelRecoveryRef=useRef<StepModelState|null>(null),flushModelRef=useRef<()=>Promise<void>>(async()=>{})
  const [modelExitWorkId,setModelExitWorkId]=useState<string|null>(null),[modelExitUnsafe,setModelExitUnsafe]=useState(false)
  const recoverModel=(value:StepModelState|null)=>{modelRecoveryRef.current=value;setModelRecovery(value)}
  const modelDraftRef=useRef<{episodeId:string;descriptorDigest:string;baseState:StepModelState;state:StepModelState}|null>(null)
  const modelSentRef=useRef<(ModelBinding&{state:StepModelState})|null>(null)
  const modelAdmissionRef=useRef<ModelSaveAdmission|null>(null)
  const modelAutosave=useRef(createModelAutosave()),[modelAutosaveTick,setModelAutosaveTick]=useState(0)
  const readModelContext=():ModelSyncContext|null=>{
    const current=workRef.current,episode=current?.learningModel
    return current&&episode?{workId:current.id,open:!!current.learning?.modelOpen,episode,draft:modelDraftRef.current,recovery:!!modelRecoveryRef.current}:null
  }
  const [lessonEntryFocus,setLessonEntryFocus]=useState<{workId:string;familyId:string;target:'start'|'why'}|null>(null)
  const lessonTitleRef=useRef<HTMLHeadingElement>(null),whyDetailsRef=useRef<HTMLDetailsElement>(null)
  const [chatPart,setChatPart]=useState('')
  const [lessonTrail,setLessonTrail]=useState<{familyId:string;materialId?:string}[]>([])
  const [message,setMessage] = useState(''), [contexts,setContexts] = useState<ExamContext[]>([]), [selection,setSelection] = useState<ExamContext|null>(null)
  const [objection,setObjection] = useState<{evaluationId?:string;advisoryId?:string;attemptId:string}|null>(null), [objectionText,setObjectionText] = useState('')
  const objectionTextRef=useRef(objectionText);objectionTextRef.current=objectionText
  const [session,setSession] = useState<ExamSession|null>(null), [editions,setEditions] = useState<ExamEdition[]>([]), [remaining,setRemaining] = useState(0), [confirmSubmit,setConfirmSubmit] = useState(false),[confirmCloseSession,setConfirmCloseSession]=useState(false)
  const [recent,setRecent] = useState<ExamWorkSummary[]>([]), [recentPage,setRecentPage] = useState(0), [moreHistory,setMoreHistory] = useState(true)
  const [recover,setRecover] = useState<Draft|null>(null)
  const [historyCursor,setHistoryCursor] = useState<number|null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve()), actionBusy=useRef(false), expiredRead=useRef<string|null>(null)
  const mounted = useRef(true), reasoningRef = useRef<HTMLTextAreaElement>(null), returnRef = useRef<ReturnPoint|null>(null)
  const lastEditor=useRef<HTMLElement|null>(null)
  const probeDrafts=useRef(new Map<string,string>())
  const [formulaTarget,setFormulaTarget]=useState<FormulaTarget|null>(null),[formulaError,setFormulaError]=useState('')
  const [quoteSource,setQuoteSource]=useState<ExamContext|null>(null),[helpCollapsed,setHelpCollapsed]=useState(false)
  const quoteCapture=useRef(0)
  const [quoteLocation,setQuoteLocation]=useState<{context:ExamContext;workId:string;snapshot:string;start:number;end:number}|null>(null)
  const chatSending=useRef(false),chatDraftRef=useRef({text:message,contexts})
  const [providerWorkId,setProviderWorkId]=useState<string|null>(null)
  chatDraftRef.current={text:message,contexts}
  const pendingReturn=useRef<{workId:string;point:ReturnPoint|null}|null>(null)
  const serial = useCallback(<T,>(task:()=>Promise<T>):Promise<T> => {const next=queue.current.catch(()=>{}).then(task);queue.current=next;return next},[])
  const updateWork = useCallback((next:ExamWork,reset=false) => {
    const changed = workRef.current?.id !== next.id
    if(changed){modelAutosave.current.cancel();modelDraftRef.current=null;modelSentRef.current=null;setModelState(null);recoverModel(null);setModelSaveLabel('');try{probeDrafts.current=readProbeDrafts(learnerStorage,next.id)}catch{probeDrafts.current.clear()}}
    if(next.learning?.open&&next.learning.returnPoint)returnRef.current=next.learning.returnPoint as ReturnPoint
    workRef.current=next;setWork(next);setMixed(current=>current&&current.tasks.some(task=>task.workId===next.id)?{...current,work:next,tasks:current.tasks.map(task=>task.workId===next.id?{...task,work:next}:task)}:current)
    setState(current=>current?{...current,work:next}:current)
    setRecent(current=>[{id:next.id,familyId:next.familyId,title:next.instance.title,updatedAt:next.updatedAt,completed:next.completed,mode:next.mode},...current.filter(item=>item.id!==next.id)])
    if (changed || reset) {
      setModelExitWorkId(null);setModelExitUnsafe(false)
      const value=draftOf(next); draftRef.current=value;setDraft(value);history.current=[value];historyPosition.current=0;setHistoryTick(t=>t+1);setContexts([]);setSelection(null);setObjection(null);setLesson(null);setLessonTrail([]);setLessonEntryFocus(null);setFormulaTarget(null);setRecover(null);setMessage('');setChatPart(next.instance.parts[0]?.id??'');returnRef.current=next.learning?.returnPoint as typeof returnRef.current??null
      try {const chat=readExamChatDraft(learnerStorage,next.id);setMessage(chat.text);setContexts(chat.contexts);const raw=learnerStorage.getItem(`exam.draft.${next.id}`);if(raw){const local=JSON.parse(raw);if(local.draft&&typeof local.draft.reasoning==='string'&&local.draft.answersByPart&&typeof local.draft.answersByPart==='object'&&Object.values(local.draft.answersByPart).every(answer=>typeof answer==='string')&&!sameDraft(local.draft,value))setRecover(local.draft)}} catch { /* Server copy remains usable. */ }
    }
  },[])
  const updateSession = useCallback((next:ExamSession) => {setSession(next);setRemaining(next.remainingSeconds);const current=next.tasks.find(task=>task.position===next.currentPosition)??next.tasks[0];if(current)updateWork(current.work,true)},[updateWork])
  function adoptLesson(next:ExamLesson,ownerWork?:ExamWork){
    setLesson(next)
    const episode=ownerWork?.learningModel
    const local=modelDraftRef.current
    if(episode&&ownerWork?.learning?.modelOpen&&local?.episodeId===episode.id&&local.descriptorDigest===episode.descriptorDigest){
      const sent=modelSentRef.current
      const ownSave=sent?.workId===ownerWork.id&&sent.episodeId===episode.id&&sent.descriptorDigest===episode.descriptorDigest&&JSON.stringify(sent.state)===JSON.stringify(episode.state)
      if(!ownSave&&modelDraftConflicts(local,episode)){recoverModel(local.state);setModelState(episode.state);modelDraftRef.current={...local,baseState:episode.state,state:episode.state}}
      else modelDraftRef.current={...local,baseState:episode.state}
    }
    if(episode&&ownerWork?.learning?.modelOpen&&(modelDraftRef.current?.episodeId!==episode.id||modelDraftRef.current?.descriptorDigest!==episode.descriptorDigest)){
      let state=episode.state,recovery:StepModelState|null=null
      try{const local=readModelDraft(learnerStorage,ownerWork.id);if(local?.episodeId===episode.id&&local.descriptorDigest===episode.descriptorDigest){if(JSON.stringify(local.baseState)===JSON.stringify(episode.state))state=local.state;else if(JSON.stringify(local.state)!==JSON.stringify(episode.state))recovery=local.state}}catch{/* Saved state remains usable. */}
      modelDraftRef.current={episodeId:episode.id,descriptorDigest:episode.descriptorDigest,baseState:episode.state,state};setModelState(state);recoverModel(recovery);setModelSaveLabel('')
    }
    const key=next.familyId
    setProbeAnswer(next.kind==='material'?'':probeDrafts.current.get(key)??ownerWork?.learning?.probeResult?.answer??'')
  }
  const reload = useCallback(async(clearMissingWork=false)=>{
    const [data,exam,practice]=await Promise.all([api<ExamState>('state'),api<{session:ExamSession|null;editions:ExamEdition[]}>('session/state'),api<{mixed:ExamMixed|null}>('mixed/state')])
    setMixed(practice.mixed)
    setState(data);setRecent(data.works??[]);setHistoryCursor(data.nextCursor??null);setMoreHistory(data.nextCursor!=null);setEditions(exam.editions??[]);setSession(exam.session);if(data.work)updateWork(data.work,true)
    else if(clearMissingWork){workRef.current=null;setWork(null);const empty={answersByPart:{},reasoning:''};draftRef.current=empty;setDraft(empty);history.current=[];historyPosition.current=0;returnRef.current=null;setLesson(null);setRecover(null);setMessage('');setContexts([]);setSelection(null);setSaveLabel('');setView('home')}
    if(exam.session?.status==='active'){updateSession(exam.session);setView('session')}
    else if(practice.mixed&&practice.mixed.status!=='completed'){setMixed(practice.mixed);updateWork(practice.mixed.work,true);setView('home')}
    else if(data.work?.learning?.open){const reply=await api<ExamReply>('learn',{workId:data.work.id,expectedRevision:data.work.revision,expectedModeEpoch:data.work.modeEpoch,requestId:requestId(),action:data.work.learning.modelOpen?'model-open':'open',familyId:data.work.learning.familyId,materialId:data.work.learning.materialId});if(reply.work)updateWork(reply.work);if(reply.lesson){adoptLesson(reply.lesson,reply.work)};setView('work')}
  },[updateWork,updateSession])
  const initialization=useRef<Promise<void>|null>(null)
  useEffect(()=>{mounted.current=true;setBusy(true);initialization.current??=reload();initialization.current.catch(e=>setError(e.message)).finally(()=>setBusy(false));return()=>{mounted.current=false}},[reload])
  const edit = (value:Draft) => {
    draftRef.current=value;setDraft(value);history.current=[...history.current.slice(0,historyPosition.current+1),value].slice(-100);historyPosition.current=history.current.length-1;setHistoryTick(t=>t+1);setSaveLabel('Сохраняем…')
    if(workRef.current)try{learnerStorage.setItem(`exam.draft.${workRef.current.id}`,JSON.stringify({revision:workRef.current.revision,draft:value}))}catch{setSaveLabel('Черновик пока только на открытой странице')}
  }
  const moveHistory=(offset:number)=>{historyPosition.current+=offset;const next=history.current[historyPosition.current];draftRef.current=next;setDraft(next);setHistoryTick(t=>t+1);setSaveLabel('Сохраняем…');if(workRef.current)try{learnerStorage.setItem(`exam.draft.${workRef.current.id}`,JSON.stringify({revision:workRef.current.revision,draft:next}))}catch{}}
  const openFormula=(partId?:string)=>{
    const current=workRef.current
    if(!current)return
    const previous=lastEditor.current
    const field=partId?document.getElementById(`exam-answer-${partId}`):previous instanceof HTMLTextAreaElement&&previous.isConnected?previous:reasoningRef.current
    if(!(field instanceof HTMLTextAreaElement)||field.disabled)return
    const targetPart=field.closest('[data-exam-part]')?.getAttribute('data-exam-part')??undefined
    const existing=existingFormulaAt(field.value,field.selectionStart,field.selectionEnd)
    setFormulaError('');setFormulaTarget({workId:current.id,partId:targetPart,start:existing?.start??field.selectionStart,end:existing?.end??field.selectionEnd,snapshot:field.value,initialValue:existing?.latex??'',editing:!!existing})
  }
  const acceptFormula=(latex:string)=>{
    if(!formulaTarget)return
    const current=workRef.current,partId=formulaTarget.partId
    const text=partId?draftRef.current.answersByPart[partId]??'':draftRef.current.reasoning
    if(!editable||!current||current.id!==formulaTarget.workId||current.completed||current.mode==='review'||text!==formulaTarget.snapshot){setFormulaError('Запись изменилась или уже закрыта для редактирования. Закрой это окно и выбери место для формулы заново.');return}
    try{
      const result=insertExamFormula(text,formulaTarget.start,formulaTarget.end,latex)
      edit(partId?{...draftRef.current,answersByPart:{...draftRef.current.answersByPart,[partId]:result.text}}:{...draftRef.current,reasoning:result.text})
      setFormulaTarget(null);setFormulaError('')
      requestAnimationFrame(()=>{const field=partId?document.getElementById(`exam-answer-${partId}`):reasoningRef.current;if(field instanceof HTMLTextAreaElement){field.focus({preventScroll:true});field.setSelectionRange(result.caret,result.caret)}})
    }catch(error){setFormulaError(error instanceof Error?error.message:'Формула не вставлена. Исходная запись сохранена.')}
  }
  const saveSolution = useCallback(async(modelBinding?:ModelBinding)=>{
    if(modelBinding)assertModelBinding(readModelContext(),modelBinding)
    const current=workRef.current;if(!current||current.completed||current.mode==='review'||sameDraft(draftRef.current,draftOf(current)))return current
    const snapshot=structuredClone(draftRef.current)
    setSaveLabel('Сохраняем…')
    const body={workId:current.id,expectedRevision:current.revision,expectedModeEpoch:current.modeEpoch,...snapshot}
    let result:ExamReply
    try{result=await api<ExamReply>('save',body)}catch(error){
      // Only a definite rejection may be retried, and only after proving that
      // concurrent chat metadata left the saved learner text unchanged.
      if(!(error instanceof ExamApiError)||error.status!==409)throw error
      const latest=await api<ExamReply>('open',{workId:current.id})
      if(!latest.work||!canRebaseExamSave(current,latest.work))throw error
      result=await api<ExamReply>('save',{...body,expectedRevision:latest.work.revision})
    }
    if(!result.work)throw new Error('Не удалось подтвердить сохранение.')
    if(modelBinding)assertModelBinding(readModelContext(),modelBinding)
    updateWork(result.work)
    if(sameDraft(snapshot,draftRef.current)){setSaveLabel('Сохранено');try{learnerStorage.removeItem(`exam.draft.${current.id}`)}catch{/* Optional local recovery. */}}
    return result.work
  },[updateWork])
  const save = useCallback(async()=>{
    const saved=await saveSolution()
    await flushModelRef.current()
    return workRef.current??saved
  },[saveSolution])
  useEffect(()=>{if(!work||work.completed||work.mode==='review'||sameDraft(draft,draftOf(work)))return;const timer=setTimeout(()=>{serial(saveSolution).catch(e=>{if(mounted.current){setSaveLabel('Не сохранено на сервере');setError(e.message)}})},850);return()=>clearTimeout(timer)},[draft,work,saveSolution,serial])
  const run = (action:()=>Promise<void>,modelRetry=false) => {
    if(actionBusy.current)return
    const admission=modelAutosave.current.admit(readModelContext(),modelRetry),release=modelAutosave.current.hold()
    actionBusy.current=true;setBusy(true);setError('')
    serial(async()=>{modelAdmissionRef.current=admission;try{if(admission)assertModelBinding(readModelContext(),admission.binding);await action()}finally{modelAdmissionRef.current=null}}).catch(e=>setError(e.message)).finally(()=>{release();actionBusy.current=false;if(mounted.current){setBusy(false);setModelAutosaveTick(t=>t+1)}})
  }
  const mutate = async(path:string,extra:Record<string,unknown>={},options:{skipModelSave?:boolean;modelBinding?:ModelBinding}={}) => {
    if(options.modelBinding)assertModelBinding(readModelContext(),options.modelBinding)
    // A provider reservation advances revision without changing learner text.
    // Read it back before another explicit action; never replay an unknown POST.
    if(chatSending.current&&workRef.current&&!await refreshProviderWork(workRef.current.id))throw Error('Не удалось согласовать запись. Обнови состояние перед следующим действием.')
    if(options.modelBinding)assertModelBinding(readModelContext(),options.modelBinding)
    const modelWrite=path==='learn'&&['model-save','model-check'].includes(String(extra.action))
    // Model persistence calls this same mutation path: save only the solution
    // inside that write, so the explicit navigation flush cannot await itself.
    await (modelWrite||options.skipModelSave?saveSolution(options.modelBinding):save());const current=workRef.current;if(!current)throw new Error('Сначала открой задачу.')
    if(options.modelBinding)assertModelBinding(readModelContext(),options.modelBinding)
    if(modelWrite&&modelDraftRef.current&&current.learningModel&&(modelDraftRef.current.descriptorDigest!==current.learningModel.descriptorDigest||modelDraftConflicts(modelDraftRef.current,current.learningModel))){
      recoverModel(modelDraftRef.current.state);setModelState(current.learningModel.state);modelDraftRef.current={...modelDraftRef.current,baseState:current.learningModel.state,state:current.learningModel.state};throw new Error('Разбор изменён в другой вкладке. Выбери, какой ввод продолжить; серверная запись сохранена.')
    }
    const reply=await api<ExamReply>(path,{workId:current.id,expectedRevision:current.revision,expectedModeEpoch:current.modeEpoch,requestId:requestId(),...extra})
    if(options.modelBinding){
      assertModelBinding(readModelContext(),options.modelBinding)
      const returned=reply.work,episode=returned?.learningModel
      assertModelBinding(returned&&episode?{workId:returned.id,open:!!returned.learning?.modelOpen,episode,draft:null,recovery:false}:null,options.modelBinding)
    }
    if(reply.work){updateWork(reply.work,path==='next'||path==='correct');if(path==='correct'&&reply.work.id!==current.id)setView('work')}if(reply.lesson){adoptLesson(reply.lesson,reply.work)}
    if(['submit','correct','finish','next','object'].includes(path)){const fresh=await api<ExamState>('state');setState(current=>current?{...current,route:fresh.route}:current)}
    return reply
  }
  const start = (familyId:string,mode:'guided'|'solo',learn=false,templateId?:string) => run(async()=>{
    await save();const reply=await api<ExamReply>('start',{familyId,mode,templateId,requestId:requestId()});if(!reply.work)throw new Error('Задача не открылась.');updateWork(reply.work,true);setView('work');setSelected(null)
    if(learn){const learned=await api<ExamReply>('learn',{workId:reply.work.id,expectedRevision:reply.work.revision,expectedModeEpoch:reply.work.modeEpoch,requestId:requestId(),action:'open',familyId,returnPoint:{scrollY:0,start:0,end:0}});if(learned.work)updateWork(learned.work);if(learned.lesson)adoptLesson(learned.lesson,learned.work)}
  })
  const startMixed=()=>run(async()=>{await save();const result=await api<{mixed:ExamMixed}>('mixed/start',{requestId:requestId()});setMixed(result.mixed);updateWork(result.mixed.work,true);setView('work')})
  const resumeMixed=()=>run(async()=>{await save();if(!mixed)return;const result=await api<{mixed:ExamMixed}>('mixed/open',{mixedId:mixed.id});setMixed(result.mixed);updateWork(result.mixed.work,true);setView('work')})
  const advanceMixed=(action:'next'|'skip'|'finish')=>run(async()=>{await save();if(!mixed||!workRef.current)return;const result=await api<{mixed:ExamMixed}>('mixed/next',{mixedId:mixed.id,expectedRevision:mixed.revision,requestId:requestId(),workId:workRef.current.id,expectedWorkRevision:workRef.current.revision,expectedWorkModeEpoch:workRef.current.modeEpoch,action});setMixed(result.mixed);updateWork(result.mixed.work,true)})
  const navigate = (next:View) => run(async()=>{
    await save()
    if(mixed?.status==='active'&&view==='work'&&workRef.current&&mixed.tasks.some(task=>task.workId===workRef.current?.id)){
      const result=await api<{mixed:ExamMixed}>('mixed/pause',{mixedId:mixed.id,expectedRevision:mixed.revision,requestId:requestId(),workId:workRef.current.id,expectedWorkRevision:workRef.current.revision,expectedWorkModeEpoch:workRef.current.modeEpoch});setMixed(result.mixed)
    }
    if(next==='session'){
      const latest=await api<{session:ExamSession|null}>('session/state')
      setSession(latest.session)
      if(latest.session)updateSession(latest.session)
    }
    setView(next);setSelected(null)
  })
  const loadWork = async(id:string) => {
    const reply=await api<ExamReply>('open',{workId:id}).catch(error=>{
      if(error instanceof ExamApiError&&[404,410].includes(error.status))throw new SourceWorkUnavailable(error.message)
      throw error
    })
    if(!reply.work)throw new Error('Сохранённая работа не открылась. Обнови состояние перед следующим действием.')
    updateWork(reply.work,true);setView('work')
    if(mixed?.status==='paused'&&mixed.tasks.some(task=>task.workId===id)){const result=await api<{mixed:ExamMixed}>('mixed/open',{mixedId:mixed.id});setMixed(result.mixed);updateWork(result.mixed.work,true)}
    const published=state?.families.some(family=>family.id===reply.work?.familyId)
    if(!published&&!mixed?.tasks.some(task=>task.workId===id))setRouteNotice('Эта версия темы сохранена для чтения. Можно скачать запись и выбрать доступную тему для новой работы.')
    else if(reply.work.learning?.open){const learned=await mutate('learn',{action:reply.work.learning.modelOpen?'model-open':'open',familyId:reply.work.learning.familyId,materialId:reply.work.learning.materialId});if(learned.lesson)adoptLesson(learned.lesson,learned.work)}
  }
  const openWork = (id:string) => run(async()=>{await save();setRouteNotice('');await loadWork(id)})
  const followRecommendation = (item:ExamRecommendation) => {
    const action=examRecommendationAction(item)
    setRouteNotice('')
    if(sessionActive)return
    if(action.kind==='mixed'){startMixed();return}
    if(action.kind==='start'){start(action.familyId,action.mode);return}
    run(async()=>{
      await save()
      if(action.kind==='open'){
        try{await loadWork(action.workId);return}
        catch(error){if(!(error instanceof SourceWorkUnavailable))throw error}
        setRouteNotice('Работа, на которой основан этот шаг, больше недоступна. Выбери доступную тему; новую попытку мы ещё не начинали.')
      }else if(item.goal==='repair'||item.goal==='review')setRouteNotice('У этого предложения нет ссылки на исходную работу. Можно найти её в «Мои решения» или выбрать новую тему.')
      setView('catalog');setGroup('all');setQuery('');setSelected(state?.families.some(family=>family.id===item.familyId)?item.familyId:null)
    })
  }

  const openLesson = (familyId?:string,materialId?:string,back=false,entryTarget?:'start'|'why') => run(async()=>{
    if(!work?.learning?.open){
      const target=(lastEditor.current?.isConnected?lastEditor.current:null)??reasoningRef.current
      const field=target as (HTMLInputElement & {position?:number})|null
      returnRef.current={scrollY:window.scrollY,start:field?.selectionStart??0,end:field?.selectionEnd??0,partId:target?.closest('[data-exam-part]')?.getAttribute('data-exam-part')??undefined,kind:target?.tagName==='MATH-FIELD'?'math':'text',...(typeof field?.position==='number'?{position:field.position}:{})}
    }
    await mutate('learn',{action:'open',familyId:familyId??work?.familyId,...(materialId?{materialId}:{}),...(returnRef.current?{returnPoint:returnRef.current}:{})})
    const current=workRef.current
    setLessonEntryFocus(entryTarget&&current?{workId:current.id,familyId:familyId??current.familyId,target:entryTarget}:null)
    if(back)setLessonTrail(current=>current.slice(0,-1));else if(lesson)setLessonTrail(current=>[...current,{familyId:lesson.familyId,...(lesson.kind==='material'?{materialId:lesson.material.id}:{})}].slice(-20))
  })
  const leaveLesson = (saving:'server'|'local'|'unsynced'='server') => run(async()=>{
    const point=returnRef.current??(workRef.current?.learning?.returnPoint as ReturnPoint|null)
    const workId=workRef.current?.id
    if(saving==='local'){
      const current=workRef.current,local=modelDraftRef.current
      try{
        if(!current||!local||current.learningModel?.id!==local.episodeId)throw Error('Разбор изменился')
        confirmModelDraftBackup(learnerStorage,current.id,local,modelRecoveryRef.current)
      }catch{setModelExitUnsafe(true);throw Error('На устройстве тоже не удалось подтвердить черновик разбора. Скопируй или скачай ввод перед выходом.')}
    }
    try{await mutate('learn',{action:'return'},{skipModelSave:saving!=='server'})}
    catch(error){if(error instanceof ModelSyncError&&workId&&workRef.current?.id===workId&&workRef.current?.learning?.modelOpen)setModelExitWorkId(workId);throw error}
    if(workId)pendingReturn.current={workId,point}
    setModelExitWorkId(null);setModelExitUnsafe(false)
    setLesson(null);setLessonTrail([])
    setLessonEntryFocus(null)
  },saving==='server')
  const closeLesson=()=>leaveLesson()
  const openModel=(context?:ExamContext)=>run(async()=>{
    if(!workRef.current?.learning?.open){const target=(lastEditor.current?.isConnected?lastEditor.current:null)??reasoningRef.current;const field=target as HTMLTextAreaElement|null;returnRef.current={scrollY:window.scrollY,start:context?.selection?.start??field?.selectionStart??0,end:context?.selection?.end??field?.selectionEnd??0,partId:context?.origin==='answer'?context.partId:target?.closest('[data-exam-part]')?.getAttribute('data-exam-part')??undefined,kind:'text'}}
    const exact=context?.selection&&['reasoning','answer'].includes(context.origin??'')?{quote:context.quote,origin:context.origin,...(context.origin==='answer'?{partId:context.partId}:{}),selection:context.selection}:undefined
    await mutate('learn',{action:'model-open',...(exact?{context:exact}:{}),...(returnRef.current?{returnPoint:returnRef.current}:{})});setSelection(null);setLessonTrail([]);if(!workRef.current?.messages.length)setHelpCollapsed(true)
  })
  const changeModel=(state:StepModelState)=>{
    const current=workRef.current,episode=modelDraftRef.current;if(!current?.learning?.modelOpen||!episode||episode.episodeId!==current.learningModel?.id||episode.descriptorDigest!==current.learningModel.descriptorDigest)return
    modelDraftRef.current={...episode,state};setModelState(state);setModelSaveLabel('На этом устройстве')
    try{writeModelDraft(learnerStorage,current.id,modelDraftRef.current)}catch{setModelSaveLabel('Пока только на открытой странице')}
  }
  const persistModel=async(check=false,expected?:ModelBinding)=>{
    const context=readModelContext(),local=modelDraftRef.current
    if(!context?.open||!local||modelRecoveryRef.current)return
    const binding=expected??modelBindingOf(context)
    assertModelBinding(context,binding)
    modelAutosave.current.assertAdmission(binding,modelAdmissionRef.current)
    if(local.episodeId!==binding.episodeId||local.descriptorDigest!==binding.descriptorDigest)throw new ModelSyncError('changed')
    if(!check&&JSON.stringify(local.state)===JSON.stringify(context.episode.state))return
    const snapshot=structuredClone(local.state),workId=binding.workId
    let reply:ExamReply
    modelSentRef.current={...binding,state:snapshot}
    try{reply=await mutate('learn',{action:check?'model-check':'model-save',state:snapshot},{modelBinding:binding})}
    catch(cause){const current=readModelContext();if(current?.open&&JSON.stringify(modelBindingOf(current))===JSON.stringify(binding)){modelAutosave.current.block(binding);setModelSaveLabel('Не сохранено на сервере')}throw cause}
    finally{modelSentRef.current=null}
    assertModelBinding(readModelContext(),binding)
    const latest=modelDraftRef.current,episode=reply.work?.learningModel
    if(!latest||!episode||latest.episodeId!==binding.episodeId||latest.descriptorDigest!==binding.descriptorDigest)throw new ModelSyncError('changed')
    modelDraftRef.current={...latest,baseState:episode.state}
    if(JSON.stringify(latest.state)===JSON.stringify(snapshot)){setModelSaveLabel('Разбор сохранён');try{clearModelDraft(learnerStorage,workId)}catch{/* Server is authoritative. */}}
    else try{writeModelDraft(learnerStorage,workId,modelDraftRef.current)}catch{setModelSaveLabel('Пока только на открытой странице')}
    if(check){modelAutosave.current.confirm(binding);setModelExitWorkId(null);setModelExitUnsafe(false)}
  }
  flushModelRef.current=async()=>{
    const initial=readModelContext(),binding=modelAdmissionRef.current?.binding??(initial?.open?modelBindingOf(initial):null)
    try{await flushModelDraft(readModelContext,()=>persistModel(),modelAutosave.current,modelAdmissionRef.current)}
    catch(error){const current=readModelContext();if(binding&&current?.open&&JSON.stringify(modelBindingOf(current))===JSON.stringify(binding))setModelSaveLabel('Не сохранено на сервере');throw error}
    setModelExitWorkId(null);setModelExitUnsafe(false)
  }
  useEffect(()=>modelAutosave.current.schedule(readModelContext,serial,binding=>persistModel(false,binding),cause=>{
    if(mounted.current){setModelSaveLabel('Не сохранено на сервере');setError(cause instanceof Error?cause.message:'Не удалось подтвердить сохранение разбора.')}
  }),[modelState,modelRecovery,work?.id,work?.learning?.modelOpen,work?.learningModel?.id,work?.learningModel?.descriptorDigest,serial,modelAutosaveTick])
  useEffect(()=>()=>modelAutosave.current.cancel(),[])
  useEffect(()=>{
    if(!lessonEntryFocus||!lesson||lesson.kind==='material'||lessonEntryFocus.workId!==work?.id||lessonEntryFocus.familyId!==lesson.familyId)return
    let frame=0,ticks=0
    const focusEntry=()=>{
      // A newly opened lesson may still be behind its lazy math renderer.
      const target=lessonEntryFocus.target==='why'?whyDetailsRef.current:lessonTitleRef.current
      if(target){
        if(target instanceof HTMLDetailsElement)target.open=true
        const focusTarget=target instanceof HTMLDetailsElement?target.querySelector('summary'):target
        focusTarget?.focus({preventScroll:true})
        target.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
        setLessonEntryFocus(null)
      }else if(ticks++<180)frame=requestAnimationFrame(focusEntry)
      else setLessonEntryFocus(null)
    }
    frame=requestAnimationFrame(focusEntry)
    return()=>cancelAnimationFrame(frame)
  },[lessonEntryFocus,lesson?.familyId,lesson?.kind,work?.id])
  useEffect(()=>{
    if(lesson||!pendingReturn.current)return
    let frame=0,ticks=0
    const restore=()=>{
      const pending=pendingReturn.current
      if(!pending||pending.workId!==workRef.current?.id){pendingReturn.current=null;return}
      const point=pending.point
      const section=point?.partId?document.getElementById(`exam-part-${point.partId}`):null
      const target=(section?.querySelector('math-field,input,textarea')??reasoningRef.current) as (HTMLInputElement & {position?:number})|null
      if(target?.isConnected&&!target.disabled){
        target.focus({preventScroll:true})
        if(point){if(point.kind==='math'&&typeof point.position==='number')target.position=point.position;else if(target.tagName==='INPUT'||target.tagName==='TEXTAREA')target.setSelectionRange(point.start,point.end);window.scrollTo({top:point.scrollY,behavior:'instant'})}
        pendingReturn.current=null
      }else if(ticks++<180)frame=requestAnimationFrame(restore)
      else pendingReturn.current=null
    }
    frame=requestAnimationFrame(restore)
    return()=>cancelAnimationFrame(frame)
  },[lesson,work?.id])
  const persistChatDraft=(text:string,nextContexts:ExamContext[],workId=workRef.current?.id)=>{
    if(!workId)return
    try{writeExamChatDraft(learnerStorage,workId,{text,contexts:nextContexts})}catch{setSaveLabel('Вопрос пока только на открытой странице')}
  }
  const setChatDraft=(text:string,nextContexts:ExamContext[])=>{
    setMessage(text);setContexts(nextContexts);chatDraftRef.current={text,contexts:nextContexts};persistChatDraft(text,nextContexts)
  }
  const refreshProviderWork=async(workId:string)=>{
    if(!mounted.current||workRef.current?.id!==workId)return false
    const fresh=await api<ExamReply>('open',{workId})
    if(!mounted.current||workRef.current?.id!==workId||!fresh.work)return false
    const decision=examRefreshDecision(draftOf(workRef.current),draftRef.current,draftOf(fresh.work))
    if(decision==='conflict'){
      setSaveLabel('Нужно выбрать версию записи')
      setError('Запись изменена в другой вкладке. Твой черновик остался на этом устройстве. Обнови состояние, чтобы увидеть обе версии и выбрать, какую продолжить.')
      return false
    }
    updateWork(fresh.work,decision==='adopt')
    return true
  }
  const dispatchQuestion=async(text:string,attached:ExamContext[],draftToClear?:{text:string;contexts:ExamContext[]})=>{
    if(chatSending.current)return
    const sourceWorkId=workRef.current?.id
    if(!sourceWorkId)return
    chatSending.current=true;setAssistantThinking(true);setProviderWorkId(sourceWorkId);setError('')
    const workId=sourceWorkId
    try{
      const body=await serial(async()=>{
        if(workRef.current?.id!==sourceWorkId)throw Error('Задача изменилась. Вопрос остался в её черновике; открой исходную задачу для отправки.')
        await save();const current=workRef.current
        if(current?.id!==sourceWorkId)throw Error('Задача изменилась. Вопрос остался в её черновике; открой исходную задачу для отправки.')
        return {workId:current.id,expectedRevision:current.revision,expectedModeEpoch:current.modeEpoch,requestId:requestId(),message:text,contexts:attached}
      })
      // External waiting does not own the draft queue. The server binds its
      // reply to the question snapshot, never to a later learner text.
      await api<ExamReply>('chat',body)
      await serial(async()=>{
        if(!mounted.current||workRef.current?.id!==body.workId)return
        await refreshProviderWork(body.workId)
        if(!mounted.current||workRef.current?.id!==body.workId)return
        if(draftToClear&&JSON.stringify(chatDraftRef.current)===JSON.stringify(draftToClear)){try{if(JSON.stringify(readExamChatDraft(learnerStorage,body.workId))===JSON.stringify(draftToClear))setChatDraft('',[])}catch{/* Keep an unconfirmed local question. */}}
      })
    }catch(cause){if(mounted.current&&(!workId||workRef.current?.id===workId))setError(cause instanceof Error?cause.message:'Не удалось подтвердить ответ. Обнови состояние перед новым вопросом.')}
    finally{chatSending.current=false;if(mounted.current){setAssistantThinking(false);setProviderWorkId(null)}}
  }
  const dispatchReview=async(attemptId:string,objectionTo?:{advisoryId:string;explanation:string})=>{
    if(chatSending.current)return
    const sourceWorkId=workRef.current?.id
    if(!sourceWorkId)return
    chatSending.current=true;setAssistantThinking(true);setProviderWorkId(sourceWorkId);setError('')
    try{
      const body=await serial(async()=>{
        if(workRef.current?.id!==sourceWorkId)throw Error('Задача изменилась. Выбери попытку для разбора ещё раз.')
        await save()
        const current=workRef.current
        if(current?.id!==sourceWorkId||current.attempts.at(-1)?.id!==attemptId)throw Error('Попытка изменилась. Выбери её для разбора ещё раз.')
        return {workId:sourceWorkId,attemptId,expectedRevision:current.revision,expectedModeEpoch:current.modeEpoch,requestId:requestId(),...(objectionTo??{})}
      })
      // Only the provider-backed objection leaves this queue. Deterministic
      // evaluation objections still use the ordinary atomic mutation.
      await api<ExamReply>(objectionTo?'object':'review',body)
      if(objectionTo&&mounted.current&&workRef.current?.id===sourceWorkId&&objectionTextRef.current===objectionTo.explanation)setObjection(current=>current?.advisoryId===objectionTo.advisoryId&&current.attemptId===attemptId?null:current)
      await serial(()=>refreshProviderWork(body.workId))
    }catch(cause){if(mounted.current&&workRef.current?.id===sourceWorkId)setError(cause instanceof Error?cause.message:'Не удалось подтвердить разбор. Обнови состояние перед новым запросом.')}
    finally{chatSending.current=false;if(mounted.current){setAssistantThinking(false);setProviderWorkId(null)}}
  }
  const enableHelp=async()=>{
    const currentPart=chatPart||(lastEditor.current?.isConnected?lastEditor.current.closest('[data-exam-part]')?.getAttribute('data-exam-part'):null)
    const attached=contexts.length?contexts:selection?[selection]:currentPart?[{partId:currentPart,quote:workRef.current?.instance.parts.find(part=>part.id===currentPart)?.prompt??workRef.current?.instance.parts.find(part=>part.id===currentPart)?.label??'Текущая часть'}]:[]
    await mutate('help');setHelpCollapsed(false)
    const current=workRef.current
    if(current&&(current.reasoning.trim()||Object.values(current.answersByPart).some(value=>value.trim())))void dispatchQuestion('Посмотри мою запись. Помоги разобраться именно в трудном переходе и предложи один следующий шаг или короткий вопрос. Не делай вывод о постоянном пробеле по одной попытке.',attached)
  }
  const captureSelection = (partId?:string) => {const text=window.getSelection()?.toString().trim();if(text&&text.length<=1200){quoteCapture.current++;setSelection({quote:text,partId:partId??(chatPart||undefined),origin:'excerpt'})}}
  const captureTextareaQuote=(field:HTMLTextAreaElement,origin:'answer'|'reasoning',partId?:string)=>{
    const snapshot=field.value,captured=captureExamQuote(snapshot,field.selectionStart,field.selectionEnd),workId=workRef.current?.id
    if(!captured||!workId)return
    const generation=++quoteCapture.current
    const stillCurrent=()=>mounted.current&&quoteCapture.current===generation&&workRef.current?.id===workId&&field.isConnected&&field.value===snapshot
    void examQuoteFieldDigest(snapshot).then(fieldDigest=>{if(stillCurrent())setSelection({quote:captured.quote,partId,origin,selection:{start:captured.start,end:captured.end,fieldDigest}})})
      .catch(()=>{if(stillCurrent())setSelection({quote:captured.quote,partId,origin:'excerpt'})})
  }
  const askSelection = () => {if(selection){setHelpCollapsed(false);setChatDraft(message,[...contexts,selection].slice(-6));setSelection(null);document.getElementById('exam-chat-input')?.focus()}}
  const sendQuestion=()=>{
    const current=workRef.current;if(!current||!message.trim()||chatSending.current)return
    const lessonContext=lesson&&current.learning?.open?{quote:`Открытый материал: ${lesson.title}.${current.learning.modelOpen?` Разбираю переход на схеме этой задачи.${modelState?.input.trim()?` Моя подстановка: ${modelState.input}.`:''}`:lesson.kind==='material'?` Статья версии ${lesson.material.version}.`:` Короткая проба: ${lesson.probe.prompt}${probeAnswer.trim()?` Мой ответ на пробу: ${probeAnswer}`:''}`} `.slice(0,4000)}:null
    const attached=contexts.length?contexts:lessonContext?[lessonContext]:chatPart?[{partId:chatPart,quote:current.instance.parts.find(part=>part.id===chatPart)?.prompt??current.instance.parts.find(part=>part.id===chatPart)?.label??'Условие'}]:[]
    void dispatchQuestion(message,attached,{text:message,contexts})
  }
  const sessionActive=session?.status==='active'
  useEffect(()=>{if(!sessionActive||!session)return;const tick=()=>{setRemaining(Math.max(0,Math.ceil((new Date(session.deadlineAt).getTime()-Date.now())/1000)))};tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer)},[sessionActive,session])
  useEffect(()=>{if(sessionActive&&session&&remaining===0&&!busy&&expiredRead.current!==session.id){expiredRead.current=session.id;run(async()=>{const data=await api<{session:ExamSession}>('session/state');updateSession(data.session)})}},[sessionActive,session,remaining,busy])
  const changeSessionPosition = (position:number) => run(async()=>{await save();const latest=await api<{session:ExamSession}>('session/state');const current=latest.session;if(current.status!=='active'){updateSession(current);return}const reply=await api<{session:ExamSession}>('session/navigate',{sessionId:current.id,expectedRevision:current.revision,expectedSessionEpoch:current.sessionEpoch,position});updateSession(reply.session);setView('session')})
  const submitSession = () => run(async()=>{if(remaining>0)await save();const latest=await api<{session:ExamSession}>('session/state');if(latest.session.status!=='active'){updateSession(latest.session);setConfirmSubmit(false);return}const current=latest.session;const reply=await api<{session:ExamSession}>('session/submit',{sessionId:current.id,expectedRevision:current.revision,expectedSessionEpoch:current.sessionEpoch,requestId:requestId(),workRevisions:current.tasks.map(task=>({workId:task.workId,revision:task.work.revision,modeEpoch:task.work.modeEpoch}))});updateSession(reply.session);setConfirmSubmit(false)})
  const endSessionUnverified=()=>run(async()=>{
    if(!session)return
    // Closing is available even when saving/checking needs more storage. The
    // confirmation names the last server copy; local recovery is kept intact.
    const reply=await api<{session:ExamSession}>('session/end-unverified',{sessionId:session.id,expectedRevision:session.revision,expectedSessionEpoch:session.sessionEpoch,requestId:requestId()})
    updateSession(reply.session);setConfirmCloseSession(false)
  })
  const families=state?.families??[], selectedFamily=families.find(item=>item.id===selected), currentFamily=families.find(item=>item.id===work?.familyId)
  const groups=[...new Set(families.map(item=>item.group))]
  const filtered=families.filter(item=>(group==='all'||item.group===group)&&(!query.trim()||`${item.title} ${item.scope} ${item.skills?.join(' ')??''}`.toLowerCase().includes(query.toLowerCase())))
  const recommendations=state?.route?.recommendations??[]
  const routeMemory=(state?.route?.learnerMemory??[]).filter(item=>recommendations.some(step=>step.familyId===item.familyId)).slice(0,3)
  const isWork=(view==='work'||view==='session'&&session?.tasks.some(task=>task.workId===work?.id))&&work
  const inSession=view==='session'&&!!session
  const inMixed=!!mixed&&mixed.tasks.some(task=>task.workId===work?.id)&&view==='work', mixedActive=inMixed&&mixed?.status==='active'
  const editable=!!work&&!work.completed&&work.mode!=='review'&&!!(currentFamily||inSession||inMixed)&&(!inSession||sessionActive&&remaining>0)
  const activeEvaluations=work?.evaluations.filter(item=>item.active&&item.attemptId===work.attempts.at(-1)?.id)??[]
  const latestAttempt=work?.attempts.at(-1)
  const emptyBeforeHelp=latestAttempt?.reason==='before-help'&&!latestAttempt.reasoning?.trim()&&!Object.values(latestAttempt.answersByPart??{}).some(answer=>answer.trim())
    &&activeEvaluations.every(item=>item.status==='unknown'&&item.summary==='Ответ не указан.')
    &&!work?.evaluations.some(item=>item.attemptId===latestAttempt.id&&item.objections?.length)
    &&!work?.advisories?.some(item=>item.attemptId===latestAttempt.id)
  const ReviewContainer=emptyBeforeHelp?'details':'section'
  useEffect(()=>{if(!objection&&!confirmSubmit&&!confirmCloseSession)return;const previous=document.activeElement as HTMLElement|null;const trap=(event:KeyboardEvent)=>{if(event.key!=='Tab')return;const dialog=document.querySelector<HTMLElement>('.exam-dialog');const controls=dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),[tabindex="0"]');if(!controls?.length)return;const first=controls[0],last=controls[controls.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}};document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);previous?.focus()}},[objection,confirmSubmit,confirmCloseSession])
  const quoteSaved=quoteSource?.source
  useEffect(()=>{
    setQuoteLocation(null)
    if(lesson||!work||!quoteSource||!quoteSaved||quoteSaved.workId!==work.id||!(quoteSaved.field==='reasoning'||quoteSaved.field==='answer'&&work.instance.parts.some(part=>part.id===quoteSaved.partId&&part.kind==='text')))return
    const snapshot=quoteSaved.field==='answer'?draft.answersByPart[quoteSaved.partId??'']??'':draft.reasoning
    let cancelled=false
    void locateExamQuote(snapshot,quoteSource.quote,quoteSaved).then(range=>{if(!cancelled&&range)setQuoteLocation({context:quoteSource,workId:work.id,snapshot,...range})}).catch(()=>{/* A source stays readable without navigation. */})
    return()=>{cancelled=true}
  },[quoteSource,quoteSaved,lesson,work?.id,draft])
  const canLocateQuote=Boolean(quoteLocation&&quoteLocation.context===quoteSource&&work&&quoteSaved&&quoteLocation.workId===work.id&&quoteLocation.snapshot===(quoteSaved.field==='answer'?draft.answersByPart[quoteSaved.partId??'']??'':draft.reasoning))
  const pageSize=8, visibleRecent=recent.slice(recentPage*pageSize,(recentPage+1)*pageSize)
  const chooseFamily=(family:ExamFamily)=><div className="exam-family-detail"><span className="exam-eyebrow">{family.group}</span><h2>{family.title}</h2><p>{family.scope}</p>{!!family.exclusions?.length&&<details><summary>Границы этой темы</summary><ul>{family.exclusions.map(item=><li key={item}>{item}</li>)}</ul></details>}{!!family.prerequisites?.length&&<div className="exam-prerequisites"><h3>Что поможет перед началом</h3>{family.prerequisites.map(item=><button type="button" key={item.familyId} disabled={busy} onClick={()=>setSelected(item.familyId)}><BookOpen size={14}/>{families.find(f=>f.id===item.familyId)?.title??item.title??'Предыдущая тема'}<small>{item.role==='hard'?'Нужно знать':item.role==='method'?'Приём решения':'Полезно повторить'}</small></button>)}</div>}<div className="exam-actions"><button type="button" className="exam-primary" disabled={busy||sessionActive} onClick={()=>start(family.id,'guided',view==='materials')}>{view==='materials'?'Объяснение и короткая проба':'Начать с помощью'}<ArrowRight size={16}/></button><button type="button" disabled={busy||sessionActive} onClick={()=>start(family.id,'solo')}>Попробовать самому</button></div><p className="exam-muted">С помощью — объяснения и вопрос наставнику рядом. Самостоятельно — сначала твоя попытка, помощь можно открыть позже.</p></div>
  const showLearningEntry=!!work&&!lesson&&work.mode==='guided'&&!work.completed&&!work.attempts.length&&!work.messages.length&&!draft.reasoning.trim()&&!Object.values(draft.answersByPart).some(value=>value.trim())
  const helpPanel=work&&!inSession?<aside className={`exam-help ${helpCollapsed?'is-collapsed':''}`}><GlassSurface className="exam-help-header"><MessageCircle size={18}/><div><h2>Разберём вместе</h2>{assistantThinking&&<p role="status">{providerWorkId===work.id?'Наставник смотрит твою запись…':'Наставник ещё отвечает в другой задаче…'}</p>}<span>{work.mode==='solo'&&!work.completed?'Откроется, если попросишь помощь':'Можно спросить про любой шаг'}</span></div><button type="button" className="exam-help-toggle" aria-expanded={!helpCollapsed} aria-controls="exam-help-body" onClick={()=>setHelpCollapsed(value=>!value)} aria-label={helpCollapsed?'Открыть помощь':'Свернуть помощь'}>{helpCollapsed?<MessageCircle size={16}/>:<ChevronRight size={16}/>}</button></GlassSurface><div id="exam-help-body" hidden={helpCollapsed}>{work.mode==='guided'||work.mode==='review'||work.completed?<>{!lesson&&!showLearningEntry&&<button type="button" className="exam-material-link" disabled={busy||work.completed||!currentFamily} onClick={()=>lesson?closeLesson():openLesson()}><BookOpen size={18}/><span>{lesson?'Вернуться в моё решение':'Объяснение и короткая проба'}<small>{lesson?'Продолжим с того же шага':'Вернёшься в своё решение'}</small></span><ArrowRight size={16}/></button>}{!lesson&&work.instance.stepModelAvailable&&<button type="button" className="exam-material-link" disabled={busy||work.completed} onClick={()=>openModel()}><BookOpen size={18}/><span>Разобрать переход на схеме<small>На числах этой задачи</small></span><ArrowRight size={16}/></button>}<div className="exam-messages" aria-live="polite">{showLearningEntry&&<ExamLearningEntry disabled={busy||!currentFamily} onWrite={()=>{setHelpCollapsed(true);requestAnimationFrame(()=>reasoningRef.current?.focus())}} onWhy={()=>openLesson(undefined,undefined,false,'why')} onStart={()=>openLesson(undefined,undefined,false,'start')}/>}{!work.messages.length&&!showLearningEntry&&<div className="exam-chat-welcome"><span>Привет!</span><p>Покажи, где застрял. Можно выделить фрагмент условия или своей записи и прикрепить его к вопросу.</p><small>Если наставник недоступен, объяснение и короткая проба всё равно работают.</small></div>}{work.messages.filter(item=>item.source!=='availability').map(item=><div className={`exam-chat-message is-${item.role}`} key={item.id}><span className="exam-message-author">{item.role==='user'?'Ты':'Наставник'}</span><div>{!!item.contexts?.length&&<div className="exam-quotes">{item.contexts.map((context,index)=><QuoteChip key={index} context={context} index={index} onOpen={()=>setQuoteSource(context)}/>)}</div>}{item.role==='assistant'&&item.contextStatus==='previous'&&<p className="exam-message-context">К прежней записи</p>}<MathContent text={item.text} renderAnnotation={index=>{const source=examMessageContexts<typeof item,ExamContext>(work.messages,item.id)[index-1];return source?<QuoteChip context={source} index={index-1} onOpen={()=>setQuoteSource(source)}/>:null}}/>{item.role==='user'&&item.status&&['pending','failed','stale'].includes(item.status)&&<div className={`exam-message-status is-${item.status}`} role="status"><p>{(item.error==='storage'?'Не удалось сохранить ответ наставника: хранилище заполнено. Вопрос и твоя запись сохранены. Можно скачать профиль перед новым запросом.':item.error)??(item.status==='pending'?'Ответ ещё не подтверждён. Сначала обнови состояние.':item.status==='stale'?'Ответ не применён: запись или режим изменились. Текущая работа сохранена.':'Наставник не ответил на этот вопрос. Автоматического повтора не было.')}</p>{item.status==='pending'?<button type="button" className="exam-text" disabled={busy} onClick={()=>run(reload)}>Обновить состояние</button>:<button type="button" className="exam-text" disabled={busy||!currentFamily} onClick={()=>{setChatDraft(item.text,item.contexts??[]);document.getElementById('exam-chat-input')?.focus()}}>Подготовить новый вопрос</button>}</div>}{item.suggestions?.map(suggestion=><button type="button" key={suggestion.materialId??suggestion.familyId} className="exam-chat-suggestion" disabled={busy} onClick={()=>openLesson(suggestion.familyId,suggestion.materialId)}><BookOpen size={14}/><span>{suggestion.title}<small>{suggestion.reason}</small></span><ArrowRight size={14}/></button>)}</div></div>)}</div>{selection&&<button type="button" className="exam-attach-selection" onClick={askSelection}><Paperclip size={14}/>Спросить об этом фрагменте</button>}<form className="exam-chat-form" onSubmit={event=>{event.preventDefault();sendQuestion()}}>{lesson&&<p className="exam-lesson-chat-context">{lesson.kind==='material'?'Можно спросить про любой фрагмент этой статьи.':'Наставник видит материал и твой ответ на пробу.'}</p>}<div className="exam-quotes">{contexts.map((context,index)=><QuoteChip context={context} index={index} key={index} onOpen={()=>setQuoteSource(context)} onRemove={()=>setChatDraft(message,contexts.filter((_,i)=>i!==index))}/>)}</div>{!lesson&&work.instance.parts.length>1&&<label className="exam-chat-part">Про какую часть?<select value={chatPart} onChange={event=>setChatPart(event.target.value)}>{work.instance.parts.map(part=><option key={part.id} value={part.id}>{part.label}</option>)}</select></label>}<label htmlFor="exam-chat-input" className="sr-only">Вопрос наставнику</label><textarea id="exam-chat-input" value={message} onChange={event=>{setChatDraft(event.target.value,contexts)}} placeholder={lesson?.kind==='material'?'Что непонятно в статье?':lesson?'Что непонятно в объяснении или пробе?':'Что непонятно на этом шаге?'} maxLength={4000} disabled={busy||!currentFamily}/><button type="submit" className="exam-chat-send" disabled={busy||assistantThinking||!currentFamily||!message.trim()} aria-label="Отправить вопрос">{assistantThinking?<LoaderCircle size={17} className="is-spinning"/>:<Send size={17}/>}</button></form></>:<div className="exam-solo-help"><p>Сначала попробуй свой способ. Если не получается — можно сохранить самостоятельную попытку и перейти к разбору.</p><button type="button" disabled={busy||(!currentFamily&&!inMixed)} onClick={()=>run(enableHelp)}>Открыть помощь<ArrowRight size={15}/></button><small>Переход к помощи будет отмечен в результате.</small></div>}</div></aside>:null
  return <section className="exam-trainer" aria-label="Математика — учёба и практика">
    <header className="exam-top"><BrandWordmark compact/><button type="button" className="exam-back" disabled={busy} onClick={()=>run(async()=>{await save();onExit()})}><ArrowLeft size={16}/>Прежние занятия</button><span>Математика · профиль</span><span className="exam-top-save" role="status">{saveLabel}</span></header>
    <GlassSurface className="exam-navigation" material="frost"><span className="exam-nav-brand"><BrandWordmark/></span><nav aria-label="Разделы тренажёра">{([['home','Заниматься'],['catalog','Задачи'],['materials','Материалы'],['route','Мой маршрут'],['history','Мои решения']] as const).map(([key,label])=><button type="button" key={key} aria-current={view===key?'page':undefined} onClick={()=>navigate(key)} disabled={busy}>{label}</button>)}</nav><button type="button" className="exam-session-link" disabled={busy} onClick={()=>navigate('session')}><Clock3 size={15}/>{sessionActive?'Продолжить вариант':'Вариант ЕГЭ'}</button><ExamProfile beforeAction={()=>serial(save)} onRestored={reload} onCleared={()=>reload(true)} disabled={busy||!!sessionActive}/></GlassSurface>
    {routeNotice&&<div className="exam-route-notice" role="status"><p>{routeNotice}</p><button type="button" className="exam-text" onClick={()=>setRouteNotice('')}>Понятно</button></div>}
    {error&&<div className="exam-error" role="alert"><p>{error}</p><p>Если ответ сервера потерялся, сначала обнови состояние. Повторно сдавать работу не нужно.</p><button type="button" disabled={busy} onClick={()=>run(reload)}>Обновить состояние</button><button type="button" aria-label="Закрыть сообщение" onClick={()=>setError('')}><X size={15}/></button></div>}
    {!state ? <div className="exam-loading" role="status">{busy?<><LoaderCircle size={20} className="is-spinning"/>Открываем твои занятия…</>:<p>Занятия пока не загрузились. Можно обновить состояние выше.</p>}</div> : <>
      {sessionActive&&view!=='session'&&<div className="exam-session-notice"><Clock3 size={16}/><span>Вариант идёт. До его сдачи помощь и другие задачи недоступны.</span><button type="button" disabled={busy} onClick={()=>{updateSession(session);setView('session')}}>Вернуться</button></div>}
      {view==='home'&&<div className="exam-home"><article className="exam-hero"><div><h1>{work&&!work.completed?'Продолжим с того же места?':'Профильная математика'}</h1>{work&&!work.completed&&<div className="exam-continuation"><span>{families.find(family=>family.id===work.familyId)?.title??'Сохранённая задача'}</span><MathContent text={work.instance.prompt}/>{draft.reasoning.trim()&&<p className="exam-continuation-note">{draft.reasoning.trim().split('\n').slice(-2).join('\n').slice(-240)}</p>}</div>}<p>{work&&!work.completed?'Твоё решение сохранено. Можно продолжить задачу или выбрать новую тему.':'Выбери знакомую тему или начни с короткого объяснения. Сложные места можно разобрать по одному.'}</p><button type="button" className="exam-primary" disabled={busy} onClick={()=>sessionActive&&session?(updateSession(session),setView('session')):mixed&&mixed.status!=='completed'&&mixed.tasks.some(task=>task.workId===work?.id)?resumeMixed():work&&!work.completed?openWork(work.id):navigate('catalog')}>{work&&!work.completed?'Продолжить решение':'Выбрать тему'}<ArrowRight size={17}/></button></div><HomeGeometry/></article><div className="exam-home-bottom"><section><h2>Ближайший шаг</h2>{recommendations.length?recommendations.slice(0,3).map((item,index)=><button className="exam-route-row" type="button" key={item.familyId} disabled={busy||sessionActive} onClick={()=>followRecommendation(item)}><span><strong>{item.title}</strong>{(index===0||item.reason!==recommendations[0]?.reason)&&<small>{item.reason}</small>}</span><ChevronRight size={17}/></button>):<p className="exam-muted">Начни с любой темы. После попыток здесь появятся предложения, что повторить.</p>}<button type="button" className="exam-text" disabled={busy} onClick={()=>navigate('route')}>Посмотреть маршрут <ArrowRight size={14}/></button></section><section className="exam-beginner"><span className="exam-small-symbol">?</span><h2>Пока не знаю, с чего начать</h2><p>Можно начать с процентов: разберём, что считать за целое, и попробуем на небольшой задаче.</p><button type="button" className="exam-text" onClick={()=>start('number.percent','guided',true,'discount')} disabled={busy||sessionActive}>Начать с процентов <ArrowRight size={14}/></button></section></div><section className="exam-mixed-home"><div><h2>Вперемешку · 3 задачи</h2><p>Попробуй сам выбрать способ. Тема станет видна после попытки или просьбы о помощи. Таймера нет, можно остановиться и вернуться.</p></div><button type="button" disabled={busy||sessionActive} onClick={mixed&&mixed.status!=='completed'?resumeMixed:startMixed}>{mixed&&mixed.status!=='completed'?'Продолжить подборку':'Начать три задачи'}<ArrowRight size={15}/></button></section>{selectedFamily&&chooseFamily(selectedFamily)}</div>}
      {(view==='catalog'||view==='materials')&&<div className="exam-catalog"><div className="exam-section-heading"><span className="exam-eyebrow">{view==='materials'?'Объяснения и короткие пробы':'Практика по темам'}</span><h1>{view==='materials'?'Понять нужный шаг':'Что разберём сегодня?'}</h1><p>Здесь собраны конкретные типы задач. Описание каждой темы показывает, что именно можно потренировать.</p></div><div className="exam-filters"><label className="exam-search"><Search size={17}/><span className="sr-only">Найти тему или материал</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название, приём, трудный шаг…" type="search"/></label><label><span className="sr-only">Группа тем</span><select value={group} onChange={e=>setGroup(e.target.value)}><option value="all">Все разделы</option>{groups.map(name=><option key={name}>{name}</option>)}</select></label><label><span className="sr-only">Редакция экзамена</span><select value={edition} onChange={e=>setEdition(e.target.value)}><option value="2026">ЕГЭ 2026 · итоговая</option><option value="2027">ЕГЭ 2027 · проект</option></select></label></div>{edition==='2027'&&<p className="exam-edition-note">Проект 2027: нумерация и состав могут измениться.</p>}<div className="exam-catalog-layout"><div className="exam-family-list">{group==='all'&&!query.trim()?<div className="exam-group-list">{groups.map(name=><button type="button" key={name} onClick={()=>{setGroup(name);setSelected(null)}}><span><strong>{name}</strong><small>{families.filter(item=>item.group===name).length} {(() => {const count=families.filter(item=>item.group===name).length;return count%100>=11&&count%100<=14?'тем':count%10===1?'тема':count%10>=2&&count%10<=4?'темы':'тем'})()}</small></span><ChevronRight size={17}/></button>)}</div>:groups.filter(name=>filtered.some(item=>item.group===name)).map(name=><section key={name}><h2>{name}</h2>{filtered.filter(item=>item.group===name).map(family=><button type="button" className={`exam-family-row ${selected===family.id?'is-selected':''}`} aria-expanded={selected===family.id} key={family.id} onClick={()=>setSelected(family.id)}><span className="exam-family-number">{family.alignments?.[edition]?.length?`№${family.alignments[edition].join(', ')}`:<BookOpen size={18}/>}</span><span><strong>{family.title}</strong></span><ChevronRight size={17}/></button>)}</section>)}{!filtered.length&&<p className="exam-muted">Таких тем пока нет. Попробуй другое слово или раздел.</p>}</div><aside className="exam-family-aside">{selectedFamily?chooseFamily(selectedFamily):<div className="exam-empty-detail"><BookOpen size={25}/><h2>{view==='materials'?'Материал рядом с практикой':'Выбери одну тему'}</h2><p>Открой описание, проверь, что стоит повторить, и выбери: с объяснением или самостоятельно.</p></div>}</aside></div></div>}
      {view==='route'&&<div className="exam-route"><div className="exam-section-heading"><span className="exam-eyebrow">По твоим попыткам</span><h1>Следующий понятный шаг</h1><p>Это предложения по доступным темам. Одна верная попытка ещё не означает, что вся тема освоена.</p></div>{recommendations.length?recommendations.map((item,index)=><button type="button" className="exam-route-row" key={item.familyId} disabled={busy||sessionActive} onClick={()=>followRecommendation(item)}><span className="exam-step">{index+1}</span><span><strong>{item.title}</strong><small>{item.reason}{item.goal==='transfer'?' · три задачи вперемешку':''}</small></span><ArrowRight size={17}/></button>):<p className="exam-muted">Пока мало данных для маршрута. Выбери тему, попробуй решить и сдай свою первую попытку.</p>}{selectedFamily&&chooseFamily(selectedFamily)}{routeMemory.length>0?<details className="exam-observations exam-route-memory"><summary>На чём основан маршрут</summary>{routeMemory.map(item=><article key={item.familyId}><h2>{families.find(family=>family.id===item.familyId)?.title??'Сохранённая тема'}</h2><p>{item.interpretation}</p><small>Последняя попытка: {dateText(item.lastObservedAt)} · разных работ: {item.distinctWorkCount}</small>{item.supportHypothesis&&<p>Стоит проверить: {item.supportHypothesis.summary} Это предположение по попыткам, а не установленный пробел.</p>}<div className="exam-memory-evidence">{item.recentEvidence.slice(0,3).map(event=><button type="button" className="exam-text" key={event.id} disabled={busy||sessionActive} onClick={()=>openWork(event.workId)}>{dateText(event.createdAt)} · {event.independent?'самостоятельно':'с помощью'} · {event.status==='correct'?'ответы совпали':event.status==='incorrect'?'есть расхождение':'часть не проверена'}</button>)}</div></article>)}</details>:!!state.route?.observations?.length&&<details className="exam-observations"><summary>На чём основаны предложения</summary>{state.route.observations.map((item,index)=><p key={index}><strong>{families.find(f=>f.id===item.familyId)?.title??'Попытка'}</strong> · {item.independent?'самостоятельно':'с помощью'}<br/>{item.summary}</p>)}</details>}<button type="button" className="exam-text" onClick={()=>navigate('catalog')}>Выбрать другую тему <ArrowRight size={14}/></button></div>}
      {view==='history'&&<div className="exam-history"><div className="exam-section-heading"><h1>Твои решения</h1><p>Черновики, сданные попытки и исправления. Открой работу, чтобы вернуться к её ходу.</p></div>{visibleRecent.map(item=><button type="button" className="exam-history-row" key={item.id} disabled={busy||sessionActive} onClick={()=>openWork(item.id)}><span><strong>{item.title??families.find(f=>f.id===item.familyId)?.title??'Сохранённая задача'}</strong><small>{item.completed?'Завершена':'Можно продолжить'}{item.mode==='guided'?' · с помощью':item.mode==='solo'?' · самостоятельно':''}</small></span><time>{dateText(item.updatedAt)}</time><ChevronRight size={17}/></button>)}{!recent.length&&<p className="exam-muted">Здесь будут твои решения — начиная с первой открытой задачи.</p>}<div className="exam-pagination"><button type="button" disabled={busy||recentPage===0} onClick={()=>setRecentPage(n=>n-1)}><ChevronLeft size={16}/>Назад</button><span>Страница {recentPage+1}</span><button type="button" disabled={busy||((recentPage+1)*pageSize>=recent.length&&!moreHistory)} onClick={()=>run(async()=>{if((recentPage+2)*pageSize>recent.length&&moreHistory){if(historyCursor===null){setMoreHistory(false);return}const reply=await api<ExamReply>('history',{before:historyCursor});const added=(reply.works??[]).filter(item=>!recent.some(old=>old.id===item.id));setRecent(current=>[...current,...added]);setHistoryCursor(reply.nextCursor??null);setMoreHistory(reply.nextCursor!=null);if(!added.length&&(recentPage+1)*pageSize>=recent.length)return}setRecentPage(n=>n+1)})}>Следующие <ChevronRight size={16}/></button></div></div>}
      {view==='session'&&!sessionActive&&(!session||session.status==='active')&&<div className="exam-session-intro"><span className="exam-eyebrow">Полный вариант</span><h1>Попробуй как на экзамене</h1><p>Авторский тренировочный вариант по структуре ЕГЭ. 235 минут, свободный переход между задачами, одна общая сдача. Можно оставить пропуски. Ответы сохраняются, время идёт и после закрытия страницы.</p><p>Во время варианта объяснения и чат закрыты. Автоматическая проверка подтверждает только те ответы, которые умеет проверить; доказательства остаются на проверку.</p><div className="exam-editions">{editions.map(item=><article key={item.id}><h2>{item.label}</h2><p>{item.taskCount} задач · {item.durationMinutes} минут</p>{item.status==='draft'&&<small>Проект. Состав может измениться.</small>}<button type="button" className="exam-primary" disabled={busy} onClick={()=>run(async()=>{await save();const reply=await api<{session:ExamSession}>('session/start',{edition:item.id,requestId:requestId()});updateSession(reply.session)})}>Начать вариант<ArrowRight size={16}/></button></article>)}</div></div>}
      {view==='session'&&session&&session.status!=='active'&&<div className="exam-session-result"><ExamSessionSummary session={session}/><ExamResultNavigation tasks={session.tasks} selectedWorkId={work?.id} onSelect={selected=>run(async()=>{await save();updateWork(selected,true)})} mode="exam"/><button type="button" className="exam-primary" disabled={busy} onClick={()=>{setSession(null);setView('session')}}>Новый тренировочный вариант<ArrowRight size={15}/></button><button type="button" className="exam-text" disabled={busy} onClick={()=>{setSession(null);setView('catalog')}}>Выбрать тему для разбора <ArrowRight size={15}/></button></div>}
      {isWork&&<Suspense fallback={<div className="exam-loading" role="status">Открываем лист решения…</div>}>
        {inMixed&&mixed&&<section className="exam-mixed-banner" aria-label="Три задачи вперемешку"><div><span className="exam-eyebrow">Вперемешку · без таймера</span><h2>{mixed.status==='active'?`Задача ${mixed.currentIndex+1} из ${mixed.tasks.length}`:'Подборка завершена'}</h2><p>{mixed.status==='active'?'Сначала твоя попытка. Помощь можно открыть — это будет отмечено.':`Обработано ${mixed.completedCount} из ${mixed.tasks.length} задач. Подтверждены отдельные ответы, не освоение тем.`}</p></div>{mixed.status==='active'?<div className="exam-actions">{work.attempts.length>0&&<button type="button" className="exam-primary" disabled={busy} onClick={()=>advanceMixed('next')}>{mixed.currentIndex+1===mixed.tasks.length?'Завершить подборку':'Следующая задача'}<ArrowRight size={15}/></button>}{!work.attempts.length&&<button type="button" disabled={busy} onClick={()=>advanceMixed('skip')}>Оставить пропуск</button>}<button type="button" disabled={busy} onClick={()=>advanceMixed('finish')}>Закончить подборку сейчас</button></div>:<><ExamResultNavigation tasks={mixed.tasks} selectedWorkId={work?.id} onSelect={selected=>run(async()=>{await save();updateWork(selected,true)})} mode="mixed"/><button type="button" disabled={busy||sessionActive} onClick={startMixed}>Новая подборка</button></>}</section>}
        {!currentFamily&&!inSession&&!inMixed&&<p className="exam-recovery">Эта сохранённая версия доступна для чтения. Её можно скачать и выбрать опубликованную тему для нового занятия.</p>}
        {inSession&&session?.submissionError&&<div className="exam-error" role="alert"><p>{session.submissionError}</p><p>Время закончилось. Твои записи сохранены, повторная сдача возможна только по кнопке.</p><button type="button" disabled={busy} onClick={()=>setConfirmSubmit(true)}>Повторить общую сдачу</button><button type="button" disabled={busy} onClick={()=>setConfirmCloseSession(true)}>Завершить без проверки</button></div>}
        {inSession&&sessionActive&&<div className="exam-session-bar"><div><span className="exam-eyebrow">ЕГЭ {session.edition}{session.editionStatus==='draft'?' · проект':''}</span><strong><Clock3 size={17}/><span role="timer" aria-label="Оставшееся время">{Math.floor(remaining/3600)}:{String(Math.floor(remaining%3600/60)).padStart(2,'0')}:{String(remaining%60).padStart(2,'0')}</span></strong></div><p>Можно решать в любом порядке и оставлять пропуски.</p><button type="button" disabled={busy} onClick={()=>setConfirmSubmit(true)}>Сдать весь вариант</button><button type="button" className="exam-text" disabled={busy} onClick={()=>setConfirmCloseSession(true)}>Закончить без проверки</button><details className="exam-coverage"><summary>О составе варианта</summary><p>Это авторские тренировочные задачи по структуре экзамена.</p>{session.coverageWarnings?.map(warning=><p key={warning}>{warning}</p>)}</details><div className="exam-task-nav" aria-label="Задачи варианта">{session.tasks.map(task=><button type="button" key={task.position} className={Object.values(task.workId===work.id?draft.answersByPart:task.work.answersByPart).some(value=>value.trim())?'has-answer':''} aria-current={work.id===task.workId?'step':undefined} disabled={busy} onClick={()=>changeSessionPosition(task.position)} aria-label={`Задача ${task.position}${Object.values(task.work.answersByPart).some(value=>value.trim())?', есть ответ':', без ответа'}`}>{task.position}</button>)}</div></div>}
        {recover&&<div className="exam-recovery"><p>На этом устройстве остался другой черновик. Можно вернуть его перед продолжением.</p><button type="button" disabled={busy||!editable} onClick={()=>{edit(recover);setRecover(null)}}>Вернуть черновик</button><button type="button" onClick={()=>downloadExamFile(`черновик-${work.id}.json`,{format:'mathmaxing-local-draft',workId:work.id,instance:work.instance,...recover})}>Скачать черновик с устройства</button><button type="button" onClick={()=>{setRecover(null);try{learnerStorage.removeItem(`exam.draft.${work.id}`)}catch{/* optional */}}}>Оставить сохранённую версию</button></div>}
        {lesson&&work.learning?.open&&!inSession?<div className="exam-work-layout is-learning"><article className="exam-lesson" onMouseUp={()=>captureSelection()} onKeyUp={()=>captureSelection()}><button type="button" className="exam-back" onClick={closeLesson} disabled={busy}><ArrowLeft size={16}/>В моё решение — на тот же шаг</button>{!work.learning.modelOpen&&<span className="exam-eyebrow">Разобрать один шаг</span>}<h1 ref={lessonTitleRef} tabIndex={-1}>{lesson.title}</h1>{lessonTrail.length>0&&<button type="button" className="exam-text" disabled={busy} onClick={()=>{const previous=lessonTrail.at(-1);if(previous)openLesson(previous.familyId,previous.materialId,true)}}><ArrowLeft size={14}/>К предыдущему объяснению</button>}{work.learning.modelOpen&&lesson.kind!=='material'&&lesson.interaction&&modelState?<><p className="step-model-status" role="status">{modelSaveLabel}</p>{modelRecovery&&<div className="step-model-recovery"><p>На этом устройстве есть другой ввод для этого разбора. Серверная версия не изменена.</p><button type="button" onClick={()=>{changeModel(modelRecovery);recoverModel(null)}}>Вернуть мой ввод</button><button type="button" onClick={()=>{recoverModel(null);try{clearModelDraft(learnerStorage,work.id)}catch{/* Optional */}}}>Оставить сохранённый</button></div>}{modelExitWorkId===work.id&&<div className="step-model-recovery" role="alert"><p>Разбор пока не синхронизирован. Можно повторить возврат или оставить ввод только на этом устройстве.</p><button type="button" disabled={busy} onClick={()=>leaveLesson('local')}>Вернуться с локальным черновиком</button>{modelExitUnsafe&&<><p>На устройстве тоже не удалось подтвердить сохранение. Скопируй или скачай ввод перед выходом.</p><button type="button" disabled={busy} onClick={()=>{const local=modelDraftRef.current;if(local)downloadExamFile('mathmaxing-model-'+work.id+'.json',{version:1,workId:work.id,descriptorDigest:local.descriptorDigest,state:modelRecoveryRef.current??local.state})}}>Скачать ввод</button><button type="button" disabled={busy} onClick={()=>leaveLesson('unsynced')}>Вернуться без сохранения разбора</button></>}</div>}<ExamStepModel descriptor={lesson.interaction} state={modelState} result={JSON.stringify(work.learningModel?.checkedState)===JSON.stringify(modelState)?work.learningModel?.result:undefined} source={work.learningModel?.source} disabled={busy||!!modelRecovery} onChange={changeModel} onCheck={()=>run(()=>persistModel(true),true)} onReturn={closeLesson} onNext={()=>run(async()=>{await mutate('next',{sameTemplate:true})})}/></>:lesson.kind==='material'?<><ExamMaterialArticle lesson={lesson} disabled={busy} onNavigate={id=>openLesson(lesson.familyId,id)}/><button type="button" className="exam-text" disabled={busy} onClick={()=>openLesson(lesson.familyId)}>К объяснению темы и короткой пробе</button></>:<><MathContent text={lesson.meaning}/><details open><summary>Как записать</summary><MathContent text={lesson.notation}/></details><details ref={whyDetailsRef}><summary>Когда это работает и почему</summary><MathContent text={`${lesson.conditions}\n\n${lesson.why}`}/></details><details><summary>Пример</summary><MathContent text={lesson.example.prompt}/><MathContent text={lesson.example.solution}/></details>{!!lesson.pitfalls?.length&&<details><summary>Где легко ошибиться</summary>{lesson.pitfalls.map(item=><MathContent key={item} text={item}/>)}</details>}{!!lesson.prerequisites?.length&&<div className="exam-prerequisites"><h2>Если пока не хватает основы</h2>{lesson.prerequisites.map(item=><button type="button" disabled={busy} onClick={()=>openLesson(item.familyId)} key={item.familyId}><BookOpen size={14}/>{item.title}<ArrowRight size={14}/></button>)}</div>}{lesson.links?.some(id=>families.some(family=>family.id===id)&&!lesson.prerequisites?.some(item=>item.familyId===id))&&<div className="exam-prerequisites"><h2>Ещё по этому шагу</h2>{lesson.links.filter(id=>families.some(family=>family.id===id)&&!lesson.prerequisites?.some(item=>item.familyId===id)).map(id=><button type="button" key={id} disabled={busy} onClick={()=>openLesson(id)}><BookOpen size={14}/>{families.find(family=>family.id===id)?.title}<ArrowRight size={14}/></button>)}</div>}{!!lesson.materials?.length&&<nav className="exam-prerequisites" aria-label="Понятия и рисунки"><h2>Понятия и рисунки</h2>{lesson.materials.map(item=><button key={item.id} type="button" disabled={busy} onClick={()=>openLesson(lesson.familyId,item.id)}><BookOpen size={14}/>{item.title}<ArrowRight size={14}/></button>)}</nav>}<form className="exam-probe" onSubmit={event=>{event.preventDefault();run(async()=>{await mutate('learn',{action:'probe',answer:probeAnswer})})}}><span className="exam-eyebrow">Одна короткая проба</span><MathContent text={lesson.probe.prompt}/><ExamProbeInput probe={lesson.probe} value={probeAnswer} onChange={value=>{setProbeAnswer(value);if(value.length<=4000){probeDrafts.current.set(lesson.familyId,value);try{writeProbeDrafts(learnerStorage,work.id,probeDrafts.current)}catch{setSaveLabel('Ответ на пробу пока только на открытой странице')}}}} disabled={busy}/><button className="exam-primary" disabled={busy||!probeAnswer.trim()} type="submit">Проверить шаг<Check size={15}/></button>{work.learning.probeResult&&work.learning.probeResult.answer===probeAnswer&&<div className={`exam-feedback is-${work.learning.probeResult.status}`} role="status"><strong>{work.learning.probeResult.status==='correct'?'Получилось':work.learning.probeResult.status==='incorrect'?'Этот шаг стоит повторить':'Пока не удалось проверить'}</strong><MathContent text={work.learning.probeResult.summary??''}/>{work.learning.probeResult.explanation&&work.learning.probeResult.explanation!==work.learning.probeResult.summary&&<MathContent text={work.learning.probeResult.explanation}/>}</div>}</form></>}{!work.learning.modelOpen&&<button type="button" className="exam-primary" disabled={busy} onClick={closeLesson}>Продолжить мою задачу<ArrowRight size={16}/></button>}</article>{helpPanel}</div>:<div className={`exam-work-layout ${inSession?'is-exam':''}`}><article className="exam-paper" onKeyDown={event=>{
            if(!(event.target instanceof HTMLTextAreaElement)||!(event.ctrlKey||event.metaKey)||event.altKey)return
            const key=event.key.toLowerCase(),back=key==='z'&&!event.shiftKey,forward=key==='y'||key==='z'&&event.shiftKey
            if(!back&&!forward)return
            event.preventDefault()
            if(editable&&!busy&&(back?historyPosition.current>0:historyPosition.current<history.current.length-1))moveHistory(back?-1:1)
          }} onFocusCapture={event=>{const target=event.target as HTMLElement;if(['INPUT','TEXTAREA','MATH-FIELD'].includes(target.tagName)){lastEditor.current=target;const partId=target.closest('[data-exam-part]')?.getAttribute('data-exam-part');if(partId)setChatPart(partId)}}}><div className="exam-work-heading"><span className="exam-eyebrow">{inSession?`Задача ${session?.tasks.find(task=>task.workId===work.id)?.position??''}`:currentFamily?.alignments[edition]?.length?`ЕГЭ · ${currentFamily.alignments[edition].length===1?'задание':'задания'} ${currentFamily.alignments[edition].join(', ')}`:currentFamily?.group??'Твоя задача'}</span><button className="exam-download-work" type="button" onClick={()=>downloadExamFile(`моя-задача-${work.id}.json`,{format:'mathmaxing-work-snapshot',version:1,savedAt:new Date().toISOString(),instance:work.instance,answersByPart:draft.answersByPart,reasoning:draft.reasoning,attempts:work.attempts,evaluations:work.evaluations,advisories:work.advisories??[]})}><span>Скачать запись</span></button><span className="exam-mode">{work.completed?'Завершено':inSession?'Самостоятельно':work.mode==='review'?'Разбор попытки':work.mode==='solo'?'Без подсказок':'С помощью'}</span></div><h1>{inSession?'Условие задачи':work.instance.title===work.instance.prompt?currentFamily?.title??'Задача':work.instance.title}</h1><div className="exam-prompt" onMouseUp={()=>captureSelection()} onKeyUp={()=>captureSelection()}><MathContent text={work.instance.prompt}/>{work.instance.svg&&<div className="exam-figure"><img src={examFigureSource(work.instance.svg)} alt="Чертёж к задаче. Все размеры и условия приведены в тексте."/></div>}{work.instance.table&&<div className="exam-table-scroll"><table><thead><tr>{work.instance.table.headers.map((header,index)=><th key={index} scope="col">{header}</th>)}</tr></thead><tbody>{work.instance.table.rows.map((row,index)=><tr key={index}>{row.map((value,column)=><td key={column}>{value}</td>)}</tr>)}</tbody></table></div>}</div>
          {work.sourceWorkId&&<p className="exam-writing-note">Это отдельное учебное исправление. Исходная экзаменационная сдача сохранена.</p>}<ExamPhoto work={work} onWork={next=>updateWork(next,true)} onImportBusyChange={setPhotoImportBusy} removalDisabled={busy||sessionActive} disabled={busy||!editable||!sameDraft(draft,draftOf(work))}/><div className="exam-writing-heading"><h2>{work.instance.parts.some(part=>part.kind==='text')?'Общие рассуждения':'Мой ход решения'}</h2><div role="group" aria-label="Запись и история черновика"><button type="button" className="exam-insert-formula" disabled={!editable||busy} onPointerDown={event=>event.preventDefault()} onClick={()=>openFormula()}>Формула</button><button type="button" disabled={!editable||busy||historyPosition.current===0} aria-label="Отменить изменение" onClick={()=>{moveHistory(-1)}}><Undo2 size={16}/></button><button type="button" disabled={!editable||busy||historyPosition.current>=history.current.length-1} aria-label="Повторить изменение" onClick={()=>{moveHistory(1)}}><Redo2 size={16}/></button></div></div><label className="sr-only" htmlFor="exam-reasoning">{work.instance.parts.some(part=>part.kind==='text')?'Общие рассуждения':'Ход решения и обоснование'}</label>{work.instance.parts.some(part=>part.kind==='text')&&<p className="exam-writing-note">Общие основания входят в сданную попытку. В пунктах ниже можно ссылаться на них без переписывания.</p>}<textarea id="exam-reasoning" ref={reasoningRef} className="exam-reasoning" maxLength={80000} value={draft.reasoning} disabled={!editable||busy} placeholder={work.instance.parts.some(part=>part.kind==='text')?'Запиши общий ход или основания для нескольких пунктов. Формулы можно писать обычным текстом или вставлять кнопкой.':'Запиши, как рассуждаешь. Формулы можно записывать обычным текстом или в $…$.'} onChange={event=>edit({...draftRef.current,reasoning:event.target.value})} onSelect={event=>captureTextareaQuote(event.currentTarget,'reasoning',chatPart||undefined)}/>{draft.reasoning.includes('$')&&<details className="exam-reasoning-preview"><summary>Посмотреть формулы в записи</summary><MathContent text={draft.reasoning}/></details>}
          <div className="exam-answers">{work.instance.parts.map(part=><section key={part.id} id={`exam-part-${part.id}`} data-exam-part={part.id}>{part.prompt&&<MathContent text={part.prompt}/ >}{part.kind==='text'?<label className="exam-part-text">{part.label}<textarea id={`exam-answer-${part.id}`} maxLength={16000} value={draft.answersByPart[part.id]??''} onChange={event=>edit({...draftRef.current,answersByPart:{...draftRef.current.answersByPart,[part.id]:event.target.value}})} onSelect={event=>captureTextareaQuote(event.currentTarget,'answer',part.id)} disabled={!editable||busy} placeholder="Запиши обоснование этой части"/></label>:<MathAnswer label={`${part.label}${part.answerUnit?` · ${part.answerUnit}`:''}`} value={draft.answersByPart[part.id]??''} onChange={value=>edit({...draftRef.current,answersByPart:{...draftRef.current.answersByPart,[part.id]:value}})} disabled={!editable||busy} mode={part.kind==='number'?'number':'math'} multiple={part.kind==='roots'||part.kind==='series'} answerKey={`${work.id}-${part.id}`}/>}{part.kind==='text'&&<><button type="button" className="exam-text exam-insert-formula" disabled={!editable||busy} onPointerDown={event=>event.preventDefault()} onClick={()=>openFormula(part.id)}>Вставить формулу в этот пункт</button>{draft.answersByPart[part.id]?.includes('$')&&<details className="exam-reasoning-preview"><summary>Посмотреть формулы</summary><MathContent text={draft.answersByPart[part.id]}/></details>}</>}{part.scope&&<small className="exam-muted">{part.scope}</small>}</section>)}</div>
          {!inSession&&<div className="exam-work-actions"><button type="button" className="exam-primary" disabled={busy||!editable} onClick={()=>run(async()=>{await mutate('submit')})}>Сдать попытку<Check size={16}/></button>{work.mode==='solo'&&!work.completed&&<button type="button" disabled={busy||(!currentFamily&&!inMixed)} onClick={()=>run(enableHelp)}><HelpCircle size={16}/>Нужна помощь</button>}</div>}
          {!!work.attempts.length&&!inSession&&<ReviewContainer className="exam-review">{emptyBeforeHelp?<summary>До помощи запись была пустой</summary>:<h2>{work.attempts.at(-1)?.reason==='before-help'?'Попытка до помощи':'Последняя сданная попытка'}</h2>}{!sameDraft(draft,{answersByPart:work.attempts.at(-1)?.answersByPart??{},reasoning:work.attempts.at(-1)?.reasoning??''})&&<p className="exam-stale-result">Ты уже изменил запись. Ниже — проверка прежней попытки; новую ещё не проверяли.</p>}<p className="exam-muted">{work.attempts.at(-1)?.independent?'Последняя попытка — самостоятельная.':'В этой попытке была доступна помощь.'}</p>{activeEvaluations.length?activeEvaluations.map(item=><ExamEvaluationResult key={item.id} evaluation={item} label={work.instance.parts.find(part=>part.id===item.partId)?.label} disabled={busy} onObject={()=>{setObjection({evaluationId:item.id,attemptId:item.attemptId});setObjectionText('')}}/>):<p>Результат пока не подтверждён.</p>}<button type="button" className="exam-proof-review" disabled={busy||assistantThinking||!work.attempts.length} onClick={()=>{const attempt=work.attempts.at(-1);if(attempt)void dispatchReview(attempt.id)}}><MessageCircle size={15}/>Разобрать ход решения</button><p className="exam-muted">Можно обсудить спорный переход и предложить свой способ. {work.instance.parts.some(part=>part.kind==='text')&&'Это обсуждение шагов, а не подтверждение доказательства.'}</p>{work.advisories?.filter(item=>item.attemptId===work.attempts.at(-1)?.id).map(item=>item.partId?<div key={item.id} className={`exam-advisory ${item.active===false?'is-withdrawn':''}`}><span className="exam-eyebrow">{item.active===false?'Замечание отозвано':item.verdict==='possible-error'?'Возможная ошибка':item.verdict==='needs-clarification'?'Нужно уточнение':item.verdict==='supported-step'?'Этот шаг выглядит обоснованным':'Шаг пока не проверен'}</span>{item.quote&&<blockquote><MathContent text={item.quote}/></blockquote>}<MathContent text={item.message??''}/>{item.question&&<p>{item.question}</p>}{item.active!==false&&<button type="button" className="exam-text" disabled={busy||assistantThinking} onClick={()=>{setObjection({advisoryId:item.id,attemptId:item.attemptId});setObjectionText('')}}>Обсудить это замечание</button>}{item.objections?.map((response,index)=><p key={index} className="exam-muted">{response.message??response.summary??'Возражение сохранено.'}</p>)}</div>:<p key={item.id} className="exam-muted" role="status">{item.message??(item.status==='pending'?'Наставник читает сохранённую попытку…':'')}</p>)}<div className="exam-actions"><button type="button" disabled={busy||work.completed} onClick={()=>run(async()=>{await mutate('correct')})}>Исправить решение</button><button type="button" disabled={busy||!!mixedActive} onClick={()=>run(async()=>{await mutate('next');setLesson(null)})}>Новый вариант самому<ArrowRight size={15}/></button><button type="button" disabled={busy||work.completed} onClick={()=>run(async()=>{await mutate('finish')})}>Завершить эту работу</button></div></ReviewContainer>}
          {inSession&&sessionActive&&<div className="exam-actions"><button type="button" disabled={busy||session.currentPosition<=1} onClick={()=>changeSessionPosition(session.currentPosition-1)}><ChevronLeft size={15}/>Предыдущая</button><button type="button" className="exam-primary" disabled={busy||session.currentPosition>=session.tasks.length} onClick={()=>changeSessionPosition(session.currentPosition+1)}>Следующая<ChevronRight size={15}/></button></div>}
          {inSession&&session?.status==='submitted'&&<div className="exam-review"><h2>Проверка этой задачи</h2>{activeEvaluations.map(item=><div className={`exam-feedback is-${item.status}`} key={item.id}><strong>{statusText[item.status]}</strong><MathContent text={item.summary}/></div>)}{!activeEvaluations.length&&<p>Подтверждённого результата пока нет.</p>}<button type="button" className="exam-primary" disabled={busy} onClick={()=>run(async()=>{await mutate('correct')})}>Разобрать в отдельной работе<ArrowRight size={15}/></button><p className="exam-muted">Условие и твоя запись перейдут в учебный разбор с помощью. Сданный вариант останется прежним.</p></div>}
        </article>{helpPanel}</div>}
      </Suspense>}
    </>}
    {selection&&view==='work'&&work&&work.mode!=='solo'&&<div className="exam-quote-bubble">{work.instance.stepModelAvailable&&selection.selection&&['answer','reasoning'].includes(selection.origin??'')&&<button type="button" disabled={busy} onClick={()=>openModel(selection)}>Разобрать переход</button>}<button type="button" onClick={askSelection}><Paperclip size={15}/>Обсудить выделенный фрагмент</button><button type="button" aria-label="Убрать выделенный фрагмент" onClick={()=>setSelection(null)}><X size={14}/></button></div>}
    {quoteSource&&<Suspense fallback={<div role="status">Открываем фрагмент…</div>}><ExamQuoteSourceDialog context={quoteSource} onClose={()=>setQuoteSource(null)} onLocate={canLocateQuote?()=>{
      const source=quoteSource.source!,quote=quoteSource.quote,location=quoteLocation
      if(!location||workRef.current?.id!==location.workId)return
      setQuoteSource(null)
      requestAnimationFrame(()=>{const field=source.field==='answer'?document.getElementById(`exam-answer-${source.partId}`):reasoningRef.current;if(workRef.current?.id===location.workId&&field instanceof HTMLTextAreaElement&&field.value===location.snapshot&&field.value.slice(location.start,location.end)===quote){field.focus();field.setSelectionRange(location.start,location.end);field.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}})
    }:undefined}/></Suspense>}
    {formulaTarget&&<Suspense fallback={<div className="exam-loading" role="status">Открываем редактор формулы…</div>}><ExamFormulaComposer initialValue={formulaTarget.initialValue} editing={formulaTarget.editing} onInsert={acceptFormula} onClose={()=>{setFormulaTarget(null);setFormulaError('')}} error={formulaError} disabled={busy||!editable}/></Suspense>}
    {objection&&<div className="exam-dialog-backdrop" onKeyDown={event=>{if(event.key==='Escape')setObjection(null)}}><section className="exam-dialog" role="dialog" aria-modal="true" aria-labelledby="exam-objection-title"><button type="button" className="exam-dialog-close" aria-label="Закрыть" onClick={()=>setObjection(null)}><X size={18}/></button><h2 id="exam-objection-title">Что в проверке не сходится?</h2><p>Напиши свой аргумент. Исходная попытка и результат сохранятся; возражение будет записано отдельно.</p><label htmlFor="exam-objection" className="sr-only">Обоснование возражения</label><textarea autoFocus id="exam-objection" value={objectionText} onChange={event=>setObjectionText(event.target.value)} maxLength={4000}/><div className="exam-actions"><button type="button" onClick={()=>setObjection(null)}>Вернуться</button><button type="button" className="exam-primary" disabled={busy||!!objection.advisoryId&&assistantThinking||!objectionText.trim()} onClick={()=>{if(objection.advisoryId)void dispatchReview(objection.attemptId,{advisoryId:objection.advisoryId,explanation:objectionText});else run(async()=>{await mutate('object',{...objection,explanation:objectionText});setObjection(null)})}}>Сохранить возражение</button></div></section></div>}
    {confirmCloseSession&&session&&<div className="exam-dialog-backdrop" onKeyDown={event=>{if(event.key==='Escape')setConfirmCloseSession(false)}}><section className="exam-dialog" role="dialog" aria-modal="true" aria-labelledby="exam-close-title"><h2 id="exam-close-title">Завершить без проверки?</h2><p>Сохранённые на сервере записи останутся для чтения. Вариант закроется, без результатов и баллов. После этого можно скачать полный архив.</p>{work&&!sameDraft(draft,draftOf(work))&&<p>На этой странице есть несохранённые изменения. Скачай их перед завершением: <button type="button" onClick={()=>downloadExamFile(`черновик-${work.id}.json`,{format:'mathmaxing-local-draft',workId:work.id,instance:work.instance,...draft})}>Скачать текущую запись</button></p>}<div className="exam-actions"><button type="button" autoFocus disabled={busy} onClick={()=>setConfirmCloseSession(false)}>Вернуться в вариант</button><button type="button" className="exam-primary" disabled={busy} onClick={endSessionUnverified}>Завершить без проверки</button></div></section></div>}
    {confirmSubmit&&session&&<div className="exam-dialog-backdrop" onKeyDown={event=>{if(event.key==='Escape')setConfirmSubmit(false)}}><section className="exam-dialog" role="dialog" aria-modal="true" aria-labelledby="exam-submit-title"><h2 id="exam-submit-title">Сдать весь вариант?</h2><p>После сдачи ответы зафиксируются. Пропуски допустимы. Проверка покажет подтверждённые ответы и то, что ещё требует проверки.</p><p>С ответами: {session.tasks.filter(task=>Object.values(task.workId===work?.id?draft.answersByPart:task.work.answersByPart).some(value=>value.trim())).length} из {session.tasks.length} задач.</p><div className="exam-actions"><button type="button" autoFocus disabled={busy} onClick={()=>setConfirmSubmit(false)}>Продолжить решать</button><button type="button" className="exam-primary" disabled={busy} onClick={submitSession}>Сдать вариант<Check size={16}/></button></div></section></div>}
  </section>
}
