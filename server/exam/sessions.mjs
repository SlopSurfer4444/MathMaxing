import { createHash, randomUUID, randomInt as cryptoRandomInt } from 'node:crypto'
import { families as publishedFamilies } from './registry.mjs'
import { checkNumericAnswer } from '../percentages.mjs'

// Frozen edition criteria: official 2026 specification and 2027 project,
// sources and verification retained in docs/full-exam-expansion-2026-10-23/pro-response.md §4/F1–F4.
export const examEditions = Object.freeze([
  Object.freeze({ id: '2026', label: 'ЕГЭ 2026', status: 'final', taskCount: 19, maxPoints: 32, durationMinutes: 235, shortCount: 12, weights: Object.freeze([...Array(12).fill(1), 2, 3, 2, 2, 3, 4, 4]) }),
  Object.freeze({ id: '2027', label: 'ЕГЭ 2027 — проект', status: 'draft', taskCount: 20, maxPoints: 33, durationMinutes: 235, shortCount: 13, weights: Object.freeze([...Array(13).fill(1), 2, 3, 2, 2, 3, 4, 4]) }),
])

const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const identifier = (value, name) => { if (typeof value !== 'string' || value.length < 1 || value.length > 160 || !/^[\w.:-]+$/.test(value)) fail(400, `Некорректный ${name}`); return value }
const publicEditions = () => examEditions.map(({ weights, shortCount, ...edition }) => edition)
const submissionFingerprint = body => createHash('sha256').update(JSON.stringify({ expectedRevision: body.expectedRevision, expectedSessionEpoch: body.expectedSessionEpoch, workRevisions: body.workRevisions })).digest('hex')
const SHORT_SEED_ATTEMPTS = 64, SEED_RANGE = 2147483648
function finiteDecimalAnswer(expected) {
  const value = String(expected)
  // Reuse the numeric checker's bounded exact grammar, including decimal
  // numerator/denominator forms. Decimal scales contribute only factors 2/5.
  try { if (checkNumericAnswer(value, value).status !== 'correct') return false } catch { return false }
  const parts = value.replace(/−/g, '-').split('/')
  if (parts.length === 1) return true
  const whole = part => BigInt(part.trim().replace(/^[+-]/, '').replace(/[.,]/g, ''))
  const numerator = whole(parts[0])
  let denominator = whole(parts[1])
  let a = numerator, b = denominator
  while (b) [a, b] = [b, a % b]
  denominator /= a
  for (const factor of [2n, 5n]) while (denominator % factor === 0n) denominator /= factor
  return denominator === 1n
}

// Injecting clock/catalog/randomness supports deterministic offline acceptance.
// Production uses server-owned defaults; none is accepted from HTTP.
export function createExamSessions({ store, createWork, readWork, submitWork, closeUnverifiedWork, families = publishedFamilies, now = () => Date.now(), randomInt = cryptoRandomInt }) {
  const db = store.db
  db.exec('CREATE TABLE IF NOT EXISTS exam_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS exam_sessions_owner ON exam_sessions(owner)')
  const owner = visitorStore => visitorStore?.owner ?? fail(400, 'Не указан профиль')
  const list = visitorStore => db.prepare('SELECT data FROM exam_sessions WHERE owner=? ORDER BY rowid DESC').all(owner(visitorStore)).map(row => JSON.parse(row.data))
  const read = (visitorStore, id) => {
    identifier(id, 'sessionId')
    const row = db.prepare('SELECT data FROM exam_sessions WHERE id=? AND owner=?').get(id, owner(visitorStore))
    if (!row) fail(404, 'Вариант не найден')
    return JSON.parse(row.data)
  }
  const put = (visitorStore, session) => {
    const data = JSON.stringify(session)
    const total = db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS bytes FROM exam_sessions WHERE owner=? AND id<>?').get(owner(visitorStore), session.id)
    if (Buffer.byteLength(data) > 6_000_000 || total.bytes + Buffer.byteLength(data) > 12_000_000) fail(429, 'Хранилище вариантов заполнено. Сохрани архив профиля; существующие ответы не удалены.')
    const previous = db.prepare('SELECT length(CAST(data AS BLOB)) AS bytes FROM exam_sessions WHERE owner=? AND id=?').get(owner(visitorStore), session.id)
    visitorStore.assertCanStore?.(Buffer.byteLength(data) - (previous?.bytes ?? 0))
    db.prepare('INSERT OR REPLACE INTO exam_sessions(id,owner,data) VALUES(?,?,?)').run(session.id, owner(visitorStore), data)
  }
  const atomic = fn => {
    db.exec('SAVEPOINT exam_session_change')
    try { const result = fn(); db.exec('RELEASE exam_session_change'); return result }
    catch (error) { db.exec('ROLLBACK TO exam_session_change'); db.exec('RELEASE exam_session_change'); throw error }
  }
  const cas = (session, body) => {
    if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || !Number.isSafeInteger(body.expectedSessionEpoch) || body.expectedSessionEpoch < 0) fail(400, 'Нужны версия варианта и эпоха')
    if (body.expectedRevision !== session.revision || body.expectedSessionEpoch !== session.sessionEpoch) fail(409, 'Вариант изменился. Обнови его перед действием.')
  }
  const currentWorks = (visitorStore, session) => session.tasks.map(task => readWork(visitorStore, task.workId))
  const score = (session, works) => {
    let verifiedPoints = 0, pendingProof = 0, verifiedAnswers = 0
    const tasks = session.tasks.map((task, index) => {
      const work = works[index]
      const attempt = work.attempts?.at(-1)
      const evaluations = (work.evaluations ?? []).filter(e => e.attemptId === attempt?.id && e.active !== false)
      const parts = work.instance.parts ?? []
      const answered = Object.values(attempt?.answersByPart ?? work.answersByPart ?? {}).some(answer => String(answer).trim()) || Boolean((attempt?.reasoning ?? work.reasoning ?? '').trim())
      const allCorrect = parts.length > 0 && parts.every(part => evaluations.some(e => e.partId === part.id && e.status === 'correct' && ['mathmaxing.numeric', 'mathmaxing.interval', 'mathmaxing.roots', 'mathmaxing.series', 'mathmaxing.choice'].includes(e.checker) && e.checkerVersion === 1 && e.targetRevision === attempt.revision && e.targetDigest === attempt.digest))
      if (allCorrect) verifiedAnswers++
      // A correct numeric fragment is not the edition's criterion for an extended solution.
      // No arbitrary points-per-part or whole-task weighting is inferred from templates.
      const short = task.position <= session.blueprint.shortCount
      const points = short && allCorrect ? 1 : 0
      verifiedPoints += points
      if (!short && answered) pendingProof++
      return { position: task.position, verifiedPoints: points, maxPoints: task.maxPoints, status: !answered ? 'blank' : !short ? 'pending_review' : allCorrect ? 'verified' : evaluations.some(e => e.status === 'unknown') || parts.some(part => !evaluations.some(e => e.partId === part.id)) ? 'unknown' : 'incorrect' }
    })
    return { verifiedPoints, verifiedAnswers, maxPoints: session.blueprint.maxPoints, pendingProof, final: false, tasks,
      summary: `Подтверждено не менее ${verifiedPoints} из ${session.blueprint.maxPoints} первичных баллов. Это нижняя граница по кратким ответам; развёрнутые решения требуют проверки по критериям редакции. Итоговый балл экзамена не установлен.` }
  }
  const conceal = (work, position) => {
    // Explicit projection: no family, method, generator/template identifier, seed,
    // previous attempt, learning material or answer-bearing messages before submit.
    const instance = work.instance ?? {}
    return { id: work.id, mode: 'solo', modeEpoch: work.modeEpoch, revision: work.revision, answersByPart: work.answersByPart ?? {}, reasoning: work.reasoning ?? '', createdAt: work.createdAt, updatedAt: work.updatedAt, completed: false, attempts: [], evaluations: [], messages: [], exposure: false,
      instance: { id: work.id, version: instance.version, title: `Задание ${position}`, prompt: instance.prompt, parts: (instance.parts ?? []).map(({ id, label, kind, prompt, answerUnit }) => ({ id, label, kind, ...(prompt ? { prompt } : {}), ...(answerUnit ? { answerUnit } : {}) })), ...(instance.svg ? { svg: instance.svg } : {}), ...(instance.table ? { table: instance.table } : {}) } }
  }
  const project = (visitorStore, session) => {
    const current = currentWorks(visitorStore, session)
    // Answers and attempts stay frozen. A later objection may withdraw an
    // evaluation of that same attempt, and every score consumer must observe it.
    const works = session.status === 'submitted' ? session.tasks.map((task, index) => {
      const source = current[index], legacy = session.submittedWorks?.[index]
      const attemptId = task.submittedAttemptId ?? legacy?.attempts?.at(-1)?.id
      const frozen = legacy ?? source
      const attempt = frozen.attempts?.find(item => item.id === attemptId)
      if (!attempt) fail(409, 'Исходная попытка варианта недоступна. История не изменена.')
      return { ...frozen, answersByPart: structuredClone(attempt.answersByPart ?? frozen.answersByPart ?? {}), reasoning: attempt.reasoning ?? frozen.reasoning ?? '', attempts: legacy ? frozen.attempts : [attempt], evaluations: (source.evaluations ?? []).filter(evaluation => evaluation.attemptId === attemptId) }
    }) : current
    return { id: session.id, edition: session.edition, editionStatus: session.blueprint.status, status: session.status, revision: session.revision, sessionEpoch: session.sessionEpoch, currentPosition: session.currentPosition, createdAt: session.createdAt, deadlineAt: session.deadlineAt, remainingSeconds: session.status !== 'active' ? 0 : Math.max(0, Math.ceil((Date.parse(session.deadlineAt) - now()) / 1000)), ...(session.status === 'submitted' ? { submittedAt: session.submittedAt, submissionReason: session.submissionReason, score: score(session, works) } : {}), ...(session.status === 'active' && session.timeoutFailure ? { submissionError: session.timeoutFailure.quota ? 'Хранилище заполнено. Автоматическая сдача не записана; черновики сохранены. Можно завершить вариант без проверки.' : 'Автоматическая сдача не выполнена; ответы сохранены. Повтор возможен только по явной команде.', submissionFailedAt: session.timeoutFailure.createdAt } : {}),
      tasks: session.tasks.map((task, index) => ({ position: task.position, maxPoints: task.maxPoints, workId: task.workId, work: session.status === 'active' ? conceal(works[index], task.position) : works[index] })), coverageWarnings: [...session.coverageWarnings] }
  }
  const freezeSubmit = (visitorStore, session, requestId, reason, expectedWorks, fingerprint) => atomic(() => {
    const works = currentWorks(visitorStore, session)
    if (expectedWorks) {
      if (!Array.isArray(expectedWorks) || expectedWorks.length !== works.length || expectedWorks.some(item => !item || typeof item !== 'object' || typeof item.workId !== 'string' || !Number.isSafeInteger(item.revision) || item.revision < 0 || !Number.isSafeInteger(item.modeEpoch) || item.modeEpoch < 0) || new Set(expectedWorks.map(item => item.workId)).size !== works.length) fail(400, 'Нужны версии всех работ варианта')
      for (const work of works) {
        const expected = expectedWorks.find(item => item.workId === work.id)
        if (!expected || !Number.isSafeInteger(expected.revision) || !Number.isSafeInteger(expected.modeEpoch)) fail(400, 'Некорректная версия работы')
        if (expected.revision !== work.revision || expected.modeEpoch !== work.modeEpoch) fail(409, 'Ответы изменились. Обнови вариант перед сдачей.')
      }
    }
    works.forEach((work, index) => {
      const submitted = submitWork(visitorStore, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: `exam:${session.id}:${work.id}`, examSessionId: session.id, reason })
      const attemptId = submitted.attempts?.at(-1)?.id
      if (typeof attemptId !== 'string' || !attemptId) fail(409, 'Исходная попытка не сохранена. Вариант не сдан.')
      session.tasks[index].submittedAttemptId = attemptId
    })
    session.status = 'submitted'; session.submittedAt = new Date(now()).toISOString(); session.submissionReason = reason; session.submitRequestId = requestId; session.submitFingerprint = fingerprint; delete session.timeoutFailure; session.revision++; session.sessionEpoch++
    put(visitorStore, session)
    return session
  })
  const expire = (visitorStore, session) => {
    if (session.status !== 'active' || session.timeoutFailure || now() < Date.parse(session.deadlineAt)) return session
    try { return freezeSubmit(visitorStore, session, `timeout:${session.id}`, 'timeout') }
    catch {
      // A failed deterministic timeout pass must not become an invisible retry loop.
      // The transaction preserved all answers; the runtime policy keeps editing closed.
      const preserved = read(visitorStore, session.id)
      const failure = { createdAt: new Date(now()).toISOString() }
      preserved.timeoutFailure = failure; preserved.revision++
      try { put(visitorStore, preserved); return preserved }
      catch (error) {
        if (error.status !== 429) throw error
        // Even the small terminal receipt may not fit. Keep the actual stored
        // revision/epoch and make the failed read visible without writing it.
        // Production submitWork only snapshots and runs synchronous checkPart:
        // no tutor/provider dispatch occurs here, including after a restart.
        // Any retry of this local check is fully rolled back by freezeSubmit.
        return { ...read(visitorStore, session.id), timeoutFailure: { ...failure, quota: true } }
      }
    }
  }
  const policyForWork = (visitorStore, workId) => {
    const session = list(visitorStore).find(item => item.tasks.some(task => task.workId === workId))
    return session ? { sessionId: session.id, status: session.status, deadlineAt: session.deadlineAt } : null
  }
  // Aid to any work can leak a method into the live variant, so the policy is owner-wide.
  const activeForWork = visitorStore => list(visitorStore).some(session => session.status === 'active')

  function route(method, path, body = {}, visitorStore) {
    if (!path.startsWith('/api/exam/session/')) return null
    if (method === 'GET' && path === '/api/exam/session/state') {
      const session = list(visitorStore)[0]
      return { editions: publicEditions(), session: session ? project(visitorStore, expire(visitorStore, session)) : null }
    }
    if (method !== 'POST') fail(404, 'Маршрут варианта не найден')
    if (body === null || typeof body !== 'object' || Array.isArray(body) || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) fail(400, 'Некорректный запрос варианта')
    if (path === '/api/exam/session/start') {
      const edition = examEditions.find(item => item.id === body.edition)
      if (!edition) fail(400, 'Редакция экзамена не поддерживается')
      identifier(body.requestId, 'requestId')
      const previous = list(visitorStore)
      const replay = previous.find(session => session.startRequestId === body.requestId)
      if (replay) {
        if (replay.edition !== edition.id) fail(409, 'requestId уже использован с другой редакцией')
        return { session: project(visitorStore, expire(visitorStore, replay)) }
      }
      if (previous.some(session => expire(visitorStore, session).status === 'active')) fail(409, 'Сначала сдай текущий вариант')
      if (previous.length >= 20) fail(429, 'Сохранено 20 вариантов. Сначала создай архив профиля; варианты автоматически не удаляются.')
      const selected = edition.weights.map((maxPoints, index) => {
        const eligible = families.filter(family => Array.isArray(family.alignments?.[edition.id]) && family.alignments[edition.id].includes(index + 1) && family.templates?.length).flatMap(family => family.templates.map(template => ({ family, template })))
        if (!eligible.length) fail(503, `Для задания ${index + 1} пока нет опубликованного семейства. Вариант не создан.`)
        const first = randomInt(eligible.length)
        for (let offset = 0; offset < eligible.length; offset++) {
          const candidate = eligible[(first + offset) % eligible.length], initialSeed = randomInt(SEED_RANGE)
          if (index >= edition.shortCount) return { position: index + 1, maxPoints, ...candidate, seed: initialSeed }
          // Validate the actual frozen seed, rather than inferring answer format
          // from build(0). Exhaustion is bounded and happens before any work exists.
          for (let attempt = 0; attempt < SHORT_SEED_ATTEMPTS; attempt++) {
            const seed = (initialSeed + attempt) % SEED_RANGE, parts = candidate.template.build(seed).parts
            if (parts.length === 1 && parts[0].check === 'numeric' && finiteDecimalAnswer(parts[0].expected)) return { position: index + 1, maxPoints, ...candidate, seed }
          }
        }
        fail(503, `Для задания ${index + 1} не найден допустимый краткий ответ — целое число или конечная десятичная дробь. Вариант не создан.`)
      })
      return atomic(() => {
        const id = randomUUID(), startedAt = now(), createdAt = new Date(startedAt).toISOString()
        const session = { id, edition: edition.id, blueprint: structuredClone(edition), status: 'active', revision: 0, sessionEpoch: 0, currentPosition: 1, createdAt, deadlineAt: new Date(startedAt + edition.durationMinutes * 60_000).toISOString(), startRequestId: body.requestId,
          coverageWarnings: ['Вариант составлен из опубликованных авторских подтипов. Полное покрытие всех подтипов ЕГЭ и предметная приёмка банка этим не подтверждены.'], tasks: [] }
        // Insert the session before callbacks so a runtime projection can discover its policy.
        put(visitorStore, session)
        session.tasks = selected.map(({ position, maxPoints, family, template, seed }) => {
          const work = createWork(visitorStore, { familyId: family.id, templateId: template.id, mode: 'solo', seed, requestId: `exam:${id}:${position}`, sessionId: id, position })
          return { position, maxPoints, familyId: family.id, templateId: template.id, workId: work.id }
        })
        put(visitorStore, session)
        return { session: project(visitorStore, session) }
      })
    }
    if (!['/api/exam/session/open', '/api/exam/session/navigate', '/api/exam/session/submit', '/api/exam/session/end-unverified'].includes(path)) fail(404, 'Маршрут варианта не найден')
    let session = read(visitorStore, body.sessionId)
    // This explicit exit precedes expire(): automatic submission itself may
    // need unavailable space for attempts/evaluations at the reserve ceiling.
    if (path === '/api/exam/session/end-unverified') {
      identifier(body.requestId, 'requestId')
      if (session.status === 'closed') return { session: project(visitorStore, session) }
      if (session.status !== 'active') fail(409, 'Вариант уже сдан')
      cas(session, body)
      if (typeof closeUnverifiedWork !== 'function') fail(503, 'Завершение без проверки временно недоступно. Записи сохранены.')
      return atomic(() => {
        for (const task of session.tasks) closeUnverifiedWork(visitorStore, { workId: task.workId, sessionId: session.id })
        // active→closed is equal length. No new receipt, timestamp or counters:
        // status itself fences every subsequent active-session mutation.
        session.status = 'closed'
        delete session.timeoutFailure
        put(visitorStore, session)
        return { session: project(visitorStore, session) }
      })
    }
    if (path === '/api/exam/session/submit') {
      identifier(body.requestId, 'requestId')
      if (session.status === 'submitted') {
        if (body.requestId !== session.submitRequestId || submissionFingerprint(body) !== session.submitFingerprint) fail(409, 'Вариант уже сдан. Повторная сдача не выполняется.')
        return { session: project(visitorStore, session) }
      }
    }
    session = expire(visitorStore, session)
    if (path === '/api/exam/session/open') return { session: project(visitorStore, session) }
    if (session.status !== 'active') fail(409, 'Вариант уже сдан')
    cas(session, body)
    if (path === '/api/exam/session/navigate') {
      if (now() >= Date.parse(session.deadlineAt)) fail(409, 'Время варианта истекло. Ответы сохранены; нужна явная повторная сдача.')
      if (!Number.isSafeInteger(body.position) || body.position < 1 || body.position > session.tasks.length) fail(400, 'Некорректный номер задания')
      session.currentPosition = body.position; session.revision++; put(visitorStore, session)
    } else {
      if (!Array.isArray(body.workRevisions)) fail(400, 'Нужны версии всех работ варианта')
      session = freezeSubmit(visitorStore, session, body.requestId, now() >= Date.parse(session.deadlineAt) ? 'timeout' : 'student', body.workRevisions, submissionFingerprint(body))
    }
    return { session: project(visitorStore, session) }
  }
  return { route, activeForWork, policyForWork }
}
