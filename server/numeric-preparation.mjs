import { percentageHelp, checkPercentagePreparation } from './percentages.mjs'
import { topicHelp, checkTopicPreparation } from './topic-packs.mjs'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const now = () => new Date().toISOString()
const snapshotKey = work => `numeric-preparation:${work.id}`
const copy = value => structuredClone(value)

function publicHelp(problem) {
  const help = problem.packageId === 'percentages' ? percentageHelp(problem) : topicHelp(problem)
  // Explicit fields keep private checker inputs out of both work state and prompts.
  const { id, title, why, introduction, steps, example, check, materialIds, graph } = help
  const { id: checkId, kind, prompt, answerUnit, answerFormat, math, graph: checkGraph } = check
  return JSON.parse(JSON.stringify({ id, title, why, introduction, steps, example, graph,
    check: { id: checkId, kind, prompt, answerUnit, answerFormat, math, graph: checkGraph }, materialIds }))
}

function returnPoint(value) {
  if (value === undefined) return undefined
  if (!value || !['reasoning', 'answer'].includes(value.field)
      || !Number.isSafeInteger(value.selectionStart) || value.selectionStart < 0
      || !Number.isSafeInteger(value.selectionEnd) || value.selectionEnd < value.selectionStart
      || !Number.isFinite(value.scrollY) || value.scrollY < 0 || value.scrollY > 10000000) {
    throw fail('Некорректное место возврата к решению.')
  }
  return { field: value.field, selectionStart: value.selectionStart, selectionEnd: value.selectionEnd, scrollY: value.scrollY }
}

function answer(value) {
  if (typeof value !== 'string' || value.length > 2000) throw fail('Некорректный ответ подготовки.')
  return value
}

export function numericPreparationSignature(work) {
  const p = work.numericPreparation
  return JSON.stringify(p ? { id: p.id, revision: p.revision, open: p.open, completed: p.completed, helpId: p.helpId, contentVersion: p.contentVersion } : null)
}

export function numericPreparationContext(_store, work) {
  const p = work.numericPreparation
  if (!p?.open || p.completed) return null
  // Rebuild the public shape instead of forwarding any future private fields.
  return copy({ id: p.id, revision: p.revision, helpId: p.helpId, contentVersion: p.contentVersion,
    help: p.help, answer: p.answer, ...(p.result ? { result: p.result } : {}), open: p.open, completed: p.completed,
    ...(p.returnPoint ? { returnPoint: p.returnPoint } : {}), attempts: p.attempts, startedAt: p.startedAt })
}

// Returns null only when this helper does not own the route.
export function handleNumericPreparation({ store, work, path, body, checkWorkVersion, cancel = () => {} }) {
  const route = /^\/api\/(percentages|topics)\/(help|preparation|draft|return)$/.exec(path)
  if (!route) return null
  if (!body || typeof body.workId !== 'string' || body.workId !== work.id) throw fail('Не указана корректная работа.')
  work = store.get(work.id)
  if (work.mode === 'solo') throw fail('Сначала явно перейди к помощи или заверши самостоятельную попытку.', 403)
  const problem = store.problem(work)
  if (!['numeric', 'interval'].includes(problem.kind)
      || (route[1] === 'percentages') !== (problem.packageId === 'percentages')) {
    throw fail('Для этой работы нужен другой раздел подготовки.')
  }
  checkWorkVersion(work, body)
  if (store.current().id !== work.id) throw fail('Текущее занятие изменилось.', 409)
  const action = route[2]
  let p = work.numericPreparation
  if (action === 'help' && p?.open && !p.completed) return { help: copy(p.help), preparation: copy(p), work }

  if (action !== 'help') {
    if (typeof body.preparationId !== 'string' || !body.preparationId || !Number.isSafeInteger(body.expectedPreparationRevision) || body.expectedPreparationRevision < 0) {
      throw fail('Нужны идентификатор и числовая ревизия подготовки.')
    }
    if (!p || p.id !== body.preparationId || p.revision !== body.expectedPreparationRevision || !p.open || p.completed) {
      throw fail('Подготовка изменилась. Обнови её перед сохранением.', 409)
    }
  }
  const point = returnPoint(body.returnPoint)
  const value = action === 'draft' || action === 'preparation' || (action === 'return' && body.answer !== undefined) ? answer(body.answer) : undefined
  let evidence, result
  // A single private snapshot per work bounds storage and freezes exact checks.
  // Completed history is public and never becomes checkable again.
  store.db.exec('BEGIN')
  try {
    if (action === 'help') {
      const help = publicHelp(problem)
      p = { id: crypto.randomUUID(), revision: 0, helpId: help.id, contentVersion: problem.contentVersion ?? work.contentVersion ?? 1,
        help, answer: '', open: true, completed: false, ...(point ? { returnPoint: point } : {}), attempts: [], startedAt: now() }
      store.setSetting(snapshotKey(work), JSON.stringify({ preparationId: p.id, problem }))
      work.numericPreparation = p
      work.numericHelpSeen = true
      work.modeEpoch++
    } else {
      if (value !== undefined) {
        if (value !== p.answer) delete p.result
        p.answer = value
      }
      p.revision++
      if (action === 'preparation') {
        const frozenValue = store.setting(snapshotKey(work))
        const frozen = frozenValue ? JSON.parse(frozenValue) : null
        if (frozen?.preparationId !== p.id) throw fail('Сохранённая проверка подготовки недоступна. Вернись к работе и открой новую подготовку.', 409)
        result = frozen.problem.packageId === 'percentages' ? checkPercentagePreparation(frozen.problem, p.answer) : checkTopicPreparation(frozen.problem, p.answer)
        p.result = copy(result)
        p.attempts = [...p.attempts, { answer: p.answer, result: copy(result), createdAt: now() }].slice(-20)
        evidence = store.learningChecked({ kind: frozen.problem.packageId === 'percentages' ? 'percentage_preparation' : 'topic_preparation', workId: work.id,
          preparationId: p.id, preparationRevision: p.revision, helpId: p.helpId, contentVersion: p.contentVersion, answer: p.answer, result,
          summary: 'Проверена отдельная учебная проба, не вся тема.' })
      }
      if (action === 'return') {
        if (point) p.returnPoint = point
        p.open = false
        p.completed = true
        p.returnedAt = now()
        work.numericPreparationHistory = [...(work.numericPreparationHistory ?? []), copy(p)].slice(-12)
        work.modeEpoch++
      }
    }
    store.put(work)
    store.db.exec('COMMIT')
  } catch (error) {
    store.db.exec('ROLLBACK')
    throw error
  }
  cancel(work.id)
  return { ...(action === 'help' ? { help: copy(p.help) } : {}), ...(action === 'preparation' ? { result, evidence } : {}), preparation: copy(p), work }
}
