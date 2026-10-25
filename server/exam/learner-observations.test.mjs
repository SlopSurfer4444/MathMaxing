import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { learnerObservations } from './learner-observations.mjs'

function fixture(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  db.exec('CREATE TABLE exam_works(id TEXT PRIMARY KEY,owner TEXT,data TEXT); CREATE TABLE exam_observations(id TEXT PRIMARY KEY,owner TEXT,work_id TEXT,family_id TEXT,attempt_id TEXT,created_at TEXT,data TEXT)')
  const attempt = { id: 'attempt-one', revision: 4, digest: 'saved-attempt-digest' }
  const evaluation = (id, partId, status, extra = {}) => ({ id, attemptId: attempt.id, partId, status, targetRevision: attempt.revision, targetDigest: attempt.digest, checker: 'saved-checker-v1', checkerVersion: 1, ...extra })
  const source = { id: 'observation-one', familyId: 'family.one', workId: 'work-one', attemptId: attempt.id, createdAt: '2026-10-01T09:00:00Z', status: 'incorrect', independent: true, evaluationIds: ['first-a', 'first-b'], summary: 'Historical result', practiceKind: 'themed' }
  const work = { id: source.workId, attempts: [attempt], evaluations: [evaluation('first-a', 'a', 'incorrect'), evaluation('first-b', 'b', 'correct')], retractions: [], reasoning: 'Historical notebook must not be returned' }
  const put = (event = source, saved = work, owner = 'local') => {
    db.prepare('INSERT OR REPLACE INTO exam_works VALUES(?,?,?)').run(event.workId, owner, JSON.stringify(saved))
    db.prepare('INSERT OR REPLACE INTO exam_observations VALUES(?,?,?,?,?,?,?)').run(event.id, owner, event.workId, event.familyId, event.attemptId, event.createdAt, JSON.stringify(event))
  }
  return { db, attempt, evaluation, source, work, put, read: (owner = 'local') => learnerObservations(db, owner) }
}

test('saved replacement chains change current status and retain exact original observation identity/history', t => {
  const f = fixture(t)
  f.work.retractions.push({ evaluationId: 'first-a' }, { evaluationId: 'replacement-a' })
  f.work.evaluations.push(f.evaluation('replacement-a', 'a', 'unknown', { supersedes: 'first-a', provenance: 'reconsideration' }), f.evaluation('current-a', 'a', 'correct', { supersedes: 'replacement-a', provenance: 'reconsideration' }))
  f.put()
  const originalObservation = f.db.prepare('SELECT data FROM exam_observations').get().data
  const originalWork = f.db.prepare('SELECT data FROM exam_works').get().data
  const [event] = f.read()
  for (const key of ['id', 'workId', 'familyId', 'attemptId', 'createdAt', 'independent']) assert.deepEqual(event[key], f.source[key])
  assert.equal(event.status, 'correct')
  assert.equal(event.sourceStatus, 'incorrect')
  assert.equal(event.provenance, 'current-saved-evaluations')
  assert.deepEqual(event.sourceEvaluationIds, ['first-a', 'first-b'])
  assert.deepEqual(event.evaluationIds, ['current-a', 'first-b'])
  assert.equal(event.parts[0].evaluationProvenance, 'reconsideration')
  assert.equal(JSON.stringify(event).includes(f.work.reasoning), false)
  assert.equal(f.db.prepare('SELECT data FROM exam_observations').get().data, originalObservation)
  assert.equal(f.db.prepare('SELECT data FROM exam_works').get().data, originalWork)
})

test('a partial withdrawal retains other part evidence and complete withdrawal remains honest unknown', t => {
  const f = fixture(t)
  f.work.retractions.push({ evaluationId: 'first-b' }); f.put()
  let [event] = f.read()
  assert.equal(event.status, 'incorrect')
  assert.deepEqual(event.parts.map(part => part.status), ['incorrect', 'unknown'])
  assert.deepEqual(event.evaluationIds, ['first-a'])
  f.work.retractions.push({ evaluationId: 'first-a' }); f.put()
  ;[event] = f.read()
  assert.equal(event.status, 'unknown')
  assert.deepEqual(event.evaluationIds, [])
  assert.equal(event.id, f.source.id)
})

test('missing, foreign, ambiguous and snapshot-mismatched authority never confirms an answer', t => {
  for (const invalid of ['missing-work', 'foreign-work', 'missing-root', 'stale-digest', 'stale-revision', 'ambiguous', 'explicitly-inactive']) {
    const f = fixture(t)
    f.source.evaluationIds = ['first-a']; f.work.evaluations[0].status = 'correct'
    if (invalid === 'missing-root') f.work.evaluations = []
    if (invalid === 'stale-digest') f.work.evaluations[0].targetDigest = 'other-snapshot'
    if (invalid === 'stale-revision') f.work.evaluations[0].targetRevision++
    if (invalid === 'ambiguous') f.work.evaluations.push(f.evaluation('parallel-a', 'a', 'correct', { supersedes: 'first-a' }))
    if (invalid === 'explicitly-inactive') f.work.evaluations[0].active = false
    f.put()
    if (invalid === 'missing-work') f.db.prepare('DELETE FROM exam_works').run()
    if (invalid === 'foreign-work') f.db.prepare("UPDATE exam_works SET owner='other'").run()
    assert.equal(f.read()[0].status, 'unknown', invalid)
    assert.deepEqual(f.read('stranger'), [])
  }
})

test('imported unknown and assisted provenance never upgrade to independent or verified imported evidence', t => {
  for (const marked of ['observation', 'attempt']) {
    const f = fixture(t)
    f.source.status = 'unknown'; f.source.independent = false
    if (marked === 'observation') f.source.provenance = 'imported-unverified'
    else f.attempt.provenance = 'imported-unverified'
    f.work.retractions.push({ evaluationId: 'first-a' })
    f.work.evaluations.push(f.evaluation('native-replacement', 'a', 'correct', { supersedes: 'first-a', provenance: 'reconsideration' }))
    f.put()
    const [event] = f.read()
    assert.equal(event.status, 'unknown')
    assert.equal(event.independent, false)
    assert.equal(event.provenance, 'imported-unverified')
  }
  const f = fixture(t)
  f.source.independent = false; f.work.evaluations[0].status = 'correct'; f.put()
  assert.equal(f.read()[0].status, 'correct')
  assert.equal(f.read()[0].independent, false)
  f.source.skipped = true; f.put()
  assert.equal(f.read()[0].status, 'unknown')
})

test('a per-family window retains the last fact despite 100 newer observations in another family', t => {
  const f = fixture(t)
  f.put()
  for (let index = 0; index < 100; index++) {
    const other = { ...f.source, id: `other-${index}`, familyId: 'family.other', workId: `other-work-${index}`, createdAt: new Date(Date.parse(f.source.createdAt) + index + 1).toISOString() }
    f.put(other, { ...f.work, id: other.workId })
  }
  const events = f.read()
  assert.equal(events.filter(event => event.familyId === 'family.other').length, 12)
  assert.equal(events.find(event => event.familyId === 'family.one').id, f.source.id)
  assert.equal(events.length, 13)
})
