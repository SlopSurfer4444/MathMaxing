import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { createExamMixed } from './mixed.mjs'
import { createExamRuntime } from './runtime.mjs'
import { families as publishedFamilies } from './registry.mjs'

const rejected = (fn, status) => assert.throws(fn, error => error.status === status)
function savedObservation(f, { key = 'earlier', familyId = 'integer.fixture', createdAt = '2026-10-10T09:00:00Z', status = 'correct', independent = true, retracted = false, replacementStatus, provenance, skipped = false } = {}) {
  f.db.exec('CREATE TABLE IF NOT EXISTS exam_observations(id TEXT,owner TEXT,work_id TEXT,family_id TEXT,attempt_id TEXT,created_at TEXT,data TEXT); CREATE TABLE IF NOT EXISTS exam_works(id TEXT PRIMARY KEY,owner TEXT,family_id TEXT,updated_at TEXT,completed INTEGER,revision INTEGER,data TEXT)')
  const attempt = { id: `${key}-attempt`, answersByPart: { answer: '42' }, reasoning: '', revision: 2, modeEpoch: 0, mode: 'solo', independent, practiceKind: 'themed', reason: skipped ? 'mixed-skip' : 'submit', createdAt }
  attempt.digest = createHash('sha256').update(JSON.stringify({ answersByPart: attempt.answersByPart, reasoning: attempt.reasoning, revision: attempt.revision, modeEpoch: attempt.modeEpoch })).digest('hex')
  const evaluation = { id: `${key}-evaluation`, attemptId: attempt.id, partId: 'answer', claim: 'answer', status, targetRevision: attempt.revision, targetDigest: attempt.digest, createdAt }
  const work = { id: `${key}-work`, familyId, attempts: [attempt], evaluations: [evaluation], retractions: retracted || replacementStatus ? [{ evaluationId: evaluation.id }] : [] }
  if (replacementStatus) work.evaluations.push({ ...evaluation, id: `${key}-replacement`, supersedes: evaluation.id, status: replacementStatus, provenance: 'reconsideration' })
  const event = { id: `${key}-observation`, workId: work.id, familyId, attemptId: attempt.id, createdAt, status, independent, practiceKind: 'themed', skipped, evaluationIds: [evaluation.id], ...(provenance ? { provenance } : {}) }
  f.db.prepare('INSERT INTO exam_observations VALUES(?,?,?,?,?,?,?)').run(event.id, 'local', event.workId, familyId, attempt.id, createdAt, JSON.stringify(event))
  f.db.prepare('INSERT INTO exam_works VALUES(?,?,?,?,?,?,?)').run(work.id, 'local', familyId, createdAt, 0, 3, JSON.stringify(work))
  return { event, work, attempt, evaluation }
}
function fixture(t, options = {}) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec('CREATE TABLE fixture_works(id TEXT PRIMARY KEY,owner TEXT,data TEXT)')
  const visitor = { owner: 'local', assertCanStore() { if (options.failPut) throw Object.assign(Error('Storage full'), { status: 429 }) } }, stranger = { owner: 'stranger' }
  let time = Date.parse('2026-10-23T09:00:00Z'), next = 0, submits = 0
  const catalog = ['geom.fixture', 'probability.fixture', 'algebra.fixture', 'model.fixture', 'integer.fixture'].map((id, index) => ({ id, group: `group-${index}`, templates: [{ id: 'structure-a' }, { id: 'structure-b' }] }))
  const putWork = (v, work) => { db.prepare('INSERT OR REPLACE INTO fixture_works VALUES(?,?,?)').run(work.id, v.owner, JSON.stringify(work)); return structuredClone(work) }
  const readWork = (v, workId) => { const row = db.prepare('SELECT data FROM fixture_works WHERE owner=? AND id=?').get(v.owner, workId); if (!row) throw Object.assign(Error('Work not found'), { status: 404 }); return JSON.parse(row.data) }
  const createWork = (v, data) => {
    if (options.failCreate === next + 1) throw Error('Creation failed')
    const work = { id: `work-${++next}`, familyId: data.familyId, blind: data.blind, practiceKind: data.practiceKind, mode: data.mode, modeEpoch: 0, revision: 0, answersByPart: { answer: '' }, reasoning: '', completed: false, exposure: false, attempts: [], evaluations: [], messages: [], instance: { id: `${data.familyId}:${data.templateId}:${data.seed}`, familyId: data.familyId, templateId: data.templateId, seed: data.seed, title: 'Secret method title', prompt: `Statement ${next}`, parts: [{ id: 'answer', kind: 'number', label: 'Ответ', expected: 42 }], reference: ['Hidden answer'] }, createdAt: new Date(time).toISOString(), updatedAt: new Date(time).toISOString() }
    return putWork(v, work)
  }
  const submitWork = (v, data) => {
    submits++
    if (options.failSubmit) throw Error('Submission failed')
    const work = readWork(v, data.workId)
    const attempt = { id: `attempt-${work.id}-${work.attempts.length}`, reason: data.reason === 'mixed-skip' ? 'mixed-skip' : 'submit', answersByPart: structuredClone(work.answersByPart), reasoning: work.reasoning, independent: !work.exposure, practiceKind: work.practiceKind, revision: work.revision }
    work.attempts.push(attempt); work.evaluations.push({ id: `evaluation-${work.id}`, attemptId: attempt.id, status: data.reason === 'mixed-skip' ? 'unknown' : work.answersByPart.answer === '42' ? 'correct' : 'unknown' }); work.mode = 'review'; work.modeEpoch++; work.revision++
    return putWork(v, work)
  }
  const create = () => createExamMixed({ store: { db }, createWork, readWork, submitWork, families: catalog, now: () => time })
  let engine = create()
  const call = (action, body = {}, v = visitor) => engine.route(action === 'state' ? 'GET' : 'POST', `/api/exam/mixed/${action}`, body, v)
  const start = (requestId = 'start-one', v = visitor) => call('start', { requestId }, v).mixed
  const latest = v => call('state', {}, v).mixed
  const action = (run, action = 'next', requestId = 'transition-one') => ({ mixedId: run.id, expectedRevision: run.revision, workId: run.work.id, expectedWorkRevision: run.work.revision, expectedWorkModeEpoch: run.work.modeEpoch, requestId, action })
  const submit = run => submitWork(visitor, { workId: run.work.id })
  const answer = (run, value = '42') => { const work = readWork(visitor, run.work.id); work.answersByPart.answer = value; work.revision++; putWork(visitor, work) }
  const privateRun = run => JSON.parse(db.prepare('SELECT data FROM exam_mixed WHERE id=?').get(run.id).data)
  return { db, catalog, visitor, stranger, call, start, latest, action, submit, answer, readWork, putWork, privateRun, get submits() { return submits }, restart() { engine = create() }, advance(ms) { time += ms } }
}

test('three frozen distinct domains are blind; restart and public history never reveal future methods', t => {
  const f = fixture(t), run = f.start()
  assert.equal(run.total, 3)
  assert.equal(run.tasks.length, 3)
  assert.equal(run.currentIndex, 0)
  assert.equal(new Set(f.privateRun(run).tasks.map(task => task.familyId.split('.')[0])).size, 3)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM fixture_works').get().count, 3)
  assert.doesNotMatch(JSON.stringify(run), /familyId|templateId|Hidden answer|expected|seed|Secret method/)
  assert.equal(run.work.instance.title, 'Задача')
  assert.ok(run.tasks.every(task => task.work.instance.title === 'Задача'))
  f.catalog.length = 0
  f.restart()
  assert.deepEqual(f.latest(), run)
  assert.deepEqual(f.start(), run)
  assert.doesNotMatch(JSON.stringify(f.call('history')), /familyId|templateId|Secret method/)
  assert.equal(f.call('state').runs.length, 1)
})

test('next requires a fresh submitted attempt; help snapshot alone does not count and unknown proof can finish', t => {
  const f = fixture(t)
  let run = f.start()
  rejected(() => f.call('next', f.action(run)), 409)
  const work = f.readWork(f.visitor, run.work.id)
  work.mode = 'guided'; work.modeEpoch++; work.revision++; work.exposure = true
  work.attempts.push({ id: 'before-help', reason: 'before-help', answersByPart: { answer: '' }, reasoning: '' })
  f.putWork(f.visitor, work)
  run = f.latest()
  assert.ok(run.work.familyId)
  rejected(() => f.call('next', f.action(run)), 409)
  f.submit(run)
  run = f.latest()
  const body = f.action(run)
  run = f.call('next', body).mixed
  assert.equal(run.currentIndex, 1)
  assert.equal(run.completedCount, 1)
  assert.equal(run.tasks[0].status, 'submitted')
  assert.deepEqual(f.call('next', body).mixed, run)
  rejected(() => f.call('next', { ...body, action: 'skip' }), 409)
  const finished = f.call('next', f.action(run, 'finish', 'finish-unknown')).mixed
  assert.equal(finished.status, 'completed')
  assert.equal(finished.completedCount, 2)
  assert.equal(finished.tasks[2].status, 'pending')
  assert.equal(finished.tasks[2].work.familyId, undefined)
  assert.equal(finished.selection.length, 2)
  assert.equal(finished.tasks[1].work.evaluations[0].status, 'unknown')
})

test('work CAS, run CAS and content freshness reject stale tabs without advancing the set', t => {
  const f = fixture(t), run = f.start()
  f.answer(run)
  rejected(() => f.call('next', f.action(run, 'skip')), 409)
  f.submit(f.latest())
  const submitted = f.latest(), work = f.readWork(f.visitor, submitted.work.id)
  work.answersByPart.answer = 'changed after submitted snapshot'; work.revision++; work.mode = 'guided'
  f.putWork(f.visitor, work)
  rejected(() => f.call('next', f.action(f.latest())), 409)
  rejected(() => f.call('next', { ...f.action(f.latest(), 'skip'), expectedRevision: 9 }), 409)
  rejected(() => f.call('next', { ...f.action(f.latest(), 'skip'), expectedWorkModeEpoch: 99 }), 409)
  rejected(() => f.call('next', { ...f.action(f.latest(), 'skip'), workId: 'another-work' }), 409)
  assert.equal(f.latest().currentIndex, 0)
})

test('pause retains exact draft, restart resumes without timer and only one unfinished run is allowed', t => {
  const f = fixture(t)
  let run = f.start()
  f.answer(run)
  run = f.latest()
  const paused = f.call('pause', f.action(run, undefined, 'pause-one')).mixed
  assert.equal(paused.status, 'paused')
  assert.equal(paused.work.answersByPart.answer, '42')
  assert.equal(f.submits, 0)
  f.advance(30 * 86400_000); f.restart()
  assert.deepEqual(f.latest(), paused)
  rejected(() => f.start('second-run'), 409)
  rejected(() => f.call('next', f.action(paused, 'skip')), 409)
  run = f.call('open', { mixedId: paused.id }).mixed
  assert.equal(run.status, 'active')
  assert.equal(run.work.answersByPart.answer, '42')
  assert.equal(run.deadlineAt, undefined)
  assert.equal(run.revision, paused.revision + 1)
})

test('explicit skip freezes the student snapshot once, records unknown and progresses without forced proof', t => {
  const f = fixture(t)
  let run = f.start()
  f.answer(run)
  run = f.latest()
  const body = f.action(run, 'skip', 'skip-once')
  const next = f.call('next', body).mixed
  assert.equal(next.currentIndex, 1)
  assert.equal(next.tasks[0].status, 'skipped')
  assert.equal(next.tasks[0].work.attempts[0].reason, 'mixed-skip')
  assert.equal(next.tasks[0].work.attempts[0].answersByPart.answer, '42')
  assert.equal(next.tasks[0].work.evaluations[0].status, 'unknown')
  assert.equal(f.submits, 1)
  assert.deepEqual(f.call('next', body).mixed, next)
  assert.equal(f.submits, 1)
  assert.equal(next.work.familyId, undefined)
})

test('visitor isolation covers run IDs, work IDs, history, start receipts and independent unfinished runs', t => {
  const f = fixture(t), run = f.start()
  assert.equal(f.latest(f.stranger), null)
  assert.deepEqual(f.call('history', {}, f.stranger).runs, [])
  rejected(() => f.call('open', { mixedId: run.id }, f.stranger), 404)
  rejected(() => f.call('next', f.action(run, 'skip'), f.stranger), 404)
  const other = f.start('start-one', f.stranger)
  assert.notEqual(other.id, run.id)
  assert.notEqual(other.work.id, run.work.id)
  assert.equal(f.latest().id, run.id)
})

test('creation and snapshot progression roll back completely when a callback or shared quota fails', t => {
  const brokenCreation = fixture(t, { failCreate: 2 })
  assert.throws(() => brokenCreation.start(), /Creation failed/)
  assert.equal(brokenCreation.db.prepare('SELECT COUNT(*) AS count FROM fixture_works').get().count, 0)
  assert.equal(brokenCreation.latest(), null)
  const failedSubmit = fixture(t, { failSubmit: true }), run = failedSubmit.start()
  assert.throws(() => failedSubmit.call('next', failedSubmit.action(run, 'skip')), /Submission failed/)
  assert.equal(failedSubmit.latest().revision, 0)
  assert.equal(failedSubmit.readWork(failedSubmit.visitor, run.work.id).attempts.length, 0)
  const quota = { failPut: false }, full = fixture(t, quota), started = full.start()
  quota.failPut = true
  rejected(() => full.call('next', full.action(started, 'skip')), 429)
  assert.equal(full.readWork(full.visitor, started.work.id).attempts.length, 0)
  assert.equal(full.latest().revision, 0)
})

test('delayed repeat uses current saved evaluations after seven days, not a mastery estimate', t => {
  const f = fixture(t)
  const { event } = savedObservation(f)
  const run = f.start(), saved = f.privateRun(run)
  assert.equal(saved.tasks[0].familyId, event.familyId)
  assert.equal(saved.tasks[0].source.observationId, event.id)
  assert.match(saved.tasks[0].selectionReason, /прошла неделя/)
  assert.equal(run.selection, undefined)
  assert.doesNotMatch(JSON.stringify(run), /mastery|освоено|earlier-observation/)
})

test('a corrected replacement schedules a due repeat from the original independent attempt', t => {
  const f = fixture(t)
  const { event } = savedObservation(f, { status: 'incorrect', replacementStatus: 'correct' })
  const run = f.start(), first = f.privateRun(run).tasks[0]
  assert.equal(first.familyId, event.familyId)
  assert.deepEqual(first.source, { observationId: event.id, attemptId: event.attemptId, workId: event.workId, createdAt: event.createdAt })
  assert.match(first.selectionReason, /прошла неделя/)
})

test('withdrawn, corrected-incorrect, skipped and imported unknown observations do not schedule due repeats', t => {
  for (const options of [{ retracted: true }, { replacementStatus: 'incorrect' }, { skipped: true }, { provenance: 'imported-unverified' }]) {
    const f = fixture(t)
    savedObservation(f, options)
    const run = f.start()
    assert.ok(f.privateRun(run).tasks.every(task => !task.source), JSON.stringify(options))
  }
})

test('one hundred newer observations in another family cannot erase an older due repeat', t => {
  const f = fixture(t), { event } = savedObservation(f)
  for (let index = 0; index < 100; index++) savedObservation(f, { key: `recent-${index}`, familyId: 'algebra.fixture', createdAt: '2026-10-23T08:00:00Z' })
  const run = f.start(), first = f.privateRun(run).tasks[0]
  assert.equal(first.familyId, event.familyId)
  assert.equal(first.source.observationId, event.id)
  assert.match(first.selectionReason, /прошла неделя/)
})

test('mixed help/history cannot bypass an active full exam, while another owner remains independent', t => {
  const f = fixture(t), run = f.start()
  const work = f.readWork(f.visitor, run.work.id)
  work.mode = 'guided'; work.exposure = true; work.messages.push({ text: 'a teaching explanation' })
  f.putWork(f.visitor, work)
  f.db.exec('CREATE TABLE exam_sessions(id TEXT PRIMARY KEY,owner TEXT,data TEXT)')
  f.db.prepare('INSERT INTO exam_sessions VALUES(?,?,?)').run('active-exam', 'local', JSON.stringify({ status: 'active' }))
  const state = f.call('state')
  assert.equal(state.mixed, null)
  assert.equal(state.blockedByExam, true)
  assert.doesNotMatch(JSON.stringify(state), /teaching explanation|familyId/)
  rejected(() => f.call('open', { mixedId: run.id }), 403)
  rejected(() => f.call('next', f.action(run, 'skip')), 403)
  assert.ok(f.start('other-owner', f.stranger))
  f.db.prepare('UPDATE exam_sessions SET data=? WHERE id=?').run(JSON.stringify({ status: 'submitted' }), 'active-exam')
  assert.equal(f.latest().work.messages[0].text, 'a teaching explanation')
})

test('bounded SQL history pagination stays stable across updates; run cap and unsupported domains are explicit', t => {
  const f = fixture(t)
  for (let index = 0; index < 20; index++) {
    const run = f.start(`start-${index}`)
    f.call('next', f.action(run, 'finish', `finish-${index}`))
  }
  const first = f.call('history'), second = f.call('history', { before: first.nextCursor })
  assert.equal(first.runs.length, 10)
  assert.equal(second.runs.length, 10)
  assert.equal(new Set([...first.runs, ...second.runs].map(run => run.id)).size, 20)
  assert.equal(second.nextCursor, null)
  rejected(() => f.start('twenty-first'), 429)
  rejected(() => f.call('history', { before: -1 }), 400)
  const insufficient = fixture(t)
  insufficient.catalog.splice(2)
  rejected(() => insufficient.start(), 503)
  assert.equal(insufficient.latest(), null)
})

test('published families integrate with real runtime: blind provenance, help snapshot, unknown skip and full resume', async t => {
  const db = new DatabaseSync(':memory:'), store = { db, owner: 'local' }
  const runtime = createExamRuntime({ store, tutor: { respond() { throw Error('No paid provider used') } } })
  t.after(() => { runtime.close(); db.close() })
  const mixed = createExamMixed({ store, ...runtime })
  let run = mixed.route('POST', '/api/exam/mixed/start', { requestId: 'real-mixed-start' }, store).mixed
  const familyById = new Map(publishedFamilies.map(family => [family.id, family]))
  const privateRun = JSON.parse(db.prepare('SELECT data FROM exam_mixed WHERE id=?').get(run.id).data)
  assert.equal(new Set(privateRun.tasks.map(task => familyById.get(task.familyId).group)).size, 3)
  assert.ok(run.tasks.every(task => !task.work.familyId && task.work.instance.title === 'Задача'))
  const work = run.work
  const opened = (await runtime.route('POST', '/api/exam/open', { workId: work.id }, store)).work
  assert.equal(opened.familyId, undefined)
  const state = await runtime.route('GET', '/api/exam/state', {}, store)
  assert.ok(state.works.every(item => item.familyId === undefined))
  const helped = (await runtime.route('POST', '/api/exam/help', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'real-mixed-help' }, store)).work
  assert.equal(helped.attempts.length, 1)
  assert.equal(helped.attempts[0].reason, 'before-help')
  assert.equal(helped.attempts[0].practiceKind, 'mixed')
  assert.ok(helped.familyId)
  let current = mixed.route('GET', '/api/exam/mixed/state', {}, store).mixed
  const advance = (value, action, requestId) => ({ mixedId: value.id, expectedRevision: value.revision, workId: value.work.id, expectedWorkRevision: value.work.revision, expectedWorkModeEpoch: value.work.modeEpoch, action, requestId })
  rejected(() => mixed.route('POST', '/api/exam/mixed/next', advance(current, 'next', 'help-only-next'), store), 409)
  await runtime.route('POST', '/api/exam/submit', { workId: helped.id, expectedRevision: helped.revision, expectedModeEpoch: helped.modeEpoch, requestId: 'real-mixed-submit' }, store)
  current = mixed.route('GET', '/api/exam/mixed/state', {}, store).mixed
  run = mixed.route('POST', '/api/exam/mixed/next', advance(current, 'next', 'real-first-next'), store).mixed
  run = mixed.route('POST', '/api/exam/mixed/next', advance(run, 'skip', 'real-skip-next'), store).mixed
  assert.equal(run.tasks[1].work.attempts[0].reason, 'mixed-skip')
  const skipObservation = JSON.parse(db.prepare('SELECT data FROM exam_observations WHERE work_id=? ORDER BY rowid DESC LIMIT 1').get(run.tasks[1].workId).data)
  assert.equal(skipObservation.status, 'unknown')
  assert.equal(skipObservation.skipped, true)
  assert.equal(skipObservation.practiceKind, 'mixed')
  assert.equal(skipObservation.methodSelectionConfirmed, false)
  run = mixed.route('POST', '/api/exam/mixed/next', advance(run, 'finish', 'real-finish'), store).mixed
  assert.equal(run.status, 'completed')
  assert.equal(run.completedCount, 3)
  assert.equal(run.deadlineAt, undefined)
  const restarted = createExamMixed({ store, ...runtime })
  assert.deepEqual(restarted.route('GET', '/api/exam/mixed/state', {}, store).mixed, run)
})
