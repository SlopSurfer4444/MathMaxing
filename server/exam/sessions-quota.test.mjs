import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Store, PROFILE_LIMITS } from '../store.mjs'
import { createProfileArchive } from '../profile-archive.mjs'
import { createExamRuntime } from './runtime.mjs'
import { createExamSessions } from './sessions.mjs'

function fixture(t) {
  const store = new Store(':memory:'), visitor = store.forVisitor(randomUUID())
  let time = Date.now(), providerCalls = 0, runtime, sessions
  const restart = () => {
    runtime?.close()
    runtime = createExamRuntime({ store, tutor: { respond() { providerCalls++; throw Error('Deadline submission must not dispatch a provider') } } })
    sessions = createExamSessions({ store, ...runtime, now: () => time, randomInt: () => 0 })
    runtime.setSessionGuard(sessions.activeForWork)
    runtime.setSessionPolicy(sessions.policyForWork)
  }
  restart()
  const call = (action, body = {}) => sessions.route(action === 'state' ? 'GET' : 'POST', `/api/exam/session/${action}`, body, visitor)
  const submitBody = session => ({ sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: session.sessionEpoch, requestId: `submit:${session.id}`, workRevisions: session.tasks.map(task => ({ workId: task.workId, revision: task.work.revision, modeEpoch: task.work.modeEpoch })) })
  t.after(() => { runtime.close(); store.close() })
  return { store, visitor, get runtime() { return runtime }, get sessions() { return sessions }, get providerCalls() { return providerCalls }, restart, call, submitBody, advance(ms) { time += ms } }
}

test('ten weekly 2027 variants fit actual Store count and preserve first observations and repeated exposure', async t => {
  const f = fixture(t), db = f.store.db
  let firstObservation, firstWork, firstWorkBytes
  for (let week = 0; week < 10; week++) {
    let session = f.call('start', { edition: '2027', requestId: `weekly:${week}` }).session
    if (week === 0) {
      const task = session.tasks[0]
      const frozen = JSON.parse(db.prepare("SELECT i.data FROM exam_instances i JOIN exam_works w ON json_extract(w.data,'$.instanceId')=i.id WHERE w.id=?").get(task.workId).data)
      const answersByPart = Object.fromEntries(frozen.parts.map(part => [part.id, String(part.expected)]))
      await f.runtime.route('POST', '/api/exam/save', { workId: task.workId, expectedRevision: task.work.revision, expectedModeEpoch: task.work.modeEpoch, answersByPart, reasoning: 'Первая самостоятельная запись' }, f.visitor)
      session = f.call('state').session
    }
    const submitted = f.call('submit', f.submitBody(session)).session
    assert.equal(submitted.status, 'submitted')
    if (week === 0) {
      firstWork = submitted.tasks[0].work
      assert.equal(firstWork.priorExposure, false)
      firstObservation = db.prepare('SELECT id,data FROM exam_observations WHERE owner=? AND work_id=?').get(f.visitor.owner, firstWork.id)
      firstWorkBytes = db.prepare('SELECT data FROM exam_works WHERE id=?').get(firstWork.id).data
    } else assert.ok(submitted.tasks.every(task => task.work.priorExposure === true))
    assert.equal(db.prepare('SELECT data FROM exam_observations WHERE id=?').get(firstObservation.id).data, firstObservation.data)
    assert.equal(db.prepare('SELECT data FROM exam_works WHERE id=?').get(firstWork.id).data, firstWorkBytes)
    f.advance(7 * 86400000)
  }
  assert.equal(f.visitor.profileBudget().count, 200)
  assert.equal(f.visitor.profileBudget().limits.works, 1000)
  assert.ok(f.visitor.profileBudget().bytes < PROFILE_LIMITS.bytes)
  assert.equal(db.prepare('SELECT COUNT(*) count FROM exam_observations WHERE owner=?').get(f.visitor.owner).count, 200)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM exam_sessions WHERE owner=? AND json_type(data,'$.submittedWorks') IS NOT NULL").get(f.visitor.owner).count, 0)
})

test('actual byte quota rolls failed submission back and explicit overdue closure shrinks at the exact ceiling, restoring archive access', async t => {
  const f = fixture(t), db = f.store.db
  let session = f.call('start', { edition: '2027', requestId: 'quota-start' }).session
  const task = session.tasks[0]
  await f.runtime.route('POST', '/api/exam/save', { workId: task.workId, expectedRevision: task.work.revision, expectedModeEpoch: task.work.modeEpoch, answersByPart: { [task.work.instance.parts[0].id]: '42' }, reasoning: 'Мой сохранённый черновик' }, f.visitor)
  session = f.call('state').session
  // Counters at a digit boundary must not grow while trying to free the hold.
  const raw = JSON.parse(db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(session.id).data)
  raw.revision = 9; raw.sessionEpoch = 9
  db.prepare('UPDATE exam_sessions SET data=? WHERE id=?').run(JSON.stringify(raw), session.id)
  session = f.call('state').session
  const beforeWorks = db.prepare('SELECT id,data FROM exam_works WHERE owner=? ORDER BY id').all(f.visitor.owner)
  const beforeSession = db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(session.id).data
  const ceiling = PROFILE_LIMITS.bytes + PROFILE_LIMITS.editReserveBytes
  f.visitor.setSetting('quota-test-padding', 'x'.repeat(ceiling - f.visitor.profileBudget().bytes))
  assert.equal(f.visitor.profileBudget().bytes, ceiling)
  assert.throws(() => f.call('submit', f.submitBody(session)), { status: 429 })
  assert.deepEqual(db.prepare('SELECT id,data FROM exam_works WHERE owner=? ORDER BY id').all(f.visitor.owner), beforeWorks)
  assert.equal(db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(session.id).data, beforeSession)
  assert.equal(db.prepare('SELECT COUNT(*) count FROM exam_observations WHERE owner=?').get(f.visitor.owner).count, 0)
  const archive = createProfileArchive({ config: {}, store: f.store })
  assert.throws(() => archive.exportProfile(f.visitor), { status: 409 })
  f.advance(236 * 60000)
  for (let read = 0; read < 2; read++) {
    if (read) f.restart()
    const overdue = f.call('state').session
    assert.equal(overdue.status, 'active')
    assert.equal(overdue.remainingSeconds, 0)
    assert.equal(overdue.revision, 9)
    assert.equal(overdue.sessionEpoch, 9)
    assert.equal(overdue.score, undefined)
    assert.match(overdue.submissionError, /Хранилище заполнено.*без проверки/)
    assert.equal(overdue.tasks[0].work.reasoning, 'Мой сохранённый черновик')
    assert.deepEqual(db.prepare('SELECT id,data FROM exam_works WHERE owner=? ORDER BY id').all(f.visitor.owner), beforeWorks)
    assert.equal(db.prepare('SELECT data FROM exam_sessions WHERE id=?').get(session.id).data, beforeSession)
    assert.equal(db.prepare('SELECT COUNT(*) count FROM exam_observations WHERE owner=?').get(f.visitor.owner).count, 0)
    assert.equal(f.visitor.profileBudget().bytes, ceiling)
    assert.equal(f.providerCalls, 0)
  }
  const body = { sessionId: session.id, expectedRevision: 9, expectedSessionEpoch: 9, requestId: 'quota-explicit-close' }
  const closed = f.call('end-unverified', body).session
  assert.equal(closed.status, 'closed')
  assert.equal(closed.score, undefined)
  assert.equal(closed.tasks[0].work.reasoning, 'Мой сохранённый черновик')
  assert.ok(closed.tasks.every(item => item.work.completed && item.work.attempts.length === 0 && item.work.evaluations.length === 0))
  assert.equal(f.visitor.profileBudget().bytes, ceiling - session.tasks.length)
  const afterBytes = f.visitor.profileBudget().bytes
  assert.deepEqual(f.call('end-unverified', body).session, closed)
  assert.equal(f.visitor.profileBudget().bytes, afterBytes)
  const exported = archive.exportProfile(f.visitor)
  assert.ok(exported.payload)
  await assert.rejects(f.runtime.route('POST', '/api/exam/save', { workId: task.workId, expectedRevision: task.work.revision, expectedModeEpoch: task.work.modeEpoch, answersByPart: task.work.answersByPart, reasoning: 'Изменить закрытый черновик' }, f.visitor), { status: 409 })
})

test('count warnings are relative to the 1000-work ceiling, while byte limits remain unchanged', t => {
  const f = fixture(t), db = f.store.db
  const insert = db.prepare('INSERT INTO exam_works(id,owner,family_id,updated_at,completed,revision,data) VALUES(?,?,?,?,?,?,?)')
  for (let i = 0; i < 899; i++) insert.run(`small-${i}`, f.visitor.owner, 'count-fixture', '', 1, 0, '{}')
  assert.equal(f.visitor.profileBudget().archiveRecommended, false)
  insert.run('small-899', f.visitor.owner, 'count-fixture', '', 1, 0, '{}')
  assert.equal(f.visitor.profileBudget().warning, true)
  assert.equal(f.visitor.profileBudget().full, false)
  for (let i = 900; i < 1000; i++) insert.run(`small-${i}`, f.visitor.owner, 'count-fixture', '', 1, 0, '{}')
  assert.equal(f.visitor.profileBudget().full, true)
  assert.throws(() => f.visitor.assertCanCreate(), { status: 429 })
  assert.equal(PROFILE_LIMITS.bytes, 10000000)
  assert.equal(PROFILE_LIMITS.editReserveBytes, 2000000)
})
