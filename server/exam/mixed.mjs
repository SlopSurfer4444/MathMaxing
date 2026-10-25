import { createHash, randomInt, randomUUID } from 'node:crypto'
import { families as publishedFamilies } from './registry.mjs'
import { learnerObservations } from './learner-observations.mjs'

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const id = (value, name) => { if (typeof value !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(value)) fail(400, `Некорректный ${name}`); return value }
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const answerKey = work => JSON.stringify({ answers: Object.entries(work.answersByPart ?? {}).sort(([a], [b]) => a.localeCompare(b)), reasoning: work.reasoning ?? '' })
const freshSubmission = work => {
  const attempt = work.attempts?.at(-1)
  return Boolean(attempt && (work.completed || ['submit', 'correction', 'mixed-skip', 'finish', 'mixed-finish'].includes(attempt.reason)) && answerKey(attempt) === answerKey(work))
}
function domain(family) {
  if (/^geom\./.test(family.id)) return 'geometry'
  if (/^(probability|distribution)\./.test(family.id)) return 'chance'
  if (/^(algebra|functions|analysis)\./.test(family.id)) return 'symbolic'
  if (/^(number|model|finance|data|sequence)\./.test(family.id)) return 'models'
  if (/^(parameters?|integer)\./.test(family.id)) return 'reasoning'
  return family.group
}

/** A short, untimed choice-of-method practice. It does not replace a full exam. */
export function createExamMixed({ store, createWork, readWork, submitWork, families = publishedFamilies, now = () => Date.now() }) {
  const db = store.db
  db.exec('CREATE TABLE IF NOT EXISTS exam_mixed (id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS exam_mixed_owner ON exam_mixed(owner)')
  const owner = visitor => id(visitor?.owner, 'профиль')
  const transaction = fn => {
    const name = `mixed_${randomUUID().replaceAll('-', '')}`
    db.exec(`SAVEPOINT ${name}`)
    try { const result = fn(); db.exec(`RELEASE ${name}`); return result }
    catch (error) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); throw error }
  }
  const read = (visitor, mixedId) => {
    id(mixedId, 'mixedId')
    const row = db.prepare('SELECT data FROM exam_mixed WHERE owner=? AND id=?').get(owner(visitor), mixedId)
    if (!row) fail(404, 'Смешанная практика не найдена')
    return JSON.parse(row.data)
  }
  const put = (visitor, run) => {
    const data = JSON.stringify(run)
    if (Buffer.byteLength(data) > 200_000) fail(429, 'История набора заполнена. Существующие работы сохранены.')
    const previous = db.prepare('SELECT length(CAST(data AS BLOB)) AS bytes FROM exam_mixed WHERE owner=? AND id=?').get(owner(visitor), run.id)
    visitor.assertCanStore?.(Buffer.byteLength(data) - (previous?.bytes ?? 0))
    db.prepare('INSERT INTO exam_mixed(id,owner,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id, owner(visitor), data)
  }
  const cas = (run, body) => {
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) fail(400, 'Нужна версия набора')
    if (run.revision !== body.expectedRevision) fail(409, 'Набор изменился в другой вкладке. Обнови его перед действием.')
  }
  const workCas = (run, work, body) => {
    if (body.workId !== run.tasks[run.currentIndex].workId) fail(409, 'Открыта другая задача набора')
    if (!Number.isSafeInteger(body.expectedWorkRevision) || body.expectedWorkRevision < 0 || !Number.isSafeInteger(body.expectedWorkModeEpoch) || body.expectedWorkModeEpoch < 0) fail(400, 'Нужны версии текущей работы и режима')
    if (body.expectedWorkRevision !== work.revision || body.expectedWorkModeEpoch !== work.modeEpoch) fail(409, 'Запись или режим изменились. Обнови работу перед переходом.')
  }
  const blindWork = work => {
    if (work.exposure || work.mode !== 'solo' || work.completed || work.attempts?.length) return work
    const instance = work.instance
    return { id: work.id, mode: work.mode, modeEpoch: work.modeEpoch, revision: work.revision, answersByPart: work.answersByPart, reasoning: work.reasoning, completed: false, exposure: false, priorExposure: Boolean(work.priorExposure), practiceKind: 'mixed', attempts: [], evaluations: [], advisories: [], messages: [], createdAt: work.createdAt, updatedAt: work.updatedAt,
      instance: { id: work.id, version: instance.version, title: 'Задача', prompt: instance.prompt, parts: instance.parts.map(({ id, label, kind, prompt, answerUnit }) => ({ id, label, kind, ...(prompt ? { prompt } : {}), ...(answerUnit ? { answerUnit } : {}) })), ...(instance.svg ? { svg: instance.svg } : {}), ...(instance.table ? { table: instance.table } : {}) } }
  }
  const project = (visitor, run) => {
    const tasks = run.tasks.map(task => ({ position: task.position, workId: task.workId, status: task.status, work: blindWork(readWork(visitor, task.workId)) }))
    return { id: run.id, status: run.status, revision: run.revision, currentIndex: run.currentIndex, tasks, work: tasks[run.currentIndex]?.work ?? null, completedCount: tasks.filter(task => task.status !== 'pending').length, total: 3, createdAt: run.createdAt, updatedAt: run.updatedAt, ...(run.completedAt ? { completedAt: run.completedAt } : {}), warnings: [...run.warnings],
      scope: 'Три задачи из разных направлений без названия метода до попытки. Это наблюдение за выбором и применением способа, а не подтверждение освоения или полный вариант ЕГЭ.',
      ...(run.status === 'completed' ? { selection: run.tasks.filter(task => task.status !== 'pending').map(task => ({ position: task.position, familyId: task.familyId, templateId: task.templateId, reason: task.selectionReason, ...(task.source ? { source: task.source } : {}) })) } : {}) }
  }
  const history = (visitor, before = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isSafeInteger(before) || before < 1) fail(400, 'Некорректная страница истории')
    const rows = db.prepare("SELECT id,rowid AS cursor,json_extract(data,'$.status') AS status,json_extract(data,'$.createdAt') AS createdAt,json_extract(data,'$.updatedAt') AS updatedAt,json_extract(data,'$.currentIndex') AS currentIndex FROM exam_mixed WHERE owner=? AND rowid<? ORDER BY rowid DESC LIMIT 11").all(owner(visitor), before)
    return { runs: rows.slice(0, 10).map(({ cursor, ...run }) => run), nextCursor: rows.length > 10 ? rows[9].cursor : null }
  }
  const examActive = visitor => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='exam_sessions'").get() && db.prepare("SELECT 1 FROM exam_sessions WHERE owner=? AND json_extract(data,'$.status')='active' LIMIT 1").get(owner(visitor)))
  function observations(visitor) {
    return learnerObservations(db, owner(visitor))
  }
  function select(visitor) {
    const latest = new Map()
    for (const event of observations(visitor)) if (!latest.has(event.familyId)) latest.set(event.familyId, event)
    const candidates = families.filter(family => family.templates?.length && domain(family)).map(family => {
      const event = latest.get(family.id), age = event ? now() - Date.parse(event.createdAt) : Infinity
      const due = event?.status === 'correct' && Boolean(event.independent) && age >= 7 * 86400_000
      const recent = Boolean(event) && age < 7 * 86400_000
      return { family, event, due, recent, priority: due ? 0 : !event ? 1 : recent ? 3 : 2, tie: randomInt(2147483647) }
    }).sort((a, b) => a.priority - b.priority || a.tie - b.tie)
    const chosen = [], usedDomains = new Set()
    for (const candidate of candidates) {
      const key = domain(candidate.family)
      if (usedDomains.has(key)) continue
      chosen.push(candidate); usedDomains.add(key)
      if (chosen.length === 3) break
    }
    if (chosen.length !== 3) fail(503, 'Для смешанной практики нужны три опубликованных разных направления. Набор не создан.')
    return chosen.map(({ family, event, due, recent }, index) => ({ position: index + 1, family, template: family.templates[randomInt(family.templates.length)], seed: randomInt(2147483647), recent,
      selectionReason: due ? 'После самостоятельной проверенной попытки прошла неделя: новый вариант проверяет сохранение способа без подсказки темы.' : recent ? 'Недавнее направление повторяется в другой структуре набора; это не отложенное повторение.' : 'Другое опубликованное направление для самостоятельного выбора способа.',
      ...(due ? { source: { observationId: event.id, attemptId: event.attemptId, workId: event.workId, createdAt: event.createdAt } } : {}) }))
  }
  function route(method, path, body = {}, visitor = store) {
    if (!path.startsWith('/api/exam/mixed/')) return null
    if (method === 'GET' && path === '/api/exam/mixed/state') {
      if (examActive(visitor)) return { mixed: null, ...history(visitor), blockedByExam: true }
      const row = db.prepare("SELECT data FROM exam_mixed WHERE owner=? ORDER BY CASE WHEN json_extract(data,'$.status') IN ('active','paused') THEN 0 ELSE 1 END,rowid DESC LIMIT 1").get(owner(visitor))
      return { mixed: row ? project(visitor, JSON.parse(row.data)) : null, ...history(visitor) }
    }
    if (method !== 'POST') fail(404, 'Маршрут смешанной практики не найден')
    if (!record(body)) fail(400, 'Некорректный запрос набора')
    if (path === '/api/exam/mixed/history') return history(visitor, body.before)
    if (examActive(visitor)) fail(403, 'Сначала сдай экзаменационный вариант. Смешанная практика и её запись сохранены.')
    if (path === '/api/exam/mixed/start') {
      id(body.requestId, 'requestId')
      const replay = db.prepare("SELECT data FROM exam_mixed WHERE owner=? AND json_extract(data,'$.startRequestId')=?").get(owner(visitor), body.requestId)
      if (replay) return { mixed: project(visitor, JSON.parse(replay.data)) }
      if (db.prepare("SELECT 1 FROM exam_mixed WHERE owner=? AND json_extract(data,'$.status') IN ('active','paused')").get(owner(visitor))) fail(409, 'Продолжи или закончи сохранённый набор')
      if (db.prepare('SELECT COUNT(*) AS count FROM exam_mixed WHERE owner=?').get(owner(visitor)).count >= 20) fail(429, 'Сохранено 20 наборов. Создай архив профиля; история автоматически не удаляется.')
      const selected = select(visitor)
      return transaction(() => {
        const stamp = new Date(now()).toISOString(), mixedId = randomUUID()
        const run = { id: mixedId, status: 'active', revision: 0, currentIndex: 0, startRequestId: body.requestId, createdAt: stamp, updatedAt: stamp, requests: [], warnings: selected.some(task => task.recent) ? ['В наборе есть недавнее направление; весь набор не обозначается отложенным повторением.'] : [], tasks: [] }
        run.tasks = selected.map(task => {
          const work = createWork(visitor, { familyId: task.family.id, templateId: task.template.id, seed: task.seed, mode: 'solo', blind: true, practiceKind: 'mixed', mixedId, position: task.position, requestId: `mixed:${mixedId}:${task.position}` })
          return { position: task.position, familyId: task.family.id, templateId: task.template.id, workId: work.id, status: 'pending', selectionReason: task.selectionReason, ...(task.source ? { source: task.source } : {}) }
        })
        put(visitor, run)
        return { mixed: project(visitor, run) }
      })
    }
    if (!['/api/exam/mixed/open', '/api/exam/mixed/pause', '/api/exam/mixed/next'].includes(path)) fail(404, 'Маршрут смешанной практики не найден')
    const run = read(visitor, body.mixedId)
    if (path === '/api/exam/mixed/open') {
      if (run.status === 'paused') { run.status = 'active'; run.revision++; run.updatedAt = new Date(now()).toISOString(); put(visitor, run) }
      return { mixed: project(visitor, run) }
    }
    id(body.requestId, 'requestId')
    const requestFingerprint = fingerprint({ path, body })
    const receipt = run.requests.find(request => request.id === body.requestId)
    if (receipt) {
      if (receipt.fingerprint !== requestFingerprint) fail(409, 'requestId уже использован для другого действия')
      return { mixed: project(visitor, run) }
    }
    if (run.status !== 'active') fail(409, 'Набор сейчас не открыт для перехода')
    cas(run, body)
    const work = readWork(visitor, run.tasks[run.currentIndex].workId)
    workCas(run, work, body)
    if (path.endsWith('/next') && !['next', 'skip', 'finish'].includes(body.action)) fail(400, 'Неизвестный переход набора')
    if (path.endsWith('/next') && body.action === 'next' && !freshSubmission(work)) fail(409, 'Сначала сдай текущую попытку, пропусти задачу или закончи набор. Непроверенное доказательство не мешает продолжить.')
    return transaction(() => {
      if (path.endsWith('/pause')) run.status = 'paused'
      else {
        const alreadySubmitted = freshSubmission(work)
        if (!alreadySubmitted) {
          if (typeof submitWork !== 'function') fail(503, 'Сохранение пропуска сейчас недоступно; твоя запись сохранена.')
          submitWork(visitor, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: `mixed:${run.id}:${work.id}`, reason: body.action === 'skip' ? 'mixed-skip' : 'mixed-finish' })
        }
        run.tasks[run.currentIndex].status = body.action === 'skip' && !alreadySubmitted ? 'skipped' : 'submitted'
        if (body.action === 'finish' || run.currentIndex === run.tasks.length - 1) { run.status = 'completed'; run.completedAt = new Date(now()).toISOString() }
        else run.currentIndex++
      }
      run.revision++; run.updatedAt = new Date(now()).toISOString()
      run.requests.push({ id: body.requestId, fingerprint: requestFingerprint }); run.requests = run.requests.slice(-64)
      put(visitor, run)
      return { mixed: project(visitor, run) }
    })
  }
  return { route }
}
