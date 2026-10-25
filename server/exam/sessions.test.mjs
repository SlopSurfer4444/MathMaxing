import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createExamSessions, examEditions } from './sessions.mjs'
import { createExamRuntime } from './runtime.mjs'
import { checkNumericAnswer } from '../percentages.mjs'

function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec('CREATE TABLE fixture_works(id TEXT PRIMARY KEY, owner TEXT, data TEXT)')
  const visitor = { owner: 'local' }, stranger = { owner: 'other' }
  const catalog = Array.from({ length: 20 }, (_, index) => ({ id: `family.secret-method-${index + 1}`, alignments: { '2026': index < 19 ? [index + 1] : [], '2027': [index + 1] }, templates: [{ id: 'fixture-number', build: () => ({ parts: [{ check: 'numeric', expected: '42' }] }) }] }))
  let time = Date.parse('2026-10-23T09:00:00Z'), next = 0, submissions = 0, closures = 0
  const put = (v, work) => { db.prepare('INSERT OR REPLACE INTO fixture_works VALUES(?,?,?)').run(work.id, v.owner, JSON.stringify(work)); return structuredClone(work) }
  const readWork = (v, id) => { const row = db.prepare('SELECT data FROM fixture_works WHERE id=? AND owner=?').get(id, v.owner); if (!row) throw Object.assign(Error('not found'), { status: 404 }); return JSON.parse(row.data) }
  const createWork = (v, data) => {
    if (options.failCreateAt === next + 1) throw Error('Fixture creation failure')
    const id = `work-${++next}`, stamp = new Date(time).toISOString()
    assert.ok(data.seed <= 2147483647)
    return put(v, { id, familyId: data.familyId, mode: data.mode, modeEpoch: 0, revision: 0, answersByPart: { answer: '' }, reasoning: '', createdAt: stamp, updatedAt: stamp, completed: false, attempts: [], evaluations: [], messages: [{ text: 'private reference' }], instance: { id: `${data.familyId}:method-secret:${data.seed}`, title: 'Use the secret method', familyId: data.familyId, templateId: 'method-secret', seed: data.seed, prompt: `Авторское условие ${data.position}`, parts: [{ id: 'answer', label: 'Ответ', kind: 'number' }], reference: ['secret answer'] } })
  }
  const submitWork = (v, data) => {
    submissions++
    if (options.failSubmitAt === submissions) throw Error('Fixture submission failure')
    const work = readWork(v, data.workId)
    assert.equal(data.expectedRevision, work.revision)
    assert.equal(data.expectedModeEpoch, work.modeEpoch)
    const attempt = { id: `attempt-${work.id}`, revision: work.revision, digest: `digest-${work.revision}`, answersByPart: work.answersByPart, reasoning: work.reasoning }
    work.attempts.push(attempt)
    work.evaluations.push({ id: `eval-${work.id}`, partId: 'answer', attemptId: attempt.id, status: work.answersByPart.answer === '42' ? 'correct' : work.answersByPart.answer ? 'incorrect' : 'unknown', checker: options.checker ?? 'mathmaxing.numeric', checkerVersion: 1, targetRevision: attempt.revision, targetDigest: options.staleDigest ? 'stale' : attempt.digest, active: true })
    work.completed = true; work.revision++
    return put(v, work)
  }
  const closeUnverifiedWork = (v, { workId, sessionId }) => {
    closures++
    if (options.failCloseAt === closures) throw Error('Fixture closure failure')
    const work = readWork(v, workId)
    assert.ok(sessionId)
    work.completed = true
    put(v, work)
  }
  const create = () => createExamSessions({ store: { db }, createWork, readWork, submitWork, closeUnverifiedWork, families: catalog, now: () => time, randomInt: options.randomInt })
  let engine = create()
  const call = (action, body = {}, v = visitor) => engine.route(action === 'state' ? 'GET' : 'POST', `/api/exam/session/${action}`, body, v)
  const start = (edition = '2026', v = visitor, requestId = 'start-one') => call('start', { edition, requestId }, v).session
  const latest = v => call('state', {}, v).session
  const submission = (session, requestId = 'submit-one') => ({ sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: session.sessionEpoch, requestId, workRevisions: session.tasks.map(task => ({ workId: task.workId, revision: task.work.revision, modeEpoch: task.work.modeEpoch })) })
  const answer = (task, value = '42') => { const work = readWork(visitor, task.workId); work.answersByPart.answer = value; work.revision++; put(visitor, work) }
  return { db, visitor, stranger, catalog, call, start, latest, submission, answer, readWork, put, get engine() { return engine }, get submissions() { return submissions }, advance(ms) { time += ms }, restart() { engine = create() } }
}
const rejected = (fn, status) => assert.throws(fn, error => error.status === status)

test('short positions accept exactly finite decimals, including reduced and decimal fractions', t => {
  for (const expected of ['0', '-2', '0,125', '3/6', '7/20', '1.2/3.0', '0/3', '−1/8', '100000000000000000000000000000000000000000000000000000000000/8']) {
    const f = fixture(t, { randomInt: () => 0 })
    f.catalog[0].templates[0].build = () => ({ parts: [{ check: 'numeric', expected }] })
    assert.equal(f.start().tasks.length, 19, expected)
  }
  for (const expected of ['1/6', '2/6', '0.1/0.3', '1/0', '1e-6', 'not-a-number', undefined]) {
    const f = fixture(t, { randomInt: () => 0 })
    f.catalog[0].templates[0].build = () => ({ parts: [{ check: 'numeric', expected }] })
    rejected(() => f.start(), 503)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fixture_works').get().n, 0, String(expected))
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM exam_sessions').get().n, 0)
  }
})

test('short candidate search retries actual seeds, wraps safely and falls back to another template', t => {
  const f = fixture(t, { randomInt: () => 0 })
  const seen = []
  f.catalog[0].templates[0].build = seed => { seen.push(seed); return { parts: [{ check: 'numeric', expected: seed < 2 ? '1/6' : '3/6' }] } }
  const session = f.start()
  assert.deepEqual(seen, [0, 1, 2])
  assert.equal(f.readWork(f.visitor, session.tasks[0].workId).instance.seed, 2)
  const wrapped = fixture(t, { randomInt: max => max - 1 })
  wrapped.catalog[0].templates[0].build = seed => ({ parts: [{ check: 'numeric', expected: seed === 0 ? '1/8' : '1/6' }] })
  assert.equal(wrapped.readWork(wrapped.visitor, wrapped.start().tasks[0].workId).instance.seed, 0)
  const fallback = fixture(t, { randomInt: () => 0 })
  let rejectedSeeds = 0
  fallback.catalog[0].templates[0].build = () => { rejectedSeeds++; return { parts: [{ check: 'numeric', expected: '1/6' }] } }
  fallback.catalog[0].templates.push({ id: 'finite-fallback', build: () => ({ parts: [{ check: 'numeric', expected: '0.25' }] }) })
  const fallbackSession = fallback.start()
  const fallbackStored = JSON.parse(fallback.db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(fallbackSession.id).data)
  assert.equal(rejectedSeeds, 64)
  assert.equal(fallbackStored.tasks[0].templateId, 'finite-fallback')
})

test('late short-position exhaustion returns 503 before creating any session or work', t => {
  for (const [edition, lastShortIndex] of [['2026', 11], ['2027', 12]]) {
    const f = fixture(t, { randomInt: () => 0 })
    let checked = 0
    f.catalog[lastShortIndex].templates[0].build = () => { checked++; return { parts: [{ check: 'numeric', expected: '1/6' }] } }
    assert.throws(() => f.start(edition), error => error.status === 503 && /конечная десятичная дробь/.test(error.message))
    assert.equal(checked, 64)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM fixture_works').get().n, 0)
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM exam_sessions').get().n, 0)
  }
})

test('real editions across distinct seeds produce exact finite-decimal short answers while themed sixths survive', async () => {
  // Independent certificate: long division must terminate, and the existing
  // exact checker must accept its decimal expansion without any rounding.
  const decimal = expected => {
    const read = value => { const [whole, tail = ''] = value.trim().replace(',', '.').split('.'); return [BigInt(whole + tail), 10n ** BigInt(tail.length)] }
    const [top, bottom = '1'] = String(expected).replace(/−/g, '-').split('/'), [an, ad] = read(top), [bn, bd] = read(bottom)
    let n = an * bd, d = ad * bn
    const negative = n < 0n !== d < 0n
    if (n < 0n) n = -n
    if (d < 0n) d = -d
    let result = `${negative ? '-' : ''}${n / d}`, remainder = n % d
    if (remainder) result += '.'
    const seen = new Set()
    while (remainder) {
      assert.equal(seen.has(remainder), false, `Repeating decimal: ${expected}`)
      assert.ok(seen.size < 256)
      seen.add(remainder); remainder *= 10n; result += String(remainder / d); remainder %= d
    }
    return result
  }
  for (const edition of examEditions) for (const initial of [0, 1, 4, 7, 19, 2147483647]) {
    const db = new DatabaseSync(':memory:'), store = { db, owner: 'local' }, runtime = createExamRuntime({ store })
    try {
      const sessions = createExamSessions({ store, ...runtime, randomInt: max => initial % max })
      const session = sessions.route('POST', '/api/exam/session/start', { edition: edition.id, requestId: 'finite-decimal' }, store).session
      for (const task of session.tasks.slice(0, edition.shortCount)) {
        const row = db.prepare("SELECT i.data FROM exam_instances i JOIN exam_works w ON json_extract(w.data,'$.instanceId')=i.id WHERE w.id=?").get(task.workId)
        const instance = JSON.parse(row.data)
        assert.equal(instance.parts.length, 1)
        const expected = String(instance.parts[0].expected)
        assert.equal(checkNumericAnswer(decimal(expected), expected).status, 'correct', `${edition.id}/${initial}/${task.position}`)
      }
      const themed = runtime.createWork(store, { familyId: 'probability.finite', templateId: 'dice-sum', seed: 4, mode: 'solo' })
      const frozen = JSON.parse(db.prepare('SELECT data FROM exam_instances WHERE id=(SELECT json_extract(data,\'$.instanceId\') FROM exam_works WHERE id=?)').get(themed.id).data)
      assert.equal(checkNumericAnswer('1/6', String(frozen.parts[0].expected)).status, 'correct')
      const saved = runtime.saveWork(store, { workId: themed.id, expectedRevision: themed.revision, expectedModeEpoch: themed.modeEpoch, answersByPart: { [frozen.parts[0].id]: '1/6' }, reasoning: '' }).work
      const checked = runtime.submitWork(store, { workId: saved.id, expectedRevision: saved.revision, expectedModeEpoch: saved.modeEpoch, requestId: 'themed-sixth' })
      assert.equal(checked.instance.prompt, themed.instance.prompt)
      assert.ok(checked.evaluations.every(evaluation => evaluation.status === 'correct'))
    } finally { runtime.close(); db.close() }
  }
})

test('frozen editions contain all positions and official weighted totals, with no method metadata in active variant', t => {
  const f = fixture(t)
  assert.deepEqual(examEditions.map(edition => [edition.taskCount, edition.maxPoints, edition.durationMinutes, edition.weights.reduce((a, b) => a + b, 0)]), [[19, 32, 235, 32], [20, 33, 235, 33]])
  const session = f.start('2027')
  assert.equal(session.editionStatus, 'draft')
  assert.equal(session.tasks.length, 20)
  assert.equal(session.remainingSeconds, 235 * 60)
  assert.equal(session.tasks[19].work.instance.prompt, 'Авторское условие 20')
  assert.equal(session.tasks[19].work.instance.title, 'Задание 20')
  assert.doesNotMatch(JSON.stringify(session), /secret|familyId|templateId|reference|seed/)
  assert.ok(session.coverageWarnings.length)
  f.catalog.length = 0
  f.restart()
  assert.deepEqual(f.latest(), session)
  assert.equal(f.db.prepare('SELECT COUNT(DISTINCT json_extract(data,\'$.familyId\')) AS count FROM fixture_works').get().count, 20)
})

test('free navigation, saved answers, blank positions, resume and exact CAS', t => {
  const f = fixture(t)
  let session = f.start()
  f.answer(session.tasks[18])
  const original = session
  session = f.call('navigate', { sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: session.sessionEpoch, position: 19 }).session
  assert.equal(session.currentPosition, 19)
  assert.equal(session.tasks[18].work.answersByPart.answer, '42')
  assert.equal(session.tasks[0].work.answersByPart.answer, '')
  rejected(() => f.call('navigate', { sessionId: session.id, expectedRevision: original.revision, expectedSessionEpoch: 0, position: 2 }), 409)
  rejected(() => f.call('navigate', { sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: 0, position: 20 }), 400)
  session = f.call('navigate', { sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: 0, position: 2 }).session
  f.restart()
  assert.deepEqual(f.call('open', { sessionId: session.id }).session, session)
})

test('single submission permits blanks, counts exact short criteria only, remains an honest lower bound', t => {
  const f = fixture(t)
  let session = f.start()
  f.answer(session.tasks[0]); f.answer(session.tasks[12])
  session = f.latest()
  const body = f.submission(session)
  const result = f.call('submit', body).session
  assert.equal(result.status, 'submitted')
  assert.equal(result.score.verifiedPoints, 1)
  assert.equal(result.score.verifiedAnswers, 2)
  assert.equal(result.score.pendingProof, 1)
  assert.equal(result.score.final, false)
  assert.equal(result.score.tasks[1].status, 'blank')
  assert.equal(result.score.tasks[12].verifiedPoints, 0)
  assert.match(result.score.summary, /нижняя граница/)
  assert.deepEqual(f.call('submit', body).session, result)
  assert.equal(f.submissions, 19)
  rejected(() => f.call('submit', { ...body, requestId: 'new-submit' }), 409)
  rejected(() => f.call('submit', { ...body, expectedRevision: body.expectedRevision + 1 }), 409)
  f.answer(session.tasks[0], 'wrong')
  assert.deepEqual(f.latest().score, result.score)
})

test('untrusted checker or stale snapshot cannot earn verified points', t => {
  for (const options of [{ checker: 'llm' }, { staleDigest: true }]) {
    const f = fixture(t, options)
    const session = f.start(); f.answer(session.tasks[0])
    assert.equal(f.call('submit', f.submission(f.latest())).session.score.verifiedPoints, 0)
  }
})

test('withdrawing an evaluation updates every score without replacing the frozen student submission', t => {
  const f = fixture(t), session = f.start()
  f.answer(session.tasks[0])
  const submitted = f.call('submit', f.submission(f.latest())).session
  assert.equal(submitted.score.verifiedPoints, 1)
  const work = f.readWork(f.visitor, session.tasks[0].workId)
  work.evaluations[0].active = false
  work.answersByPart.answer = 'later own note'
  f.put(f.visitor, work)
  const reviewed = f.latest()
  assert.equal(reviewed.score.verifiedPoints, 0)
  assert.equal(reviewed.score.tasks[0].status, 'unknown')
  assert.equal(reviewed.tasks[0].work.answersByPart.answer, '42')
  assert.equal(reviewed.tasks[0].work.evaluations[0].active, false)
  assert.equal(f.submissions, 19)
})

test('new submissions reference exact source attempts without duplicating works or scores; legacy snapshots still project', t => {
  const f = fixture(t), session = f.start()
  f.answer(session.tasks[0])
  const submitted = f.call('submit', f.submission(f.latest())).session
  const row = JSON.parse(f.db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(session.id).data)
  assert.equal(row.submittedWorks, undefined)
  assert.equal(row.score, undefined)
  assert.ok(row.tasks.every((task, index) => task.submittedAttemptId === submitted.tasks[index].work.attempts.at(-1).id))
  const source = f.readWork(f.visitor, session.tasks[0].workId)
  source.attempts.push({ ...source.attempts[0], id: 'later-attempt', answersByPart: { answer: 'wrong' } })
  source.evaluations.push({ ...source.evaluations[0], id: 'later-eval', attemptId: 'later-attempt', status: 'incorrect' })
  source.answersByPart.answer = 'later own note'
  f.put(f.visitor, source)
  assert.equal(f.latest().score.verifiedPoints, 1)
  assert.equal(f.latest().tasks[0].work.answersByPart.answer, '42')
  assert.equal(f.latest().tasks[0].work.attempts.at(-1).id, row.tasks[0].submittedAttemptId)

  // Compatibility read only: do not migrate away required legacy snapshots.
  row.submittedWorks = submitted.tasks.map(task => task.work)
  row.score = submitted.score
  row.tasks.forEach(task => { delete task.submittedAttemptId })
  const legacyBytes = JSON.stringify(row)
  f.db.prepare('UPDATE exam_sessions SET data=? WHERE id=?').run(legacyBytes, session.id)
  assert.deepEqual(f.latest(), submitted)
  source.evaluations[0].active = false
  source.answersByPart.answer = 'later note'
  f.put(f.visitor, source)
  assert.equal(f.latest().score.verifiedPoints, 0)
  assert.equal(f.latest().tasks[0].work.answersByPart.answer, '42')
  assert.equal(f.db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(session.id).data, legacyBytes)
})

test('explicit unchecked closure binds owner and CAS, bypasses timeout submission, and is replayable without mutations', t => {
  const f = fixture(t), session = f.start()
  f.answer(session.tasks[0])
  const body = { sessionId: session.id, expectedRevision: 0, expectedSessionEpoch: 0, requestId: 'end-explicit' }
  rejected(() => f.call('end-unverified', body, f.stranger), 404)
  rejected(() => f.call('end-unverified', { ...body, expectedRevision: 1 }), 409)
  f.advance(236 * 60_000)
  const closed = f.call('end-unverified', body).session
  assert.equal(f.submissions, 0)
  assert.equal(closed.status, 'closed')
  assert.equal(closed.remainingSeconds, 0)
  assert.equal(closed.score, undefined)
  assert.equal(closed.tasks[0].work.answersByPart.answer, '42')
  assert.ok(closed.tasks.every(task => task.work.completed && task.work.attempts.length === 0 && task.work.evaluations.length === 0))
  assert.match(closed.tasks[0].work.familyId, /secret/)
  assert.deepEqual(f.call('end-unverified', body).session, closed)
  rejected(() => f.call('navigate', { ...body, position: 2 }), 409)
  rejected(() => f.call('submit', f.submission(closed)), 409)
  assert.equal(f.engine.activeForWork(f.visitor), false)
})

test('unchecked closure rolls every source back when one callback fails', t => {
  const f = fixture(t, { failCloseAt: 8 }), session = f.start()
  f.answer(session.tasks[0])
  const before = f.db.prepare('SELECT data FROM fixture_works ORDER BY id').all()
  assert.throws(() => f.call('end-unverified', { sessionId: session.id, expectedRevision: 0, expectedSessionEpoch: 0, requestId: 'fail-close' }), /closure failure/)
  assert.equal(f.latest().status, 'active')
  assert.deepEqual(f.db.prepare('SELECT data FROM fixture_works ORDER BY id').all(), before)
  assert.equal(f.submissions, 0)
})

test('submission requires exact fresh versions for every work, no partial or malformed snapshots', t => {
  const f = fixture(t), session = f.start(), body = f.submission(session)
  rejected(() => f.call('submit', { ...body, workRevisions: undefined }), 400)
  rejected(() => f.call('submit', { ...body, workRevisions: body.workRevisions.slice(1) }), 400)
  rejected(() => f.call('submit', { ...body, workRevisions: [null, ...body.workRevisions.slice(1)] }), 400)
  rejected(() => f.call('submit', { ...body, workRevisions: body.workRevisions.map(() => body.workRevisions[0]) }), 400)
  f.answer(session.tasks[0])
  rejected(() => f.call('submit', body), 409)
  assert.equal(f.submissions, 0)
  assert.equal(f.latest().status, 'active')
})

test('server deadline freezes once after restart and does not allow an infinite retry or new writes through navigation', t => {
  const f = fixture(t), session = f.start()
  f.answer(session.tasks[0])
  f.advance(235 * 60_000)
  f.restart()
  const expired = f.latest()
  assert.equal(expired.status, 'submitted')
  assert.equal(expired.submissionReason, 'timeout')
  assert.equal(expired.score.verifiedPoints, 1)
  assert.equal(f.submissions, 19)
  assert.deepEqual(f.latest(), expired)
  assert.equal(f.submissions, 19)
  rejected(() => f.call('submit', f.submission(session)), 409)
  rejected(() => f.call('navigate', { sessionId: session.id, expectedRevision: 0, expectedSessionEpoch: 0, position: 2 }), 409)
})

test('owner isolation, idempotent start and owner-wide aid policy', t => {
  const f = fixture(t), session = f.start()
  assert.equal(f.engine.activeForWork(f.visitor, 'unrelated-old-work'), true)
  assert.equal(f.engine.activeForWork(f.stranger, session.tasks[0].workId), false)
  assert.deepEqual(f.engine.policyForWork(f.visitor, session.tasks[0].workId), { sessionId: session.id, status: 'active', deadlineAt: session.deadlineAt })
  assert.equal(f.engine.policyForWork(f.stranger, session.tasks[0].workId), null)
  assert.deepEqual(f.start(), session)
  rejected(() => f.start('2027'), 409)
  rejected(() => f.start('2026', f.visitor, 'start-second'), 409)
  rejected(() => f.call('open', { sessionId: session.id }, f.stranger), 404)
  assert.equal(f.latest(f.stranger), null)
  const other = f.start('2026', f.stranger)
  assert.notEqual(other.id, session.id)
  f.call('submit', f.submission(session))
  assert.equal(f.engine.activeForWork(f.visitor), false)
  assert.equal(f.engine.activeForWork(f.stranger), true)
  assert.equal(f.engine.policyForWork(f.visitor, session.tasks[0].workId).status, 'submitted')
})

test('failed creation or partial submission rolls back owned rows atomically', t => {
  const failedCreation = fixture(t, { failCreateAt: 8 })
  assert.throws(() => failedCreation.start(), /creation failure/)
  assert.equal(failedCreation.db.prepare('SELECT COUNT(*) AS count FROM fixture_works').get().count, 0)
  assert.equal(failedCreation.latest(), null)
  const failedSubmission = fixture(t, { failSubmitAt: 8 }), session = failedSubmission.start()
  assert.throws(() => failedSubmission.call('submit', failedSubmission.submission(session)), /submission failure/)
  assert.equal(failedSubmission.latest().status, 'active')
  assert.equal(failedSubmission.latest().tasks.every(task => task.work.attempts.length === 0 && task.work.revision === 0), true)
  assert.equal(failedSubmission.readWork(failedSubmission.visitor, session.tasks[0].workId).attempts.length, 0)
})

test('missing position refuses entire variant, unknown inputs never default to another edition', t => {
  const f = fixture(t)
  f.catalog.splice(3, 1)
  rejected(() => f.start(), 503)
  rejected(() => f.start('2028'), 400)
  rejected(() => f.call('start', null), 400)
  assert.equal(f.latest(), null)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM fixture_works').get().count, 0)
  assert.equal(f.engine.route('GET', '/api/exam/state', {}, f.visitor), null)
})

test('a failed automatic timeout has one persisted receipt and requires an explicit retry', t => {
  const f = fixture(t, { failSubmitAt: 3 })
  const session = f.start()
  f.advance(235 * 60_000)
  const failed = f.latest()
  assert.equal(failed.status, 'active')
  assert.equal(failed.remainingSeconds, 0)
  assert.ok(failed.submissionError)
  assert.equal(f.submissions, 3)
  f.restart()
  assert.deepEqual(f.latest(), failed)
  assert.equal(f.submissions, 3)
  const result = f.call('submit', f.submission(failed)).session
  assert.equal(result.status, 'submitted')
  assert.equal(result.submissionReason, 'timeout')
  assert.equal(result.submissionError, undefined)
  assert.equal(f.submissions, 22)
  assert.notEqual(result.submittedAt, session.createdAt)
})

test('published catalog and real runtime integrate both editions, preserve aid fences and freeze complete submissions', async t => {
  const db = new DatabaseSync(':memory:'), store = { db, owner: 'local' }
  const runtime = createExamRuntime({ store, tutor: { respond() { throw Error('Tutor must not be called during an exam') } } })
  t.after(() => { runtime.close(); db.close() })
  const sessions = createExamSessions({ store, ...runtime })
  runtime.setSessionGuard(sessions.activeForWork)
  runtime.setSessionPolicy(sessions.policyForWork)
  const ordinary = runtime.createWork(store, { familyId: 'algebra.rational-sign', mode: 'guided', seed: 4 })
  for (const edition of examEditions) {
    let session = sessions.route('POST', '/api/exam/session/start', { edition: edition.id, requestId: `integration-start-${edition.id}` }, store).session
    assert.equal(session.tasks.length, edition.taskCount)
    assert.equal(new Set(session.tasks.map(task => task.work.instance.prompt)).size > 10, true)
    const first = session.tasks[0].work
    for (const action of ['help', 'correct', 'finish', 'next', 'learn', 'chat']) {
      await assert.rejects(runtime.route('POST', `/api/exam/${action}`, { workId: first.id, expectedRevision: first.revision, expectedModeEpoch: first.modeEpoch, requestId: `blocked-${edition.id}-${action}`, action: 'open', message: 'Подскажи' }, store), error => error.status === 403)
    }
    await assert.rejects(runtime.route('POST', '/api/exam/learn', { workId: ordinary.id, expectedRevision: ordinary.revision, expectedModeEpoch: ordinary.modeEpoch, requestId: `ordinary-help-${edition.id}`, action: 'open' }, store), error => error.status === 403)
    await assert.rejects(runtime.route('POST', '/api/exam/submit', { workId: first.id, expectedRevision: first.revision, expectedModeEpoch: first.modeEpoch, requestId: `individual-${edition.id}`, examSessionId: session.id }, store), error => error.status === 403)
    const opened = (await runtime.route('POST', '/api/exam/open', { workId: first.id }, store)).work
    assert.equal(opened.familyId, undefined)
    assert.equal(opened.instance.familyId, undefined)
    assert.equal(opened.instance.templateId, undefined)
    assert.doesNotMatch(opened.instance.id, /geom|algebra|prob|trig/)
    const publicState = await runtime.route('GET', '/api/exam/state', {}, store)
    assert.ok(publicState.works.filter(work => session.tasks.some(task => task.workId === work.id)).every(work => work.familyId === undefined), 'History summaries must not map active exam tasks to methods')
    for (const task of session.tasks.filter(task => task.position <= edition.shortCount)) {
      const row = db.prepare('SELECT i.data FROM exam_instances i JOIN exam_works w ON json_extract(w.data,\'$.instanceId\')=i.id WHERE w.id=?').get(task.workId)
      const instance = JSON.parse(row.data)
      assert.equal(instance.parts.every(part => part.check !== 'proof'), true, `Short position ${task.position} cannot be a proof exercise`)
      const answersByPart = Object.fromEntries(instance.parts.map(part => [part.id, Array.isArray(part.expected) ? part.expected.join('; ') : String(part.expected)]))
      await runtime.route('POST', '/api/exam/save', { workId: task.workId, expectedRevision: task.work.revision, expectedModeEpoch: task.work.modeEpoch, answersByPart, reasoning: '' }, store)
    }
    session = sessions.route('GET', '/api/exam/session/state', {}, store).session
    const body = { sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: session.sessionEpoch, requestId: `integration-submit-${edition.id}`, workRevisions: session.tasks.map(task => ({ workId: task.workId, revision: task.work.revision, modeEpoch: task.work.modeEpoch })) }
    const submitted = sessions.route('POST', '/api/exam/session/submit', body, store).session
    assert.equal(submitted.score.verifiedPoints, edition.shortCount)
    assert.equal(submitted.score.maxPoints, edition.maxPoints)
    assert.equal(submitted.score.final, false)
    assert.ok(submitted.tasks.every(task => task.work.completed && task.work.attempts.length === 1))
    assert.deepEqual(sessions.route('POST', '/api/exam/session/submit', body, store).session, submitted)
    await assert.rejects(runtime.route('POST', '/api/exam/save', { workId: first.id, expectedRevision: submitted.tasks[0].work.revision, expectedModeEpoch: submitted.tasks[0].work.modeEpoch, answersByPart: first.answersByPart, reasoning: 'changed after exam' }, store), error => error.status === 409)
  }
  const timed = sessions.route('POST', '/api/exam/session/start', { edition: '2026', requestId: 'real-timeout' }, store).session
  const row = JSON.parse(db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(timed.id).data)
  row.deadlineAt = new Date(Date.now() - 1).toISOString()
  db.prepare('UPDATE exam_sessions SET data=? WHERE id=?').run(JSON.stringify(row), row.id)
  const first = timed.tasks[0].work
  await assert.rejects(runtime.route('POST', '/api/exam/save', { workId: first.id, expectedRevision: first.revision, expectedModeEpoch: first.modeEpoch, answersByPart: first.answersByPart, reasoning: 'after deadline' }, store), error => error.status === 409)
  const expired = sessions.route('GET', '/api/exam/session/state', {}, store).session
  assert.equal(expired.status, 'submitted')
  assert.equal(expired.submissionReason, 'timeout')
  assert.ok(expired.tasks.every(task => task.work.completed && task.work.attempts.length === 1))
  assert.deepEqual(sessions.route('GET', '/api/exam/session/state', {}, store).session, expired)
})

test('correction after a full exam creates a separate guided study copy without changing the frozen result', async t => {
  const { Store } = await import('../store.mjs')
  const store = new Store(':memory:'), db = store.db
  const runtime = createExamRuntime({ store, tutor: { respond() { throw Error('No provider is needed for a study copy') } } })
  t.after(() => { runtime.close(); store.close() })
  const sessions = createExamSessions({ store, ...runtime })
  runtime.setSessionGuard(sessions.activeForWork)
  runtime.setSessionPolicy(sessions.policyForWork)
  let session = sessions.route('POST', '/api/exam/session/start', { edition: '2026', requestId: 'study-copy-exam-start' }, store).session
  const sourceId = session.tasks[0].workId
  const frozenInstance = JSON.parse(db.prepare("SELECT i.data FROM exam_instances i JOIN exam_works w ON json_extract(w.data,'$.instanceId')=i.id WHERE w.id=? AND w.owner=?").get(sourceId, store.owner).data)
  const answersByPart = Object.fromEntries(frozenInstance.parts.map(part => [part.id, Array.isArray(part.expected) ? part.expected.join('; ') : String(part.expected)]))
  await runtime.route('POST', '/api/exam/save', { workId: sourceId, expectedRevision: session.tasks[0].work.revision, expectedModeEpoch: session.tasks[0].work.modeEpoch, answersByPart, reasoning: 'Моя исходная экзаменационная запись.' }, store)
  session = sessions.route('GET', '/api/exam/session/state', {}, store).session
  const submitted = sessions.route('POST', '/api/exam/session/submit', {
    sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: session.sessionEpoch, requestId: 'study-copy-exam-submit',
    workRevisions: session.tasks.map(task => ({ workId: task.workId, revision: task.work.revision, modeEpoch: task.work.modeEpoch })),
  }, store).session
  const source = submitted.tasks[0].work
  assert.equal(source.completed, true)
  assert.equal(submitted.score.tasks[0].status, 'verified')
  const originalWorkBytes = db.prepare('SELECT data FROM exam_works WHERE id=? AND owner=?').get(sourceId, store.owner).data
  const originalSessionBytes = db.prepare('SELECT data FROM exam_sessions WHERE id=? AND owner=?').get(session.id, store.owner).data
  const assertExamUnchanged = () => {
    assert.equal(db.prepare('SELECT data FROM exam_works WHERE id=? AND owner=?').get(sourceId, store.owner).data, originalWorkBytes)
    assert.equal(db.prepare('SELECT data FROM exam_sessions WHERE id=? AND owner=?').get(session.id, store.owner).data, originalSessionBytes)
    assert.deepEqual(sessions.route('GET', '/api/exam/session/state', {}, store).session, submitted)
  }

  let { work: study } = await runtime.route('POST', '/api/exam/correct', { workId: sourceId, expectedRevision: source.revision, expectedModeEpoch: source.modeEpoch, requestId: 'study-copy-correct' }, store)
  assert.notEqual(study.id, sourceId)
  assert.equal(study.mode, 'guided')
  assert.equal(study.completed, false)
  assert.equal(study.exposure, true)
  assert.equal(study.priorExposure, true)
  assert.equal(study.sourceWorkId, sourceId)
  assert.equal(study.correctionOf, source.attempts.at(-1).id)
  assert.equal(study.examSessionId, undefined)
  assert.deepEqual(study.instance, source.instance)
  assert.deepEqual(study.answersByPart, source.answersByPart)
  assert.equal(study.reasoning, source.reasoning)
  const studyInstance = JSON.parse(db.prepare("SELECT i.data FROM exam_instances i JOIN exam_works w ON json_extract(w.data,'$.instanceId')=i.id WHERE w.id=? AND w.owner=?").get(study.id, store.owner).data)
  assert.deepEqual(studyInstance, frozenInstance)
  assertExamUnchanged()

  const revisedAnswers = Object.fromEntries(study.instance.parts.map(part => [part.id, '999999999']))
  ;({ work: study } = await runtime.route('POST', '/api/exam/save', { workId: study.id, expectedRevision: study.revision, expectedModeEpoch: study.modeEpoch, answersByPart: revisedAnswers, reasoning: 'Новое рассуждение только в учебной копии.' }, store))
  const reviewed = (await runtime.route('POST', '/api/exam/submit', { workId: study.id, expectedRevision: study.revision, expectedModeEpoch: study.modeEpoch, requestId: 'study-copy-submit' }, store)).work
  assert.deepEqual(reviewed.answersByPart, revisedAnswers)
  assert.equal(reviewed.reasoning, 'Новое рассуждение только в учебной копии.')
  assert.equal(reviewed.attempts.at(-1).independent, false)
  assert.equal(reviewed.attempts.at(-1).correctionOf, source.attempts.at(-1).id)
  assertExamUnchanged()
})
