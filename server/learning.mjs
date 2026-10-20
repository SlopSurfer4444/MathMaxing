import { learningEpisodes } from '../src/learning-content.ts'
// Learning navigation records activity, never a mastery score.
export const episodeIds = ['K1','K2','K3','K4','K5','K6','K7','M1','M2','M3']
const ids = new Set(episodeIds)
const fail = message => Object.assign(new Error(message), { status: 400 })
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const own = (value, key) => Object.hasOwn(value, key)
export function initialLearningSession() {
  return { entry: null, episodeId: null, progress: {}, view: 'home', revision: 0, updatedAt: new Date().toISOString() }
}
function record(value, validate, label) {
  if (!object(value) || Object.keys(value).length > 30) throw fail(`Некорректные ${label}`)
  const result = {}
  for (const [key, item] of Object.entries(value)) {
    if (!/^[\w-]{1,80}$/.test(key) || ['__proto__','constructor','prototype'].includes(key) || !validate(item)) throw fail(`Некорректные ${label}`)
    result[key] = item
  }
  return result
}
function progressItem(item) {
  if (!object(item) || Object.keys(item).some(key => !['step','answers','outcomes','attempts','skipped'].includes(key))) throw fail('Некорректный учебный шаг')
  if (!Number.isInteger(item.step) || item.step < 0 || item.step > 100) throw fail('Некорректный номер шага')
  if (item.skipped !== undefined && typeof item.skipped !== 'boolean') throw fail('Некорректная отметка пропуска')
  return {
    step: item.step,
    answers: record(item.answers ?? {}, value => typeof value === 'string' && value.length <= 4000, 'ответы'),
    outcomes: record(item.outcomes ?? {}, value => ['correct','incorrect','unknown'].includes(value), 'результаты'),
    attempts: record(item.attempts ?? {}, value => Number.isInteger(value) && value >= 0 && value <= 10000, 'попытки'),
    ...(item.skipped === undefined ? {} : { skipped: item.skipped }),
  }
}
export function updateLearningSession(previous, patch) {
  if (!object(patch) || Object.keys(patch).some(key => !['entry','episodeId','progress','view','workId','expectedRevision'].includes(key))) throw fail('Неизвестные поля учебного маршрута')
  if (JSON.stringify(patch).length > 100000) throw fail('Слишком большая запись маршрута')
  const next = structuredClone(previous)
  if (own(patch,'entry')) {
    if (![null,'explain','refresh','solve'].includes(patch.entry)) throw fail('Неизвестный вход в занятие')
    next.entry = patch.entry
  }
  if (own(patch,'view')) {
    if (!['home','episode','work','diagnostic','materials'].includes(patch.view)) throw fail('Неизвестный экран занятия')
    next.view = patch.view
  }
  if (own(patch,'episodeId')) {
    if (patch.episodeId !== null && !ids.has(patch.episodeId)) throw fail('Неизвестный учебный эпизод')
    next.episodeId = patch.episodeId
  }
  if (own(patch,'progress')) {
    if (!object(patch.progress) || Object.keys(patch.progress).length > ids.size) throw fail('Некорректный учебный маршрут')
    for (const [id, value] of Object.entries(patch.progress)) {
      if (!ids.has(id)) throw fail('Неизвестный учебный эпизод')
      next.progress[id] = progressItem(value)
    }
  }
  if (next.view === 'episode' && !next.episodeId) throw fail('Не выбран учебный эпизод')
  next.updatedAt = new Date().toISOString()
  next.revision = previous.revision + 1
  return next
}
export function learningContext(session, evidence) {
  const episode = session.view === 'episode' ? learningEpisodes.find(item => item.id === session.episodeId) : null
  const step = episode ? session.progress[episode.id]?.step ?? 0 : 0
  return { entry: session.entry, episodeId: session.view === 'episode' ? session.episodeId : null,
    activeEpisode: episode ? {id:episode.id,title:episode.title,goal:episode.goal,explanation:episode.explanation,example:episode.example,exampleSteps:episode.exampleSteps??[],why:episode.why,step,currentCheck:episode.checks[step-1]??null} : null,
    progress: session.progress, recentActivity: evidence.slice(0,8),
    interpretation: 'Это журнал действий и результатов клиента, не доказательство освоения. Просмотр объяснения не означает понимания. Старый успех не гарантирует текущего знания. Уточняй затруднение и предлагай выбор, не навязывай маршрут.' }
}
export function familiarFamilies(session) {
  const completed = id => {
    const episode=learningEpisodes.find(item=>item.id===id), progress=session.progress[id]
    return !!episode && !!progress && progress.step > episode.checks.length
      && episode.checks.every(check=>progress.outcomes[check.id]==='correct')
  }
  // Completion provides exposure, not a mastery verdict.
  return ['G1',...(completed('M2')?['G2']:[]),...(completed('M3')?['G3']:[])]
}
