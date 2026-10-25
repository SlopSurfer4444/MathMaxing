import { taskPackages, packageProblems } from './problems.mjs'

const KEY = 'mixed-practice:v1'
const fail = (message, status = 400) => Object.assign(Error(message), { status })
const load = store => JSON.parse(store.setting(KEY) ?? 'null')
const submitted = work => work.submissions.find(item => item.reason === 'submitted')

function itemResult(store, item) {
  if (!item.workId) return { status: 'unattempted', assistance: 'unknown' }
  const work = store.get(item.workId), attempt = submitted(work)
  if (!attempt) return { status: 'unattempted', assistance: 'unknown' }
  const results = item.packageId === 'trigonometry' ? [attempt.result, attempt.seriesResult] : [attempt.result]
  const context = attempt.attemptContext
  const assistance = attempt.mode === 'guided' || attempt.helpCount > 0 || context?.numericHelpSeen === true || context?.preparationUsed === true ? 'used' : attempt.mode === 'solo' && attempt.helpCount === 0 && context?.numericHelpSeen === false && context?.preparationUsed === false ? 'none' : 'unknown'
  return { status: results.some(result => result?.status === 'incorrect') ? 'incorrect' : results.every(result => result?.status === 'correct') ? 'correct' : 'unknown', assistance, submissionId: attempt.id }
}

// Never return the private frozen task or future topics: neither is a method hint.
export function readMixedPractice(store) {
  const set = load(store)
  if (!set) return null
  return { id: set.id, revision: set.revision, status: set.status, position: set.position, total: set.items.length,
    currentWorkId: set.status === 'active' ? set.items[set.position].workId : null,
    items: set.items.map((item, index) => ({ index, ...(item.workId ? { workId: item.workId, repeated: item.repeated } : {}), ...itemResult(store, item) })),
    scope: 'Короткая практика из доступных тем. Это не полный вариант ЕГЭ; проверка ответов не оценивает доказательство.' }
}

function openItem(store, set) {
  const item = set.items[set.position]
  if (item.workId) return store.open(item.workId)
  // The complete authored instance is frozen when the set starts, before upgrades.
  const work = store.create(item.problem.id, 'solo', item.problem)
  item.repeated = work.priorExposure
  item.workId = work.id
  work.mixedPracticeId = set.id
  work.mixedPracticeIndex = set.position
  store.setSetting(`problem-instance:${work.id}`, JSON.stringify(item.problem))
  return store.put(work)
}

function selectItems(store) {
  const seen = new Set(store.list().map(work => work.problemId))
  const groups = taskPackages.map(pack => ({ pack, problems: packageProblems(pack.id) })).filter(group => group.problems.length)
  if (!groups.length) throw fail('Сейчас нет задач для смешанной практики.', 409)
  // Prefer unused tasks and rotate packages by prior exposure. Never fabricate a task.
  groups.sort((a, b) => Number(b.problems.some(problem => !seen.has(problem.id))) - Number(a.problems.some(problem => !seen.has(problem.id))) || a.problems.filter(problem => seen.has(problem.id)).length - b.problems.filter(problem => seen.has(problem.id)).length)
  return groups.slice(0, 3).map(({ pack, problems }) => ({ packageId: pack.id, problem: structuredClone(problems.find(problem => !seen.has(problem.id)) ?? problems[0]), workId: null, repeated: false }))
}

export function changeMixedPractice(store, action, options = {}) {
  if (!['start', 'next'].includes(action)) throw fail('Неизвестное действие')
  if (typeof options.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(options.requestId)) throw fail('Нужен идентификатор запроса')
  if (!Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw fail('Нужна версия набора')
  let set = load(store)
  const receipt = set?.requests.find(request => request.id === options.requestId)
  if (receipt) {
    if (receipt.action !== action || receipt.expectedRevision !== options.expectedRevision) throw fail('Идентификатор уже использован для другого действия.', 409)
    // Replay is read-only; an old retry must not move the current work backwards.
    return { mixed: readMixedPractice(store), ...(set.status === 'active' ? { work: store.get(set.items[set.position].workId) } : {}) }
  }
  if ((set?.revision ?? 0) !== options.expectedRevision) throw fail('Набор изменился в другой вкладке. Обнови страницу.', 409)
  if (action === 'start' && set?.status === 'active') throw fail('Сначала закончи текущий набор или продолжи сохранённую задачу.', 409)
  if (action === 'next' && (!set || set.status !== 'active')) throw fail('Нет текущего набора.', 409)
  if (action === 'next' && !submitted(store.get(set.items[set.position].workId))) throw fail('Сначала сдай попытку. Если трудно, можно перейти к помощи.', 409)
  store.db.exec('SAVEPOINT mixed_practice')
  try {
    if (action === 'start') set = { id: crypto.randomUUID(), revision: (set?.revision ?? 0), position: 0, status: 'active', items: selectItems(store), requests: set?.requests.slice(-20) ?? [] }
    else if (set.position + 1 < set.items.length) set.position++
    else set.status = 'complete'
    const work = set.status === 'active' ? openItem(store, set) : undefined
    set.revision++
    set.requests.push({ id: options.requestId, action, expectedRevision: options.expectedRevision })
    set.requests = set.requests.slice(-24)
    store.setSetting(KEY, JSON.stringify(set))
    store.db.exec('RELEASE mixed_practice')
    return { mixed: readMixedPractice(store), ...(work ? { work } : {}) }
  } catch (error) {
    store.db.exec('ROLLBACK TO mixed_practice'); store.db.exec('RELEASE mixed_practice'); throw error
  }
}
