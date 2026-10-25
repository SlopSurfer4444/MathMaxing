import test from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'
import { loadServerConfig } from './config.mjs'
import { families, createInstance, publicInstance, coverageFor, checkPart } from './exam/registry.mjs'

const version = work => ({ workId: work.id, expectedRevision: work.revision, expectedModeEpoch: work.modeEpoch })
const id = () => crypto.randomUUID()
async function withApp(run) {
  const app = makeApp({ config: loadServerConfig({}), store: new Store(':memory:'), tutor: { status: async () => ({ connected: false, provider: 'test' }), respond: async () => { throw Error('test offline') }, close: async () => {} } })
  try { await run(app) } finally { await app.close() }
}
function assertNoKeys(value, keys) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) { assert.equal(keys.includes(key), false, `Private key ${key}`); assertNoKeys(child, keys) }
}
test('published runtime registry has real templates, complete position mapping and private projections', () => {
  assert.ok(families.length >= 30)
  for (const edition of ['2026', '2027']) assert.deepEqual(coverageFor(edition).filter(row => !row.familyIds.length), [])
  for (const family of families) {
    assert.ok(family.templates.length >= 2)
    for (const template of family.templates) {
      const instance = createInstance(family.id, 37, template.id)
      assert.deepEqual(instance, createInstance(family.id, 37, template.id))
      assertNoKeys(publicInstance(instance), ['expected', 'reference', 'lesson', 'seed', 'check'])
      const blind = publicInstance(instance, { concealMethod: true })
      assert.equal(blind.title, 'Задача'); assert.equal(blind.familyId, undefined)
      assert.equal(blind.id.includes(family.id), false)
    }
  }
  assert.throws(() => createInstance('unsupported', 0), /не опубликовано/)
  assert.equal(checkPart({ check: 'interval', expected: '[1;1] ∪ (3;+inf)' }, '{1} ∪ (3;∞)').status, 'correct')
  assert.equal(checkPart({ check: 'interval', expected: '(-inf;+inf)' }, 'ℝ').status, 'correct')
})
test('integrated legacy/new paths retain conditions, parts, revisions, correction and useful unknown', async () => withApp(async app => {
  const legacy = await app.route('GET', '/api/state', {})
  const oldDocument = structuredClone(legacy.work.document)
  const oldProblem = structuredClone(app.store.problem(legacy.work))
  let { work } = await app.route('POST', '/api/exam/start', { familyId: 'geom.plane.similarity', mode: 'solo', seed: 0, requestId: id() })
  assert.ok(work.instance.parts.length >= 3)
  const answersByPart = Object.fromEntries(work.instance.parts.map(part => [part.id, part.kind === 'text' ? 'Использую гомотетию с центром A.' : '1']))
  ;({ work } = await app.route('POST', '/api/exam/save', { ...version(work), answersByPart, reasoning: 'Длины изменяются в k раз, площади — в k² раз.' }))
  const savedRevision = work.revision
  ;({ work } = await app.route('POST', '/api/exam/submit', { ...version(work), requestId: id() }))
  assert.equal(work.mode, 'review')
  const attempt = structuredClone(work.attempts.at(-1))
  assert.equal(attempt.revision, savedRevision)
  assert.deepEqual(attempt.answersByPart, answersByPart)
  assert.ok(work.evaluations.some(evaluation => evaluation.status === 'unknown'))
  ;({ work } = await app.route('POST', '/api/exam/correct', { ...version(work), requestId: id() }))
  assert.equal(work.mode, 'guided')
  assert.deepEqual(work.attempts[0], attempt)
  ;({ work } = await app.route('POST', '/api/exam/finish', { ...version(work), requestId: id() }))
  assert.equal(work.completed, true)
  assert.deepEqual(app.store.get(legacy.work.id).document, oldDocument)
  assert.deepEqual(app.store.problem(legacy.work), oldProblem)
  assert.deepEqual((await app.route('GET', '/api/state', {})).work.id, legacy.work.id)
}))
test('HTTP factory routes isolate visitors and protect full variant across legacy help and profile export', async () => withApp(async app => {
  const first = app.store.forVisitor('11111111-1111-4111-8111-111111111111')
  const second = app.store.forVisitor('22222222-2222-4222-8222-222222222222')
  const prior = await app.route('POST', '/api/exam/start', { familyId: 'number.percent', mode: 'guided', requestId: id() }, first)
  const { session } = await app.route('POST', '/api/exam/session/start', { edition: '2026', requestId: id() }, first)
  assert.equal(session.tasks.length, 19)
  assertNoKeys(session.tasks, ['expected', 'reference', 'familyId', 'templateId', 'seed'])
  await assert.rejects(app.route('POST', '/api/profile/archive/export', {}, first), /вариант|самостоятельн/i)
  await assert.rejects(app.route('POST', '/api/chat/retry', { workId: 'unused' }, first), /Помощь недоступна/)
  await assert.rejects(app.route('POST', '/api/preparation/start', { workId: 'unused' }, first), /Помощь недоступна/)
  await assert.rejects(app.route('GET', '/api/state', {}, first), /Сначала заверши вариант/)
  await assert.rejects(app.route('POST', '/api/exam/open', { workId: prior.work.id }, second), /не найдена/)
  const revealed = await app.route('POST', '/api/exam/open', { workId: prior.work.id }, first)
  assert.equal(revealed.work.familyId, undefined)
  assert.deepEqual(revealed.work.messages, [])
  const { session: submitted } = await app.route('POST', '/api/exam/session/submit', { sessionId: session.id, expectedRevision: session.revision, expectedSessionEpoch: session.sessionEpoch, requestId: id(), workRevisions: session.tasks.map(task => ({ workId: task.workId, revision: task.work.revision, modeEpoch: task.work.modeEpoch })) }, first)
  assert.equal(submitted.status, 'submitted')
  assert.equal(submitted.score.verifiedPoints, 0)
  assert.equal(submitted.score.final, false)
}))
