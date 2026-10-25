import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.mjs'
import { readStudyRoute, refreshStudyRoute } from './study-route.mjs'

const NOW = '2026-10-21T12:00:00.000Z'
function fixture(t) { const store = new Store(':memory:'); t.after(() => store.close()); return store }
function submit(store, work, status = 'correct', extra = {}) {
  work.submissions.push({ id: crypto.randomUUID(), reason: 'submitted', mode: work.mode, helpCount: 0, result: { status }, createdAt: NOW, attemptContext: { priorExposure: Boolean(work.priorExposure), numericHelpSeen: Boolean(work.numericHelpSeen), preparationUsed: Boolean(work.preparation || work.preparationHistory?.length) }, ...extra })
  store.put(work)
}
test('legacy empty store obtains persistent route; read never changes it', t => {
  const store = fixture(t)
  const route = readStudyRoute(store, { now: NOW })
  assert.equal(route.current.action.taskId, 'percent-discount-v1')
  assert.equal(route.next.length, 3)
  assert.equal(new Set([route.current, ...route.next].map(card => card.action.taskId)).size, 4)
  store.create('percent-discount-v1', 'guided')
  assert.deepEqual(readStudyRoute(store, { now: '2027-01-01' }), route)
})
test('automatic blank trig work does not hijack first route; explicit topic can resume it', t => {
  const store = fixture(t)
  const blank = store.current()
  const route = readStudyRoute(store, { now: NOW })
  assert.equal(route.preferredPackage, 'percentages')
  assert.equal(route.current.action.taskId, 'percent-discount-v1')
  const trig = refreshStudyRoute(store, { expectedRevision: route.revision, preferredPackage: 'trigonometry', now: NOW })
  assert.equal(trig.current.action.workId, blank.id)
  assert.equal(trig.current.title, store.problem(blank).title)
})
test('completed numeric attempt advances at boundary, assistance recommends solo, stable refresh no-op', t => {
  const store = fixture(t)
  const work = store.create('percent-discount-v1', 'guided')
  work.numericHelpSeen = true
  const route = readStudyRoute(store, { now: NOW })
  submit(store, work)
  const next = refreshStudyRoute(store, { expectedRevision: route.revision, now: NOW })
  assert.equal(next.current.action.taskId, 'percent-successive-v1')
  assert.equal(next.current.action.mode, 'solo')
  assert.match(next.current.reason, /без подсказок/)
  assert.deepEqual(refreshStudyRoute(store, { expectedRevision: next.revision, now: NOW }), next)
})
test('trig requires both a and b, unknown retains unfinished solution without diagnosing weakness', t => {
  const store = fixture(t)
  const work = store.create('double-angle-cos', 'solo')
  submit(store, work)
  let route = readStudyRoute(store, { now: NOW })
  assert.equal(route.current.action.workId, work.id)
  assert.match(route.current.reason, /не установила/)
  submit(store, work, 'correct', { seriesResult: { status: 'correct' } })
  route = refreshStudyRoute(store, { expectedRevision: route.revision, now: NOW })
  assert.equal(route.current.action.type, 'new')
  assert.match(route.current.reason, /самостоятельной/)
})
test('model review, objections and OCR do not change route or create observations', t => {
  const store = fixture(t)
  const work = store.create('percent-discount-v1', 'solo')
  submit(store, work, 'unknown')
  const route = readStudyRoute(store, { now: NOW })
  work.submissions[0].review = 'Wrong method'
  work.submissions[0].reviewStatus = 'ready'
  work.submissions[0].objections = [{ status: 'accepted' }]
  work.document = { type: 'doc', content: [{ type: 'paragraph', text: 'OCR changed' }] }
  store.put(work)
  assert.deepEqual(refreshStudyRoute(store, { expectedRevision: route.revision, now: NOW }), route)
})
test('post-submission explanation cannot retroactively change independent attempt or route basis', t => {
  const store = fixture(t)
  const work = store.create('percent-discount-v1', 'solo')
  submit(store, work)
  const route = readStudyRoute(store, { now: NOW })
  assert.match(route.current.reason, /самостоятельной попытке/)
  work.numericHelpSeen = true
  work.preparationHistory = [{ id: 'later-preparation' }]
  store.put(work)
  assert.deepEqual(refreshStudyRoute(store, { expectedRevision: route.revision, now: NOW }), route)
  const revisited = refreshStudyRoute(store, { expectedRevision: route.revision, preferredPackage: 'trigonometry', now: NOW })
  const returned = refreshStudyRoute(store, { expectedRevision: revisited.revision, preferredPackage: 'percentages', now: NOW })
  assert.match(returned.current.reason, /самостоятельной попытке/)
})
test('legacy attempt without frozen assistance context does not claim independence', t => {
  const store = fixture(t)
  const work = store.create('percent-discount-v1', 'solo')
  submit(store, work, 'correct', { attemptContext: undefined })
  const route = readStudyRoute(store, { now: NOW })
  assert.doesNotMatch(route.current.reason, /в самостоятельной попытке/)
  assert.match(route.current.reason, /Следующая попытка/)
})
test('saving an older work or model response cannot reorder the route', t => {
  const store = fixture(t)
  const older = store.create('percent-discount-v1', 'solo')
  older.createdAt = '2026-10-20T10:00:00Z'; store.put(older)
  const newer = store.create('percent-reverse-v1', 'solo')
  newer.createdAt = NOW; store.put(newer)
  const route = readStudyRoute(store, { now: NOW })
  assert.equal(route.current.action.workId, newer.id)
  older.messages.push({ role: 'assistant', text: 'An answer' }); store.put(older)
  assert.deepEqual(refreshStudyRoute(store, { expectedRevision: route.revision, now: NOW }), route)
  assert.equal(route.next[0].action.taskId, 'percent-transfer-v1')
})
test('skip keeps work and advances, explicit topic choice sticks and stale changes fail', t => {
  const store = fixture(t)
  const work = store.create('percent-discount-v1', 'guided')
  let route = readStudyRoute(store, { now: NOW })
  route = refreshStudyRoute(store, { expectedRevision: route.revision, skipCurrent: true, now: NOW })
  assert.equal(route.current.action.taskId, 'percent-successive-v1')
  assert.equal(store.get(work.id).id, work.id)
  const stale = route.revision
  route = refreshStudyRoute(store, { expectedRevision: route.revision, preferredPackage: 'trigonometry', now: NOW })
  assert.equal(route.preferredPackage, 'trigonometry')
  assert.throws(() => refreshStudyRoute(store, { expectedRevision: stale, now: NOW }), error => error.status === 409)
  assert.throws(() => refreshStudyRoute(store, { expectedRevision: route.revision, preferredPackage: '__proto__' }), error => error.status === 400)
})
test('pause becomes a fresh check rather than forgetting claim, only on explicit refresh', t => {
  const store = fixture(t)
  const work = store.create('percent-discount-v1', 'solo')
  submit(store, work)
  const route = readStudyRoute(store, { now: NOW })
  assert.equal(route.paused, false)
  assert.deepEqual(readStudyRoute(store, { now: '2026-11-01' }), route)
  const next = refreshStudyRoute(store, { expectedRevision: route.revision, now: '2026-11-01' })
  assert.equal(next.paused, true)
  assert.match(next.current.reason, /не считаем, что ты забыл/)
})
test('routes isolated by store owner, several completed sessions yield authored repeat honestly', t => {
  const root = fixture(t)
  const a = root.forVisitor(crypto.randomUUID()), b = root.forVisitor(crypto.randomUUID())
  const first = readStudyRoute(a, { now: NOW })
  let route = first
  for (const taskId of ['percent-discount-v1', 'percent-successive-v1', 'percent-reverse-v1', 'percent-transfer-v1']) {
    const work = a.create(taskId, 'solo'); submit(a, work)
    route = refreshStudyRoute(a, { expectedRevision: route.revision, now: NOW })
  }
  assert.match(route.current.title, /повтор/)
  assert.equal(readStudyRoute(b, { now: NOW }).revision, 0)
  assert.equal(b.list().length, 0)
  assert.equal(a.list().length, 4)
})

for (const [packageId, ids] of [
  ['graphs', ['graph-value-v1', 'graph-rate-v1', 'graph-reverse-v1']],
  ['inequalities', ['inequality-linear-v1', 'inequality-negative-v1', 'inequality-product-v1']],
]) {
  test(`${packageId}: scalar success advances without a trig series; skip preserves work and pause is explicit`, t => {
    const store = fixture(t)
    const work = store.create(ids[0], 'solo')
    let route = readStudyRoute(store, { preferredPackage: packageId, now: NOW })
    assert.equal(route.current.action.workId, work.id)
    assert.equal(route.preferredPackage, packageId)
    submit(store, work)
    route = refreshStudyRoute(store, { expectedRevision: route.revision, now: NOW })
    assert.equal(route.current.action.taskId, ids[1])
    assert.equal(route.current.action.mode, 'solo')
    assert.match(route.current.reason, /самостоятельной попытке/)
    assert.ok([route.current, ...route.next].every(card => card.packageId === packageId))
    route = refreshStudyRoute(store, { expectedRevision: route.revision, skipCurrent: true, now: NOW })
    assert.equal(route.current.action.taskId, ids[2])
    assert.equal(store.get(work.id).id, work.id)
    assert.equal(readStudyRoute(store, { now: '2026-11-01' }).paused, false)
    route = refreshStudyRoute(store, { expectedRevision: route.revision, now: '2026-11-01' })
    assert.equal(route.paused, true)
    assert.match(route.current.reason, /не считаем, что ты забыл/)
  })
}

test('interval unknown preserves saved answer without guessing a learning deficit', t => {
  const store = fixture(t)
  const work = store.create('inequality-linear-v1', 'solo')
  submit(store, work, 'unknown')
  const route = readStudyRoute(store, { now: NOW })
  assert.equal(route.preferredPackage, 'inequalities')
  assert.equal(route.current.action.workId, work.id)
  assert.match(route.current.reason, /не установила результат/)
})
