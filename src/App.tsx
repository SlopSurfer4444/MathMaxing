import { GlassSurface } from './components/glass'
import { BrandWordmark } from './components/BrandWordmark'
import { WorkspaceDialog } from './components/WorkspaceDialog'
import { isCurrentSubmission } from './submission-current'
import { Grid2X2 } from 'lucide-react'
import { StudyCapIcon } from './components/StudyCapIcon'
import { MixedPracticeCard, MixedPracticeBanner } from './components/MixedPractice'
import type { MixedPracticeState } from './mixed-practice-types'
import { learnerStorage, visitorHeaders } from './visitor-session'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, Check, ChevronDown, CircleHelp, Download, Feather, LoaderCircle, Plus, Redo2, RefreshCw, ShieldCheck, Sparkles, Undo2 } from 'lucide-react'
import 'mathlive/static.css'
import 'mathlive/fonts.css'
import { NotebookEditor, type EditorBridge, type NotebookSelection } from './editor/NotebookEditor'
import { STORAGE_KEY, blockSignature, findBlock, freshNotebook, parseSavedNotebook, type ChatContext, type NotebookState } from './notebook-state'
import type { AppState, PreparationExercise, ProviderStatus, Submission, Work } from './api-types'
import type { JSONContent } from '@tiptap/core'
import { ChatPanel } from './components/ChatPanel'
import { MathContent, MathText } from './components/MathContent'
import { Theory } from './components/Theory'
import { Preparation, PreparationChooser } from './components/Preparation'
import { AdaptiveHelp } from './components/AdaptiveHelp'
import { LearningHome, LearningDiagnostic } from './components/LearningHome'
import { LearningEpisode } from './components/LearningEpisode'
import { emptyEpisodeProgress, learningEpisodes, type EpisodeProgress } from './learning-content'
import './learning-shell.css'
import { defaultLearningNavigation, readLearningNavigation, addressedEpisodeNavigation, episodeCompletion, type LearningNavigation } from './learning-navigation'
import { mergeWork } from './merge-work'
import { toMathAnswerLatex } from './math-answer'
import { deriveNotebookAnswers, migrateLegacyAnswers } from './answer-bindings'
import { currentDraftExport } from './draft-export'
import { PhotoSolution } from './components/PhotoSolution'
import { PercentageWork } from './components/PercentageWork'
import { StudyHome } from './components/StudyHome'
import { ReviewCycle, type ReviewActionBody } from './components/ReviewCycle'
import type { ReviewAnchor } from './review-types'
import { StudyRoute } from './components/StudyRoute'
import type { StudyRouteState, StudyRouteAction } from './study-route-types'
import { ProfileRecovery } from './components/ProfileRecovery'
import { isScalarProblem, type TaskContract } from './task-contract'
import { preferredScrollBehavior } from './motion'
import { workPackage } from './work-package'


function loadInitial(): { state: NotebookState; error: string | null; raw: string | null } {
  let raw: string | null = null
  try { raw = learnerStorage.getItem(STORAGE_KEY); return { state: raw ? parseSavedNotebook(raw) : freshNotebook(), error: null, raw } }
  catch { return { state: freshNotebook(), error: 'Сохранённый лист не удалось прочитать. Исходная копия не перезаписана — скачай её для восстановления.', raw } }
}
type PreparationDraft = { workId: string; exerciseId: string; preparationId?: string; expectedRevision?: number; startedAt: string; answer: string; baseAnswer: string }
const preparationDraftKey = (draft: Pick<PreparationDraft, 'workId' | 'exerciseId' | 'startedAt'>) => `pole.preparation.${draft.workId}.${draft.startedAt}.${draft.exerciseId}`
const draftSignature = (document: NotebookState['document'], finalAnswer: string, generalAnswer = '') => JSON.stringify({ document, finalAnswer, ...(generalAnswer ? { generalAnswer } : {}) })
type LearningSession = { entry: null | 'explain' | 'refresh' | 'solve'; view: 'home' | 'episode' | 'work' | 'diagnostic' | 'materials'; episodeId: string | null; progress: Record<string, EpisodeProgress>; workId?: string; revision?: number }
const freshLearning = (): LearningSession => ({entry: null, view: 'home', episodeId: null, progress: {}})
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { ...visitorHeaders(), 'X-Pole-Client': 'notebook-v1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  let data: Record<string, unknown>
  try { data = await response.json() } catch { throw new Error('Не удалось связаться с сервером. Запись осталась на устройстве. Попробуй ещё раз.') }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Запрос не выполнен. Твоя работа сохранена в листе.')
  return data as T
}

export default function App() {
  const [initial] = useState(loadInitial)
  const [notebook, setNotebook] = useState(initial.state)
  const [state, setState] = useState<AppState | null>(null)
  const [homeSection, setHomeSection] = useState<'study'|'tasks'|'materials'>('study')
  const [trigEntry, setTrigEntry] = useState(false)
  const [mixed, setMixed] = useState<MixedPracticeState | null>(null)
  const [mixedError, setMixedError] = useState('')
  const mixedRequest = useRef<{action:'start'|'next';requestId:string;expectedRevision:number}|null>(null)
  const [studyRoute, setStudyRoute] = useState<StudyRouteState | null>(null)
  const [routeError, setRouteError] = useState('')
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState(initial.error)
  const [recoveryRaw, setRecoveryRaw] = useState<string | null>(null)
  const [serverError, setServerError] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'failed'>('saved')
  const [contexts, setContexts] = useState<ChatContext[]>([])
  const [photoOpen, setPhotoOpen] = useState(false)
  const [finalAnswer, setFinalAnswer] = useState('')
  const [generalAnswer, setGeneralAnswer] = useState('')
  const generalRef = useRef('')
  const [learning, setLearning] = useState<LearningSession>(freshLearning)
  const learningRef = useRef(learning)
  const [learningError, setLearningError] = useState('')
  const [learningRecovery, setLearningRecovery] = useState<string | null>(null)
  const [learningSaveState, setLearningSaveState] = useState<'saved' | 'pending' | 'failed'>('saved')
  const learningRevision = useRef(0)
  const learningBlocked = useRef(false)
  const [learningDraftKey] = useState(() => {
    try {
      let id = sessionStorage.getItem('pole.learning-tab')
      if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('pole.learning-tab', id) }
      return `pole.learning-draft.v2.${id}`
    } catch { return 'pole.learning-draft.v2.recovery' }
  })
  const learningQueue = useRef<Promise<unknown>>(Promise.resolve())
  const [navigation, setNavigation] = useState(defaultLearningNavigation)
  const navigationRef = useRef(navigation)
  const updateNavigation = (next: LearningNavigation) => {
    navigationRef.current = next; setNavigation(next)
    try { if (workRef.current) learnerStorage.setItem(`pole.learning-navigation.v1.${workRef.current.id}`, JSON.stringify(next)) }
    catch { setLearningError('Точка возврата не сохранена на устройстве. Не закрывай страницу до завершения занятия.') }
  }
  const persistLearning = (patch: Partial<LearningSession>) => {
    if (patch.view === 'work') setTab('solution')
    if (patch.view === 'home' && learningRef.current.view !== 'home') updateNavigation({...navigationRef.current, resume: {view: learningRef.current.view, episodeId: learningRef.current.episodeId}})
    const next = {...learningRef.current, ...patch}; learningRef.current = next; setLearning(next)
    const workId = workRef.current?.id
    setLearningSaveState('pending')
    try { learnerStorage.setItem(learningDraftKey, JSON.stringify({session: next, expectedRevision: learningRevision.current, workId})) }
    catch { setLearningError('Не удалось сохранить ответ на устройстве. Не закрывай страницу до сохранения на сервере.') }
    learningQueue.current = learningQueue.current.catch(() => undefined).then(async () => {
      if (learningBlocked.current) { setLearningSaveState('failed'); throw new Error('Сначала восстанови связь с сохранённым маршрутом.') }
      try {
        const result = await api<{session:LearningSession}>('/api/learning', {entry: next.entry, view: next.view, episodeId: next.episodeId, progress: next.progress, workId, expectedRevision: learningRevision.current})
        learningRevision.current = result.session.revision ?? 0
        if (learningRef.current === next) {
          learnerStorage.removeItem(learningDraftKey); setLearningSaveState('saved')
        } else learnerStorage.setItem(learningDraftKey, JSON.stringify({session: learningRef.current, expectedRevision: learningRevision.current, workId: workRef.current?.id}))
        setLearningError('')
      } catch (error) {
        learningBlocked.current = true; setLearningSaveState('failed')
        const raw = JSON.stringify({session:learningRef.current,expectedRevision:learningRevision.current,workId:workRef.current?.id})
        setLearningRecovery(raw)
        setLearningError(`${error instanceof Error ? error.message : 'Маршрут не сохранён.'} Твой ответ оставлен на устройстве; можно скачать копию и открыть сохранённую версию.`)
        throw error
      }
    })
    void learningQueue.current.catch(() => undefined)
  }
  const [panelOpen, setPanelOpen] = useState(false)
  const [draftRequest, setDraftRequest] = useState<{text: string; token: number}>()
  const [mentorEnabled, setMentorEnabled] = useState(() => { try { return learnerStorage.getItem('pole.mentor.initiative') !== 'off' } catch { return true } })
  const changeMentorEnabled = (value: boolean) => {
    setMentorEnabled(value)
    try { learnerStorage.setItem('pole.mentor.initiative', value ? 'on' : 'off') } catch { setStorageError('Настройка наставника сохранена только до закрытия страницы.') }
  }
  const [tab, setTab] = useState<'solution' | 'theory'>('solution')
  useEffect(() => { window.mathVirtualKeyboard?.hide() }, [learning.view, learning.episodeId, state?.work.id, state?.work.preparation?.id, tab])
  const [materialTarget, setMaterialTarget] = useState<{ id: string; token: number } | null>(null)
  const [preparationChooser, setPreparationChooser] = useState(false)
  const pendingReturn = useRef<string | null>(null)
  const [quietEffects,setQuietEffects]=useState(()=>{try{return learnerStorage.getItem('mathmaxing.effects')==='quiet'}catch{return false}})
  useEffect(()=>{document.documentElement.dataset.quietEffects=String(quietEffects);return()=>{delete document.documentElement.dataset.quietEffects}},[quietEffects])
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpConfirmOpen, setHelpConfirmOpen] = useState(false)
  const helpConfirmation = useRef<{promise:Promise<boolean>;resolve(value:boolean):void}|null>(null)
  const [conditionOpen, setConditionOpen] = useState(false)
  useEffect(()=>{if(panelOpen||conditionOpen||helpConfirmOpen)window.mathVirtualKeyboard?.hide()},[panelOpen,conditionOpen,helpConfirmOpen])
  const [narrowWorkspace,setNarrowWorkspace]=useState(()=>window.matchMedia('(max-width:900px)').matches)
  const workspaceReturn = useRef<{workId?:string;view?:LearningSession['view'];anchor?:{blockId?:string;position?:number};scrollY:number;element:HTMLElement|null}|null>(null)
  useEffect(()=>{const media=window.matchMedia('(max-width:900px)');const update=()=>setNarrowWorkspace(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
  const captureWorkspaceReturn=()=>{workspaceReturn.current={workId:workRef.current?.id,view:learningRef.current.view,anchor:bridge.current?.captureReturnAnchor(),scrollY:window.scrollY,element:document.activeElement as HTMLElement|null}}
  const restoreWorkspaceReturn=()=>{const point=workspaceReturn.current;workspaceReturn.current=null;if(!point||point.workId!==workRef.current?.id)return;requestAnimationFrame(()=>{if(point.view==='work'&&point.anchor?.blockId&&!isScalarProblem(workRef.current))bridge.current?.restoreReturnAnchor(point.anchor);else if(point.element?.isConnected)point.element.focus({preventScroll:true});window.scrollTo({top:point.scrollY,behavior:'instant'})})}
  const closeMentor=()=>{setPanelOpen(false);restoreWorkspaceReturn()}
  const confirmHelp=()=>{if(helpConfirmation.current)return helpConfirmation.current.promise;captureWorkspaceReturn();let resolve!:(value:boolean)=>void;const promise=new Promise<boolean>(done=>{resolve=done});helpConfirmation.current={promise,resolve};setHelpConfirmOpen(true);return promise}
  const finishHelpConfirmation=(accepted:boolean)=>{setHelpConfirmOpen(false);helpConfirmation.current?.resolve(accepted);helpConfirmation.current=null;if(!accepted)restoreWorkspaceReturn()}

  const helpRequestId = useRef<string | null>(null)
  const [taskOpen, setTaskOpen] = useState(true)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState<'chat' | 'submit' | 'switch' | null>(null)
  const [checking, setChecking] = useState(false)
  const [, refreshToolbar] = useState(0)
  const bridge = useRef<EditorBridge | null>(null)
  const workRef = useRef<Work | null>(null)
  const draftBase = useRef<{ workId: string; signature: string } | null>(null)
  const notebookRef = useRef(notebook)
  notebookRef.current = notebook
  const answerRef = useRef(finalAnswer)
  answerRef.current = finalAnswer
  const busyRef = useRef(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const preparationDraft = useRef<PreparationDraft | null>(null)
  const preparationConflict = useRef<PreparationDraft | null>(null)
  const flushPreparation = useRef<() => Promise<void>>(async () => {})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const bootStarted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  const acceptWork = useCallback((work: Work) => {
    work = mergeWork(workRef.current, work)
    workRef.current = work
    setState(previous => previous ? { ...previous, work, works: [
      { id: work.id, problemId: work.problemId, mode: work.mode, updatedAt: work.updatedAt, packageId: work.packageId, kind: work.kind, contentVersion: work.contentVersion },
      ...(previous.works ?? []).filter(item => item.id !== work.id),
    ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) } : previous)
  }, [])
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.current.catch(() => undefined).then(operation)
    queue.current = next
    return next
  }, [])
  const saveCurrent = useCallback(async () => {
    if (!mounted.current) throw new Error('Страница была обновлена. Открой актуальную работу перед сохранением.')
    try { await flushPreparation.current() } catch (error) { setSaveState('failed'); throw error }
    const work = workRef.current
    if (!work) throw new Error('Нет связи с сервером. Твой лист остаётся на устройстве.')
    const document = notebookRef.current.document
    const answer = answerRef.current
    if (JSON.stringify(document) === JSON.stringify(work.document) && answer === work.finalAnswer && generalRef.current === (work.generalAnswer ?? '')) { setSaveState('saved'); return work }
    setSaveState('pending')
    try {
      const result = await api<{ work: Work }>('/api/work/save', { workId: work.id, expectedRevision: work.revision, document, finalAnswer: answer, generalAnswer: generalRef.current })
      // Only an acknowledged save advances the recovery base. Error readback may
      // contain another editor's document and must not make our dirty draft its successor.
      draftBase.current = { workId: result.work.id, signature: draftSignature(result.work.document, result.work.finalAnswer, result.work.generalAnswer) }
      acceptWork(result.work)
      setSaveState(draftSignature(notebookRef.current.document, answerRef.current, generalRef.current) === draftBase.current.signature ? 'saved' : 'pending')
      return result.work
    } catch (error) { setSaveState('failed'); throw error }
  }, [acceptWork])
  const scheduleSave = useCallback(() => {
    setSaveState('pending')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void enqueue(saveCurrent).catch(error => setServerError(error.message)) }, 650)
  }, [enqueue, saveCurrent])
  const ready = useCallback((value: EditorBridge) => { bridge.current = value; refreshToolbar(count => count + 1) }, [])
  const onDocumentChange = useCallback((document: NotebookState['document']) => {
    const answers = deriveNotebookAnswers(document)
    const previousAnswers = deriveNotebookAnswers(notebookRef.current.document)
    if ((previousAnswers.generalAnswer && !answers.generalAnswer) || (previousAnswers.finalAnswer && !answers.finalAnswer)) setToast('Ответ больше не указан. Отметь другую строку или верни изменение кнопкой отмены.')
    generalRef.current = answers.generalAnswer; setGeneralAnswer(answers.generalAnswer)
    answerRef.current = answers.finalAnswer; setFinalAnswer(answers.finalAnswer)
    notebookRef.current = { ...notebookRef.current, document }; setNotebook(previous => ({ ...previous, document })); scheduleSave()
  }, [scheduleSave])
  const replaceWork = useCallback((work: Work) => {
    draftBase.current = { workId: work.id, signature: draftSignature(work.document, work.finalAnswer, work.generalAnswer) }
    acceptWork(work);
    try { const nextNavigation = readLearningNavigation(learnerStorage.getItem(`pole.learning-navigation.v1.${work.id}`)); navigationRef.current = nextNavigation; setNavigation(nextNavigation) } catch { setLearningError('Точку возврата не удалось восстановить. Выбери тему в начале занятия.') }
    const document = isScalarProblem(work) ? work.document : migrateLegacyAnswers(work.document, work.generalAnswer ?? '', work.finalAnswer)
    const answers = isScalarProblem(work) ? {finalAnswer: work.finalAnswer, generalAnswer: ''} : deriveNotebookAnswers(document)
    setFinalAnswer(answers.finalAnswer); answerRef.current = answers.finalAnswer; setGeneralAnswer(answers.generalAnswer); generalRef.current = answers.generalAnswer
    notebookRef.current = { ...notebookRef.current, document }
    setNotebook(previous => ({ ...previous, document }))
    // Work identity keys the editor; boot also remounts it after loading. Never
    // mutate an outgoing editor here: its update callback could queue an old save.
    setContexts([]); setPhotoOpen(false); helpRequestId.current = null; setTab('solution'); setSaveState(document === work.document ? 'saved' : 'pending'); setPreparationChooser(false); setPanelOpen(false); pendingReturn.current = null
    if (document !== work.document) scheduleSave()
  }, [acceptWork, scheduleSave])
  const boot = useCallback(async () => {
    setLoading(true); setServerError('')
    try {
      let result = await api<AppState>('/api/state')
      const local = initial.raw && !initial.error ? JSON.parse(initial.raw) as { workId?: string; baseSignature?: string; finalAnswer?: string; generalAnswer?: string } : null
      const recoverPending = local?.workId === result.work.id && typeof local.finalAnswer === 'string' && local.baseSignature === draftSignature(result.work.document, result.work.finalAnswer, result.work.generalAnswer) && draftSignature(initial.state.document, local.finalAnswer, local.generalAnswer) !== local.baseSignature
      const importLegacy = result.canImportLocal && (!local?.workId || local.workId === result.work.id)
      if (initial.raw && !initial.error && (importLegacy || recoverPending)) {
        try {
          const imported = await api<{ work: Work }>('/api/work/save', { workId: result.work.id, expectedRevision: result.work.revision, document: initial.state.document, finalAnswer: recoverPending ? local!.finalAnswer : result.work.finalAnswer, generalAnswer: recoverPending ? local!.generalAnswer ?? '' : result.work.generalAnswer ?? '' })
          result = { ...result, work: imported.work }
        } catch (error) {
          // Recovery is optimistic. A concurrent or outgoing HMR save can win;
          // keep the local candidate and still open the latest server work.
          setRecoveryRaw(initial.raw)
          try { learnerStorage.setItem(`pole.notebook.recovery.${Date.now()}`, initial.raw) } catch { /* The download remains available in this page. */ }
          result = await api<AppState>('/api/state')
          setServerError(`Локальный черновик не объединён с серверной работой: ${error instanceof Error ? error.message : 'работа успела измениться'}. Открыта актуальная версия; локальную копию можно скачать ниже.`)
        }
      } else if (initial.raw && !initial.error) {
        try { if (!learnerStorage.getItem('pole.notebook.legacy.v1')) learnerStorage.setItem('pole.notebook.legacy.v1', initial.raw) } catch { /* Current notebook remains downloadable. */ }
        const divergentDraft = local?.workId === result.work.id && typeof local.finalAnswer === 'string' && typeof local.baseSignature === 'string' && draftSignature(initial.state.document, local.finalAnswer, local.generalAnswer) !== local.baseSignature && draftSignature(initial.state.document, local.finalAnswer, local.generalAnswer) !== draftSignature(result.work.document, result.work.finalAnswer, result.work.generalAnswer)
        if (divergentDraft) {
          setRecoveryRaw(initial.raw)
          try { learnerStorage.setItem(`pole.notebook.recovery.${Date.now()}`, initial.raw) } catch { /* The local candidate is also held for download. */ }
          setServerError('Локальный черновик и серверная работа изменились независимо. Открыта серверная версия; локальная копия сохранена отдельно и доступна для скачивания.')
        }
      }
      if (!mounted.current) return
      let recoveredPreparation: PreparationDraft | null = null
      const active = result.work.preparation
      if (active && !active.completed) {
        try {
          const key = preparationDraftKey({ workId: result.work.id, exerciseId: active.exerciseId, startedAt: active.startedAt })
          const rawDraft = learnerStorage.getItem(key)
          const draft = rawDraft ? JSON.parse(rawDraft) as PreparationDraft : null
          if (draft && draft.workId === result.work.id && draft.exerciseId === active.exerciseId && draft.startedAt === active.startedAt && typeof draft.answer === 'string' && typeof draft.baseAnswer === 'string') {
            if (active.answer === draft.answer) learnerStorage.removeItem(key)
            else if (active.answer === draft.baseAnswer && (draft.expectedRevision ?? 0) === (active.revision ?? 0)) {
              recoveredPreparation = draft
              // Show the safely recovered local answer immediately; retain its server base until acknowledged.
              result = { ...result, work: { ...result.work, preparation: { ...active, answer: draft.answer, result: undefined } } }
            } else {
              preparationConflict.current = draft
              setServerError('Ответ упражнения изменился на сервере. Открыт серверный ответ; отдельный локальный черновик сохранён и включён в скачиваемую копию.')
            }
          }
        } catch { setServerError('Локальный черновик упражнения не удалось прочитать. Исходная запись оставлена на устройстве.') }
      }
      setState(result); setProvider(previous => previous ?? result.provider); replaceWork(result.work)
      try { const savedNavigation = readLearningNavigation(learnerStorage.getItem(`pole.learning-navigation.v1.${result.work.id}`)); navigationRef.current = savedNavigation; setNavigation(savedNavigation) } catch { setLearningError('Сохранённую точку возврата не удалось прочитать. Открой нужную тему из списка.') }
      try {
        const data = await api<{session: LearningSession}>('/api/learning')
        let session = {...freshLearning(), ...data.session}
        learningRevision.current = session.revision ?? 0
        const raw = learnerStorage.getItem(learningDraftKey)
        if (raw) {
          const draft = JSON.parse(raw) as {session:LearningSession;expectedRevision:number;workId:string}
          if (draft.workId === result.work.id && draft.expectedRevision === learningRevision.current) {
            const recovered = await api<{session:LearningSession}>('/api/learning', {entry:draft.session.entry, view:draft.session.view, episodeId:draft.session.episodeId, progress:draft.session.progress, workId:draft.workId, expectedRevision:draft.expectedRevision})
            session = {...freshLearning(),...recovered.session}; learningRevision.current = session.revision ?? 0
            learnerStorage.removeItem(learningDraftKey)
          } else {
            learnerStorage.setItem(`${learningDraftKey}.conflict.${Date.now()}`,raw)
            setLearningRecovery(raw)
            setLearningError('Маршрут изменился в другой вкладке. Открыта сохранённая версия; твой локальный ответ доступен отдельной копией.')
          }
        }
        learningRef.current = session; setLearning(session)
      } catch {
        learningBlocked.current = true
        const raw = learnerStorage.getItem(learningDraftKey)
        if (raw) { setLearningRecovery(raw); try { learnerStorage.setItem(`${learningDraftKey}.conflict.${Date.now()}`,raw) } catch { /* Download remains available. */ } }
        setLearningError('Не удалось восстановить учебный маршрут. Локальный ответ сохранён отдельно; открой сохранённую версию после восстановления связи.')
      }
      if (recoveredPreparation) {
        preparationDraft.current = recoveredPreparation
        setSaveState('pending')
        void enqueue(saveCurrent).catch(error => setServerError(error.message))
      }
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось открыть работу.'); setProvider({ connected: false, provider: 'Наставник', error: 'Сервер тетради недоступен.' }) }
    finally { if (mounted.current) setLoading(false) }
  }, [initial, replaceWork, enqueue, saveCurrent])
  useEffect(() => { if (!bootStarted.current) { bootStarted.current = true; void boot() } }, [boot])
  useEffect(() => {
    let active = true
    void api<ProviderStatus>('/api/status').then(value => { if (active) setProvider(value) }).catch(() => {
      if (active) setProvider({connected:false,provider:'Наставник',error:'Наставник пока недоступен. Материалы и проверка работают.'})
    })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (initial.error || loading) return
    try { learnerStorage.setItem(STORAGE_KEY, JSON.stringify({ ...notebookRef.current, savedAt: new Date().toISOString(), workId: workRef.current?.id, baseSignature: draftBase.current?.workId === workRef.current?.id ? draftBase.current?.signature : undefined, finalAnswer: answerRef.current, generalAnswer: generalRef.current })); setStorageError(null) }
    catch { setStorageError('Не удалось сохранить на устройстве. Скачай копию, чтобы не потерять запись.') }
  }, [notebook, finalAnswer, generalAnswer, initial.error, loading, state?.work])
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(''), 3500); return () => clearTimeout(id) }, [toast])

  const checkConnection = async () => {
    setChecking(true)
    try { setProvider(await api<ProviderStatus>('/api/status')) }
    catch (error) { setProvider({ connected: false, provider: 'Наставник', error: error instanceof Error ? error.message : 'Не удалось проверить подключение.' }) }
    finally { setChecking(false) }
  }
  const attach = useCallback((context: ChatContext) => {
    captureWorkspaceReturn(); setContexts(previous => previous.some(item => item.anchor.blockId === context.anchor.blockId && item.anchor.quote === context.anchor.quote) ? previous : [...previous, context]); setPanelOpen(true)
  }, [])
  const requestAnnotation = useCallback((anchor: NotebookSelection) => {
    const block = findBlock(notebookRef.current.document, anchor.blockId)
    if (block) attach({ anchor: { ...anchor, origin: 'notebook' }, source: blockSignature(block) })
  }, [attach])
  const refreshAfterError = async () => {
    try {
      const latest = await api<AppState>('/api/state'), current = workRef.current
      if (current && latest.work.id === current.id) {
        const merged = mergeWork(current, latest.work)
        // Error readback can refresh independently versioned metadata, never
        // adopt another editor's document revision as our local draft's base.
        acceptWork({...merged,document:current.document,finalAnswer:current.finalAnswer,generalAnswer:current.generalAnswer,revision:current.revision})
        setState(previous => previous ? {...previous,memory:latest.memory} : previous)
      }
    } catch { /* Never discard the visible draft if readback is unavailable. */ }
  }
  const send = async (message: string, retryId?: string): Promise<boolean> => {
    if (busyRef.current || !workRef.current) return false
    busyRef.current = true; setBusy('chat'); setServerError('')
    const requestId = retryId || crypto.randomUUID()
    const sentContexts = [...contexts]
    let accepted = false
    try {
      const work = await enqueue(saveCurrent)
      // Let the server ground the reply in the saved episode without putting
      // implementation labels into the learner's visible message.
      await learningQueue.current
      const sentSignature = draftSignature(work.document, work.finalAnswer, work.generalAnswer)
      const result = await api<{ work: Work; reply: string }>('/api/chat' + (retryId ? '/retry' : ''), retryId ? { workId: work.id, requestId } : { workId: work.id, message, contexts: sentContexts, requestId })
      if (workRef.current?.id === work.id) {
        const dirty = draftSignature(notebookRef.current.document, answerRef.current, generalRef.current) !== sentSignature
        acceptWork({ ...workRef.current, messages: result.work.messages.map(item => item.requestId === requestId && item.role === 'assistant' ? { ...item, stale: item.stale || dirty } : item) })
      }
      accepted = true
      void checkConnection()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Ответ не получен.'); await refreshAfterError()
      void checkConnection()
      accepted = !!workRef.current?.messages.some(item => item.requestId === requestId)
    } finally { busyRef.current = false; setBusy(null) }
    if (accepted && !retryId) setContexts(current => current.filter(context => !sentContexts.includes(context)))
    return accepted
  }
  const refreshCatalog = async () => {
    const latest = await api<AppState>('/api/state')
    setState(previous => previous ? { ...previous, packages: latest.packages, exercises: latest.exercises, memory: latest.memory, problems: latest.problems } : latest)
  }
  const openDirection = async (packageId: TaskContract['packageId'], destination: 'entry'|'materials' = 'entry') => {
    if (busyRef.current || !state) return
    busyRef.current = true; setBusy('switch'); setServerError('')
    try {
      await enqueue(async () => {
        await learningQueue.current.catch(() => undefined)
        const current = await saveCurrent()
        const previous = state.works.find(item => workPackage(item,state.problems) === packageId)
        const selected = workPackage(current,state.problems) === packageId ? current : previous
          ? (await api<{work:Work}>('/api/work/open', {workId:previous.id})).work
          : (await api<{work:Work}>('/api/work/new', {packageId,mode:'guided'})).work
        replaceWork(selected); await refreshCatalog()
        setTrigEntry(false)
        // Browsing materials from a solo attempt requires the same explicit
        // help transition as the work screen. Never reveal theory silently.
        if (destination === 'materials' && selected.mode === 'solo') {
          persistLearning({view:'work',episodeId:null})
          setToast('Открой «Нужна помощь», чтобы перейти к материалам. Самостоятельная попытка будет сохранена.')
        } else {
          persistLearning({view:destination === 'materials' ? 'materials' : 'work',episodeId:null})
          if (destination === 'materials') {
            updateNavigation({...navigationRef.current,materialReturn:{view:'home',episodeId:null}})
            if (packageId === 'trigonometry') setMaterialTarget({id:'library',token:Date.now()})
          }
        }
        setPanelOpen(false); window.scrollTo(0,0)
      })
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось открыть занятие.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  const numericRequest = async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
    const originId = workRef.current?.id
    const prepare = async () => {
      const current = await saveCurrent()
      if (current.id !== originId) throw new Error('Занятие изменилось. Повтори запрос в текущей задаче.')
      return current
    }
    const run = async (current: Work) => {
      const signature = draftSignature(current.document, current.finalAnswer, current.generalAnswer)
      const result = await api<T & {work?:Work}>(path, {...body,workId:current.id,expectedRevision:current.revision,expectedModeEpoch:current.modeEpoch})
      const latest = workRef.current
      if (!latest || latest.id !== originId || latest.revision !== current.revision || latest.modeEpoch !== current.modeEpoch || draftSignature(notebookRef.current.document,answerRef.current,generalRef.current) !== signature) throw new Error('Запись изменилась. Прежний ответ не показан.')
      if (result.work) acceptWork(result.work)
      return result
    }
    // Only saving belongs to the mutation queue. The model can take time;
    // autosave/navigation must remain free to cancel or supersede its answer.
    if (path === '/api/assistance') return run(await enqueue(prepare))
    return enqueue(async () => run(await prepare()))
  }
  const newWork = async (_solo: boolean, similar = false) => {
    if (!state || busyRef.current) return
    busyRef.current = true; setBusy('switch'); setServerError('')
    try {
      await enqueue(async () => {
        await learningQueue.current.catch(() => undefined)
        const work = await saveCurrent()
        const result = await api<{ work: Work; repeated: boolean }>('/api/work/next', { workId: work.id, ...(similar ? {similar:true,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch} : {}) })
        replaceWork(result.work); await refreshCatalog(); persistLearning({view: 'work', episodeId: null}); window.scrollTo(0, 0)
        if (result.repeated) setToast('Все варианты уже встречались. Открыта повторная самостоятельная попытка.')
      })
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось открыть задачу.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  const startPreparation = async (exerciseId: string) => {
    if (busyRef.current || !state?.exercises?.some(item => item.id === exerciseId) || workRef.current?.mode === 'solo') return
    const returnAnchor = workRef.current?.preparation && !workRef.current.preparation.completed ? workRef.current.preparation.returnAnchor : { ...bridge.current?.captureReturnAnchor(), scrollY: window.scrollY }
    busyRef.current = true; setBusy('switch'); setServerError('')
    try {
      await enqueue(async () => {
        const work = await saveCurrent()
        const result = await api<{ work: Work }>('/api/preparation/start', { workId: work.id, exerciseId, returnAnchor })
        acceptWork(result.work); await refreshCatalog(); persistLearning({view: 'work', episodeId: null}); setPreparationChooser(false); setTab('solution'); setPanelOpen(false); window.scrollTo(0, 0)
      })
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось открыть подготовку.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  flushPreparation.current = async () => {
    const draft = preparationDraft.current
    const current = workRef.current
    if (!draft || !current || draft.workId !== current.id || draft.exerciseId !== current.preparation?.exerciseId || draft.startedAt !== current.preparation.startedAt || current.preparation.completed) return
    const result = await api<{ work: Work }>('/api/preparation/draft', { workId: current.id, preparationId: draft.preparationId ?? current.preparation.id, expectedRevision: draft.expectedRevision ?? current.preparation.revision ?? 0, answer: draft.answer })
    acceptWork(result.work)
    if (preparationDraft.current === draft) {
      preparationDraft.current = null
      try { learnerStorage.removeItem(preparationDraftKey(draft)) } catch { /* Matching acknowledged draft is safe to recover again. */ }
    } else if (preparationDraft.current?.startedAt === draft.startedAt && preparationDraft.current.workId === draft.workId) {
      preparationDraft.current.baseAnswer = result.work.preparation?.answer ?? draft.answer
      preparationDraft.current.expectedRevision = result.work.preparation?.revision ?? 0
      try { learnerStorage.setItem(preparationDraftKey(preparationDraft.current), JSON.stringify(preparationDraft.current)) } catch { setStorageError('Ответ упражнения не сохранён на устройстве. Скачай копию перед обновлением страницы.') }
    }
  }
  const draftPreparation = (answer: string) => {
    const work = workRef.current
    if (!work?.preparation || work.preparation.completed) return
    preparationDraft.current = { workId: work.id, preparationId: work.preparation.id, expectedRevision: preparationDraft.current?.expectedRevision ?? work.preparation.revision ?? 0, exerciseId: work.preparation.exerciseId, startedAt: work.preparation.startedAt, answer, baseAnswer: preparationDraft.current?.startedAt === work.preparation.startedAt ? preparationDraft.current.baseAnswer : work.preparation.answer }
    try { learnerStorage.setItem(preparationDraftKey(preparationDraft.current), JSON.stringify(preparationDraft.current)) } catch { setStorageError('Ответ упражнения не сохранён на устройстве. Скачай копию перед обновлением страницы.') }
    scheduleSave()
  }
  const answerPreparation = async (answer: string) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy('switch'); setServerError('')
    const preparationId = workRef.current?.preparation?.id
    try { await enqueue(async () => { const work = await saveCurrent(); const result = await api<{ work: Work }>('/api/preparation/answer', { workId: work.id, preparationId, expectedRevision: work.preparation?.revision ?? 0, answer }); acceptWork(result.work); await refreshCatalog() }) }
    catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось проверить упражнение.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  const returnToSolution = async () => {
    if (busyRef.current) return
    busyRef.current = true; setBusy('switch'); setServerError('')
    const preparationId = workRef.current?.preparation?.id
    try { await enqueue(async () => { const work = await saveCurrent(); const result = await api<{ work: Work }>('/api/preparation/return', { workId: work.id, preparationId, expectedRevision: work.preparation?.revision ?? 0 }); pendingReturn.current = result.work.id + ':' + result.work.preparation?.startedAt; acceptWork(result.work); setTab('solution'); setPreparationChooser(false); setToast('Ты снова в своём решении. Продолжай с того места, где остановился.') }) }
    catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось вернуться к решению.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  useEffect(() => {
    const work = state?.work
    const prep = work?.preparation
    if (!work || !prep?.completed || !prep.returnAnchor || loading || tab !== 'solution') return
    const key = work.id + ':' + prep.startedAt
    if (pendingReturn.current !== key) return
    const frame = requestAnimationFrame(() => { pendingReturn.current = null; bridge.current?.restoreReturnAnchor(prep.returnAnchor!); window.scrollTo({ top: prep.returnAnchor?.scrollY ?? 0, behavior: 'instant' }) })
    return () => cancelAnimationFrame(frame)
  }, [state?.work, loading, tab])
  const openWork = async (workId: string) => {
    if (busyRef.current || !workRef.current) return
    if (workId === workRef.current.id) { persistLearning({view:'work',episodeId:null}); setPanelOpen(false); return }
    busyRef.current = true; setBusy('switch'); setServerError('')
    try {
      await enqueue(async () => {
        await learningQueue.current.catch(() => undefined)
        await saveCurrent()
        const result = await api<{ work: Work }>('/api/work/open', { workId })
        replaceWork(result.work); await refreshCatalog(); persistLearning({view: 'work', episodeId: null})
      })
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось открыть сохранённую работу.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  const requestHelp = async () => {
    if (busyRef.current) return
    if(workRef.current?.mode !== 'solo'){captureWorkspaceReturn();setPanelOpen(true);return}
    if(!await confirmHelp())return
    if(busyRef.current)return
    busyRef.current = true; setBusy('switch'); setServerError('')
    try {
      await enqueue(async () => { const work = await saveCurrent(); const result = await api<{ work: Work; memory: AppState['memory'] }>('/api/work/mode', { workId: work.id, mode: 'guided', expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: helpRequestId.current ??= crypto.randomUUID() }); acceptWork(result.work); helpRequestId.current = null; setState(previous => previous ? { ...previous, memory: result.memory } : previous); await refreshCatalog(); setPanelOpen(true); setToast('Самостоятельная попытка сохранена. Теперь можно разбирать решение вместе.') })
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось включить помощь.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  const submit = async () => {
    if (busyRef.current || (!answerRef.current.trim() && !generalRef.current.trim())) return
    busyRef.current = true; setBusy('submit'); setServerError('')
    try {
      await enqueue(async () => {
        const workId = workRef.current!.id
        const key = `pole.pending-submit.v1.${workId}`
        let requestId = learnerStorage.getItem(key)
        if (requestId) {
          const found = await api<{work:Work;submission:Submission|null;memory:AppState['memory']}>('/api/submit/lookup', {workId,requestId})
          if (found.submission) {
            acceptWork({...workRef.current!, mode:found.work.mode, modeEpoch:found.work.modeEpoch, submissions:found.work.submissions})
            setState(previous => previous ? {...previous,memory:found.memory} : previous)
            learnerStorage.removeItem(key)
            await refreshCatalog()
            setToast('Эта попытка уже сохранена. Повторный разбор не создавался.')
            return
          }
        }
        const work = await saveCurrent()
        requestId ??= crypto.randomUUID()
        learnerStorage.setItem(key,requestId)
        const result = await api<{ work: Work; submission: Submission; memory: AppState['memory'] }>('/api/submit', { workId: work.id, requestId, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch })
        acceptWork(result.work); learnerStorage.removeItem(key)
        setState(previous => previous ? { ...previous, memory: result.memory } : previous)
        await refreshCatalog()
      })
      await refreshRoute()
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось получить результат.'); await refreshAfterError() }
    finally { busyRef.current = false; setBusy(null) }
  }
  const pendingReviews = state?.work.submissions.filter(item => item.reviewStatus === 'pending' || item.findings?.some(finding => finding.objections.some(objection => objection.status === 'pending'))).map(item => item.id).join(',') ?? ''
  useEffect(() => {
    if (!pendingReviews) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const id = state?.work.id
    const poll = async () => {
      try {
        const latest = await api<AppState>('/api/state')
        if (!stopped && latest.work.id === id && workRef.current?.id === id) {
          acceptWork({ ...workRef.current, submissions: latest.work.submissions })
        }
      } catch { /* Keep the saved result visible; a later poll can recover. */ }
      if (!stopped) timer = setTimeout(() => void poll(), 2500)
    }
    timer = setTimeout(() => void poll(), 1500)
    return () => { stopped = true; clearTimeout(timer) }
  }, [pendingReviews, state?.work.id, acceptWork])
  const retryReview = async (submissionId: string) => {
    const work = workRef.current
    if (!work || busyRef.current) return
    try {
      const result = await api<{work: Work}>('/api/submit/review', {workId: work.id, submissionId})
      if (workRef.current?.id === work.id) acceptWork({...workRef.current, submissions: result.work.submissions})
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось повторить разбор.') }
  }
  useEffect(() => {
    if (loading || learning.view !== 'home') return
    let active = true
    api<{route:StudyRouteState}>('/api/study-route').then(result => {if(active){setStudyRoute(result.route);setRouteError('')}}).catch(error => {if(active)setRouteError(error.message)})
    return () => {active=false}
  }, [loading, learning.view, state?.work.id])
  const refreshMixed = async () => { try {setMixed((await api<{mixed:MixedPracticeState|null}>('/api/mixed')).mixed);setMixedError('')}catch(error){setMixedError(error instanceof Error?error.message:'Не удалось загрузить подборку.')} }
  useEffect(() => {if(!loading)void refreshMixed()},[loading,learning.view,state?.work.id,state?.work.submissions.length])
  const mixedAction = async (action:'start'|'next') => {
    if(busyRef.current)return
    busyRef.current=true;setBusy('switch');setMixedError('')
    try {await enqueue(async()=>{
      await learningQueue.current.catch(()=>undefined);await saveCurrent()
      if(!mixedRequest.current || mixedRequest.current.action!==action)mixedRequest.current={action,requestId:crypto.randomUUID(),expectedRevision:mixed?.revision??0}
      const result=await api<{mixed:MixedPracticeState;work?:Work}>(`/api/mixed/${action}`,mixedRequest.current)
      mixedRequest.current=null;setMixed(result.mixed)
      if(result.work){replaceWork(result.work);await refreshCatalog();persistLearning({view:'work',episodeId:null})}
      else{persistLearning({view:'home',episodeId:null});setHomeSection('study')}
      setPanelOpen(false);setTrigEntry(false);window.scrollTo(0,0)
    })}catch(error){setMixedError(error instanceof Error?error.message:'Не удалось открыть подборку.')}finally{busyRef.current=false;setBusy(null)}
  }
  const refreshRoute = async (options: {preferredPackage?:TaskContract['packageId'];skipCurrent?:boolean} = {}) => {
    try {
      const current = await api<{route:StudyRouteState}>('/api/study-route')
      const result = await api<{route:StudyRouteState}>('/api/study-route', {expectedRevision:current.route.revision,...options})
      setStudyRoute(result.route);setRouteError('')
    } catch(error){setRouteError(error instanceof Error?error.message:'Не удалось обновить маршрут.')}
  }
  // The caller saves the current work and owns the navigation queue.
  const runStudyAction = async (action: StudyRouteAction) => {
    if (action.type === 'open') {
      if (action.workId !== workRef.current?.id) {
        const result = await api<{work:Work}>('/api/work/open', {workId:action.workId})
        replaceWork(result.work)
      }
    } else {
      const result = await api<{work:Work}>('/api/work/new',{packageId:action.packageId,mode:action.mode,taskId:action.taskId,...(action.packageId==='trigonometry'?{generate:true}:{})})
      replaceWork(result.work)
    }
    await refreshCatalog()
    persistLearning({view:'work',episodeId:null});setPanelOpen(false);setTrigEntry(false);window.scrollTo(0,0)
  }
  const advanceStudyRoute = async () => {
    if (busyRef.current) return
    busyRef.current=true;setBusy('switch');setServerError('')
    try {
      await enqueue(async () => {
        await learningQueue.current
        await saveCurrent()
        // Read after submission/save, then refresh through the route's CAS.
        // Its current action may intentionally resume another unfinished work;
        // neither catalogue order nor next[0] represents that learner choice.
        const current=await api<{route:StudyRouteState}>('/api/study-route')
        const result=await api<{route:StudyRouteState}>('/api/study-route',{expectedRevision:current.route.revision})
        setStudyRoute(result.route);setRouteError('')
        await runStudyAction(result.route.current.action)
      })
    } catch(error) {setServerError(error instanceof Error?error.message:'Не удалось продолжить маршрут.')}
    finally {busyRef.current=false;setBusy(null)}
  }
  const routeAction = async (action: StudyRouteAction) => {
    if(action.type==='open') {
      if(action.workId===workRef.current?.id)persistLearning({view:'work',episodeId:null})
      else await openWork(action.workId)
      return
    }
    if(busyRef.current)return
    busyRef.current=true;setBusy('switch');setServerError('')
    try{await enqueue(async()=>{
      await learningQueue.current
      await saveCurrent()
      await runStudyAction(action)
    });await refreshRoute({preferredPackage:action.packageId})}catch(error){setServerError(error instanceof Error?error.message:'Не удалось открыть занятие.')}
    finally{busyRef.current=false;setBusy(null)}
  }
  const reviewAction = async (body: ReviewActionBody) => {
    if(busyRef.current)throw Error('Дождись сохранения текущего действия.')
    busyRef.current=true;setBusy('switch')
    try{await enqueue(async()=>{
      const current=await saveCurrent()
      const result=await api<{work:Work}>('/api/review/action',{...body,expectedRevision:current.revision,expectedModeEpoch:current.modeEpoch})
      acceptWork(result.work)
      if(body.action==='correct'){setTab('solution');setPanelOpen(false);setToast('Исходная попытка сохранена. Исправь запись и отправь её на проверку ещё раз.')}
    })}finally{busyRef.current=false;setBusy(null)}
  }
  const locateReview = (anchor:ReviewAnchor) => {
    if(anchor.kind==='block' && isScalarProblem(workRef.current)){
      const input=document.querySelector<HTMLTextAreaElement>('.percentage-writing textarea')
      if(input){input.focus();const at=input.value.indexOf(anchor.quote);if(at>=0)input.setSelectionRange(at,at+anchor.quote.length);else setToast('Цитата относится к сданной попытке. Текущая запись уже изменена.')}
      return
    }
    if(anchor.kind==='block' && anchor.blockId){bridge.current?.focusBlock(anchor.blockId);return}
    if(anchor.kind==='numeric'){document.querySelector<HTMLInputElement>('.percentage-answer')?.focus();return}
    const part=anchor.kind==='answer_a'?'a':'b'
    const block=deriveNotebookAnswers(notebookRef.current.document)[part][0]
    if(block)bridge.current?.focusBlock(block.id)
    else setToast('Эта строка была в сданной попытке. Её цитата сохранена в разборе; текущий лист уже изменён.')
  }
  const openMaterial = (id: string) => {
    if (learningRef.current.view !== 'materials') {captureWorkspaceReturn();updateNavigation({...navigationRef.current, materialReturn: {view: learningRef.current.view, episodeId: learningRef.current.episodeId}})}; persistLearning({view: 'materials'}); setTab('theory'); setMaterialTarget(previous => ({ id, token: (previous?.token ?? 0) + 1 }))
    if (window.innerWidth < 900) setPanelOpen(false)
  }
  const locate = (context: ChatContext) => {
    if(context.anchor.origin === 'material' && isScalarProblem(workRef.current)){setToast('Эта ссылка не относится к материалам текущей темы. Открой подготовку рядом с задачей.');return}
    if (context.anchor.origin === 'material') { if (learningRef.current.view !== 'materials') updateNavigation({...navigationRef.current, materialReturn: {view: learningRef.current.view, episodeId: learningRef.current.episodeId}}); persistLearning({view: 'materials'}); setTab('theory'); setMaterialTarget(previous => ({ id: context.anchor.blockId, token: (previous?.token ?? 0) + 1 })); setTimeout(() => document.getElementById(`material-${context.anchor.blockId}`)?.scrollIntoView({ block: 'center', behavior: preferredScrollBehavior() }), 30) }
    else { persistLearning({view: 'work'}); setTab('solution'); setTimeout(() => bridge.current?.focusBlock(context.anchor.blockId), 30) }
    if (window.innerWidth < 900) setPanelOpen(false)
  }
  const download = () => {
    const raw = initial.error ? initial.raw ?? '{}' : JSON.stringify({ ...currentDraftExport(notebookRef.current, workRef.current, answerRef.current, generalRef.current), memory: state?.memory, pendingPreparationDraft: preparationDraft.current, conflictingPreparationDraft: preparationConflict.current }, null, 2)
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'pole-notebook.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const downloadRecovery = () => {
    if (!recoveryRaw) return
    const url = URL.createObjectURL(new Blob([recoveryRaw], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'pole-local-recovery.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const downloadLearningRecovery = () => {
    const raw = learningRecovery ?? learnerStorage.getItem(learningDraftKey)
    if (!raw) return
    const url = URL.createObjectURL(new Blob([raw],{type:'application/json'}))
    const link = document.createElement('a'); link.href = url; link.download = 'pole-learning-recovery.json'; link.click()
    setTimeout(() => URL.revokeObjectURL(url),1000)
  }
  const restoreLearning = async () => {
    try {
      await learningQueue.current.catch(() => undefined)
      const raw = learnerStorage.getItem(learningDraftKey)
      if (raw) {
        setLearningRecovery(raw)
        learnerStorage.setItem(`${learningDraftKey}.conflict.${Date.now()}`,raw)
      }
      const {session} = await api<{session:LearningSession}>('/api/learning')
      learningRef.current = session; setLearning(session); learningRevision.current = session.revision ?? 0
      learningBlocked.current = false; learnerStorage.removeItem(learningDraftKey); setLearningSaveState('saved')
      setLearningError(raw ? 'Открыта сохранённая версия. Предыдущий локальный ответ сохранён отдельной копией.' : '')
    } catch { setLearningError('Связь не восстановилась. Локальный ответ сохранён; попробуй ещё раз.') }
  }
  const enterLearning = async (entry: 'explain' | 'refresh' | 'solve') => {
    if (entry === 'solve') { persistLearning({entry}); await newWork(true); return }
    if (workRef.current?.mode === 'solo') { await requestHelp(); if (workRef.current?.mode === 'solo') return }
    setPanelOpen(false)
    updateNavigation({...navigationRef.current, episodeReturn: entry === 'explain' ? 'course' : {view: 'diagnostic', episodeId: null}, episodeTrail: []})
    persistLearning({entry, view: entry === 'explain' ? 'episode' : 'diagnostic', episodeId: entry === 'explain' ? 'K1' : null,
      ...(entry === 'explain' ? {progress: {...learningRef.current.progress, K1: emptyEpisodeProgress()}} : {})})
  }
  const goEpisode = (episodeId: string, intent?: 'practice') => {
    updateNavigation(addressedEpisodeNavigation(navigationRef.current, {view:learningRef.current.view, episodeId:learningRef.current.episodeId}))
    setPanelOpen(false); persistLearning({view:'episode',episodeId, ...(intent === 'practice' ? {progress: {...learningRef.current.progress, [episodeId]: {...emptyEpisodeProgress(), step: 1}}} : {})}); window.scrollTo(0,0)
  }
  const completeEpisode = (progress?: EpisodeProgress) => {
    if (progress && learningRef.current.episodeId) persistLearning({progress: {...learningRef.current.progress, [learningRef.current.episodeId]: progress}})
    if (navigationRef.current.episodeReturn === 'course' && learningRef.current.episodeId === 'M1') { void newWork(true); return }
    const target = episodeCompletion(navigationRef.current, learningRef.current.episodeId ?? '')
    if (navigationRef.current.episodeReturn !== 'course') {
      const trail = navigationRef.current.episodeTrail ?? []
      updateNavigation({...navigationRef.current, episodeReturn: trail.at(-1) ?? {view:'home',episodeId:null}, episodeTrail: trail.slice(0,-1)})
    }
    persistLearning(target)
    setTab('solution'); setPanelOpen(false); window.scrollTo(0,0)
  }
  const work = state?.work
  const solo = work?.mode === 'solo'
  const problem = state?.problems.find(item => item.id === work?.problemId)
  const numeric = isScalarProblem(problem ?? work)
  const inMixed = mixed?.status === 'active' && mixed.currentWorkId === work?.id
  const latestSubmission = work?.submissions.filter(item => item.reason === 'submitted').at(-1)
  const submissionIsCurrent = isCurrentSubmission(latestSubmission,notebook.document,finalAnswer,generalAnswer)
  const legacy = notebook.annotations
  const preparation = work?.preparation && !work.preparation.completed ? work.preparation : null
  const exercise = state?.exercises?.find(item => item.id === preparation?.exerciseId)

  const goHomeSection=(section:'study'|'tasks'|'materials')=>{persistLearning({view:'home'});setTrigEntry(false);setHomeSection(section);setPanelOpen(false);window.scrollTo(0,0)}
  const focusAnswer=(part:'a'|'b')=>{const item=deriveNotebookAnswers(notebookRef.current.document)[part][0];if(item)bridge.current?.focusBlock(item.id);else bridge.current?.insertAnswer(part)}
  return <div className={`app-shell mathmaxing-app view-${learning.view} ${numeric?'scalar-work':'extended-work'} ${quietEffects?'quiet-effects':''}`}>
    <aside className="workspace-sidebar" inert={panelOpen&&narrowWorkspace}>
      <a href="#home" className="workspace-brand" aria-label="На главную" onClick={()=>goHomeSection('study')}><BrandWordmark/></a>
      <div className="sidebar-navigation-frame"><GlassSurface material={quietEffects ? 'frost' : 'lens'} className="sidebar-navigation-glass"><nav aria-label="Основная навигация">{([{id:'study',label:'Заниматься',Icon:StudyCapIcon},{id:'tasks',label:'Задания',Icon:Grid2X2},{id:'materials',label:'Материалы',Icon:BookOpen}] as const).map(({id,label,Icon})=><button key={id} disabled={!!busy} aria-current={learning.view==='home'&&homeSection===id?'page':undefined} onClick={()=>goHomeSection(id)}><Icon size={18}/>{label}</button>)}</nav></GlassSurface></div>
      <div className="sidebar-bottom"><span className="sidebar-exam">Профильный ЕГЭ</span><button onClick={()=>setHelpOpen(true)}><CircleHelp size={16}/>Как заниматься</button><button onClick={download}><Download size={16}/>Скачать мою работу</button></div>
    </aside>
    <div className="main-app"><header className="topbar" inert={panelOpen&&narrowWorkspace}><span className="workspace-location">{learning.view==='home'?(homeSection==='study'?'Профильная математика':homeSection==='tasks'?'Выбрать задание':'Объяснения и примеры'):learning.view==='materials'?'Материалы занятия':learning.view==='episode'?'Разбираемся в теме':'Занятие'}</span><div className="topbar-actions"><span className="exam-format">Формат 2026</span><button className="icon-button" aria-label="Как пользоваться" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/></button></div></header>
      <div className={`workspace ${solo ? 'is-solo' : ''} ${panelOpen ? 'has-open-mentor' : 'mentor-closed'}`}>
        <main id="notebook" className="notebook-column" inert={busy === 'switch' || (panelOpen && narrowWorkspace)}>
          {!loading && ['work','diagnostic'].includes(learning.view) && <nav className="learning-breadcrumb"><button onClick={() => { persistLearning({view: 'home'}); setTrigEntry(false); setPanelOpen(false) }}>← К занятиям</button></nav>}
          {!loading && learning.view === 'home' && !trigEntry && <StudyHome secondaryContent={<MixedPracticeCard mixed={mixed} busy={!!busy} onStart={()=>void mixedAction('start')} onResume={()=>{if(mixed?.currentWorkId)void openWork(mixed.currentWorkId)}}/>} packages={state?.packages} onDirection={(id, destination) => { if (['percentages','trigonometry','graphs','inequalities'].includes(id)) void openDirection(id as TaskContract['packageId'], destination === 'materials' ? 'materials' : 'entry') }} studyContent={studyRoute ? <StudyRoute route={studyRoute} busy={!!busy} onAction={action => void routeAction(action)} onRefresh={() => void refreshRoute()} onChoose={preferredPackage => void refreshRoute({preferredPackage})} onSkip={() => void refreshRoute({skipCurrent:true})}/> : undefined} resumeLabel={!numeric && navigation.resume.view === 'episode' ? learningEpisodes.find(item => item.id === navigation.resume.episodeId)?.title : !numeric && navigation.resume.view === 'diagnostic' ? 'Короткая проба по тригонометрии' : undefined} section={homeSection} onSection={setHomeSection} work={work} works={state?.works ?? []} problems={state?.problems ?? []} busy={!!busy} onResume={() => { persistLearning(numeric || solo ? {view:'work',episodeId:null} : navigationRef.current.resume); setPanelOpen(false) }} onPercentStart={() => void openDirection('percentages')} onTrigStart={() => void openDirection('trigonometry')} onPercentMaterials={() => void openDirection('percentages','materials')} onTrigMaterials={() => void openDirection('trigonometry','materials')} onOpenWork={id => id === work?.id ? persistLearning({view:'work',episodeId:null}) : void openWork(id)} />}
          {!loading && learning.view === 'work' && inMixed && mixed && <MixedPracticeBanner mixed={mixed} busy={!!busy} onNext={()=>void mixedAction('next')} onResume={()=>{if(mixed.currentWorkId)void openWork(mixed.currentWorkId)}}/>}
          {mixedError && <p role="alert">{mixedError} <button onClick={()=>{mixedRequest.current=null;void refreshMixed()}}>Обновить подборку</button></p>}
          {!loading && learning.view === 'home' && trigEntry && <><button className="outline-button" onClick={() => setTrigEntry(false)}>← Все занятия</button><LearningHome learning={learning} solo={!!solo} busy={!!busy} works={state?.works.filter(item => workPackage(item,state.problems) === 'trigonometry') ?? []} problems={state?.problems.filter(item => !isScalarProblem(item)) ?? []} activeWorkId={work?.id} onEntry={entry => void enterLearning(entry)} resumeLabel={navigation.resume.view === 'diagnostic' ? 'Короткая проба' : navigation.resume.view === 'materials' ? 'Материалы занятия' : undefined} onResume={() => { persistLearning(solo ? {view:'work'} : navigationRef.current.resume); setPanelOpen(false) }} onMaterials={async () => { if (solo) { await requestHelp(); if (workRef.current?.mode === 'solo') return } openMaterial('library') }} onOpenWork={id => id === work?.id ? persistLearning({view: 'work'}) : void openWork(id)} onEpisode={async (id, intent) => { if (workRef.current?.mode === 'solo') { await requestHelp(); if (workRef.current?.mode === 'solo') return } goEpisode(id, intent) }} /></>}
          {!loading && learning.view === 'home' && !trigEntry && <>{routeError && <p role="alert">{routeError}</p>}<ProfileRecovery beforeSwitch={async () => {busyRef.current=true;setBusy('switch');if(saveTimer.current)clearTimeout(saveTimer.current);await enqueue(saveCurrent);await learningQueue.current}} onSwitchFailed={() => {busyRef.current=false;setBusy(null)}}/></>}
          {!loading && !solo && learning.view === 'episode' && learning.episodeId && <LearningEpisode key={learning.episodeId} episodeId={learning.episodeId} progress={learning.progress[learning.episodeId] ?? emptyEpisodeProgress()} onProgress={progress => persistLearning({progress: {...learningRef.current.progress, [learning.episodeId!]: progress}})} onComplete={completeEpisode} onCheck={async (checkId, answer) => { const response = await api<{result: {status: 'correct' | 'incorrect' | 'unknown'; message: string}}>('/api/learning/answer', {workId: work?.id, episodeId: learning.episodeId, checkId, answer}); return response.result }} onAsk={text => { setPanelOpen(true); void send(text) }} completionLabel={navigation.episodeReturn === 'course' ? (learning.episodeId === 'M1' ? 'Решить новый вариант самостоятельно' : `Дальше: ${learningEpisodes.find(e => e.id === episodeCompletion(navigation, learning.episodeId!).episodeId)?.title ?? 'к своей задаче'}`) : 'Вернуться к занятию'} onMaterial={openMaterial} onBack={() => persistLearning({view: 'home'})} />}
          {!loading && !solo && learning.view === 'diagnostic' && <LearningDiagnostic key={work?.id} workId={work?.id ?? ''} onRecommend={goEpisode} onSolve={() => void enterLearning('solve')} check={body => api('/api/learning/diagnostic', body)} />}
          {!loading && !numeric && !solo && learning.view === 'materials' && <div className="learning-materials"><button className="outline-button" onClick={() => {persistLearning(navigationRef.current.materialReturn);restoreWorkspaceReturn()}}>← Вернуться к занятию</button><Theory family={/^gen-v1-(G[123])-/.exec(work?.problemId ?? "")?.[1] ?? null} solo={!!solo} onPractice={id => goEpisode(id, 'practice')} onAttach={attach} requestedMaterialId={materialTarget?.id} requestToken={materialTarget?.token} /></div>}
          {learningSaveState === 'pending' && <p role="status" className="save-indicator">Сохраняем ответ…</p>}{learningError && <div className="storage-error" role="alert">{learningError}{learningRecovery && <button onClick={downloadLearningRecovery}>Скачать локальный ответ</button>}<button onClick={() => void restoreLearning()}>Открыть сохранённую версию</button></div>}
          {!loading && numeric && work && problem && ['work','materials'].includes(learning.view) && <PercentageWork neutralTitle={inMixed} hideNext={inMixed} key={work.id} work={work} problem={problem} answer={finalAnswer} onAnswer={value => {answerRef.current=value;setFinalAnswer(value);scheduleSave()}} reasoning={notebook.document} onReasoning={document => {notebookRef.current={...notebookRef.current,document};setNotebook(previous=>({...previous,document}));scheduleSave()}} busy={!!busy} saveState={saveState} onSubmit={() => void submit()} onNext={() => void newWork(true, problem.packageId === 'percentages')} onAdvance={problem.packageId === 'percentages' ? () => void advanceStudyRoute() : undefined} onAsk={text => {if(workRef.current?.mode==='solo')return;captureWorkspaceReturn(); if(text) setDraftRequest({text,token:Date.now()}); setPanelOpen(true) }} onHelp={async () => { if (workRef.current?.mode === 'solo') await requestHelp(); setPanelOpen(false); return workRef.current?.mode !== 'solo' }} request={numericRequest} startWithHelp={learning.view === 'materials'} onHome={() => {setTrigEntry(false);persistLearning({view:'home',episodeId:null})}} onReturnToWork={() => persistLearning({view:'work',episodeId:null})} />}
          {numeric && learning.view === 'work' && latestSubmission && submissionIsCurrent && work && <ReviewCycle key={latestSubmission.id} submission={latestSubmission} work={work} busy={!!busy} onAction={reviewAction} onLocate={locateReview} requestSelfcheck={() => api('/api/review/selfcheck',{workId:work.id,submissionId:latestSubmission.id})} onRetry={() => void retryReview(latestSubmission.id)}/>}
          {numeric && learning.view === 'work' && work && work.submissions.length > 0 && <details className="attempt-history"><summary>Предыдущие попытки и исправления ({work.submissions.length})</summary>{work.submissions.slice().reverse().map(attempt=><article key={attempt.id}><strong>{attempt.reason==='help_requested'?'До включения помощи':attempt.correctionOf?'Исправленная попытка':'Сданная попытка'}</strong><Readback node={attempt.document}/><p>Ответ: {attempt.finalAnswer || 'не указан'}</p>{(attempt.id!==latestSubmission?.id || !submissionIsCurrent) && attempt.reason==='submitted' && <ReviewCycle key={attempt.id} submission={attempt} work={work} busy={!!busy} onAction={reviewAction} onLocate={locateReview} requestSelfcheck={() => api('/api/review/selfcheck',{workId:work.id,submissionId:attempt.id})} onRetry={()=>void retryReview(attempt.id)}/>}</article>)}</details>}
          {!numeric && <div hidden={learning.view !== 'work'}>
          {loading ? <div className="loading-card"><LoaderCircle className="is-spinning" size={20} /> Открываю тетрадь…</div> : <>
            <article className={`trig-workspace ${preparation ? 'has-preparation' : ''}`}><section className="assignment" aria-label="Условие задачи" hidden={!!preparation}><button className="assignment-title" onClick={() => setTaskOpen(value => !value)} aria-expanded={taskOpen}><span><span className="task-number">{solo ? <ShieldCheck size={13} /> : <Feather size={13} />}</span>{inMixed ? 'Реши задачу' : '№13 ЕГЭ · тригонометрия'}</span><ChevronDown size={17} className={!taskOpen ? 'rotated' : ''} /></button><h1 className="task-title">{inMixed ? 'Реши задачу' : 'Уравнение и отбор корней'}</h1>{taskOpen && <div className="assignment-body"><p><strong>а)</strong> Реши уравнение. <strong>б)</strong> Отбери корни на указанном отрезке.</p><div className="assignment-math"><MathText value={problem?.equation ?? '\\sin 2x=\\cos x'} /><span className="math-separator" /><MathText value={problem?.interval ?? 'x\\in[-\\pi/2;3\\pi/2]'} /></div></div>}</section>
            <div className="learning-mode"><span className={`mode-label ${solo ? 'solo' : ''}`}>{solo ? <ShieldCheck size={14} /> : <Sparkles size={14} />}{solo ? 'Самостоятельно' : work?.mode === 'review' ? 'Разбор результата' : 'С наставником'}</span>{solo ? <button disabled={!!busy} onClick={() => void requestHelp()}>Нужна помощь <ArrowUpRight size={13} /></button> : !preparation && !inMixed && <button disabled={!!busy || !work} onClick={() => void newWork(true)}>Проверить себя на новой задаче <ArrowUpRight size={13} /></button>}</div>
            {!preparation && <GlassSurface material="frost" className="work-part-nav" role="navigation" aria-label="Части решения"><div><button onClick={()=>focusAnswer('a')}>а) Все решения</button><button onClick={()=>focusAnswer('b')}>б) Отбор корней</button></div><button onClick={()=>{captureWorkspaceReturn();setConditionOpen(true)}}>Условие</button></GlassSurface>}
            {solo && <div className="solo-note">По кнопке «Нужна помощь» сохраним твою запись до подсказки.{work?.priorExposure && <span>Ты уже открывал эту задачу раньше — это повторная попытка.</span>}</div>}
            {!solo && <nav className="scene-tools" aria-label="Помощь в решении"><button className={tab === 'solution' && !preparationChooser ? 'selected' : ''} onClick={() => { setTab('solution'); setPreparationChooser(false) }}><Feather size={16}/>{preparation ? 'Упражнение' : 'Моё решение'}</button><button onClick={() => {if(panelOpen)closeMentor();else{captureWorkspaceReturn();setPanelOpen(true)}}}><Sparkles size={16}/>Наставник{contexts.length ? ` · ${contexts.length}` : ''}</button><details className="lesson-more" onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false }}><summary>Справка и практика</summary><div><button onClick={() => { setPreparationChooser(value => !value); setTab('solution') }}>Выбрать упражнение</button><button onClick={() => openMaterial('sine')}>Материалы</button><button onClick={() => goEpisode('K1')}>Разобраться с основ</button><button onClick={()=>{setTrigEntry(true);persistLearning({view:'home'});setPanelOpen(false)}}>Темы и короткая проба</button>{!preparation && !inMixed && <button disabled={!!busy} onClick={() => void newWork(true)}>Новый вариант самостоятельно</button>}</div></details></nav>}
            {!numeric && learning.view === 'work' && work?.mode === 'guided' && !preparation  && <AdaptiveHelp enabled={mentorEnabled} onEnabled={changeMentorEnabled} key={`guide:${work.id}`} work={work} saved={saveState === 'saved'} busy={!!busy} request={numericRequest} onHelp={async () => {if(workRef.current?.mode === 'solo')await requestHelp();setPanelOpen(false);return workRef.current?.mode !== 'solo'}} onPreparation={() => openMaterial('library')} onExercise={id => void startPreparation(id)} onDiscuss={text => {captureWorkspaceReturn(); setDraftRequest({text, token: Date.now()}); setPanelOpen(true) }} />}
            {!solo && preparationChooser && <PreparationChooser exercises={state?.exercises ?? []} busy={!!busy} onChoose={id => void startPreparation(id)} onBasics={() => { setPreparationChooser(false); openMaterial('sine') }} onClose={() => setPreparationChooser(false)}/>}
            {preparation && <div hidden={tab !== 'solution' || preparationChooser}>{exercise ? <Preparation key={preparation.startedAt} exercise={exercise} preparation={preparation} saveStatus={saveState === 'pending' ? 'Сохраняю ответ…' : saveState === 'failed' ? 'Копия на устройстве' : 'Ответ сохранён'} busy={!!busy} onDraft={draftPreparation} onAnswer={answer => void answerPreparation(answer)} onReturn={() => void returnToSolution()} onMaterial={openMaterial}/> : <section className="preparation-scene"><p>Упражнение сейчас недоступно. Твой лист сохранён.</p><button className="primary-button" onClick={() => void returnToSolution()}>Вернуться к решению</button></section>}</div>}
            <div id="solution-panel" role="tabpanel" aria-label="Моё решение" hidden={tab !== 'solution' || !!preparation || preparationChooser}><section className="paper" aria-label="Рабочий лист" inert={photoOpen}><div className="paper-header"><div><Feather size={17} /><span>Моё решение</span></div><span className={`save-state ${storageError || saveState === 'failed' ? 'save-error' : ''}`} role="status"><Check size={13} />{storageError ? 'Не сохранено' : saveState === 'pending' ? 'Сохраняю…' : saveState === 'failed' ? 'Копия на устройстве' : work ? 'Сохранено' : 'На устройстве'}</span></div>
              <div className="editor-toolbar" role="toolbar" aria-label="Инструменты тетради"><button className="formula-button" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertMath()}><span className="fx">ƒx</span> Формула <Plus size={14} /></button><span className="toolbar-separator" /><button className="symbol-button fraction-symbol" title="Дробь" aria-label="Вставить дробь" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('\\frac{#0}{#?}')}>a<span />b</button><button className="symbol-button" title="Степень" aria-label="Вставить степень" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('#0^{#?}')}>x<sup>n</sup></button><button className="symbol-button" title="Корень" aria-label="Вставить корень" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('\\sqrt{#0}')}>√</button><button className="symbol-button" title="Число пи" aria-label="Вставить пи" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('\\pi')}>π</button><span className="toolbar-space" /><button className="icon-button" title="Отменить · Ctrl Z" aria-label="Отменить изменение" disabled={!bridge.current?.canUndo()} onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.undo()}><Undo2 size={17} /></button><button className="icon-button" title="Повторить · Ctrl Shift Z" aria-label="Повторить изменение" disabled={!bridge.current?.canRedo()} onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.redo()}><Redo2 size={17} /></button></div>
              <NotebookEditor key={work?.id ?? 'local'} initialContent={notebook.document} onChange={onDocumentChange} onSelection={() => refreshToolbar(value => value + 1)} onReady={ready} answersEnabled onRequestAnnotation={anchor=>{if(workRef.current?.mode==='solo')void requestHelp().then(()=>{if(workRef.current?.mode!=='solo')requestAnnotation(anchor)});else requestAnnotation(anchor)}} annotatedBlockIds={solo ? [] : contexts.filter(item => item.anchor.origin !== 'material').map(item => item.anchor.blockId)} />
              <div className="paper-footer"><span>{solo ? 'Запиши обоснование и общий вид корней.' : 'Выдели строку или формулу, чтобы задать вопрос.'}</span><span>Ctrl + Z — отменить</span></div></section>

              {work && <div className="photo-entry">{!photoOpen ? <button className="outline-button" disabled={!!busy} onClick={async () => { try { await enqueue(saveCurrent); setPhotoOpen(true) } catch (error) { setServerError((error as Error).message) } }}>Уже решил на бумаге? Добавить фото</button> : <><button className="outline-button" onClick={() => setPhotoOpen(false)}>К вводу на сайте</button><PhotoSolution workId={work.id} revision={work.revision} modeEpoch={work.modeEpoch} disabled={!!busy || saveState !== 'saved'} onImported={async imported => { replaceWork(imported); bridge.current?.replaceContent(imported.document); await enqueue(saveCurrent) }} onCheck={async () => { await submit() }}/></>}</div>}
              <section className="answer-card"><h2>Мои ответы</h2><p>Отметь строки решения как ответ а) или б). Здесь появится та же запись.</p>{(['a','b'] as const).map(part => { const items = deriveNotebookAnswers(notebook.document)[part]; return <div className="bound-answer" key={part}><h3>{part === 'a' ? 'а) Все решения уравнения' : 'б) Корни на отрезке'}</h3>{items.length ? items.map(item => <button className="answer-source" key={item.id} onClick={() => bridge.current?.focusBlock(item.id)}>{item.kind === 'math' ? <MathText value={item.value}/> : item.value}{!item.value.trim() && <span>Ответ пока не указан</span>}<small>К строке решения ↗</small></button>) : <button className="outline-button" onClick={() => bridge.current?.insertAnswer(part)}>Вписать ответ {part === 'a' ? 'а' : 'б'})</button>}</div> })}<div className="answer-footer"><button className="primary-button" disabled={photoOpen || !!busy || !work || (!finalAnswer.trim() && !generalAnswer.trim())} onClick={() => void submit()}>{busy === 'submit' ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}{busy === 'submit' ? 'Проверяем…' : 'Проверить мою работу'}</button></div></section>
              {latestSubmission && !submissionIsCurrent && <p className="changed-work-note" role="status">Запись изменилась после проверки. Отправь её ещё раз; прежний результат сохранён в попытках.</p>}
              {latestSubmission && submissionIsCurrent && <Result hideNext={inMixed} onFix={part => { if(!work)return;void reviewAction({workId:work.id,submissionId:latestSubmission.id,action:'correct',requestId:crypto.randomUUID(),expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,expectedReviewVersion:latestSubmission.reviewVersion??0}).then(()=>{const block=deriveNotebookAnswers(notebookRef.current.document)[part][0];if(block)bridge.current?.focusBlock(block.id);else bridge.current?.insertAnswer(part)}).catch(error=>setServerError(error.message)) }} exercises={state?.exercises ?? []} onOpenExercise={id => void startPreparation(id)} onOpenMaterial={openMaterial} submission={latestSubmission} onRetry={() => void retryReview(latestSubmission.id)} busy={!!busy} onNext={() => void newWork(true)} />}
              {latestSubmission && submissionIsCurrent && work && <ReviewCycle key={latestSubmission.id} submission={latestSubmission} work={work} busy={!!busy} onAction={reviewAction} onLocate={locateReview} requestSelfcheck={() => api('/api/review/selfcheck',{workId:work.id,submissionId:latestSubmission.id})} onRetry={() => void retryReview(latestSubmission.id)}/>}
              {!!work?.submissions.length && <details className="attempt-history"><summary>Сохранённые попытки <span>{work.submissions.length}</span></summary>{work.submissions.slice().reverse().map(attempt => <article key={attempt.id}><div><strong>{attempt.reason === 'help_requested' ? 'До включения помощи' : 'Отправлено на проверку'}</strong><span>{attempt.mode === 'solo' ? 'Самостоятельно' : 'С помощью'} · {new Date(attempt.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span></div><Readback node={attempt.document} />{attempt.generalAnswer && <p className="attempt-answer">а) <MathText value={toMathAnswerLatex(attempt.generalAnswer)} /></p>}{attempt.finalAnswer && <p className="attempt-answer">б) <MathText value={toMathAnswerLatex(attempt.finalAnswer)} /></p>}{(attempt.id!==latestSubmission?.id || !submissionIsCurrent) && attempt.reason==='submitted' && <ReviewCycle key={attempt.id} submission={attempt} work={work} busy={!!busy} onAction={reviewAction} onLocate={locateReview} requestSelfcheck={() => api('/api/review/selfcheck',{workId:work.id,submissionId:attempt.id})} onRetry={()=>void retryReview(attempt.id)}/>}</article>)}</details>}
            </div>
            </article>
          </>}
          </div>
          }
          {serverError && <div className="storage-error server-error" role="alert">{serverError}<div><button onClick={() => { if (!work) void boot(); else void enqueue(saveCurrent).then(() => setServerError('')).catch(error => setServerError(error.message)) }}><RefreshCw size={12} />{work ? 'Повторить сохранение' : 'Подключиться снова'}</button><button onClick={download}>Скачать копию</button></div></div>}
          {recoveryRaw && <div className="storage-error"><span>Локальный черновик сохранён отдельно и не заменяет открытую работу.</span><button onClick={downloadRecovery}>Скачать локальный черновик</button></div>}
          {storageError && <div className="storage-error" role="alert">{storageError}<button onClick={download}>Скачать копию</button></div>}
          {learning.view === 'home' && !!state?.memory.length && <details className="learning-memory"><summary><BookOpen size={14} /> История занятий <span>{state.memory.length}</span></summary>{state.memory.slice(0,5).map(event => <article key={event.id}><span>{event.independent ? 'Самостоятельно' : 'Практика'} · {new Date(event.createdAt).toLocaleDateString('ru')}</span><p>{event.summary}</p></article>)}</details>}
        </main>
        {!solo && learning.view !== 'home' && <div className="mentor-column">{!solo && <ChatPanel key={`chat:${work?.id ?? 'local'}`} draftRequest={draftRequest} draftKey={`pole.chat-draft.v1.${work?.id ?? 'local'}`} onDraftConsumed={() => setDraftRequest(undefined)} open={panelOpen} onClose={closeMentor} provider={provider} messages={work?.messages ?? []} contexts={contexts} onContexts={setContexts} onSend={send} onRetry={requestId => void send('', requestId)} onCheck={() => void checkConnection()} onLocate={locate} busy={busy === 'chat'} blocked={!!busy || !work} checking={checking} notes={legacy} exercises={state?.exercises} onOpenExercise={id => void startPreparation(id)} />}</div>}
      </div>{!panelOpen && !solo && learning.view !== 'home' && <button className="floating-notes" onClick={() => setPanelOpen(true)}><Sparkles size={17} /> Наставник</button>}
    </div>
    {helpConfirmOpen && <WorkspaceDialog title="Продолжить с наставником?" onClose={()=>finishHelpConfirmation(false)}><p>Сохраним твою самостоятельную попытку. Дальше продолжишь с помощью — так и отметим результат.</p><p className="workspace-dialog-note">После разбора можно решить новый вариант самому.</p><div className="workspace-dialog-actions"><button className="outline-button" onClick={()=>finishHelpConfirmation(false)}>Пока сам</button><button className="primary-button" onClick={()=>finishHelpConfirmation(true)}>Открыть помощь</button></div></WorkspaceDialog>}
    {conditionOpen && <WorkspaceDialog title="Условие · задание №13" onClose={()=>{setConditionOpen(false);restoreWorkspaceReturn()}}><p>а) Реши уравнение. б) Отбери корни на указанном отрезке.</p><div className="condition-dialog-math"><MathText value={problem?.equation??''}/><MathText value={problem?.interval??''}/></div><button className="primary-button" onClick={()=>{setConditionOpen(false);restoreWorkspaceReturn()}}>К моей записи</button></WorkspaceDialog>}
    {toast && <div className="toast" role="status">{toast}</div>}
    {helpOpen && <WorkspaceDialog title="Как заниматься" onClose={()=>setHelpOpen(false)}><ol className="workspace-help-list"><li><strong>Решай в своём темпе.</strong> Записывай рассуждение словами и формулами. Готовые строки можно отметить как ответы а) и б).</li><li><strong>Спрашивай о конкретном месте.</strong> Выдели фрагмент или формулу и добавь в чат. Перед помощью сохраним самостоятельную попытку.</li><li><strong>Возвращайся к своей записи.</strong> Короткая подготовка и материалы открываются отдельно. Текущая работа остаётся на месте.</li><li><strong>Проверяй себя.</strong> После разбора попробуй новый вариант без подсказок. Прежние попытки и исправления сохраняются.</li></ol><label className="quiet-effects-setting"><input type="checkbox" checked={quietEffects} onChange={event=>{const quiet=event.target.checked;setQuietEffects(quiet);try{learnerStorage.setItem('mathmaxing.effects',quiet?'quiet':'full')}catch{setToast('Настройка действует до закрытия страницы.')}}}/>Спокойный вид: без движения и прозрачности</label><p className="workspace-dialog-note">Работа сохраняется на сервере. Для переноса на другое устройство сохрани код внизу главной. Наставник получает вопрос и контекст занятия, включая запись решения.</p><div className="workspace-dialog-actions"><button className="outline-button" onClick={download}><Download size={15}/> Скачать работу</button><button className="primary-button" onClick={()=>setHelpOpen(false)}>К занятию</button></div></WorkspaceDialog>}
  </div>
}

function Result({ submission, busy, onNext, onFix, hideNext=false }: { hideNext?:boolean; submission: Submission; busy: boolean; onNext(): void; onFix(part: 'a' | 'b'): void; onOpenMaterial(id: string): void; exercises: PreparationExercise[]; onOpenExercise(id: string): void; onRetry(): void }) {
  const needsA = submission.seriesResult?.status !== 'correct'
  const needsB = submission.result.status !== 'correct'
  const part = needsA ? 'a' : 'b'
  const unknown = (needsA ? submission.seriesResult : submission.result)?.status === 'unknown'
  return <section className="result-card" aria-label="Результат проверки">
    <h2>Проверка отправленного решения</h2>
    <div className={`series-result is-${submission.seriesResult?.status ?? 'unknown'}`}><h3>а) Все решения уравнения</h3><p>{submission.generalAnswer ? submission.seriesResult?.summary ?? 'Эта часть пока не проверена.' : 'Ответ пока не указан.'}</p>{submission.generalAnswer && <MathText value={toMathAnswerLatex(submission.generalAnswer)}/>}</div>
    <div className={`series-result is-${submission.result.status}`}><h3>б) Корни на отрезке</h3><p>{submission.finalAnswer ? submission.result.summary : 'Ответ пока не указан.'}</p>{submission.finalAnswer && <MathText value={toMathAnswerLatex(submission.finalAnswer)}/>}</div>
    <p className="result-boundary">Совпадение ответов не подтверждает всё обоснование.</p>

    <div className="result-footer"><span>{submission.mode === 'solo' ? 'Отправлено без подсказок' : 'Отправлено с помощью'}</span>{needsA || needsB ? <button className="primary-button" disabled={busy} onClick={() => onFix(part)}>{unknown ? 'Уточнить запись' : part === 'a' ? 'Исправить общее решение' : 'Исправить отбор'} {part === 'a' ? 'а)' : 'б)'}</button> : !hideNext && <button className="primary-button" disabled={busy} onClick={onNext}>Решить новый вариант самостоятельно</button>}</div>
  </section>
}

function Readback({ node }: { node: JSONContent }) {
  if (node.type === 'mathBlock') return <div className="attempt-formula"><MathText value={node.attrs?.latex ?? ''} /></div>
  if (node.type === 'text') return <>{node.text}</>
  if (node.type === 'hardBreak') return <br />
  const children = node.content?.map((child, index) => <Readback key={index} node={child} />)
  if (node.type === 'paragraph' || node.type === 'heading') return <p>{children}</p>
  return <div>{children}</div>
}
