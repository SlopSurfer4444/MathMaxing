import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Store } from '../store.mjs'
import { createExamRuntime } from './runtime.mjs'
import { createInstance, families } from './registry.mjs'
import { getMaterialResource } from './material-resources.mjs'

function fixture(t, tutor) {
  const db = new DatabaseSync(':memory:')
  const settings = new Map()
  const view = owner => ({ db, owner, setting: key => settings.get(`${owner}:${key}`), setSetting: (key, value) => settings.set(`${owner}:${key}`, value) })
  const store = view('local'), other = view('other')
  const runtime = createExamRuntime({ store, tutor })
  t.after(() => { runtime.close(); db.close() })
  let sequence = 0
  const call = (action, body = {}, visitor = store) => runtime.route(action === 'state' ? 'GET' : 'POST', `/api/exam/${action}`, body, visitor)
  const start = async (options = {}) => (await call('start', { familyId: 'number.percent', mode: 'solo', seed: 71, requestId: `r-${++sequence}`, ...options })).work
  const mutate = async (action, work, extras = {}) => (await call(action, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: `r-${++sequence}`, ...extras })).work
  const save = async (work, answersByPart, reasoning = 'Моя запись') => (await call('save', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, answersByPart, reasoning })).work
  return { db, store, other, runtime, call, start, mutate, save }
}
const answers = instance => Object.fromEntries(instance.parts.map(part => [part.id, part.check === 'proof' ? 'Провожу обоснование' : Array.isArray(part.expected) ? part.expected.join('; ') : String(part.expected)]))

test('foundation articles preserve the draft, topic probe, frozen source and original return point', async t => {
  const prompts = []
  const f = fixture(t, { async respond({ prompt }) { prompts.push(JSON.parse(prompt)); return 'Синус здесь — отношение сторон. [[material:cosine]] [[material:not-published]]' } })
  let work = await f.start({ familyId: 'algebra.equations.trig-segment', mode: 'guided' })
  work = await f.save(work, work.answersByPart, 'Мой незаконченный переход')
  const point = { scrollY: 314, start: 2, end: 7, partId: work.instance.parts[0].id, kind: 'text' }
  work = await f.mutate('learn', work, { action: 'open', returnPoint: point })
  work = await f.mutate('learn', work, { action: 'probe', answer: '0' })
  const probe = structuredClone(work.learning.probeResult)
  let reply = await f.call('learn', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'article-sine', action: 'open', materialId: 'sine' })
  work = reply.work
  assert.equal(reply.lesson.kind, 'material')
  assert.equal(reply.lesson.material.article.diagram, 'triangle')
  assert.equal(reply.lesson.probe, undefined)
  assert.equal(work.materialResources, undefined)
  const source = structuredClone(reply.lesson.material)
  reply.lesson.material.article.explanation = 'Untrusted local edit'
  work = await f.mutate('chat', work, { message: 'Что такое синус?', contexts: [{ quote: 'Синус — отношение сторон.' }] })
  assert.deepEqual(prompts[0].resource.article, source.article)
  assert.equal(prompts[0].resource.digest, source.digest)
  assert.equal(work.messages.find(item => item.role === 'user').resource.version, source.version)
  assert.equal(work.messages.at(-1).suggestions[0].materialId, 'cosine')
  assert.equal(work.messages.at(-1).suggestions.length, 1)
  await assert.rejects(f.mutate('learn', work, { action: 'probe', answer: '1' }), /нет короткой пробы/)
  work = await f.mutate('learn', work, { action: 'open', materialId: 'right-triangle', returnPoint: { scrollY: 0 } })
  work = await f.mutate('learn', work, { action: 'open', materialId: 'sine' })
  assert.deepEqual(work.learning.returnPoint, point)
  const reread = await f.call('learn', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'article-reread', action: 'open', materialId: 'sine' })
  assert.deepEqual(reread.lesson.material, source)
  work = await f.mutate('learn', reread.work, { action: 'open', familyId: work.familyId })
  assert.equal(work.learning.materialId, undefined)
  assert.deepEqual(work.learning.probeResult, probe)
  work = await f.mutate('learn', work, { action: 'return' })
  assert.equal(work.reasoning, 'Мой незаконченный переход')
  assert.deepEqual(work.learning.returnPoint, point)
})

test('a revised radians article leaves a saved version-3 source and tutor context intact', async t => {
  const prompts = [], f = fixture(t, { async respond({ prompt }) { prompts.push(JSON.parse(prompt)); return 'Смотрим на сохранённое объяснение.' } })
  const oldArticle = JSON.parse(readFileSync(new URL('./fixtures/radians-v3.json', import.meta.url), 'utf8'))
  const current = getMaterialResource('radians'), old = { ...structuredClone(current), version: oldArticle.version, article: oldArticle }
  old.digest = createHash('sha256').update(JSON.stringify({ article: old.article, relations: old.relations })).digest('hex')
  let work = await f.start({ familyId: 'algebra.equations.trig-segment', mode: 'guided' })
  work = await f.mutate('learn', work, { action: 'open', materialId: 'radians' })
  // Simulate a historical work whose full resource was frozen before publication of v4.
  const raw = JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data)
  raw.materialResources.radians = old
  f.db.prepare('UPDATE exam_works SET data=? WHERE id=?').run(JSON.stringify(raw), work.id)
  work = await f.mutate('learn', work, { action: 'return' })
  const reopened = await f.call('learn', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'old-radians', action: 'open', materialId: 'radians' })
  assert.deepEqual(reopened.lesson.material, old)
  work = await f.mutate('chat', reopened.work, { message: 'Поясни знак угла в этой статье', contexts: [] })
  assert.deepEqual(prompts[0].resource, { kind: 'material', ...old })
  assert.equal(work.messages.find(item => item.role === 'user').resource.version, 3)
  const fresh = await f.start({ familyId: 'algebra.equations.trig-segment', mode: 'guided', seed: 72 })
  const opened = await f.call('learn', { workId: fresh.id, expectedRevision: fresh.revision, expectedModeEpoch: fresh.modeEpoch, requestId: 'new-radians', action: 'open', materialId: 'radians' })
  assert.equal(opened.lesson.material.version, 4)
  assert.equal(opened.lesson.material.digest, current.digest)
  assert.notEqual(opened.lesson.material.digest, old.digest)
})

test('articles obey solo, owner-wide exam and family relevance guards', async t => {
  const f = fixture(t)
  let work = await f.start({ familyId: 'algebra.equations.trig-segment' })
  await assert.rejects(f.mutate('learn', work, { action: 'open', materialId: 'sine' }), { status: 403 })
  work = await f.mutate('help', work)
  f.runtime.setSessionGuard(() => true)
  await assert.rejects(f.mutate('learn', work, { action: 'open', materialId: 'sine' }), { status: 403 })
  f.runtime.setSessionGuard(() => false)
  const unrelated = await f.start({ mode: 'guided' })
  await assert.rejects(f.mutate('learn', unrelated, { action: 'open', materialId: 'sine' }), { status: 400 })
})

test('replaying an old article receipt returns the committed resource without re-opening an old article', async t => {
  const prompts = []
  const f = fixture(t, { async respond({ prompt }) { prompts.push(JSON.parse(prompt)); return 'Посмотрим на горизонтальную координату.' } })
  let work = await f.start({ familyId: 'algebra.equations.trig-segment', mode: 'guided' })
  const first = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'article-first', action: 'open', materialId: 'sine' }
  work = (await f.call('learn', first)).work
  work = await f.mutate('learn', work, { action: 'open', materialId: 'cosine' })
  const replay = await f.call('learn', first)
  assert.equal(replay.work.revision, work.revision)
  assert.equal(replay.lesson.material.id, 'cosine')
  assert.equal(replay.work.learning.materialId, 'cosine')
  work = await f.mutate('chat', replay.work, { message: 'Поясни рисунок', contexts: [] })
  assert.equal(prompts[0].resource.id, 'cosine')
  work = await f.mutate('learn', work, { action: 'return' })
  const closed = await f.call('learn', first)
  assert.equal(closed.lesson, undefined)
  assert.equal(closed.work.learning.open, false)
})

test('a multi-hop lesson path can return to a visited resource with its frozen probe', async t => {
  const f = fixture(t)
  let work = await f.start({ mode: 'guided' })
  work = await f.mutate('learn', work, { action: 'open', returnPoint: { scrollY: 125 } })
  work = await f.mutate('learn', work, { action: 'probe', answer: '180' })
  const originalProbe = structuredClone(work.learning.probeResult)
  for (const familyId of ['finance.savings', 'sequence.progressions', 'model.formula-units', 'sequence.progressions', 'finance.savings', 'number.percent']) {
    work = await f.mutate('learn', work, { action: 'open', familyId })
    assert.equal(work.learning.familyId, familyId)
    assert.equal(work.learning.returnPoint.scrollY, 125)
  }
  assert.deepEqual(work.learning.probeResult, originalProbe)
  assert.equal(work.learningFamilies, undefined)
  await assert.rejects(f.mutate('learn', work, { action: 'open', familyId: 'geom.space.distance' }), { status: 400 })
})

test('topic evidence survives activity in another family and reaches only the relevant tutor context', async t => {
  const prompts = []
  const f = fixture(t, { async respond({ prompt }) { prompts.push(JSON.parse(prompt)); return 'От какой цены считаешь процент?' } })
  let work = await f.start({ mode: 'guided', seed: 0 })
  work = await f.save(work, answers(createInstance('number.percent', 0)))
  work = await f.mutate('submit', work)
  const other = await f.start({ familyId: 'model.formula-units', mode: 'guided', seed: 0 })
  for (let i = 0; i < 45; i++) {
    const event = { id: `unrelated-${i}`, workId: other.id, familyId: other.familyId, attemptId: `fixture-${i}`, independent: false, status: 'unknown', createdAt: new Date(Date.now() + i + 1).toISOString(), evaluationIds: [], summary: 'Fixture observation' }
    f.db.prepare('INSERT INTO exam_observations VALUES(?,?,?,?,?,?,?)').run(event.id, f.store.owner, event.workId, event.familyId, event.attemptId, event.createdAt, JSON.stringify(event))
  }
  const route = (await f.call('state')).route
  assert.equal(route.learnerMemory.find(item => item.familyId === work.familyId).recentEvidence[0].workId, work.id)
  assert.equal(route.learnerMemory.find(item => item.familyId === other.familyId).unverifiedCount, 12)
  await f.mutate('chat', work, { message: 'Я уже пробовал эту тему?', contexts: [] })
  const memory = prompts[0].learnerMemory.find(item => item.familyId === work.familyId)
  assert.equal(memory.assistedCorrectCount, 1)
  assert.equal(memory.recentEvidence[0].attemptId, work.attempts[0].id)
  assert.ok(prompts[0].learnerMemory.length <= 3)
  assert.equal('answersByPart' in memory, false)
})

test('reopening an active lesson retains the checked probe and original return point', async t => {
  const f = fixture(t)
  let work = await f.start({ mode: 'guided' })
  work = await f.mutate('learn', work, { action: 'open', returnPoint: { scrollY: 44, start: 1, end: 3 } })
  work = await f.mutate('learn', work, { action: 'probe', answer: '0' })
  const result = structuredClone(work.learning.probeResult)
  work = await f.mutate('learn', work, { action: 'open', returnPoint: { scrollY: 0, start: 0, end: 0 } })
  assert.deepEqual(work.learning.probeResult, result)
  assert.equal(work.learning.returnPoint.scrollY, 44)
})

for (const action of ['chat', 'review', 'object']) test(`a ${action} result exceeding the profile reserve becomes terminal without provider replay or restart`, async t => {
  const store = new Store(':memory:'), visitor = store.forVisitor('11111111-1111-4111-8111-111111111111')
  let calls = 0, output = '', runtime, fillRemaining = false, reservedBytes
  const tutor = { async respond() {
    calls++
    if (fillRemaining) {
      const current = visitor.profileBudget()
      visitor.setSetting('fixture-concurrent-edit', 'x'.repeat(current.limits.bytes + current.limits.editReserveBytes - current.bytes))
      reservedBytes = visitor.profileBudget().bytes
    }
    return output
  } }
  runtime = createExamRuntime({ store, tutor })
  t.after(() => { runtime.close(); store.close() })
  const call = (path, body) => runtime.route('POST', `/api/exam/${path}`, body, visitor)
  let { work } = await call('start', { familyId: 'number.percent', mode: 'guided', seed: 71, requestId: 'start' })
  const version = () => ({ workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch })
  ;({ work } = await call('save', { ...version(), answersByPart: Object.fromEntries(work.instance.parts.map(part => [part.id, '1'])), reasoning: 'Первый шаг' }))
  ;({ work } = await call('submit', { ...version(), requestId: 'submit' }))
  const finding = { partId: work.instance.parts[0].id, quote: 'Первый шаг', claim: 'Проверим основание', verdict: 'unverified', message: 'Уточни основание перехода.' }
  let advisoryId
  if (action === 'object') {
    output = JSON.stringify({ findings: [finding] })
    ;({ work } = await call('review', { ...version(), requestId: 'first-review', attemptId: work.attempts.at(-1).id }))
    advisoryId = work.advisories.find(item => item.partId).id
  }
  const initialCalls = calls, before = JSON.parse(store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data)
  output = action === 'chat' ? 'A'.repeat(24000) : action === 'object' ? JSON.stringify({ status: 'withdrawn', message: 'A'.repeat(2400) }) : JSON.stringify({ findings: [{ ...finding, claim: 'A'.repeat(1200), message: 'B'.repeat(1800) }] })
  const budget = visitor.profileBudget()
  visitor.setSetting('fixture-budget', 'x'.repeat(budget.limits.bytes + budget.limits.editReserveBytes - budget.bytes - 2000))
  fillRemaining = true
  const body = { ...version(), requestId: 'quota-result', message: 'Почему?', attemptId: work.attempts.at(-1).id, ...(advisoryId ? { advisoryId, explanation: 'Проверь основание.' } : {}) }
  await assert.rejects(call(action, body), error => error.status === 429 && /не сохранён/.test(error.message))
  const after = JSON.parse(store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data), collection = action === 'chat' ? 'messages' : action === 'object' ? 'objections' : 'advisories'
  assert.equal(after[collection].at(-1).status, 'failed')
  assert.equal(after[collection].at(-1).error, 'storage')
  assert.equal(after[collection].at(-1).dispatchStarted, undefined)
  assert.ok(visitor.profileBudget().bytes <= reservedBytes, 'terminalization must not need any free storage')
  assert.equal(after.exposure, before.exposure)
  for (const key of ['answersByPart', 'reasoning', 'attempts', 'evaluations', 'retractions']) assert.deepEqual(after[key], before[key])
  assert.deepEqual(after[collection].slice(0, -1), before[collection])
  await assert.rejects(call(action, body), { status: 429 })
  assert.equal(calls, initialCalls + 1)
  // The failed outcome is already committed; restart recovery is not required.
  const persisted = store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data
  runtime.close(); runtime = createExamRuntime({ store, tutor })
  assert.equal(store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data, persisted)
  await assert.rejects(call(action, body), { status: 429 })
  assert.equal(calls, initialCalls + 1)
})

test('a chat result exceeding the per-work cap terminalizes only its reservation and retains history', async t => {
  let calls = 0
  const f = fixture(t, { async respond() { calls++; return 'A'.repeat(24000) } })
  const work = await f.start({ mode: 'guided' })
  const row = JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data)
  row.messages = Array.from({ length: 70 }, (_, index) => ({ id: `past-${index}`, role: 'assistant', text: 'H'.repeat(24000), status: 'complete' }))
  row.messages.push({ id: 'past-tail', role: 'assistant', text: '', status: 'complete' })
  row.messages.at(-1).text = 'H'.repeat(1799000 - Buffer.byteLength(JSON.stringify(row)))
  f.db.prepare('UPDATE exam_works SET data=? WHERE id=?').run(JSON.stringify(row), work.id)
  const body = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'work-cap', message: 'Почему?' }
  await assert.rejects(f.call('chat', body), { status: 429 })
  const saved = f.runtime.readWork(f.store, work.id)
  assert.deepEqual(saved.messages.slice(0, -1), row.messages)
  assert.equal(saved.messages.at(-1).status, 'failed')
  await assert.rejects(f.call('chat', body), { status: 429 })
  assert.equal(calls, 1)
})

test('a changed draft never inherits the mathematical verdict of its earlier frozen attempt in tutor context', async t => {
  let packet
  const f = fixture(t, { async respond({ prompt }) { packet = JSON.parse(prompt); return { text: 'Посмотрим именно на текущую запись.' } } })
  let work = await f.start({ seed: 71 })
  const instance = createInstance('number.percent', 71)
  work = await f.save(work, Object.fromEntries(instance.parts.map(p => [p.id, '9999999'])), 'Прежнее рассуждение')
  work = await f.mutate('help', work)
  assert.equal(work.evaluations[0].status, 'incorrect')
  work = await f.save(work, answers(instance), 'Другая, исправленная запись')
  work = await f.mutate('chat', work, { message: 'Посмотри исправленную запись.' })
  assert.equal(packet.evaluationMatchesDraft, false)
  assert.deepEqual(packet.evaluations, [])
  work = await f.mutate('submit', work)
  await f.mutate('chat', work, { message: 'Что проверено теперь?' })
  assert.equal(packet.evaluationMatchesDraft, true)
  assert.ok(packet.evaluations.every(e => e.status === 'correct'))
})

const quoteAnchor = (original, quote, start = original.indexOf(quote)) => ({ start, end: start + quote.length, fieldDigest: createHash('sha256').update(JSON.stringify(original)).digest('hex') })

test('quote sources are bounded literal owner/revision snapshots and survive later draft changes', async t => {
  let packet
  const f = fixture(t, { async respond(input) { packet = JSON.parse(input.prompt); return 'Рассмотрим эту запись.' } })
  let work = await f.start({ mode: 'guided' })
  const partId = work.instance.parts[0].id, quote = 'Q'.repeat(4000)
  const answer = 'A'.repeat(200) + quote + 'B'.repeat(200), reasoning = 'До перехода. Важный шаг. После перехода.'
  work = await f.save(work, { [partId]: answer }, reasoning)
  const revision = work.revision
  const reply = await f.call('chat', { workId: work.id, expectedRevision: revision, expectedModeEpoch: work.modeEpoch, requestId: 'source-quote', message: 'Объясни цитаты.', contexts: [
    { partId, quote, source: { workId: 'foreign-work', revision: 999, field: 'answer', text: 'Поддельный источник' } },
    { quote: 'Важный шаг' }, { quote: 'Текст из произвольной статьи', source: { workId: 'foreign-work' } },
  ] })
  work = reply.work
  const saved = work.messages.find(message => message.role === 'user').contexts
  assert.deepEqual(saved, packet.contexts)
  assert.deepEqual(saved[0].source, { workId: work.id, revision, field: 'answer', partId, ...quoteAnchor(answer, quote), text: 'A'.repeat(150) + quote + 'B'.repeat(150) })
  assert.equal(saved[0].source.text.length, 4300)
  assert.deepEqual(saved[1].source, { workId: work.id, revision, field: 'reasoning', ...quoteAnchor(reasoning, 'Важный шаг'), text: reasoning })
  assert.deepEqual(saved[2].source, { workId: work.id, revision, field: 'excerpt', text: 'Текст из произвольной статьи' })
  const original = structuredClone(saved)
  work = await f.save(work, { [partId]: 'Другая запись' }, 'Другое рассуждение')
  assert.deepEqual(work.messages.find(message => message.role === 'user').contexts, original)
  work = await f.mutate('submit', work)
  const reviewedRevision = work.revision, attemptId = work.attempts.at(-1).id
  const review = await f.call('chat', { workId: work.id, expectedRevision: reviewedRevision, expectedModeEpoch: work.modeEpoch, requestId: 'review-source', message: 'А теперь?', contexts: [{ partId, quote: 'Другая запись' }] })
  assert.deepEqual(review.work.messages.filter(message => message.role === 'user').at(-1).contexts[0].source, { workId: work.id, revision: reviewedRevision, attemptId, field: 'answer', partId, ...quoteAnchor('Другая запись', 'Другая запись'), text: 'Другая запись' })
  await assert.rejects(f.call('chat', { workId: work.id, expectedRevision: review.work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'foreign-source', message: 'Чужая работа', contexts: [{ partId, quote: 'Другая запись' }] }, f.other), { status: 404 })
})

test('explicit quote origins match only the requested saved field and never grant source authority', async t => {
  let packet
  const f = fixture(t, { async respond(input) { packet = JSON.parse(input.prompt); return 'Посмотрим на выделенную запись.' } })
  let work = await f.start({ mode: 'guided' })
  const partId = work.instance.parts[0].id, answer = 'Ответ: x=1. Только ответ.', reasoning = 'Рассуждение: x=1. Только рассуждение.'
  work = await f.save(work, { [partId]: answer }, reasoning)
  const revision = work.revision
  const reply = await f.call('chat', { workId: work.id, expectedRevision: revision, expectedModeEpoch: work.modeEpoch, requestId: 'exact-origins', message: 'Объясни выделенное.', contexts: [
    { partId, quote: 'x=1', origin: 'reasoning', source: { workId: 'foreign', revision: 999, field: 'answer', text: 'Подмена' } },
    { partId, quote: 'x=1', origin: 'answer' },
    { partId, quote: 'x=1', origin: 'excerpt' },
    { partId, quote: 'Только ответ', origin: 'reasoning' },
    { partId, quote: 'Только рассуждение', origin: 'answer' },
    { quote: 'x=1', origin: 'answer' },
  ] })
  work = reply.work
  const contexts = work.messages.find(message => message.role === 'user').contexts
  assert.deepEqual(packet.contexts, contexts)
  assert.deepEqual(contexts.map(context => context.source.field), ['reasoning', 'answer', 'excerpt', 'excerpt', 'excerpt', 'excerpt'])
  assert.deepEqual(contexts.map(context => context.origin), ['reasoning', 'answer', 'excerpt', 'reasoning', 'answer', 'answer'])
  assert.deepEqual(contexts[0].source, { workId: work.id, revision, field: 'reasoning', ...quoteAnchor(reasoning, 'x=1'), text: reasoning })
  assert.deepEqual(contexts[1].source, { workId: work.id, revision, field: 'answer', partId, ...quoteAnchor(answer, 'x=1'), text: answer })
  for (const context of contexts.slice(2)) assert.deepEqual(context.source, { workId: work.id, revision, field: 'excerpt', text: context.quote })
  const before = structuredClone(work)
  await assert.rejects(f.mutate('chat', work, { message: 'Подмена поля', contexts: [{ quote: 'x=1', origin: 'current' }] }), { status: 400 })
  await assert.rejects(f.mutate('chat', work, { message: 'Подмена части', contexts: [{ quote: 'x=1', partId: 'foreign-part', origin: 'answer' }] }), { status: 400 })
  assert.deepEqual((await f.call('open', { workId: work.id })).work, before)
})

test('selected second occurrences retain exact field identity, environment and idempotent source ranges', async t => {
  let calls = 0
  const f = fixture(t, { async respond() { calls++; return 'Обсудим именно второй переход.' } })
  let work = await f.start({ mode: 'guided' })
  const partId = work.instance.parts[0].id, quote = 'x>0'
  const reasoning = 'Первый переход: x>0. ' + 'a'.repeat(320) + ' Второй переход: x>0. Конец.'
  const answer = 'Первый ответ: x>0. ' + 'b'.repeat(320) + ' Второй ответ: x>0.'
  work = await f.save(work, { [partId]: answer }, reasoning)
  const selected = quoteAnchor(reasoning, quote, reasoning.lastIndexOf(quote)), selectedAnswer = quoteAnchor(answer, quote, answer.lastIndexOf(quote))
  const body = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'second-occurrence', message: 'Почему во втором месте?', contexts: [
    { quote, origin: 'reasoning', selection: selected, source: { field: 'answer', start: 0, end: 3, fieldDigest: '0'.repeat(64), text: 'Подмена' } },
    { quote, partId, origin: 'answer', selection: selectedAnswer },
  ] }
  const reply = await f.call('chat', body), contexts = reply.work.messages.find(message => message.role === 'user').contexts
  assert.deepEqual(contexts[0].source, { workId: work.id, revision: work.revision, field: 'reasoning', ...selected, text: reasoning.slice(selected.start - 150, selected.end + 150) })
  assert.deepEqual(contexts[1].source, { workId: work.id, revision: work.revision, field: 'answer', partId, ...selectedAnswer, text: answer.slice(selectedAnswer.start - 150, selectedAnswer.end + 150) })
  assert.equal(contexts[0].source.text.includes('Первый переход'), false)
  assert.deepEqual((await f.call('chat', body)).work.messages.find(message => message.role === 'user').contexts, contexts)
  assert.equal(calls, 1)
})

test('changed field identities and forged quote slices remain excerpts, never false saved-field anchors', async t => {
  const f = fixture(t, { async respond() { return 'Это только цитата из вопроса.' } })
  let work = await f.start({ mode: 'guided' })
  const partId = work.instance.parts[0].id, original = 'Первое x>0, второе x>0.', quote = 'x>0'
  const selected = quoteAnchor(original, quote, original.lastIndexOf(quote))
  const changed = original.replace('Первое', 'Другое')
  work = await f.save(work, { [partId]: original }, changed)
  work = await f.mutate('chat', work, { message: 'Не подменяй источник.', contexts: [
    { quote, origin: 'reasoning', selection: selected },
    { quote, partId, origin: 'answer', selection: { ...selected, start: selected.start + 1 } },
    { quote, partId, origin: 'answer', selection: { ...selected, fieldDigest: '0'.repeat(64) } },
    { quote, origin: 'reasoning', selection: { ...selected, start: 0, end: quote.length, fieldDigest: quoteAnchor(changed, quote).fieldDigest } },
    { quote: original.slice(selected.start), partId, origin: 'answer', selection: { ...selected, end: original.length + 50 } },
  ] })
  for (const context of work.messages.find(message => message.role === 'user').contexts) assert.deepEqual(context.source, { workId: work.id, revision: work.revision - 2, field: 'excerpt', text: context.quote })
  const before = structuredClone(work)
  for (const selection of [{ ...selected, end: 80001 }, { ...selected, start: -1 }, { start: 1, end: 4, fieldDigest: 'bad' }]) {
    await assert.rejects(f.mutate('chat', work, { message: 'Некорректный диапазон', contexts: [{ quote, origin: 'reasoning', selection }] }), { status: 400 })
  }
  assert.deepEqual((await f.call('open', { workId: work.id })).work, before)
})

test('legacy citations admit only unique literal field matches and leave repeated or ambiguous matches as excerpts', async t => {
  const f = fixture(t, { async respond() { return 'Источник уточним без угадывания.' } })
  let work = await f.start({ mode: 'guided' })
  const partId = work.instance.parts[0].id, answer = 'Повтор x>0, ещё x>0. Один ответ.', reasoning = 'x>0. Уникальный переход. Один ответ.'
  work = await f.save(work, { [partId]: answer }, reasoning)
  const revision = work.revision
  work = await f.mutate('chat', work, { message: 'Старые цитаты.', contexts: [
    { quote: 'x>0', partId, origin: 'answer' }, { quote: 'x>0', partId },
    { quote: 'Один ответ.', partId }, { quote: 'Уникальный переход', origin: 'reasoning' },
  ] })
  const contexts = work.messages.find(message => message.role === 'user').contexts
  for (const context of contexts.slice(0, 3)) assert.deepEqual(context.source, { workId: work.id, revision, field: 'excerpt', text: context.quote })
  assert.deepEqual(contexts[3].source, { workId: work.id, revision, field: 'reasoning', ...quoteAnchor(reasoning, 'Уникальный переход'), text: reasoning })
})

test('frozen task, visitor isolation, exact check and honest independent observation', async t => {
  const f = fixture(t)
  let work = await f.start()
  const privateInstance = createInstance('number.percent', 71)
  assert.equal(JSON.stringify(work).includes('expected'), false)
  assert.equal(work.instance.title, 'Задача')
  assert.equal(work.instance.templateId, undefined)
  await assert.rejects(f.call('open', { workId: work.id }, f.other), { status: 404 })
  work = await f.save(work, answers(privateInstance))
  work = await f.mutate('submit', work)
  assert.equal(work.attempts.length, 1)
  assert.equal(work.attempts[0].independent, true)
  assert.ok(work.evaluations.every(item => item.status === 'correct'))
  assert.equal(work.evaluations[0].targetDigest, work.attempts[0].digest)
  const state = await f.call('state')
  assert.equal(state.route.observations[0].attemptId, work.attempts[0].id)
  assert.equal(state.route.observations[0].independent, true)
  assert.equal((await f.call('state', {}, f.other)).works.length, 0)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM exam_instances').get().n, 1)
})

test('atomic idempotent start and mutation, stale tabs and malicious part keys', async t => {
  const f = fixture(t)
  const body = { familyId: 'number.percent', mode: 'solo', seed: 31, requestId: 'once' }
  const first = await f.call('start', body), second = await f.call('start', body)
  assert.equal(first.work.id, second.work.id)
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM exam_works').get().n, 1)
  await assert.rejects(f.call('start', { ...body, seed: 32 }), { status: 409 })
  await assert.rejects(f.call('start', { ...body, requestId: 'bad', familyId: 'constructor' }), { status: 404 })
  const work = await f.save(first.work, first.work.answersByPart)
  await assert.rejects(f.mutate('submit', first.work), { status: 409 })
  await assert.rejects(f.call('save', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, answersByPart: JSON.parse('{"__proto__":"x"}'), reasoning: '' }), { status: 400 })
  const submit = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'submit-once' }
  const checked = await f.call('submit', submit)
  const replay = await f.call('submit', submit)
  assert.equal(checked.work.attempts.length, replay.work.attempts.length)
  assert.equal(replay.work.attempts.length, 1)
})

test('failed instance/work/current write rolls back all creation', async t => {
  const f = fixture(t)
  f.db.exec("CREATE TRIGGER fail_exam_work BEFORE INSERT ON exam_works BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
  await assert.rejects(f.start(), /fixture failure/)
  for (const table of ['exam_instances', 'exam_works', 'exam_current', 'exam_requests']) assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0)
})

test('help freezes solo snapshot before mode transition; learning never overwrites draft', async t => {
  const f = fixture(t)
  let work = await f.start()
  await assert.rejects(f.mutate('learn', work, { action: 'open' }), { status: 403 })
  work = await f.save(work, work.answersByPart, 'Точная собственная запись')
  const before = structuredClone(work)
  work = await f.mutate('help', work)
  assert.equal(work.attempts[0].mode, 'solo')
  assert.equal(work.attempts[0].reason, 'before-help')
  assert.equal(work.attempts[0].reasoning, before.reasoning)
  assert.equal(work.mode, 'guided')
  assert.equal(work.modeEpoch, 1)
  const point = { partId: work.instance.parts[0].id, kind: 'text', selection: { from: 3, to: 7 }, revision: work.revision }
  const opened = await f.call('learn', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'lesson-open', action: 'open', returnPoint: point })
  assert.equal(opened.lesson.probe.answer, undefined)
  assert.equal(opened.lesson.probe.explanation, undefined)
  work = opened.work
  work = await f.mutate('learn', work, { action: 'probe', answer: '0' })
  assert.ok(work.learning.probeResult)
  work = await f.mutate('learn', work, { action: 'return' })
  assert.deepEqual(work.learning.returnPoint, point)
  assert.equal(work.reasoning, before.reasoning)
  assert.deepEqual(work.answersByPart, before.answersByPart)
  assert.equal(work.learning.open, false)
})

test('proof stays unknown, attempt cores immutable, finish and fresh solo variant are available', async t => {
  const f = fixture(t)
  const proofFamily = families.find(family => family.templates.some(template => template.build(0).parts.some(part => part.check === 'proof')))
  assert.ok(proofFamily)
  let work = await f.start({ familyId: proofFamily.id })
  work = await f.save(work, answers(createInstance(proofFamily.id, 71)))
  work = await f.mutate('submit', work)
  assert.ok(work.evaluations.some(item => item.status === 'unknown'))
  const core = JSON.stringify(work.attempts[0])
  work = await f.mutate('help', work)
  const evaluation = work.evaluations.find(item => item.status === 'unknown')
  work = await f.mutate('object', work, { attemptId: evaluation.attemptId, evaluationId: evaluation.id, explanation: 'Я использовал другой допустимый метод.' })
  assert.equal(JSON.stringify(work.attempts[0]), core)
  assert.equal(work.evaluations.find(item => item.id === evaluation.id).objections[0].status, 'uncertain')
  work = await f.mutate('finish', work)
  assert.equal(work.completed, true)
  assert.ok(work.evaluations.some(item => item.status === 'unknown'))
  const next = await f.mutate('next', work)
  assert.equal(next.mode, 'solo')
  assert.equal(next.completed, false)
  assert.notEqual(next.id, work.id)
  assert.equal(next.attempts.length, 0)
  assert.equal(next.exposure, false)
})

test('active session fences aid, per-work submit and deadline saves; trusted exam submit freezes', async t => {
  const f = fixture(t)
  const work = f.runtime.createWork(f.store, { familyId: 'number.percent', mode: 'solo', seed: 5, sessionId: 'exam-a', position: 1 })
  f.runtime.setSessionGuard(() => true)
  f.runtime.setSessionPolicy(() => ({ sessionId: 'exam-a', status: 'active', deadlineAt: new Date(Date.now() + 60000).toISOString() }))
  for (const action of ['help', 'correct', 'finish', 'next', 'submit']) await assert.rejects(f.mutate(action, work), { status: 403 })
  const opened = (await f.call('open', { workId: work.id })).work
  assert.equal(opened.familyId, undefined)
  assert.equal(opened.instance.title, 'Задача')
  assert.equal(opened.instance.id.includes('number.percent'), false)
  const frozen = f.runtime.submitWork(f.store, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'exam-submit', examSessionId: 'exam-a' })
  assert.equal(frozen.completed, true)
  assert.equal(frozen.attempts[0].reason, 'exam')
  await assert.rejects(f.save(frozen, frozen.answersByPart), { status: 409 })
})

test('a submitted exam task forks an idempotent owned study correction from its exact frozen instance', async t => {
  const f = fixture(t)
  let work = f.runtime.createWork(f.store, { familyId: 'number.percent', mode: 'solo', seed: 5, sessionId: 'submitted-exam', position: 1 })
  work = await f.save(work, work.answersByPart, 'Исходное рассуждение без изменений')
  // A retired template must remain correctable without invoking today's builder.
  const instanceRow = f.db.prepare('SELECT id,data FROM exam_instances').get()
  const historical = JSON.parse(instanceRow.data)
  historical.templateId = 'retired-template'; historical.lesson.meaning = 'Сохранённое объяснение прежней версии'
  f.db.prepare('UPDATE exam_instances SET data=? WHERE id=?').run(JSON.stringify(historical), instanceRow.id)
  work = f.runtime.submitWork(f.store, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'submit-exam', examSessionId: 'submitted-exam' })
  f.runtime.setSessionPolicy((visitor, id) => id === work.id ? { sessionId: 'submitted-exam', status: 'submitted', deadlineAt: new Date().toISOString() } : null)
  const before = f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data
  const body = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'fork-correction' }
  await assert.rejects(f.call('correct', body, f.other), { status: 404 })
  f.runtime.setSessionGuard(() => true)
  await assert.rejects(f.call('correct', body), { status: 403 })
  f.runtime.setSessionGuard(() => false)
  await assert.rejects(f.call('correct', { ...body, expectedRevision: work.revision - 1 }), { status: 409 })
  let copy = (await f.call('correct', body)).work
  assert.notEqual(copy.id, work.id)
  assert.equal(copy.mode, 'guided')
  assert.equal(copy.completed, false)
  assert.equal(copy.modeEpoch, 0)
  assert.equal(copy.revision, 0)
  assert.equal(copy.exposure, true)
  assert.equal(copy.priorExposure, true)
  assert.equal(copy.sourceWorkId, work.id)
  assert.equal(copy.correctionOf, work.attempts.at(-1).id)
  assert.equal(copy.examSessionId, undefined)
  assert.equal(copy.practiceKind, 'themed')
  assert.deepEqual(copy.answersByPart, work.answersByPart)
  assert.equal(copy.reasoning, work.reasoning)
  assert.deepEqual(copy.attempts, [])
  assert.deepEqual(copy.evaluations, [])
  const copied = JSON.parse(f.db.prepare('SELECT i.data FROM exam_instances i JOIN exam_works w ON json_extract(w.data,\'$.instanceId\')=i.id WHERE w.id=?').get(copy.id).data)
  assert.deepEqual(copied, historical)
  assert.equal((await f.call('correct', body)).work.id, copy.id)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM exam_works').get().n, 2)
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM exam_instances').get().n, 2)
  const lesson = await f.call('learn', { workId: copy.id, expectedRevision: copy.revision, expectedModeEpoch: copy.modeEpoch, requestId: 'copied-frozen-lesson', action: 'open' })
  assert.equal(lesson.lesson.meaning, historical.lesson.meaning)
  copy = lesson.work
  copy = await f.save(copy, copy.answersByPart, 'Отдельное учебное исправление')
  copy = await f.mutate('submit', copy)
  assert.equal(copy.attempts.at(-1).independent, false)
  assert.equal(copy.attempts.at(-1).correctionOf, work.attempts.at(-1).id)
  assert.equal((await f.call('correct', body)).work.reasoning, copy.reasoning)
  assert.equal(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data, before)
  assert.equal(f.runtime.readWork(f.store, work.id).completed, true)
})

test('study correction creation rolls back instance, work, current pointer and receipt together', async t => {
  const f = fixture(t)
  let work = f.runtime.createWork(f.store, { familyId: 'number.percent', mode: 'solo', seed: 5, sessionId: 'submitted-exam', position: 1 })
  work = f.runtime.submitWork(f.store, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'submit-exam', examSessionId: 'submitted-exam' })
  f.runtime.setSessionPolicy((visitor, id) => id === work.id ? { status: 'submitted' } : null)
  const snapshot = () => ['exam_instances', 'exam_works', 'exam_current', 'exam_requests', 'exam_observations'].map(table => f.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  const before = snapshot()
  f.db.exec("CREATE TRIGGER fail_fork_receipt BEFORE INSERT ON exam_requests WHEN NEW.request_id='fork-rollback' BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END")
  await assert.rejects(f.call('correct', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'fork-rollback' }), /fixture receipt failure/)
  assert.deepEqual(snapshot(), before)
})

test('internal unchecked exam closure is owner/source bound and shrinks an entirely full profile', async t => {
  const store = new Store(':memory:'), visitor = store.forVisitor('11111111-1111-4111-8111-111111111111'), stranger = store.forVisitor('22222222-2222-4222-8222-222222222222'), runtime = createExamRuntime({ store })
  t.after(() => { runtime.close(); store.close() })
  const work = runtime.createWork(visitor, { familyId: 'number.percent', mode: 'solo', seed: 5, sessionId: 'source-exam', position: 1 })
  runtime.saveWork(visitor, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, answersByPart: work.answersByPart, reasoning: 'Моя незавершённая запись' })
  const read = () => store.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data
  const original = read(), before = JSON.parse(original)
  assert.throws(() => runtime.closeUnverifiedWork(stranger, { workId: work.id, sessionId: 'source-exam' }), { status: 404 })
  assert.throws(() => runtime.closeUnverifiedWork(visitor, { workId: work.id, sessionId: 'another-exam' }), { status: 409 })
  assert.equal(read(), original)
  const budget = visitor.profileBudget()
  visitor.setSetting('fixture-budget', 'x'.repeat(budget.limits.bytes + budget.limits.editReserveBytes - budget.bytes))
  assert.equal(visitor.profileBudget().bytes, budget.limits.bytes + budget.limits.editReserveBytes)
  assert.deepEqual(runtime.closeUnverifiedWork(visitor, { workId: work.id, sessionId: 'source-exam' }), { workId: work.id, completed: true })
  const closed = read(), after = JSON.parse(closed)
  assert.ok(Buffer.byteLength(closed) < Buffer.byteLength(original))
  assert.deepEqual({ ...after, completed: before.completed, updatedAt: before.updatedAt }, before)
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM exam_observations').get().n, 0)
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM exam_requests').get().n, 0)
  runtime.closeUnverifiedWork(visitor, { workId: work.id, sessionId: 'source-exam' })
  assert.equal(read(), closed)
  await assert.rejects(runtime.route('POST', '/api/exam/close-unverified', {}, visitor), { status: 404 })
})

for (const limit of ['count', 'bytes']) test(`study corrections obey the existing profile ${limit} creation quota without orphans`, async t => {
  const store = new Store(':memory:'), visitor = store.forVisitor('11111111-1111-4111-8111-111111111111'), runtime = createExamRuntime({ store })
  t.after(() => { runtime.close(); store.close() })
  let work = runtime.createWork(visitor, { familyId: 'number.percent', mode: 'solo', seed: 5, sessionId: 'submitted-exam', position: 1 })
  work = runtime.submitWork(visitor, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'submit-exam', examSessionId: 'submitted-exam' })
  runtime.setSessionPolicy((visitor, id) => id === work.id ? { status: 'submitted' } : null)
  if (limit === 'count') for (let i = 1; i < visitor.profileBudget().limits.works; i++) runtime.createWork(visitor, { familyId: 'number.percent', mode: 'guided', seed: i })
  else { const budget = visitor.profileBudget(); visitor.setSetting('fixture-budget', 'x'.repeat(budget.limits.bytes - budget.bytes - 1)) }
  const tables = ['exam_instances', 'exam_works', 'exam_current', 'exam_requests', 'exam_observations']
  const snapshot = () => tables.map(table => store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
  const before = snapshot()
  await assert.rejects(runtime.route('POST', '/api/exam/correct', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'quota-fork' }, visitor), { status: 429 })
  assert.deepEqual(snapshot(), before)
})

test('real tutor interface retains previous-context answer without changing the current draft', async t => {
  let resolveTutor, calls = 0, captured
  const f = fixture(t, { respond(input) { calls++; captured = input; return new Promise(resolve => { resolveTutor = resolve }) } })
  const work = await f.start({ mode: 'guided' })
  const body = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'chat-once', message: 'Почему так?', contexts: [] }
  const response = f.call('chat', body)
  assert.equal(calls, 1)
  assert.equal(captured.prompt.includes('"expected"'), false)
  assert.equal(captured.prompt.includes('"reference"'), false)
  const pending = f.runtime.readWork(f.store, work.id)
  const changed = await f.save(pending, pending.answersByPart, 'Новый черновик')
  resolveTutor('Содержательное объяснение')
  const stale = await response
  assert.equal(stale.work.reasoning, changed.reasoning)
  assert.equal(stale.work.messages.filter(message => message.role === 'assistant').length, 1)
  assert.equal(stale.message.contextStatus, 'previous')
  assert.equal(stale.message.inReplyTo, stale.work.messages[0].id)
  assert.deepEqual(stale.message.suggestions, [])
  assert.equal(stale.work.messages[0].status, 'answered')
  await f.call('chat', body)
  assert.equal(calls, 1)
})

test('AI outage preserves question and authored offline lesson, no automatic retry', async t => {
  let calls = 0
  const f = fixture(t, { async respond() { calls++; throw Error('offline') } })
  const work = await f.start({ mode: 'guided' })
  const body = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'offline-chat', message: 'Помоги' }
  const result = await f.call('chat', body)
  assert.equal(result.message.source, 'availability')
  assert.equal(result.work.messages[0].status, 'failed')
  await f.call('chat', body)
  assert.equal(calls, 1)
  const lesson = await f.call('learn', { workId: work.id, expectedRevision: result.work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'offline-lesson', action: 'open' })
  assert.ok(lesson.lesson.meaning)
})

test('history has bounded SQL cursor pagination', async t => {
  const f = fixture(t)
  for (let seed = 0; seed < 33; seed++) await f.start({ seed })
  const first = await f.call('state')
  assert.equal(first.works.length, 30)
  assert.ok(first.nextCursor)
  const second = await f.call('history', { before: first.nextCursor })
  assert.equal(second.works.length, 3)
  assert.equal(second.nextCursor, null)
  assert.equal(first.works.some(work => second.works.some(other => other.id === work.id)), false)
})

test('review permits discussion, requires explicit correction before edits, preserves evaluated core', async t => {
  const f = fixture(t)
  let work = await f.start()
  work = await f.save(work, answers(createInstance('number.percent', 71)), 'Исходная запись')
  work = await f.mutate('submit', work)
  assert.equal(work.mode, 'review')
  assert.equal(work.modeEpoch, 1)
  await assert.rejects(f.save(work, work.answersByPart), { status: 409 })
  const core = JSON.stringify(work.attempts[0])
  work = await f.mutate('correct', work)
  assert.equal(work.mode, 'guided')
  assert.equal(work.correctionOf, work.attempts[0].id)
  assert.equal(work.attempts.length, 1)
  work = await f.save(work, work.answersByPart, 'Моё исправление')
  work = await f.mutate('submit', work)
  assert.equal(JSON.stringify(work.attempts[0]), core)
  assert.equal(work.attempts[1].correctionOf, work.attempts[0].id)
  assert.equal(work.attempts[1].independent, false)
})

test('reconsideration appends a replacement and projects its current verdict without erasing the observation', async t => {
  let prompt
  const f = fixture(t, { async respond(packet) { prompt = JSON.parse(packet.prompt); return 'Обсудим сохранённый переход.' } })
  let work = await f.start()
  work = await f.save(work, answers(createInstance('number.percent', 71)))
  work = await f.mutate('submit', work)
  const attemptCore = JSON.stringify(work.attempts[0])
  // Fixture of a previously admitted erroneous checker result. Reconsideration must
  // preserve that historical record and supersede it rather than rewrite history.
  const row = f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id)
  const historical = JSON.parse(row.data)
  historical.evaluations[0].status = 'incorrect'
  f.db.prepare('UPDATE exam_works SET data=? WHERE id=?').run(JSON.stringify(historical), work.id)
  const originalObservation = f.db.prepare('SELECT data FROM exam_observations WHERE work_id=?').get(work.id).data
  assert.equal((await f.call('state')).route.learnerMemory.find(item => item.familyId === work.familyId).status, 'incorrect')
  const oldId = historical.evaluations[0].id
  work = await f.mutate('object', work, { attemptId: work.attempts[0].id, evaluationId: oldId, explanation: 'Ответ в снимке совпадает; проверь ещё раз.' })
  assert.equal(JSON.stringify(work.attempts[0]), attemptCore)
  assert.equal(work.evaluations.find(item => item.id === oldId).status, 'incorrect')
  assert.equal(work.evaluations.find(item => item.id === oldId).active, false)
  assert.equal(work.evaluations.find(item => item.supersedes === oldId).status, 'correct')
  const observation = (await f.call('state')).route.observations.find(item => item.attemptId === work.attempts[0].id)
  assert.equal(observation.status, 'correct')
  assert.deepEqual(observation.sourceEvaluationIds, [oldId])
  assert.deepEqual(observation.evaluationIds, [work.evaluations.find(item => item.supersedes === oldId).id])
  assert.equal(observation.provenance, 'current-saved-evaluations')
  assert.equal((await f.call('state')).route.learnerMemory.find(item => item.familyId === work.familyId).status, 'correct')
  await f.mutate('chat', work, { message: 'Какая проверка сейчас действует?' })
  assert.equal(prompt.learnerMemory.find(item => item.familyId === work.familyId).status, 'correct')
  assert.equal(f.db.prepare('SELECT data FROM exam_observations WHERE work_id=?').get(work.id).data, originalObservation)
})

test('historical unknown family remains readable but cannot be silently reassigned or edited', async t => {
  const f = fixture(t)
  const work = await f.start()
  const stored = JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data)
  stored.familyId = 'retired.family'
  f.db.prepare('UPDATE exam_works SET data=? WHERE id=?').run(JSON.stringify(stored), work.id)
  assert.equal((await f.call('open', { workId: work.id })).work.id, work.id)
  await assert.rejects(f.save(work, work.answersByPart), { status: 404 })
  await assert.rejects(f.mutate('finish', work), { status: 404 })
})

test('tutor recommendations and annotation markers are validated server-side', async t => {
  const f = fixture(t, { async respond() { return 'Посмотри эту связь [[annotation:1]] [[annotation:8]] [[family:number.percent]] [[family:unpublished.answer]]' } })
  const work = await f.start({ mode: 'guided' })
  const result = await f.call('chat', { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'suggestion', message: 'Объясни цитату', contexts: [{ quote: 'Моя запись', partId: work.instance.parts[0].id }] })
  assert.equal(result.message.suggestions.length, 1)
  assert.equal(result.message.suggestions[0].familyId, 'number.percent')
  assert.ok(result.message.text.includes('[[annotation:1]]'))
  assert.equal(result.message.text.includes('[[annotation:8]]'), false)
  assert.equal(result.message.text.includes('[[family:'), false)
})

test('route refusal has visitor-scoped cooldown and never changes mathematical observations', async t => {
  const f = fixture(t)
  const first = (await f.call('state')).route.recommendations[0].familyId
  const result = await f.call('route', { action: 'dismiss', familyId: first, requestId: 'dismiss' })
  assert.equal(result.route.recommendations.some(item => item.familyId === first), false)
  assert.equal((await f.call('state', {}, f.other)).route.recommendations[0].familyId, first)
  assert.equal(result.route.observations.length, 0)
})

test('advisory review and withdrawal use frozen steps without changing exact checks or attempt cores', async t => {
  let calls = 0, prompt
  const f = fixture(t, { async respond(input) {
    calls++; prompt = JSON.parse(input.prompt)
    if (calls === 2) return JSON.stringify({ status: 'withdrawn', message: 'Другой метод допустим; прежнее замечание было необоснованным.' })
    return JSON.stringify({ findings: [{ partId: prompt.submittedPartIds[0], quote: 'Первый шаг', claim: 'Основание перехода', verdict: 'needs-clarification', message: 'Уточни, почему этот переход сохраняет условие.', question: 'Какое условие ты использовал?' }] })
  } })
  let work = await f.start()
  work = await f.save(work, answers(createInstance('number.percent', 71)), 'Первый шаг: моя запись')
  work = await f.mutate('submit', work)
  const core = JSON.stringify(work.attempts), exact = JSON.stringify(work.evaluations)
  const request = { workId: work.id, attemptId: work.attempts[0].id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'review-once' }
  const result = await f.call('review', request)
  work = result.work
  assert.equal(result.review.status, 'complete')
  const finding = work.advisories.find(item => item.partId)
  assert.equal(finding.advisoryOnly, true)
  assert.equal(finding.active, true)
  assert.equal(finding.quote, 'Первый шаг')
  assert.equal(JSON.stringify(work.attempts), core)
  assert.equal(JSON.stringify(work.evaluations), exact)
  await f.call('review', request)
  assert.equal(calls, 1)
  work = await f.mutate('object', work, { advisoryId: finding.id, attemptId: work.attempts[0].id, explanation: 'Здесь можно применить другой метод.' })
  assert.equal(calls, 2)
  assert.equal(work.advisories.find(item => item.id === finding.id).active, false)
  assert.equal(work.advisories.find(item => item.id === finding.id).objections[0].status, 'withdrawn')
  assert.equal(JSON.stringify(work.attempts), core)
  assert.equal(JSON.stringify(work.evaluations), exact)
})

test('proof review sends only answered-part references; cannot assign mathematical success', async t => {
  let captured
  const f = fixture(t, { async respond(input) { captured = JSON.parse(input.prompt); return JSON.stringify({ findings: [] }) } })
  const family = families.find(item => item.templates.some(template => template.build(71).parts.some(part => part.check === 'proof')))
  let work = await f.start({ familyId: family.id })
  const privateInstance = createInstance(family.id, 71)
  const proofPart = privateInstance.parts.find(part => part.check === 'proof')
  const draft = Object.fromEntries(privateInstance.parts.map(part => [part.id, part.id === proofPart.id ? 'Моё обоснование' : '']))
  work = await f.save(work, draft, 'Использую равенство углов')
  work = await f.mutate('submit', work)
  const checked = structuredClone(work.evaluations)
  const result = await f.call('review', { workId: work.id, attemptId: work.attempts[0].id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'proof-review' })
  assert.deepEqual(captured.submittedPartIds, [proofPart.id])
  assert.ok(captured.allowedReferences.every(reference => reference.partId === proofPart.id))
  assert.equal(captured.task.parts.some(part => 'expected' in part), false)
  assert.deepEqual(result.work.evaluations, checked)
  assert.ok(result.work.evaluations.some(evaluation => evaluation.status === 'unknown'))
})

test('stale advisory result is retained as an unapplied request, never attached to the changed draft', async t => {
  let resolveTutor
  const f = fixture(t, { respond() { return new Promise(resolve => { resolveTutor = resolve }) } })
  let work = await f.start()
  work = await f.save(work, answers(createInstance('number.percent', 71)))
  work = await f.mutate('submit', work)
  const pending = f.call('review', { workId: work.id, attemptId: work.attempts[0].id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'stale-review' })
  await new Promise(resolve => setImmediate(resolve))
  work = f.runtime.readWork(f.store, work.id)
  work = await f.mutate('correct', work)
  work = await f.save(work, work.answersByPart, 'Изменённое рассуждение')
  resolveTutor(JSON.stringify({ findings: [] }))
  const result = await pending
  assert.equal(result.review.status, 'stale')
  assert.equal(result.work.reasoning, 'Изменённое рассуждение')
  assert.equal(result.work.advisories.some(item => item.partId), false)
})

test('owner-wide exam guard conceals old ordinary explanations and idempotent lesson/chat receipts', async t => {
  const f = fixture(t, { async respond() { return 'Сохранённое объяснение с ответом 12345' } })
  let work = await f.start({ mode: 'guided' })
  work = await f.save(work, answers(createInstance('number.percent', 71)))
  work = await f.mutate('submit', work)
  const chatRequest = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'old-explanation', message: 'Объясни' }
  work = (await f.call('chat', chatRequest)).work
  const lessonRequest = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'old-material', action: 'open' }
  work = (await f.call('learn', lessonRequest)).work
  assert.ok(work.messages.some(message => message.role === 'assistant'))
  assert.ok(work.learning.open)
  f.runtime.setSessionGuard(() => true)
  for (const visible of [(await f.call('open', { workId: work.id })).work, f.runtime.readPublicWork(f.store, work.id), (await f.call('state')).work]) {
    assert.deepEqual(visible.messages, [])
    assert.deepEqual(visible.evaluations, [])
    assert.deepEqual(visible.attempts, [])
    assert.deepEqual(visible.advisories, [])
    assert.equal(visible.learning, undefined)
    assert.equal(visible.learningResource, undefined)
    assert.equal(visible.familyId, undefined)
  }
  const lessonReplay = await f.call('learn', lessonRequest)
  assert.equal(lessonReplay.lesson, undefined)
  const chatReplay = await f.call('chat', chatRequest)
  assert.equal(chatReplay.message, undefined)
  assert.equal(JSON.stringify(chatReplay).includes('12345'), false)
  assert.ok(f.runtime.readWork(f.store, work.id).messages.some(message => message.role === 'assistant'))
})

test('focused geometry chat never injects the exact unsolved-neighbour example or probe oracle', async t => {
  const captured = []
  const f = fixture(t, { async respond(input) { captured.push(JSON.parse(input.prompt)); return 'Проекция определяется перпендикуляром.' } })
  let work = await f.start({ familyId: 'geom.solid.section-angle-distance', templateId: 'diagonal-plane-angle', seed: 0, mode: 'guided' })
  const request = () => ({ workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: `theory-${captured.length}`, message: 'Объясни только обоснование проекции', contexts: [{ partId: 'reason', quote: 'Проекция диагонали' }] })
  work = (await f.call('chat', request())).work
  assert.deepEqual(captured[0].task.parts.map(part => part.id), ['reason'])
  assert.equal(captured[0].resource.example, undefined)
  assert.equal(captured[0].resource.probe, undefined)
  assert.equal(JSON.stringify(captured[0]).includes('5/5=1'), false)
  assert.equal(captured[0].resourceExplicitlyOpened, false)
  work = await f.mutate('learn', work, { action: 'open' })
  work = (await f.call('chat', request())).work
  assert.equal(captured[1].resourceExplicitlyOpened, true)
  assert.equal(captured[1].resource.example, undefined)
  assert.equal(captured[1].resource.probe, undefined)
})

test('trusted mixed tasks hide the family until review and record actual method-selection provenance', async t => {
  const f = fixture(t)
  let work = f.runtime.createWork(f.store, { familyId: 'number.percent', mode: 'solo', seed: 12, blind: true, practiceKind: 'mixed', mixedId: 'mix-a', position: 1 })
  assert.equal(work.familyId, undefined)
  assert.equal(f.runtime.readWork(f.store, work.id).familyId, undefined)
  assert.equal((await f.call('state')).works[0].familyId, undefined)
  assert.equal((await f.call('history')).works[0].familyId, undefined)
  work = await f.save(work, answers(createInstance('number.percent', 12)))
  work = await f.mutate('submit', work)
  assert.equal(work.familyId, 'number.percent')
  assert.equal(work.attempts[0].practiceKind, 'mixed')
  assert.equal(work.attempts[0].methodSelectionOpportunity, true)
  const observed = (await f.call('state')).route.observations.find(item => item.workId === work.id)
  assert.equal(observed.practiceKind, 'mixed')
  assert.equal(observed.methodSelectionOpportunity, true)
  assert.equal(observed.methodSelectionConfirmed, false)
  assert.equal((await f.call('state')).works[0].familyId, 'number.percent')
  await assert.rejects(f.call('start', { familyId: 'number.percent', mode: 'solo', requestId: 'forged-mixed', blind: true, practiceKind: 'mixed' }), { status: 400 })
  assert.throws(() => f.runtime.createWork(f.store, { familyId: 'number.percent', mode: 'solo', blind: 'true', practiceKind: 'mixed' }), { status: 400 })
})

test('mixed skip is a distinct non-success observation even when a draft answer is present', async t => {
  const f = fixture(t)
  let work = f.runtime.createWork(f.store, { familyId: 'number.percent', mode: 'solo', seed: 99, blind: true, practiceKind: 'mixed', mixedId: 'mix-skip', position: 1 })
  work = await f.save(work, answers(createInstance('number.percent', 99)))
  work = f.runtime.submitWork(f.store, { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'skip-once', reason: 'mixed-skip' })
  const observation = (await f.call('state')).route.observations[0]
  assert.equal(work.attempts[0].reason, 'mixed-skip')
  assert.equal(observation.skipped, true)
  assert.equal(observation.status, 'unknown')
  assert.equal(observation.methodSelectionOpportunity, false)
})

test('startup recovers only SQL-selected pending records without replaying their provider calls', async t => {
  const f = fixture(t)
  const untouched = await f.start({ seed: 1 })
  const pendingWork = await f.start({ seed: 2 })
  const before = f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(untouched.id).data
  const stored = JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(pendingWork.id).data)
  stored.messages.push({ id: 'pending-msg', role: 'user', text: 'Вопрос', status: 'pending' })
  stored.advisories.push({ id: 'pending-review', status: 'pending' })
  stored.objections.push({ id: 'pending-object', status: 'pending' })
  f.db.prepare('UPDATE exam_works SET data=? WHERE id=?').run(JSON.stringify(stored), pendingWork.id)
  let calls = 0
  const restarted = createExamRuntime({ store: f.store, tutor: { async respond() { calls++; return 'Не должно вызываться' } } })
  t.after(() => restarted.close())
  assert.equal(calls, 0)
  assert.equal(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(untouched.id).data, before)
  const recovered = restarted.readWork(f.store, pendingWork.id)
  assert.equal(recovered.messages[0].status, 'failed')
  assert.equal(recovered.advisories[0].status, 'failed')
  const raw = JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(pendingWork.id).data)
  assert.equal(raw.objections[0].status, 'failed')
})

test('lesson metadata does not discard a reply to unchanged learner text', async t => {
  let resolveTutor
  const f = fixture(t, { respond() { return new Promise(resolve => { resolveTutor = resolve }) } })
  let work = await f.start({ mode: 'guided' })
  const response = f.mutate('chat', work, { message: 'Почему так?' })
  work = f.runtime.readWork(f.store, work.id)
  work = await f.mutate('learn', work, { action: 'open' })
  resolveTutor('Объяснение к той же записи')
  const done = await response
  assert.equal(done.messages.at(-1).contextStatus, undefined)
  assert.equal(done.messages.at(-1).text, 'Объяснение к той же записи')
  assert.equal(done.learning.open, true)
})

test('late chat during an exam policy returns no assistant or receipt extra', async t => {
  let resolveTutor, calls = 0
  const f = fixture(t, { respond() { calls++; return new Promise(resolve => { resolveTutor = resolve }) } })
  const work = await f.start({ mode: 'guided' })
  const body = { workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch, requestId: 'late-concealed', message: 'Почему?' }
  const pending = f.call('chat', body)
  f.runtime.setSessionPolicy(() => ({ status: 'active' }))
  resolveTutor('SECRET_LATE_EXPLANATION')
  const done = await pending
  assert.deepEqual(done.work.messages, [])
  assert.equal(done.message, undefined)
  assert.equal(JSON.stringify(done).includes('SECRET_LATE_EXPLANATION'), false)
  const replay = await f.call('chat', body)
  assert.deepEqual(replay.work.messages, [])
  assert.equal(replay.message, undefined)
  assert.equal(calls, 1)
})

test('frozen advisory survives lesson metadata without changing attempt or checks', async t => {
  let resolveTutor
  const f = fixture(t, { respond() { return new Promise(resolve => { resolveTutor = resolve }) } })
  let work = await f.start()
  work = await f.save(work, answers(createInstance('number.percent', 71)), 'Первый шаг')
  work = await f.mutate('submit', work)
  const frozen = JSON.stringify(work.attempts), checks = JSON.stringify(work.evaluations)
  const pending = f.call('review', {workId:work.id,attemptId:work.attempts[0].id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:'metadata-review'})
  await new Promise(setImmediate)
  work = f.runtime.readWork(f.store, work.id)
  await f.mutate('learn', work, {action:'open'})
  resolveTutor(JSON.stringify({findings:[]}))
  const done = await pending
  assert.equal(done.review.status,'complete')
  assert.equal(JSON.stringify(done.work.attempts),frozen)
  assert.equal(JSON.stringify(done.work.evaluations),checks)
  assert.equal(done.work.learning.open,true)
})

test('a different latest attempt invalidates pending advisory even without a metadata epoch change', async t => {
  let resolveTutor
  const f = fixture(t, { respond() { return new Promise(resolve => { resolveTutor = resolve }) } })
  let work = await f.start()
  work = await f.save(work, answers(createInstance('number.percent',71)))
  work = await f.mutate('submit',work)
  const pending = f.call('review',{workId:work.id,attemptId:work.attempts[0].id,expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:'new-attempt-review'})
  await new Promise(setImmediate)
  const row=JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data)
  row.attempts.push({...row.attempts[0],id:'replacement-fixture',digest:'new-digest'})
  f.db.prepare('UPDATE exam_works SET data=? WHERE id=?').run(JSON.stringify(row),work.id)
  resolveTutor(JSON.stringify({findings:[]}))
  const done=await pending
  assert.equal(done.review.status,'stale')
  assert.equal(done.work.advisories.some(item=>item.partId),false)
})

test('reconsideration cannot withdraw an advisory already retracted during provider wait', async t => {
  let resolveTutor, calls=0, prompt
  const f=fixture(t,{respond(input){calls++;prompt=JSON.parse(input.prompt);if(calls===1)return Promise.resolve(JSON.stringify({findings:[{partId:prompt.submittedPartIds[0],quote:'Первый шаг',claim:'Основание',verdict:'needs-clarification',message:'Обоснуй переход',question:'Почему?'}]}));return new Promise(resolve=>{resolveTutor=resolve})}})
  let work=await f.start()
  work=await f.save(work,answers(createInstance('number.percent',71)),'Первый шаг')
  work=await f.mutate('submit',work)
  work=await f.mutate('review',work,{attemptId:work.attempts[0].id})
  const finding=work.advisories.find(item=>item.partId)
  const pending=f.call('object',{workId:work.id,attemptId:work.attempts[0].id,advisoryId:finding.id,explanation:'Другой метод',expectedRevision:work.revision,expectedModeEpoch:work.modeEpoch,requestId:'withdraw-in-flight'})
  await new Promise(setImmediate)
  const row=JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data)
  row.retractions.push({advisoryId:finding.id,reason:'concurrent-fixture'})
  f.db.prepare('UPDATE exam_works SET data=? WHERE id=?').run(JSON.stringify(row),work.id)
  resolveTutor(JSON.stringify({status:'withdrawn',message:'Снять замечание'}))
  const done=await pending
  assert.equal(done.review.status,'stale')
  const stored=JSON.parse(f.db.prepare('SELECT data FROM exam_works WHERE id=?').get(work.id).data)
  assert.equal(stored.retractions.length,1)
})
