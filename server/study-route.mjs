import { createHash } from 'node:crypto'
import { topicPackages, topicProblems } from './topic-packs.mjs'

const KEY = 'study-route:v1'
const PACKAGES = ['percentages', 'trigonometry', ...topicPackages.map(item => item.id)]
const WEEK = 7 * 24 * 60 * 60 * 1000
const percentageIds = ['percent-discount-v1', 'percent-successive-v1', 'percent-reverse-v1', 'percent-transfer-v1']
const packageOf = work => PACKAGES.includes(work.packageId) ? work.packageId : work.kind === 'numeric' ? 'percentages' : work.kind === 'interval' ? 'inequalities' : 'trigonometry'
const lastSubmission = work => [...(work.submissions ?? [])].reverse().find(item => item.reason === 'submitted')
const outcome = (work, submission) => {
  if (!submission) return 'unattempted'
  const results = packageOf(work) !== 'trigonometry' ? [submission.result] : [submission.seriesResult, submission.result]
  if (results.some(result => result?.status === 'incorrect')) return 'incorrect'
  return results.every(result => result?.status === 'correct') ? 'correct' : 'unknown'
}
// Never infer original-attempt independence from help opened after submission.
// Legacy attempts without a frozen context remain unclassified.
const independent = (_work, submission) => submission?.mode === 'solo' && submission.helpCount === 0 && submission.attemptContext?.priorExposure === false && submission.attemptContext.numericHelpSeen === false && submission.attemptContext.preparationUsed === false
const hasWriting = node => Boolean(node?.text?.trim() || node?.attrs?.latex?.trim() || node?.content?.some(hasWriting))
const hasActivity = work => Boolean(work.submissions?.length || work.finalAnswer?.trim() || work.generalAnswer?.trim() || hasWriting(work.document) || work.preparation || work.preparationHistory?.length || work.numericHelpSeen)
// Store.put uses SQLite REPLACE: row order changes even for a model response.
// Session ordering must therefore come from immutable creation/submission timestamps.
const readWorks = store => store.list().map(summary => store.get(summary.id)).sort((a, b) => String(lastSubmission(b)?.createdAt ?? b.createdAt).localeCompare(String(lastSubmission(a)?.createdAt ?? a.createdAt)) || String(b.createdAt).localeCompare(String(a.createdAt)) || b.id.localeCompare(a.id))
const signature = works => createHash('sha256').update(JSON.stringify(works.map(work => [work.id, packageOf(work), (work.submissions ?? []).filter(item => item.reason === 'submitted').map(item => [item.id, item.result?.status, item.seriesResult?.status, item.mode, item.helpCount, item.attemptContext?.priorExposure, item.attemptContext?.numericHelpSeen, item.attemptContext?.preparationUsed])]))).digest('hex')
function load(store) {
  try { const route = JSON.parse(store.setting(KEY) ?? 'null'); return route?.version === 1 && Number.isSafeInteger(route.revision) && Array.isArray(route.next) && route.current ? route : null } catch { return null }
}
const templates = {
  percentages: [
    ['Цена после скидки', 'Найти новую величину после одного изменения.'],
    ['Два изменения подряд', 'Проверить, от какой величины считать второй процент.'],
    ['Восстановить начальную цену', 'Пройти от результата к исходной величине.'],
    ['Сравнить результат с началом', 'Применить проценты самостоятельно в другой формулировке.'],
  ],
  ...Object.fromEntries(topicPackages.map(pack => [pack.id, topicProblems.filter(problem => problem.packageId === pack.id).map(problem => [problem.title, pack.description])])),
  trigonometry: [
    ['Решить уравнение и отобрать корни', 'Записать общие решения и проверить отбор на отрезке.'],
    ['Другой вариант уравнения', 'Попробовать применить способ без подсказок.'],
    ['Проверить отбор корней', 'Обосновать, какие корни попали на отрезок.'],
    ['Ещё одна самостоятельная попытка', 'Проверить способ на новом варианте.'],
  ],
}
function makeRoute(store, previous, options) {
  const now = new Date(options.now ?? Date.now())
  if (!Number.isFinite(now.getTime())) throw Object.assign(Error('Некорректная дата маршрута'), { status: 400 })
  const works = readWorks(store)
  const activeWork = works.find(hasActivity)
  const preferredPackage = options.preferredPackage ?? previous?.preferredPackage ?? (activeWork ? packageOf(activeWork) : 'percentages')
  if (!PACKAGES.includes(preferredPackage)) throw Object.assign(Error('Неизвестная тема'), { status: 400 })
  const skippedWorkIds = [...new Set([...(previous?.skippedWorkIds ?? []), ...(options.skipCurrent && previous?.current.action.type === 'open' ? [previous.current.action.workId] : [])])].slice(-100)
  const relevant = works.filter(work => packageOf(work) === preferredPackage)
  const pending = relevant.find(work => !skippedWorkIds.includes(work.id) && outcome(work, lastSubmission(work)) !== 'correct' && (hasActivity(work) || preferredPackage !== 'trigonometry' || options.preferredPackage === 'trigonometry' || previous?.preferredPackage === 'trigonometry'))
  const completed = relevant.filter(work => outcome(work, lastSubmission(work)) === 'correct')
  const last = relevant.find(work => lastSubmission(work))
  const lastAttempt = last && lastSubmission(last)
  const paused = Boolean(lastAttempt && now.getTime() - Date.parse(lastAttempt.createdAt) >= WEEK)
  const skippedTaskIds = [...new Set([...(previous?.skippedTaskIds ?? []), ...(options.skipCurrent ? [previous?.current.action.taskId ?? works.find(work => work.id === previous?.current.action.workId)?.problemId].filter(Boolean) : [])])].slice(-20)
  const completedIds = new Set(completed.map(work => work.problemId))
  const taskIds = preferredPackage === 'percentages' ? percentageIds : topicProblems.filter(problem => problem.packageId === preferredPackage).map(problem => problem.id)
  const firstRemaining = taskIds.findIndex(id => !completedIds.has(id) && !skippedTaskIds.includes(id))
  const pendingStage = pending ? taskIds.indexOf(pending.problemId) : -1
  const stage = preferredPackage !== 'trigonometry' ? (pendingStage >= 0 ? pendingStage : firstRemaining < 0 ? 0 : firstRemaining) : Math.min(completed.length, 3)
  const cards = Array.from({ length: 4 }, (_, index) => {
    const templateIndex = (stage + index) % templates[preferredPackage].length
    const [title, description] = templates[preferredPackage][templateIndex]
    const taskId = taskIds[templateIndex]
    const familiar = taskId && (relevant.some(work => work.problemId === taskId) || index >= taskIds.length)
    return { id: `${preferredPackage}:${stage + index}`, packageId: preferredPackage, title: familiar ? `${title} · повтор` : title, reason: description, action: { type: 'new', packageId: preferredPackage, ...(taskId ? { taskId } : {}), mode: index === 0 && !completed.length ? 'guided' : 'solo' } }
  })
  if (pending) {
    const status = outcome(pending, lastSubmission(pending))
    let title = topicPackages.find(pack => pack.id === preferredPackage)?.title ?? (preferredPackage === 'percentages' ? 'Задача на проценты' : 'Тригонометрическое уравнение')
    try { title = store.problem(pending).title || title } catch { /* Legacy unavailable metadata must not lose the saved work. */ }
    cards[0] = { id: `work:${pending.id}`, packageId: preferredPackage, title, reason: status === 'incorrect' ? 'В проверяемом ответе осталось расхождение. Можно исправить или обсудить проверку.' : status === 'unknown' ? 'Проверка не установила результат. Сохранённое решение можно уточнить.' : 'Незаконченная работа сохранена: продолжи с того же места.', action: { type: 'open', workId: pending.id } }
  } else if (last && outcome(last, lastAttempt) === 'correct') {
    cards[0].reason = independent(last, lastAttempt) ? 'Ответ в самостоятельной попытке верный. Попробуй другую задачу.' : 'Ответ верный. Следующая попытка — без подсказок.'
    cards[0].action.mode = 'solo'
  }
  if (paused) cards[0].reason = pending ? `После перерыва можно вернуться к сохранённой работе. ${cards[0].reason}` : 'После перерыва попробуй ещё одну задачу. Мы не считаем, что ты забыл тему: новая попытка поможет это проверить.'
  const basisSignature = signature(works)
  return { version: 1, revision: (previous?.revision ?? -1) + 1, preferredPackage, goal: topicPackages.find(pack => pack.id === preferredPackage)?.description ?? (preferredPackage === 'percentages' ? 'Решать прямые и обратные задачи на проценты' : 'Решать тригонометрические уравнения и обосновывать отбор корней'), current: cards[0], next: cards.slice(1), generatedAt: now.toISOString(), basisSignature, paused, skippedWorkIds, skippedTaskIds }
}

// Read requests never rewrite an existing plan, even when a model finishes a review.
export function readStudyRoute(store, options = {}) {
  const existing = load(store)
  if (existing) return existing
  const route = makeRoute(store, null, options)
  store.setSetting(KEY, JSON.stringify(route))
  return route
}

// Called at a completed-session boundary or explicitly by the learner, never by chat/OCR.
export function refreshStudyRoute(store, options = {}) {
  const previous = readStudyRoute(store, options)
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision !== previous.revision) throw Object.assign(Error('Маршрут изменился в другой вкладке. Обнови страницу.'), { status: 409 })
  const candidate = makeRoute(store, previous, options)
  if (candidate.basisSignature === previous.basisSignature && candidate.preferredPackage === previous.preferredPackage && candidate.paused === previous.paused && !options.skipCurrent) return previous
  store.setSetting(KEY, JSON.stringify(candidate))
  return candidate
}
