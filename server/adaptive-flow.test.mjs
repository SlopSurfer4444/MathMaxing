import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'
import { percentageProblems } from './percentages.mjs'

const version = work => ({ expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch })
const notebook = text => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'student-block' }, content: [{ type: 'text', text }] }] })
const explanation = { text: 'Второе изменение считают от суммы после первого.', kind: 'explanation', resource: 'foundation' }
const answer = value => ({ text: JSON.stringify(value), runId: 'stub-only' })
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fixture(respond = () => answer(explanation)) {
  const packets = [], signals = [], store = new Store(':memory:')
  const app = makeApp({ store, tutor: { status: async () => ({ connected: true }), respond: async args => {
    const packet = JSON.parse(args.prompt); packets.push(packet); signals.push(args.signal)
    return respond(args, packet, packets.length)
  }, close() {} } })
  return { ...app, packets, signals }
}
const create = async (app, mode = 'guided', id = 'percent-discount-v1', scoped) =>
  (await app.route('POST', '/api/work/new', { packageId: 'percentages', taskId: id, mode }, scoped)).work
const assist = (app, work, body = {}, scoped) => app.route('POST', '/api/assistance', { workId: work.id, ...version(work), intent: 'ask', ...body }, scoped)
const save = async (app, work, text, finalAnswer = work.finalAnswer) => (await app.route('POST', '/api/work/save', {
  workId: work.id, expectedRevision: work.revision, document: notebook(text), finalAnswer,
})).work

test('assistance enforces solo, exact revision/epoch and current-work before calling the tutor', async () => {
  const app = fixture()
  try {
    const solo = await create(app, 'solo')
    await assert.rejects(assist(app, solo), { status: 403 })
    const guided = await create(app)
    await assert.rejects(assist(app, guided, { expectedRevision: guided.revision + 1 }), { status: 409 })
    await assert.rejects(assist(app, guided, { expectedModeEpoch: guided.modeEpoch + 1 }), { status: 409 })
    for (const field of ['expectedRevision', 'expectedModeEpoch']) await assert.rejects(assist(app, guided, { [field]: undefined }), { status: 400 })
    await create(app)
    await assert.rejects(assist(app, guided), { status: 409 })
    assert.equal(app.packets.length, 0)
    assert.equal(app.store.get(solo.id).numericHelpSeen, undefined)
    assert.equal(app.store.get(guided.id).assistance, undefined)
  } finally { await app.close() }
})

test('adaptive help respects an active trigonometric preparation and offers only its published exercise IDs', async () => {
  const app = fixture(() => answer({ text: 'Можно отдельно разобрать отбор.', kind: 'comment', exerciseId: 'root-selection' }))
  try {
    const work = app.store.current()
    const prepared = (await app.route('POST', '/api/preparation/start', { workId: work.id, exerciseId: 'root-selection' })).work
    await assert.rejects(assist(app, prepared), { status: 409 })
    assert.equal(app.packets.length, 0)
    const returned = (await app.route('POST', '/api/preparation/return', {
      workId: work.id, preparationId: prepared.preparation.id, expectedRevision: prepared.preparation.revision,
    })).work
    const helped = await assist(app, returned)
    assert.equal(helped.guidance.exerciseId, 'root-selection')
    assert.ok(app.packets[0].exercises.some(exercise => exercise.id === 'root-selection'))
    assert.equal(helped.work.preparation.completed, true)
    assert.equal(helped.work.numericHelpSeen, undefined)
  } finally { await app.close() }
})

test('explicit help transition freezes the solo attempt before adaptive help and later edits', async () => {
  const app = fixture()
  try {
    const solo = await save(app, await create(app, 'solo'), 'Моя самостоятельная запись: 1500 − 200', '1300')
    const modeRequest = { workId: solo.id, ...version(solo), mode: 'guided', requestId: 'explicit-help' }
    const opened = (await app.route('POST', '/api/work/mode', modeRequest)).work
    const frozen = structuredClone(opened.submissions[0])
    assert.equal(frozen.reason, 'help_requested')
    assert.equal(frozen.mode, 'solo')
    assert.equal(frozen.finalAnswer, '1300')
    assert.deepEqual(frozen.document, solo.document)
    assert.equal(frozen.attemptContext.numericHelpSeen, false)
    assert.equal(frozen.result.status, 'unknown')
    assert.equal(app.packets.length, 0)
    const helped = await assist(app, opened)
    assert.equal(helped.work.numericHelpSeen, true)
    assert.deepEqual(helped.work.submissions[0], frozen)
    const edited = await save(app, helped.work, 'После обсуждения исправляю запись', '1200')
    const replay = await app.route('POST', '/api/work/mode', modeRequest)
    assert.equal(replay.work.finalAnswer, edited.finalAnswer)
    assert.equal(replay.work.submissions.length, 1)
    assert.deepEqual(replay.work.submissions[0], frozen)
    assert.equal(app.store.memory().length, 1)
  } finally { await app.close() }
})

test('question and free-language follow-up use persisted server guidance and cache recommendations', async () => {
  const question = { text: 'Уточню базу второго изменения.', kind: 'question', question: { prompt: 'От какой суммы считаешь второй процент?', choices: [
    { id: 'initial', label: 'От первоначальной' }, { id: 'new', label: 'От новой' }, { id: 'unsure', label: 'Не знаю' },
  ] } }
  const app = fixture((_args, packet, count) => answer(count === 1 ? question : { ...explanation, resource: 'example' }))
  try {
    const work = await create(app, 'guided', 'percent-successive-v1')
    const first = await assist(app, work, { intent: 'recommend' })
    assert.equal(first.guidance.kind, 'question')
    assert.deepEqual(app.store.get(work.id).assistance.guidance, first.guidance)
    assert.equal(typeof first.guidance.id, 'string')
    const cached = await assist(app, work, { intent: 'recommend' })
    assert.deepEqual(cached.guidance, first.guidance)
    assert.equal(app.packets.length, 1)
    await assert.rejects(assist(app, work, { intent: 'different' }), { status: 409 })
    await assert.rejects(assist(app, work, { reply: 'От первой цены' }), { status: 409 })
    await assert.rejects(assist(app, work, { basedOn: 'forged', reply: 'Не знаю' }), { status: 409 })
    const reply = 'Не знаю. Я сначала сложил проценты, а потом вернул исходную цену.'
    const second = await assist(app, work, { basedOn: first.guidance.id, intent: 'different', reply,
      previous: { text: 'FORGED CLIENT GUIDANCE', kind: 'explanation' } })
    assert.equal(app.packets.length, 2)
    assert.equal(app.packets[1].reply, reply)
    assert.equal(app.packets[1].intent, 'different')
    assert.deepEqual(app.packets[1].previous.question, question.question)
    assert.equal(app.packets[1].previous.text, question.text)
    assert.ok(!JSON.stringify(app.packets[1]).includes('FORGED CLIENT GUIDANCE'))
    assert.notEqual(second.guidance.id, first.guidance.id)
    assert.equal(app.store.get(work.id).assistanceHistory.at(-1).reply, reply)
    const changed = await save(app, second.work, 'Меняю расчёт')
    await assert.rejects(assist(app, changed, { basedOn: second.guidance.id, reply: 'Теперь понял' }), { status: 409 })
    assert.equal(app.packets.length, 2)
  } finally { await app.close() }
})

test('route prompt uses frozen public task and curated example without current/check answer keys', async () => {
  const app = fixture()
  try {
    const work = await create(app)
    const frozen = app.store.problem(work)
    frozen.answer = 'PRIVATE_TASK_ANSWER'; frozen.solution = 'PRIVATE_TASK_SOLUTION'
    frozen.help.check.answer = 'PRIVATE_CHECK_ANSWER'; frozen.help.check.feedback = 'PRIVATE_CHECK_FEEDBACK'
    frozen.help.title = 'Замороженная опора этой попытки'
    app.store.setSetting(`problem-instance:${work.id}`, JSON.stringify(frozen))
    await assist(app, work)
    const packet = app.packets[0], text = JSON.stringify(packet)
    for (const hidden of ['PRIVATE_TASK_ANSWER', 'PRIVATE_TASK_SOLUTION', 'PRIVATE_CHECK_ANSWER', 'PRIVATE_CHECK_FEEDBACK']) assert.ok(!text.includes(hidden), hidden)
    assert.equal(packet.task.prompt, frozen.prompt)
    assert.equal(packet.help.title, frozen.help.title)
    assert.equal(packet.help.example.answer, frozen.help.example.answer)
    assert.deepEqual(packet.exercises, [])
    assert.deepEqual(packet.availableResources, ['foundation', 'example'])
    assert.equal(packet.help.check.answer, undefined)
  } finally { await app.close() }
})

test('unavailable resources and invented scalar exercises fail without accepting help', async () => {
  for (const suggestion of [
    { text: 'Открой базу.', kind: 'comment', resource: 'foundation' },
    { text: 'Открой пример.', kind: 'comment', resource: 'example' },
  ]) {
    const app = fixture(() => answer(suggestion))
    try {
      const work = app.store.current() // Trigonometry has exercises, no scalar help resource.
      await assert.rejects(assist(app, work), { status: 502 })
      assert.equal(app.store.get(work.id).assistance, undefined)
      assert.equal(app.store.get(work.id).assistanceHistory, undefined)
    } finally { await app.close() }
  }
  const app = fixture(() => answer({ text: 'Упражнение.', kind: 'comment', exerciseId: 'root-selection' }))
  try {
    const work = await create(app)
    await assert.rejects(assist(app, work), { status: 502 })
    assert.equal(app.store.get(work.id).numericHelpSeen, undefined)
  } finally { await app.close() }
})

test('failed provider and malformed replies create neither fabricated assistance nor exposure', async () => {
  for (const respond of [() => { throw new Error('Provider is offline') }, () => ({ text: 'not structured help' }), () => answer({ text: 'Произвольный экран', kind: 'comment', action: 'navigate' })]) {
    const app = fixture(respond)
    try {
      const work = await create(app)
      await assert.rejects(assist(app, work), { status: 502 })
      const persisted = app.store.get(work.id)
      assert.equal(persisted.assistance, undefined)
      assert.equal(persisted.assistanceHistory, undefined)
      assert.equal(persisted.numericHelpSeen, undefined)
      assert.deepEqual(persisted.messages, [])
      assert.equal(persisted.revision, work.revision)
    } finally { await app.close() }
  }
})

test('a failed follow-up preserves the last accepted guidance and history', async () => {
  const app = fixture((_args, _packet, count) => { if (count === 1) return answer(explanation); throw Error('Disconnected') })
  try {
    const work = await create(app)
    const first = await assist(app, work)
    const before = app.store.get(work.id)
    await assert.rejects(assist(app, first.work, { intent: 'different', basedOn: first.guidance.id }), { status: 502 })
    assert.deepEqual(app.store.get(work.id), before)
  } finally { await app.close() }
})

test('late tutor replies after notebook edits, mode epochs or current-work switches are never accepted', async t => {
  for (const change of ['edit', 'mode', 'switch']) await t.test(change, async () => {
    const started = deferred(), finish = deferred()
    const app = fixture(() => { started.resolve(); return finish.promise })
    try {
      const work = await create(app)
      const pending = assist(app, work)
      const rejected = assert.rejects(pending, { status: 409 })
      await started.promise
      await assert.rejects(assist(app, work), { status: 409 })
      if (change === 'edit') await save(app, work, 'Новая запись во время ответа', '1300')
      if (change === 'mode') await app.route('POST', '/api/work/mode', { workId: work.id, ...version(work), mode: 'guided', requestId: 'new-epoch' })
      if (change === 'switch') await create(app)
      assert.equal(app.signals[0].aborted, true)
      finish.resolve(answer(explanation))
      await rejected
      const oldWork = app.store.get(work.id)
      assert.equal(oldWork.assistance, undefined)
      assert.equal(oldWork.numericHelpSeen, undefined)
      assert.equal(oldWork.assistanceHistory, undefined)
    } finally { finish.resolve(answer(explanation)); await app.close() }
  })
})

test('late assistance and basedOn are isolated between visitors sharing one database', async () => {
  const started = deferred(), finish = deferred()
  const app = fixture((_args, packet) => { if (packet.task.id === 'percent-discount-v1') { started.resolve(); return finish.promise } return answer(explanation) })
  const firstStore = app.store.forVisitor(crypto.randomUUID()), secondStore = app.store.forVisitor(crypto.randomUUID())
  let pending
  try {
    const first = await create(app, 'guided', 'percent-discount-v1', firstStore)
    const second = await create(app, 'guided', 'percent-successive-v1', secondStore)
    pending = assist(app, first, {}, firstStore)
    await started.promise
    await assert.rejects(assist(app, first, {}, secondStore), { status: 404 })
    const secondHelp = await assist(app, second, {}, secondStore)
    assert.equal(firstStore.get(first.id).assistance, undefined)
    assert.equal(secondStore.get(second.id).assistance.guidance.id, secondHelp.guidance.id)
    finish.resolve(answer(explanation))
    const firstHelp = await pending
    assert.equal(firstHelp.workId, first.id)
    assert.notEqual(firstHelp.guidance.id, secondHelp.guidance.id)
    assert.equal(firstStore.get(first.id).assistanceHistory.length, 1)
    assert.equal(secondStore.get(second.id).assistanceHistory.length, 1)
    await assert.rejects(assist(app, firstHelp.work, { basedOn: secondHelp.guidance.id, reply: 'Не знаю' }, firstStore), { status: 409 })
    const state = await app.route('GET', '/api/state', undefined, secondStore)
    assert.ok(state.works.every(work => work.id !== first.id))
    assert.equal(app.packets.length, 2)
  } finally { finish.resolve(answer(explanation)); if (pending) await Promise.allSettled([pending]); await app.close() }
})

test('similar next creates a fresh frozen solo task at the same percentage skill and keeps public answers hidden', async () => {
  const app = fixture()
  try {
    for (const [sourceId, family] of [['percent-discount-v1', 'discount'], ['percent-successive-v1', 'successive']]) {
      const source = await save(app, await create(app, 'guided', sourceId), 'Сохранённая попытка', '123')
      await assist(app, source)
      const before = app.store.get(source.id), sourceProblem = app.store.problem(source)
      await assert.rejects(app.route('POST', '/api/work/next', { workId: source.id, similar: true, ...version(source), expectedRevision: source.revision + 1 }), { status: 409 })
      await assert.rejects(app.route('POST', '/api/work/next', { workId: source.id, similar: true, ...version(source), expectedModeEpoch: source.modeEpoch + 1 }), { status: 409 })
      const next = (await app.route('POST', '/api/work/next', { workId: source.id, similar: true, ...version(source) })).work
      assert.equal(next.mode, 'solo')
      assert.notEqual(next.id, source.id)
      assert.notEqual(next.problemId, source.problemId)
      assert.equal(next.numericHelpSeen, undefined)
      assert.equal(next.finalAnswer, '')
      const frozen = app.store.problem(next)
      assert.equal(frozen.percentageFamily, family)
      assert.deepEqual(frozen.skills, sourceProblem.skills)
      assert.notEqual(frozen.prompt, sourceProblem.prompt)
      assert.equal(app.store.setting(`problem-instance:${next.id}`), JSON.stringify(frozen))
      assert.deepEqual(app.store.get(source.id), before)
      const state = await app.route('GET', '/api/state')
      const publicNext = state.problems.find(problem => problem.id === next.problemId)
      assert.ok(publicNext)
      for (const key of ['answer', 'solution', 'help', 'generation']) assert.equal(publicNext[key], undefined)
      await assert.rejects(assist(app, next), { status: 403 })
      const later = (await app.route('POST', '/api/work/next', { workId: next.id, similar: true, ...version(next) })).work
      assert.equal(app.store.problem(later).percentageFamily, family)
      assert.notEqual(app.store.problem(later).prompt, frozen.prompt)
    }
  } finally { await app.close() }
})

test('similar next rejects unsupported frozen percentage families without changing the current work', async () => {
  const app = fixture()
  try {
    const retired = { ...structuredClone(percentageProblems[0]), id: 'retired-unsupported-percentage-family' }
    const work = app.store.create(retired.id, 'guided', retired)
    const before = app.store.get(work.id)
    await assert.rejects(app.route('POST', '/api/work/next', { workId: work.id, similar: true, ...version(work) }), { status: 409 })
    assert.deepEqual(app.store.get(work.id), before)
    assert.equal(app.store.current().id, work.id)
  } finally { await app.close() }
})
