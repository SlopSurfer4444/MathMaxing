import { learnerStorage, visitorHeaders } from './visitor-session'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, BookOpen, Check, ChevronDown, CircleHelp, Download, Feather, LoaderCircle, Plus, Redo2, RefreshCw, ShieldCheck, Sparkles, Undo2, X } from 'lucide-react'
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
import { MentorGuide } from './components/MentorGuide'
import { MathAnswer } from './components/MathAnswer'
import { LearningHome, LearningDiagnostic } from './components/LearningHome'
import { LearningEpisode } from './components/LearningEpisode'
import { emptyEpisodeProgress, type EpisodeProgress } from './learning-content'
import './learning-shell.css'
import { defaultLearningNavigation, readLearningNavigation, addressedEpisodeNavigation, episodeCompletion, type LearningNavigation } from './learning-navigation'
import { mergeWork } from './merge-work'
import { toMathAnswerLatex } from './math-answer'


function loadInitial(): { state: NotebookState; error: string | null; raw: string | null } {
  let raw: string | null = null
  try { raw = learnerStorage.getItem(STORAGE_KEY); return { state: raw ? parseSavedNotebook(raw) : freshNotebook(), error: null, raw } }
  catch { return { state: freshNotebook(), error: 'Сохранённый лист не удалось прочитать. Исходная копия не перезаписана — скачай её для восстановления.', raw } }
}
type PreparationDraft = { workId: string; exerciseId: string; preparationId?: string; startedAt: string; answer: string; baseAnswer: string }
const preparationDraftKey = (draft: Pick<PreparationDraft, 'workId' | 'exerciseId' | 'startedAt'>) => `pole.preparation.${draft.workId}.${draft.startedAt}.${draft.exerciseId}`
const draftSignature = (document: NotebookState['document'], finalAnswer: string, generalAnswer = '') => JSON.stringify({ document, finalAnswer, ...(generalAnswer ? { generalAnswer } : {}) })
type LearningSession = { entry: null | 'explain' | 'refresh' | 'solve'; view: 'home' | 'episode' | 'work' | 'diagnostic' | 'materials'; episodeId: string | null; progress: Record<string, EpisodeProgress>; workId?: string; revision?: number }
const freshLearning = (): LearningSession => ({entry: null, view: 'home', episodeId: null, progress: {}})
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: { ...visitorHeaders(), 'X-Pole-Client': 'notebook-v1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  let data: Record<string, unknown>
  try { data = await response.json() } catch { throw new Error('Сервер тетради недоступен. Проверь, что приложение запущено через npm run dev.') }
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Запрос не выполнен. Твоя работа сохранена в листе.')
  return data as T
}

export default function App() {
  const [initial] = useState(loadInitial)
  const [notebook, setNotebook] = useState(initial.state)
  const [state, setState] = useState<AppState | null>(null)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [storageError, setStorageError] = useState(initial.error)
  const [recoveryRaw, setRecoveryRaw] = useState<string | null>(null)
  const [serverError, setServerError] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'failed'>('saved')
  const [contexts, setContexts] = useState<ChatContext[]>([])
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
  const [helpOpen, setHelpOpen] = useState(false)
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
      { id: work.id, problemId: work.problemId, mode: work.mode, updatedAt: work.updatedAt },
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
    notebookRef.current = { ...notebookRef.current, document }; setNotebook(previous => ({ ...previous, document })); scheduleSave()
  }, [scheduleSave])
  const replaceWork = useCallback((work: Work) => {
    draftBase.current = { workId: work.id, signature: draftSignature(work.document, work.finalAnswer, work.generalAnswer) }
    acceptWork(work);
    try { const nextNavigation = readLearningNavigation(learnerStorage.getItem(`pole.learning-navigation.v1.${work.id}`)); navigationRef.current = nextNavigation; setNavigation(nextNavigation) } catch { setLearningError('Точку возврата не удалось восстановить. Выбери тему в начале занятия.') }
    setFinalAnswer(work.finalAnswer); answerRef.current = work.finalAnswer; setGeneralAnswer(work.generalAnswer ?? ''); generalRef.current = work.generalAnswer ?? ''
    notebookRef.current = { ...notebookRef.current, document: work.document }
    setNotebook(previous => ({ ...previous, document: work.document }))
    // Work identity keys the editor; boot also remounts it after loading. Never
    // mutate an outgoing editor here: its update callback could queue an old save.
    setContexts([]); setTab('solution'); setSaveState('saved'); setPreparationChooser(false); setPanelOpen(false); pendingReturn.current = null
  }, [acceptWork])
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
            else if (active.answer === draft.baseAnswer) {
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
    setContexts(previous => previous.some(item => item.anchor.blockId === context.anchor.blockId && item.anchor.quote === context.anchor.quote) ? previous : [...previous, context]); setPanelOpen(true)
  }, [])
  const requestAnnotation = useCallback((anchor: NotebookSelection) => {
    const block = findBlock(notebookRef.current.document, anchor.blockId)
    if (block) attach({ anchor: { ...anchor, origin: 'notebook' }, source: blockSignature(block) })
  }, [attach])
  const refreshAfterError = async () => {
    try { const latest = await api<AppState>('/api/state'); if (latest.work.id === workRef.current?.id) { acceptWork({ ...workRef.current, mode: latest.work.mode, modeEpoch: latest.work.modeEpoch, messages: latest.work.messages, submissions: latest.work.submissions }); setState(previous => previous ? { ...previous, memory: latest.memory } : previous) } } catch { /* Never discard the visible draft if readback is unavailable. */ }
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
      accepted = !!workRef.current?.messages.some(item => item.requestId === requestId)
    } finally { busyRef.current = false; setBusy(null) }
    if (accepted && !retryId) setContexts(current => current.filter(context => !sentContexts.includes(context)))
    return accepted
  }
  const refreshCatalog = async () => {
    const latest = await api<AppState>('/api/state')
    setState(previous => previous ? { ...previous, exercises: latest.exercises, memory: latest.memory, problems: latest.problems } : latest)
  }
  const newWork = async (_solo: boolean) => {
    if (!state || busyRef.current) return
    busyRef.current = true; setBusy('switch'); setServerError('')
    try {
      await enqueue(async () => {
        await learningQueue.current.catch(() => undefined)
        const work = await saveCurrent()
        const result = await api<{ work: Work; repeated: boolean }>('/api/work/next', { workId: work.id })
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
    const result = await api<{ work: Work }>('/api/preparation/draft', { workId: current.id, preparationId: draft.preparationId ?? current.preparation.id, answer: draft.answer })
    acceptWork(result.work)
    if (preparationDraft.current === draft) {
      preparationDraft.current = null
      try { learnerStorage.removeItem(preparationDraftKey(draft)) } catch { /* Matching acknowledged draft is safe to recover again. */ }
    } else if (preparationDraft.current?.startedAt === draft.startedAt && preparationDraft.current.workId === draft.workId) {
      preparationDraft.current.baseAnswer = result.work.preparation?.answer ?? draft.answer
      try { learnerStorage.setItem(preparationDraftKey(preparationDraft.current), JSON.stringify(preparationDraft.current)) } catch { setStorageError('Ответ упражнения не сохранён на устройстве. Скачай копию перед обновлением страницы.') }
    }
  }
  const draftPreparation = (answer: string) => {
    const work = workRef.current
    if (!work?.preparation || work.preparation.completed) return
    preparationDraft.current = { workId: work.id, preparationId: work.preparation.id, exerciseId: work.preparation.exerciseId, startedAt: work.preparation.startedAt, answer, baseAnswer: preparationDraft.current?.startedAt === work.preparation.startedAt ? preparationDraft.current.baseAnswer : work.preparation.answer }
    try { learnerStorage.setItem(preparationDraftKey(preparationDraft.current), JSON.stringify(preparationDraft.current)) } catch { setStorageError('Ответ упражнения не сохранён на устройстве. Скачай копию перед обновлением страницы.') }
    scheduleSave()
  }
  const answerPreparation = async (answer: string) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy('switch'); setServerError('')
    const preparationId = workRef.current?.preparation?.id
    try { await enqueue(async () => { const work = await saveCurrent(); const result = await api<{ work: Work }>('/api/preparation/answer', { workId: work.id, preparationId, answer }); acceptWork(result.work); await refreshCatalog() }) }
    catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось проверить упражнение.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  const returnToSolution = async () => {
    if (busyRef.current) return
    busyRef.current = true; setBusy('switch'); setServerError('')
    const preparationId = workRef.current?.preparation?.id
    try { await enqueue(async () => { const work = await saveCurrent(); const result = await api<{ work: Work }>('/api/preparation/return', { workId: work.id, preparationId }); pendingReturn.current = result.work.id + ':' + result.work.preparation?.startedAt; acceptWork(result.work); setTab('solution'); setPreparationChooser(false); setToast('Ты снова в своём решении. Продолжай с того места, где остановился.') }) }
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
    if (busyRef.current || !workRef.current || workId === workRef.current.id) return
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
    busyRef.current = true; setBusy('switch'); setServerError('')
    try {
      await enqueue(async () => { const work = await saveCurrent(); const result = await api<{ work: Work; memory: AppState['memory'] }>('/api/work/mode', { workId: work.id, mode: 'guided' }); acceptWork(result.work); setState(previous => previous ? { ...previous, memory: result.memory } : previous); await refreshCatalog(); setPanelOpen(true); setToast('Самостоятельная попытка сохранена. Теперь можно разбирать решение вместе.') })
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось включить помощь.') }
    finally { busyRef.current = false; setBusy(null) }
  }
  const submit = async () => {
    if (busyRef.current || !answerRef.current.trim()) return
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
        const result = await api<{ work: Work; submission: Submission; memory: AppState['memory'] }>('/api/submit', { workId: work.id, requestId })
        acceptWork(result.work); learnerStorage.removeItem(key)
        setState(previous => previous ? { ...previous, memory: result.memory } : previous)
        await refreshCatalog()
      })
    } catch (error) { setServerError(error instanceof Error ? error.message : 'Не удалось получить результат.'); await refreshAfterError() }
    finally { busyRef.current = false; setBusy(null) }
  }
  const pendingReviews = state?.work.submissions.filter(item => item.reviewStatus === 'pending').map(item => item.id).join(',') ?? ''
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
  const openMaterial = (id: string) => {
    if (learningRef.current.view !== 'materials') updateNavigation({...navigationRef.current, materialReturn: {view: learningRef.current.view, episodeId: learningRef.current.episodeId}}); persistLearning({view: 'materials'}); setTab('theory'); setMaterialTarget(previous => ({ id, token: (previous?.token ?? 0) + 1 }))
    if (window.innerWidth < 900) setPanelOpen(false)
  }
  const locate = (context: ChatContext) => {
    if (context.anchor.origin === 'material') { if (learningRef.current.view !== 'materials') updateNavigation({...navigationRef.current, materialReturn: {view: learningRef.current.view, episodeId: learningRef.current.episodeId}}); persistLearning({view: 'materials'}); setTab('theory'); setMaterialTarget(previous => ({ id: context.anchor.blockId, token: (previous?.token ?? 0) + 1 })); setTimeout(() => document.getElementById(`material-${context.anchor.blockId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30) }
    else { persistLearning({view: 'work'}); setTab('solution'); setTimeout(() => bridge.current?.focusBlock(context.anchor.blockId), 30) }
    if (window.innerWidth < 900) setPanelOpen(false)
  }
  const download = () => {
    const raw = initial.error ? initial.raw ?? '{}' : JSON.stringify({ ...notebook, work: workRef.current, memory: state?.memory, pendingPreparationDraft: preparationDraft.current, conflictingPreparationDraft: preparationConflict.current }, null, 2)
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
  const goEpisode = (episodeId: string) => {
    updateNavigation(addressedEpisodeNavigation(navigationRef.current, {view:learningRef.current.view, episodeId:learningRef.current.episodeId}))
    setPanelOpen(false); persistLearning({view:'episode',episodeId}); window.scrollTo(0,0)
  }
  const completeEpisode = () => {
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
  const latestSubmission = work?.submissions.filter(item => item.reason === 'submitted').at(-1)
  const legacy = notebook.annotations
  const preparation = work?.preparation && !work.preparation.completed ? work.preparation : null
  const exercise = state?.exercises?.find(item => item.id === preparation?.exerciseId)

  return <div className="app-shell">
    <div className="main-app"><header className="topbar"><a href="#home" onClick={() => { persistLearning({view: 'home'}); setPanelOpen(false) }} className="wordmark">поле<span> / ЕГЭ · уравнения</span></a><div className="topbar-actions"><button className="icon-button" aria-label="Как пользоваться" onClick={() => setHelpOpen(true)}><CircleHelp size={18}/></button><button className="icon-button" aria-label="Скачать копию тетради" title="Скачать копию" onClick={download}><Download size={18}/></button></div></header>
      <div className={`workspace ${solo ? 'is-solo' : ''}`}>
        <main id="notebook" className="notebook-column" inert={busy === 'switch'}>
          {!loading && ['work','diagnostic'].includes(learning.view) && <nav className="learning-breadcrumb"><button onClick={() => { persistLearning({view: 'home'}); setPanelOpen(false) }}>← К занятиям</button></nav>}
          {!loading && learning.view === 'home' && <LearningHome learning={learning} solo={!!solo} busy={!!busy} works={state?.works ?? []} problems={state?.problems ?? []} activeWorkId={work?.id} onEntry={entry => void enterLearning(entry)} resumeLabel={navigation.resume.view === 'diagnostic' ? 'Короткая проба' : navigation.resume.view === 'materials' ? 'Материалы занятия' : undefined} onResume={() => { persistLearning(solo ? {view:'work'} : navigationRef.current.resume); setPanelOpen(false) }} onMaterials={async () => { if (solo) { await requestHelp(); if (workRef.current?.mode === 'solo') return } openMaterial('library') }} onOpenWork={id => id === work?.id ? persistLearning({view: 'work'}) : void openWork(id)} onEpisode={id => { if (!solo) goEpisode(id) }} />}
          {!loading && !solo && learning.view === 'episode' && learning.episodeId && <LearningEpisode key={learning.episodeId} episodeId={learning.episodeId} progress={learning.progress[learning.episodeId] ?? emptyEpisodeProgress()} onProgress={progress => persistLearning({progress: {...learningRef.current.progress, [learning.episodeId!]: progress}})} onComplete={completeEpisode} onCheck={async (checkId, answer) => { const response = await api<{result: {status: 'correct' | 'incorrect' | 'unknown'; message: string}}>('/api/learning/answer', {workId: work?.id, episodeId: learning.episodeId, checkId, answer}); return response.result }} onAsk={text => { setDraftRequest({text, token: Date.now()}); setPanelOpen(true) }} onMaterial={openMaterial} onBack={() => persistLearning({view: 'home'})} />}
          {!loading && !solo && learning.view === 'diagnostic' && <LearningDiagnostic key={work?.id} workId={work?.id ?? ''} onRecommend={goEpisode} onSolve={() => void enterLearning('solve')} check={body => api('/api/learning/diagnostic', body)} />}
          {!loading && !solo && learning.view === 'materials' && <div className="learning-materials"><button className="outline-button" onClick={() => persistLearning(navigationRef.current.materialReturn)}>← Вернуться к занятию</button><Theory onPractice={goEpisode} onAttach={attach} requestedMaterialId={materialTarget?.id} requestToken={materialTarget?.token} /></div>}
          {learningSaveState === 'pending' && <p role="status" className="save-indicator">Сохраняем ответ…</p>}{learningError && <div className="storage-error" role="alert">{learningError}{learningRecovery && <button onClick={downloadLearningRecovery}>Скачать локальный ответ</button>}<button onClick={() => void restoreLearning()}>Открыть сохранённую версию</button></div>}
          <div hidden={learning.view !== 'work'}>
          {loading ? <div className="loading-card"><LoaderCircle className="is-spinning" size={20} /> Открываю тетрадь…</div> : <>
            <section className="assignment" aria-label="Условие задачи" hidden={!!preparation}><button className="assignment-title" onClick={() => setTaskOpen(value => !value)} aria-expanded={taskOpen}><span><span className="task-number">{solo ? <ShieldCheck size={13} /> : <Feather size={13} />}</span>{solo ? 'Полная задача · самостоятельно' : 'Полная задача · тригонометрия'}</span><ChevronDown size={17} className={!taskOpen ? 'rotated' : ''} /></button>{taskOpen && <div className="assignment-body"><p>{solo ? 'Реши уравнение. Запиши общий вид корней и выбери все корни на указанном отрезке.' : problem?.description ?? 'Реши уравнение и найди все корни на отрезке.'}</p><div className="assignment-math"><MathText value={problem?.equation ?? '\\sin 2x=\\cos x'} /><span className="math-separator" /><MathText value={problem?.interval ?? 'x\\in[-\\pi/2;3\\pi/2]'} /></div></div>}</section>
            <div className="learning-mode"><span className={`mode-label ${solo ? 'solo' : ''}`}>{solo ? <ShieldCheck size={14} /> : <Sparkles size={14} />}{solo ? 'Самостоятельная попытка' : work?.mode === 'review' ? 'Разбор результата' : 'Разбор с помощью'}</span>{solo ? <button disabled={!!busy} onClick={() => void requestHelp()}>Нужна помощь <ArrowUpRight size={13} /></button> : !preparation && <button disabled={!!busy || !work} onClick={() => void newWork(true)}>Проверить себя на новой задаче <ArrowUpRight size={13} /></button>}</div>
            {solo && <div className="solo-note">Теория и чат откроются по кнопке «Нужна помощь». Текущая самостоятельная попытка сохранится отдельно.{work?.priorExposure && <span>Ты уже открывал эту задачу раньше — это повторная попытка.</span>}</div>}
            {!solo && <nav className="scene-tools" aria-label="Помощь в решении"><button className={tab === 'solution' && !preparationChooser ? 'selected' : ''} onClick={() => { setTab('solution'); setPreparationChooser(false) }}><Feather size={16}/>{preparation ? 'Упражнение' : 'Моё решение'}</button><button onClick={() => setPanelOpen(value => !value)}><Sparkles size={16}/>Наставник{contexts.length ? ` · ${contexts.length}` : ''}</button><details className="lesson-more" onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false }}><summary>Справка и практика</summary><div><button onClick={() => { setPreparationChooser(value => !value); setTab('solution') }}>Выбрать упражнение</button><button onClick={() => openMaterial('sine')}>Материалы</button><button onClick={() => goEpisode('K1')}>Разобраться с основ</button>{!preparation && <button disabled={!!busy} onClick={() => void newWork(true)}>Новый вариант самостоятельно</button>}</div></details></nav>}
            {!solo && preparationChooser && <PreparationChooser exercises={state?.exercises ?? []} busy={!!busy} onChoose={id => void startPreparation(id)} onBasics={() => { setPreparationChooser(false); openMaterial('sine') }} onClose={() => setPreparationChooser(false)}/>}
            {preparation && <div hidden={tab !== 'solution' || preparationChooser}>{exercise ? <Preparation key={preparation.startedAt} exercise={exercise} preparation={preparation} saveStatus={saveState === 'pending' ? 'Сохраняю ответ…' : saveState === 'failed' ? 'Копия на устройстве' : 'Ответ сохранён'} busy={!!busy} onDraft={draftPreparation} onAnswer={answer => void answerPreparation(answer)} onReturn={() => void returnToSolution()} onMaterial={openMaterial}/> : <section className="preparation-scene"><p>Упражнение сейчас недоступно. Твой лист сохранён.</p><button className="primary-button" onClick={() => void returnToSolution()}>Вернуться к решению</button></section>}</div>}
            <div id="solution-panel" role="tabpanel" aria-label="Моё решение" hidden={tab !== 'solution' || !!preparation || preparationChooser}><section className="paper" aria-label="Рабочий лист"><div className="paper-header"><div><Feather size={17} /><span>Ход мысли</span></div><span className={`save-state ${storageError || saveState === 'failed' ? 'save-error' : ''}`} role="status"><Check size={13} />{storageError ? 'Не сохранено' : saveState === 'pending' ? 'Сохраняю…' : saveState === 'failed' ? 'Копия на устройстве' : work ? 'Сохранено' : 'На устройстве'}</span></div>
              <div className="editor-toolbar" role="toolbar" aria-label="Инструменты тетради"><button className="formula-button" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertMath()}><span className="fx">ƒx</span> Формула <Plus size={14} /></button><span className="toolbar-separator" /><button className="symbol-button fraction-symbol" title="Дробь" aria-label="Вставить дробь" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('\\frac{#0}{#?}')}>a<span />b</button><button className="symbol-button" title="Степень" aria-label="Вставить степень" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('#0^{#?}')}>x<sup>n</sup></button><button className="symbol-button" title="Корень" aria-label="Вставить корень" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('\\sqrt{#0}')}>√</button><button className="symbol-button" title="Число пи" aria-label="Вставить пи" onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.insertTemplate('\\pi')}>π</button><span className="toolbar-space" /><button className="icon-button" title="Отменить · Ctrl Z" aria-label="Отменить изменение" disabled={!bridge.current?.canUndo()} onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.undo()}><Undo2 size={17} /></button><button className="icon-button" title="Повторить · Ctrl Shift Z" aria-label="Повторить изменение" disabled={!bridge.current?.canRedo()} onMouseDown={event => event.preventDefault()} onClick={() => bridge.current?.redo()}><Redo2 size={17} /></button></div>
              <NotebookEditor key={work?.id ?? 'local'} initialContent={notebook.document} onChange={onDocumentChange} onSelection={() => refreshToolbar(value => value + 1)} onReady={ready} onUseAsGeneralAnswer={latex => { const next = generalRef.current.trim() ? `${generalRef.current}; ${latex}` : latex; setGeneralAnswer(next); generalRef.current = next; scheduleSave(); setToast('Формула добавлена в общее решение.'); }} onRequestAnnotation={solo ? undefined : requestAnnotation} annotatedBlockIds={solo ? [] : contexts.filter(item => item.anchor.origin !== 'material').map(item => item.anchor.blockId)} />
              <div className="paper-footer"><span>{solo ? 'Запиши обоснование и общий вид корней.' : 'Выдели строку или формулу, чтобы задать вопрос.'}</span><span>Ctrl + Z — отменить</span></div></section>

              <section className="answer-card"><div><h2>Что получилось?</h2><p>Запиши все корни на отрезке через точку с запятой.</p></div><MathAnswer multiple id="general-answer" label="Общее решение" value={generalAnswer} onChange={value => { setGeneralAnswer(value); generalRef.current = value; scheduleSave() }} /><p className="answer-format">Серии через точку с запятой, например x = a + T·n, n ∈ ℤ. Здесь важны все корни, а не только корни на отрезке.</p><MathAnswer multiple id="final-answer" label="Мой ответ" value={finalAnswer} onChange={value => { setFinalAnswer(value); answerRef.current = value; scheduleSave() }} /><div className="answer-footer"><span>Можно писать π или pi. Проверка корней и разбор хода решения — отдельно.</span><button className="primary-button" disabled={!!busy || !work || !finalAnswer.trim()} onClick={() => void submit()}>{busy === 'submit' ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}{busy === 'submit' ? 'Проверяем…' : 'Завершить попытку'}</button></div></section>
              {latestSubmission && <Result exercises={state?.exercises ?? []} onOpenExercise={id => void startPreparation(id)} onOpenMaterial={openMaterial} submission={latestSubmission} onRetry={() => void retryReview(latestSubmission.id)} busy={!!busy} onNext={() => void newWork(true)} />}
              {!!work?.submissions.length && <details className="attempt-history"><summary>Сохранённые попытки <span>{work.submissions.length}</span></summary>{work.submissions.slice().reverse().map(attempt => <article key={attempt.id}><div><strong>{attempt.reason === 'help_requested' ? 'До включения помощи' : 'Отправлено на проверку'}</strong><span>{attempt.mode === 'solo' ? 'Самостоятельно' : 'С помощью'} · {new Date(attempt.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}</span></div><Readback node={attempt.document} />{attempt.finalAnswer && <p className="attempt-answer">Ответ: <MathText value={toMathAnswerLatex(attempt.finalAnswer)} /></p>}</article>)}</details>}
            </div>
          </>}
          </div>
          {serverError && <div className="storage-error server-error" role="alert">{serverError}<div><button onClick={() => { if (!work) void boot(); else void enqueue(saveCurrent).then(() => setServerError('')).catch(error => setServerError(error.message)) }}><RefreshCw size={12} />{work ? 'Повторить сохранение' : 'Подключиться снова'}</button><button onClick={download}>Скачать копию</button></div></div>}
          {recoveryRaw && <div className="storage-error"><span>Локальный черновик сохранён отдельно и не заменяет открытую работу.</span><button onClick={downloadRecovery}>Скачать локальный черновик</button></div>}
          {storageError && <div className="storage-error" role="alert">{storageError}<button onClick={download}>Скачать копию</button></div>}
          {learning.view === 'home' && !!state?.memory.length && <details className="learning-memory"><summary><BookOpen size={14} /> История занятий <span>{state.memory.length}</span></summary>{state.memory.slice(0,5).map(event => <article key={event.id}><span>{event.independent ? 'Самостоятельно' : 'Практика'} · {new Date(event.createdAt).toLocaleDateString('ru')}</span><p>{event.summary}</p></article>)}</details>}
        </main>
        {!solo && learning.view !== 'home' && <div className="mentor-column">{learning.view === 'work' && work?.mode === 'guided' && !preparation  && <MentorGuide enabled={mentorEnabled} onEnabled={changeMentorEnabled} key={`guide:${work.id}`} work={work} saved={saveState === 'saved'} connected={!!provider?.connected} busy={!!busy} exercises={state?.exercises ?? []} onExercise={id => void startPreparation(id)} onDiscuss={text => { setDraftRequest({text: `Хочу обсудить: ${text}`, token: Date.now()}); setPanelOpen(true) }} />}<button className="mentor-open outline-button" onClick={() => setPanelOpen(true)}>Обсудить с наставником</button>{!solo && <ChatPanel key={`chat:${work?.id ?? 'local'}`} draftRequest={draftRequest} draftKey={`pole.chat-draft.v1.${work?.id ?? 'local'}`} onDraftConsumed={() => setDraftRequest(undefined)} open={panelOpen} onClose={() => setPanelOpen(false)} provider={provider} messages={work?.messages ?? []} contexts={contexts} onContexts={setContexts} onSend={send} onRetry={requestId => void send('', requestId)} onCheck={() => void checkConnection()} onLocate={locate} busy={busy === 'chat'} blocked={!!busy || !work} checking={checking} notes={legacy} exercises={state?.exercises} onOpenExercise={id => void startPreparation(id)} />}</div>}
      </div>{!panelOpen && !solo && learning.view !== 'home' && <button className="floating-notes" onClick={() => setPanelOpen(true)}><Sparkles size={17} /> Обсудить с ИИ</button>}
    </div>{toast && <div className="toast" role="status">{toast}</div>}
    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section className="help-modal" role="dialog" aria-modal="true" aria-label="Как пользоваться тетрадью" onClick={event => event.stopPropagation()}><button className="icon-button modal-close" onClick={() => setHelpOpen(false)} aria-label="Закрыть справку"><X size={20} /></button><span className="eyebrow">ТЕТРАДЬ «ПОЛЕ»</span><h2>От вопроса к пониманию</h2><ol><li><strong>Продолжи решение.</strong> Пиши прямо в листе. Формулу можно добавить с панели или кнопкой у текущей строки.</li><li><strong>Обсуди конкретное место.</strong> Выдели текст или часть формулы и нажми «Добавить в чат». Можно прикрепить несколько фрагментов.</li><li><strong>Вернись к теории.</strong> Открой «Материалы» на главной или из занятия. В статьях есть формулы, рисунки и доказательства — их тоже можно обсудить.</li><li><strong>Проверь понимание.</strong> Отправь свой ответ, затем попробуй новую задачу самостоятельно. Если понадобится помощь, попытка сохранится до её включения.</li></ol><p className="help-note">Работа сохраняется локальным сервером и на этом устройстве. Ответы создаёт подключённый ИИ-наставник. Статус виден над чатом.</p><button className="primary-button" onClick={() => setHelpOpen(false)}>К решению <ArrowUpRight size={15} /></button></section></div>}
  </div>
}

function Result({ submission, busy, onNext, onOpenMaterial, exercises, onOpenExercise, onRetry }: { submission: Submission; busy: boolean; onNext(): void; onOpenMaterial(id: string): void; exercises: PreparationExercise[]; onOpenExercise(id: string): void; onRetry(): void }) {
  return <section className={`result-card is-${submission.result.status}`} aria-label="Результат проверки"><div className="result-heading"><h2>Результат попытки</h2></div><h3>Корни на отрезке</h3><p>{submission.result.summary}</p><div className="submitted-answer"><span>Ответ в сохранённой попытке</span><MathText value={toMathAnswerLatex(submission.finalAnswer)} /></div>{submission.seriesResult && <div className={`series-result is-${submission.seriesResult.status}`}><h3>Общее решение</h3><p>{submission.seriesResult.summary}</p></div>}<p className="result-boundary">Общее решение, отбор корней и обоснование оцениваются отдельно.</p>{submission.review ? <div className="model-review"><h3><Sparkles size={14} /> Разбор рассуждения</h3><MathContent text={submission.review} onOpenMaterial={onOpenMaterial} exercises={exercises} onOpenExercise={onOpenExercise} /></div> : <div className="review-unavailable"><CircleHelp size={14} /><p>{submission.reviewStatus === 'pending' ? 'Попытка сохранена. Наставник читает рассуждение…' : submission.reviewError || 'Разбор хода решения пока не получен.'}</p>{submission.reviewStatus !== 'pending' && <button className="outline-button" disabled={busy} onClick={onRetry}>Повторить разбор</button>}</div>}<div className="result-footer"><span>Попытка сохранена · {submission.mode === 'solo' ? 'самостоятельно' : 'с помощью'}</span><button className="outline-button" disabled={busy} onClick={onNext}>Новый вариант самостоятельно<ArrowUpRight size={13} /></button></div></section>
}

function Readback({ node }: { node: JSONContent }) {
  if (node.type === 'mathBlock') return <div className="attempt-formula"><MathText value={node.attrs?.latex ?? ''} /></div>
  if (node.type === 'text') return <>{node.text}</>
  if (node.type === 'hardBreak') return <br />
  const children = node.content?.map((child, index) => <Readback key={index} node={child} />)
  if (node.type === 'paragraph' || node.type === 'heading') return <p>{children}</p>
  return <div>{children}</div>
}
