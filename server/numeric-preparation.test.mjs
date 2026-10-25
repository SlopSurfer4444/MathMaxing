import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './store.mjs'
import { percentageProblems } from './percentages.mjs'
import { handleNumericPreparation, numericPreparationContext, numericPreparationSignature } from './numeric-preparation.mjs'

function checkWorkVersion(work, body) {
  for (const key of ['expectedRevision', 'expectedModeEpoch']) if (!Number.isSafeInteger(body[key]) || body[key] < 0) throw Object.assign(Error('version'), { status: 400 })
  if (body.expectedRevision !== work.revision || body.expectedModeEpoch !== work.modeEpoch) throw Object.assign(Error('stale'), { status: 409 })
}
function fixture(id = 'percent-discount-v1', store = new Store(':memory:')) {
  const work = store.create(id, 'guided'), cancelled = []
  const prefix = work.packageId === 'percentages' ? 'percentages' : 'topics'
  function call(action, extra = {}, overrides = {}) {
    const current = store.get(work.id), p = current.numericPreparation
    return handleNumericPreparation({ store, work: current, path: `/api/${prefix}/${action}`, checkWorkVersion, cancel: id => cancelled.push(id),
      body: { workId: current.id, expectedRevision: current.revision, expectedModeEpoch: current.modeEpoch,
        ...(p ? { preparationId: p.id, expectedPreparationRevision: p.revision } : {}), ...extra }, ...overrides })
  }
  return { store, work, call, cancelled }
}

for (const id of ['percent-discount-v1', 'graph-value-v1', 'inequality-linear-v1']) {
  test(`${id}: preparation persists its own draft, checks, return point and completed history`, () => {
    const f = fixture(id)
    try {
      const main = f.store.get(f.work.id)
      main.document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Своё рассуждение' }] }] }
      main.finalAnswer = 'не менять'; main.generalAnswer = 'тоже не менять'; f.store.put(main)
      const point = { field: 'reasoning', selectionStart: 3, selectionEnd: 6, scrollY: 130 }
      const initial = f.call('help', { returnPoint: point })
      assert.equal(initial.preparation.revision, 0)
      assert.equal(initial.work.modeEpoch, main.modeEpoch + 1)
      assert.equal(initial.work.revision, main.revision)
      assert.deepEqual(initial.preparation.returnPoint, point)
      assert.equal(initial.preparation.contentVersion, f.store.problem(main).contentVersion ?? main.contentVersion)
      if (f.store.problem(main).help.example.graph) assert.deepEqual(initial.help.example.graph, f.store.problem(main).help.example.graph)
      assert.equal('answer' in initial.help.check, false)
      assert.equal('feedback' in initial.help.check, false)
      const repeated = f.call('help')
      assert.deepEqual(repeated.preparation, initial.preparation)
      assert.equal(repeated.work.modeEpoch, initial.work.modeEpoch)
      assert.equal(f.cancelled.length, 1)
      const draft = f.call('draft', { answer: 'набросок' })
      assert.equal(draft.preparation.answer, 'набросок')
      assert.equal(draft.preparation.revision, 1)
      assert.equal(draft.work.modeEpoch, initial.work.modeEpoch)
      const malformed = f.call('preparation', { answer: 'неизвестная запись' })
      assert.equal(malformed.result.status, 'unknown')
      const answer = f.store.problem(main).help.check.answer
      const checked = f.call('preparation', { answer })
      assert.equal(checked.result.status, 'correct')
      assert.equal(checked.evidence.preparationId, initial.preparation.id)
      assert.equal(checked.evidence.preparationRevision, checked.preparation.revision)
      assert.equal(checked.preparation.attempts.length, 2)
      const retained = f.call('draft', { answer })
      assert.deepEqual(retained.preparation.result, checked.result)
      const returned = f.call('return', { answer: 'черновик при возврате' })
      assert.equal(returned.preparation.answer, 'черновик при возврате')
      assert.equal(returned.preparation.result, undefined)
      assert.equal(returned.preparation.completed, true)
      assert.equal(returned.preparation.open, false)
      assert.ok(returned.preparation.returnedAt)
      assert.equal(returned.work.modeEpoch, initial.work.modeEpoch + 1)
      assert.deepEqual(returned.work.numericPreparationHistory, [returned.preparation])
      assert.equal(numericPreparationContext(f.store, returned.work), null)
      for (const key of ['document', 'finalAnswer', 'generalAnswer', 'revision']) assert.deepEqual(returned.work[key], main[key])
      const next = f.call('help')
      assert.notEqual(next.preparation.id, initial.preparation.id)
      assert.equal(next.preparation.revision, 0)
      assert.equal(next.preparation.answer, '')
      assert.deepEqual(next.work.numericPreparationHistory, [returned.preparation])
      assert.equal(f.cancelled.length, 7)
    } finally { f.store.close() }
  })
}

test('strict routes, current work, solo mode, both work versions and preparation identity fence every action', () => {
  const f = fixture()
  try {
    assert.equal(f.call('solution'), null)
    assert.throws(() => f.call('help', {}, { path: '/api/topics/help' }), { status: 400 })
    assert.throws(() => f.call('help', { workId: 'other' }), { status: 400 })
    assert.throws(() => f.call('help', { expectedRevision: undefined }), { status: 400 })
    assert.throws(() => f.call('help', { expectedRevision: 1 }), { status: 409 })
    assert.throws(() => f.call('help', { expectedModeEpoch: 1 }), { status: 409 })
    for (const action of ['draft', 'preparation', 'return']) assert.throws(() => f.call(action, { answer: '' }), { status: 400 })
    const opened = f.call('help')
    for (const action of ['draft', 'preparation', 'return']) {
      assert.throws(() => f.call(action, { answer: '', preparationId: undefined }), { status: 400 })
      assert.throws(() => f.call(action, { answer: '', expectedPreparationRevision: undefined }), { status: 400 })
      assert.throws(() => f.call(action, { answer: '', preparationId: 'old' }), { status: 409 })
      assert.throws(() => f.call(action, { answer: '', expectedPreparationRevision: 20 }), { status: 409 })
      assert.throws(() => f.call(action, { answer: 20 }), { status: 400 })
      assert.throws(() => f.call(action, { answer: 'x'.repeat(2001) }), { status: 400 })
    }
    assert.throws(() => f.call('help', { expectedModeEpoch: opened.work.modeEpoch - 1 }), { status: 409 })
    assert.throws(() => f.call('return', { returnPoint: { field: 'answer', selectionStart: 2, selectionEnd: 1, scrollY: 0 } }), { status: 400 })
    const other = f.store.create('graph-value-v1', 'guided')
    for (const action of ['help', 'draft', 'preparation', 'return']) assert.throws(() => f.call(action, { answer: '' }), { status: 409 })
    f.store.open(f.work.id)
    const solo = f.store.get(f.work.id); solo.mode = 'solo'; f.store.put(solo)
    for (const action of ['help', 'draft', 'preparation', 'return']) assert.throws(() => f.call(action, { answer: '' }), { status: 403 })
    assert.throws(() => f.call('help', {}, { store: f.store.forVisitor(crypto.randomUUID()) }), { status: 404 })
    f.store.open(other.id)
    assert.throws(() => f.call('help', {}, { work: other, path: '/api/percentages/help', body: { workId: other.id } }), { status: 400 })
    const trig = f.store.create('double-angle-cos', 'guided')
    assert.throws(() => f.call('help', {}, { work: trig, path: '/api/topics/help', body: { workId: trig.id } }), { status: 400 })
    trig.mode='solo';f.store.put(trig)
    assert.throws(() => f.call('help', {}, { work: trig, path: '/api/topics/help', body: { workId: trig.id } }), { status: 403 })
  } finally { f.store.close() }
})

test('frozen help and checker survive catalog and stored problem drift plus actual SQLite reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pole-numeric-prep-')), path = join(directory, 'state.sqlite')
  let store = new Store(path)
  const original = copy(percentageProblems[0].help)
  try {
    const f = fixture('percent-discount-v1', store), initial = f.call('help')
    f.call('draft', { answer: 'черновик' })
    const changed = store.problem(f.work)
    changed.help.title = 'Поздний заголовок'; changed.help.check.answer = '999'; changed.help.check.feedback = 'поздний отзыв'
    store.setSetting(`problem-instance:${f.work.id}`, JSON.stringify(changed))
    percentageProblems[0].help = copy(changed.help)
    store.close(); store = new Store(path)
    const work = store.open(f.work.id)
    assert.equal(work.numericPreparation.answer, 'черновик')
    const body = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, preparationId: work.numericPreparation.id, expectedPreparationRevision: work.numericPreparation.revision, answer: original.check.answer }
    const checked = handleNumericPreparation({ store, work, path: '/api/percentages/preparation', body, checkWorkVersion })
    assert.equal(checked.result.status, 'correct')
    assert.equal(checked.result.summary, original.check.feedback)
    assert.equal(checked.preparation.help.title, initial.help.title)
    const context = numericPreparationContext(store, checked.work)
    assert.deepEqual(context, checked.preparation)
    assert.equal(context.help.check.answer, undefined)
    assert.equal(context.help.check.feedback, undefined)
    assert.equal(context.problem, undefined)
    assert.notEqual(numericPreparationSignature(work), numericPreparationSignature(checked.work))
    const withHidden = { ...checked.work, numericPreparation: { ...checked.preparation, privateAnswer: 'secret' } }
    assert.equal(numericPreparationContext(store, withHidden).privateAnswer, undefined)
  } finally {
    percentageProblems[0].help = original
    store.close()
    // This test owns the exact mkdtemp directory and closes SQLite before cleanup.
    rmSync(directory, { recursive: true, force: true })
  }
})

test('attempts and completed history are bounded and closed instances cannot be resumed or checked', () => {
  const f = fixture()
  try {
    f.call('help')
    for (let i = 0; i < 24; i++) f.call('preparation', { answer: String(i) })
    const checked = f.store.get(f.work.id)
    assert.equal(checked.numericPreparation.attempts.length, 20)
    assert.equal(checked.numericPreparation.attempts[0].answer, '4')
    const closed = f.call('return')
    for (const action of ['draft', 'preparation', 'return']) assert.throws(() => f.call(action, { answer: '150' }), { status: 409 })
    for (let i = 0; i < 14; i++) { f.call('help'); f.call('return') }
    const final = f.store.get(f.work.id)
    assert.equal(final.numericPreparationHistory.length, 12)
    assert.ok(final.numericPreparationHistory.every(p => p.completed && !p.open))
    assert.ok(!final.numericPreparationHistory.some(p => p.id === closed.preparation.id))
    const keys = f.store.db.prepare('SELECT key FROM settings WHERE key LIKE ?').all(`numeric-preparation:${f.work.id}%`)
    assert.equal(keys.length, 1)
    assert.notEqual(numericPreparationSignature(final), numericPreparationSignature({ ...final, numericPreparation: { ...final.numericPreparation, completed: false } }))
  } finally { f.store.close() }
})

test('failed evidence persistence rolls back checks without cancelling the live context or advancing its revision', () => {
  const f = fixture()
  try {
    f.call('help')
    const before = f.store.get(f.work.id), signature = numericPreparationSignature(before), events = f.store.learningEvidence()
    const checked = f.store.learningChecked
    f.store.learningChecked = function(event) { checked.call(this, event); throw Error('storage failure') }
    assert.throws(() => f.call('preparation', { answer: '150' }), /storage failure/)
    assert.deepEqual(f.store.get(f.work.id), before)
    assert.deepEqual(f.store.learningEvidence(), events)
    assert.equal(numericPreparationSignature(f.store.get(f.work.id)), signature)
    assert.equal(f.cancelled.length, 1)
    f.store.learningChecked = checked
    const result = f.call('preparation', { answer: '150' })
    assert.equal(result.result.status, 'correct')
    assert.equal(result.preparation.revision, before.numericPreparation.revision + 1)
  } finally { f.store.close() }
})

function copy(value) { return structuredClone(value) }
