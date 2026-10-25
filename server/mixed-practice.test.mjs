import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.mjs'
import { changeMixedPractice, readMixedPractice } from './mixed-practice.mjs'
import { taskPackages, packageProblems } from './problems.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const request = revision => ({ expectedRevision: revision, requestId: crypto.randomUUID() })
function fixture(t) { const store = new Store(':memory:'); t.after(() => store.close()); return store }
function submit(store, work, status = 'correct', extra = {}) {
  work.submissions.push({ id: crypto.randomUUID(), reason: 'submitted', mode: 'solo', helpCount: 0, result: { status }, seriesResult: { status }, attemptContext: { priorExposure: work.priorExposure, numericHelpSeen: false, preparationUsed: false }, ...extra }); store.put(work)
}

test('mixed starts one solo work only; public response hides future topics and solutions', t => {
  const store = fixture(t)
  assert.equal(readMixedPractice(store), null)
  const result = changeMixedPractice(store, 'start', request(0))
  assert.equal(store.list().length, 1)
  assert.equal(result.work.mode, 'solo')
  assert.equal(result.mixed.total, 3)
  assert.equal(result.mixed.currentWorkId, store.current().id)
  assert.equal(result.mixed.items[0].repeated, false)
  assert.equal(JSON.stringify(result.mixed).includes('solution'), false)
  assert.deepEqual(result.mixed.items[1], { index: 1, status: 'unattempted', assistance: 'unknown' })
  const privateSet = JSON.parse(store.setting('mixed-practice:v1'))
  assert.equal(new Set(privateSet.items.map(item => item.packageId)).size, 3)
  assert.ok(privateSet.items.every(item => item.problem.solution))
})

test('replay and stale tabs do not create duplicate work or rewind a set', t => {
  const store = fixture(t), start = request(0)
  const first = changeMixedPractice(store, 'start', start)
  assert.equal(changeMixedPractice(store, 'start', start).work.id, first.work.id)
  assert.throws(() => changeMixedPractice(store, 'next', request(1)), /Сначала сдай/)
  submit(store, first.work)
  const next = request(1), second = changeMixedPractice(store, 'next', next)
  assert.equal(second.mixed.position, 1)
  assert.equal(store.list().length, 2)
  assert.equal(changeMixedPractice(store, 'next', next).work.id, second.work.id)
  assert.equal(changeMixedPractice(store, 'start', start).mixed.position, 1)
  assert.equal(store.current().id, second.work.id)
  assert.throws(() => changeMixedPractice(store, 'next', request(1)), /другой вкладке/)
  assert.throws(() => changeMixedPractice(store, 'next', { ...next, expectedRevision: 2 }), /другого действия/)
})

test('three submitted tasks finish; unknown and assistance never become a success score', t => {
  const store = fixture(t)
  let result = changeMixedPractice(store, 'start', request(0))
  submit(store, result.work, 'unknown')
  result = changeMixedPractice(store, 'next', request(1))
  submit(store, result.work, 'correct', { mode: 'guided', attemptContext: { priorExposure: false, numericHelpSeen: true, preparationUsed: false } })
  result = changeMixedPractice(store, 'next', request(2))
  submit(store, result.work, 'incorrect')
  const before = store.current().id
  result = changeMixedPractice(store, 'next', request(3))
  assert.equal(result.mixed.status, 'complete')
  assert.equal(result.work, undefined)
  assert.equal(store.current().id, before)
  assert.deepEqual(result.mixed.items.map(item => item.status), ['unknown', 'correct', 'incorrect'])
  assert.deepEqual(result.mixed.items.map(item => item.assistance), ['none', 'used', 'none'])
  assert.equal(result.mixed.score, undefined)
  assert.equal(changeMixedPractice(store, 'start', request(4)).mixed.status, 'active')
})

test('initial attempt stays measurement after corrections and post-submit help', t => {
  const store = fixture(t), { work } = changeMixedPractice(store, 'start', request(0))
  submit(store, work, 'incorrect')
  work.numericHelpSeen = true
  submit(store, work, 'correct', { mode: 'guided' })
  const item = readMixedPractice(store).items[0]
  assert.equal(item.status, 'incorrect')
  assert.equal(item.assistance, 'none')
})

test('incomplete legacy attempt context stays unknown, not independently completed', t => {
  const store = fixture(t), { work } = changeMixedPractice(store, 'start', request(0))
  submit(store, work, 'correct', { attemptContext: {} })
  assert.equal(readMixedPractice(store).items[0].assistance, 'unknown')
})

test('future work opens its frozen version even if its ID has left the live catalog', t => {
  const store = fixture(t), { work } = changeMixedPractice(store, 'start', request(0))
  const set = JSON.parse(store.setting('mixed-practice:v1'))
  const frozen = set.items[1].problem
  frozen.id = 'retired-authored-fixture-v1'
  frozen.contentVersion = 17
  frozen.description = 'Сохранённое условие'
  store.setSetting('mixed-practice:v1', JSON.stringify(set))
  submit(store, work)
  const next = changeMixedPractice(store, 'next', request(1))
  assert.equal(next.work.problemId, frozen.id)
  assert.equal(next.work.contentVersion, 17)
  assert.deepEqual(store.problem(next.work), frozen)
  assert.throws(() => store.create('wrong-id', 'solo', frozen), /identity mismatch/)
})

test('exhausted authored pool marks repeats; selection does not pretend new variants', t => {
  const store = fixture(t)
  for (const pack of taskPackages) for (const problem of packageProblems(pack.id)) store.create(problem.id, 'guided')
  let result = changeMixedPractice(store, 'start', request(0))
  assert.equal(result.mixed.items[0].repeated, true)
  submit(store, result.work)
  result = changeMixedPractice(store, 'next', request(1))
  assert.equal(result.mixed.items[1].repeated, true)
})

test('owner isolation, stored state resumes, future pre-exposure is recorded when opened', t => {
  const root = fixture(t), a = root.forVisitor(crypto.randomUUID()), b = root.forVisitor(crypto.randomUUID())
  const result = changeMixedPractice(a, 'start', request(0))
  assert.equal(readMixedPractice(b), null)
  assert.deepEqual(readMixedPractice(root.forVisitor(a.owner)), result.mixed)
  const set = JSON.parse(a.setting('mixed-practice:v1'))
  a.create(set.items[1].problem.id, 'guided')
  submit(a, result.work)
  const next = changeMixedPractice(a, 'next', request(1))
  assert.equal(next.mixed.items[1].repeated, true)
  assert.throws(() => b.get(result.work.id), /не найдена/)
})

test('work creation and current pointer roll back if persistence fails', t => {
  const store = fixture(t), old = store.current(), put = store.setSetting.bind(store)
  store.setSetting = (key, value) => { if (key === 'mixed-practice:v1') throw Error('disk failure'); return put(key, value) }
  assert.throws(() => changeMixedPractice(store, 'start', request(0)), /disk failure/)
  assert.equal(store.current().id, old.id)
  assert.equal(store.list().length, 1)
  assert.equal(readMixedPractice(store), null)
})

test('process restart retains the selected set, current writing and idempotency receipt', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pole-mixed-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, 'test.sqlite'), command = request(0)
  let store = new Store(path)
  const result = changeMixedPractice(store, 'start', command)
  result.work.finalAnswer = 'сохранённая запись'
  store.put(result.work)
  store.close()
  store = new Store(path)
  try {
    assert.equal(readMixedPractice(store).id, result.mixed.id)
    assert.equal(store.current().finalAnswer, 'сохранённая запись')
    assert.equal(changeMixedPractice(store, 'start', command).work.id, result.work.id)
    assert.equal(store.list().length, 1)
  } finally { store.close() }
})
