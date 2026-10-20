import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeApp } from './index.mjs'
import { loadServerConfig } from './config.mjs'
import { Store } from './store.mjs'
import { learningEpisodes } from '../src/learning-content.ts'

const origin = 'https://pole.test'
const notebook = text => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function fixture(overrides = {}, respondImpl) {
  const directory = await mkdtemp(join(tmpdir(), 'pole-visitors-'))
  const config = { ...loadServerConfig({ POLE_MODE: 'hosted', POLE_TUTOR_PROVIDER: 'openai', POLE_ALLOWED_ORIGINS: origin, POLE_DB_PATH: join(directory, 'state.sqlite'), OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'test-model' }), ...overrides }
  let app, base
  const packets = []
  const start = async () => {
    app = makeApp({ config, tutor: { status: async () => ({ connected: true, provider: 'test' }), respond: async args => { const packet = JSON.parse(args.prompt); packets.push(packet); return respondImpl ? respondImpl(args, packet) : { text: `Ответ: ${packet.question ?? 'разбор'}`, runId: 'test-response' } }, close() {} } })
    app.server.listen(0, '127.0.0.1')
    await once(app.server, 'listening')
    base = `http://127.0.0.1:${app.server.address().port}`
  }
  const stop = async () => {
    if (!app) return
    const current = app; app = null
    const stopped = once(current.server, 'close')
    await current.close()
    await stopped
  }
  try { await start() } catch (error) { await stop(); await rm(directory, { recursive: true, force: true }); throw error }
  return {
    config, packets,
    async request(path, { visitor, body, headers = {}, method = body === undefined ? 'GET' : 'POST' } = {}) {
      const response = await fetch(`${base}${path}`, { method, headers: { origin, 'x-pole-client': 'notebook-v1', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(visitor ? { cookie: visitor.cookie, 'x-pole-session': visitor.id } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return { status: response.status, headers: response.headers, data: await response.json() }
    },
    async restart() { await stop(); await start() },
    async close() { await stop(); await rm(directory, { recursive: true, force: true }) },
  }
}

async function visitor(f) {
  const result = await f.request('/api/session')
  assert.equal(result.status, 200, JSON.stringify(result.data))
  assert.equal(typeof result.data.id, 'string')
  assert.ok(result.data.id.length >= 16)
  assert.equal(result.data.persistent, true)
  const cookie = result.headers.get('set-cookie')
  assert.match(cookie, /^__Host-pole-visitor=[^;]+/)
  assert.match(cookie, /;\s*HttpOnly(?:;|$)/i)
  assert.match(cookie, /;\s*Secure(?:;|$)/i)
  assert.match(cookie, /;\s*Path=\/(?:;|$)/i)
  assert.match(cookie, /;\s*SameSite=(?:Lax|Strict)(?:;|$)/i)
  assert.doesNotMatch(cookie, /;\s*Domain=/i)
  assert.notEqual(cookie.split(';')[0].split('=')[1], result.data.id)
  assert.equal(result.headers.get('www-authenticate'), null)
  return { id: result.data.id, cookie: cookie.split(';')[0], session: result.data }
}

async function ok(f, path, options) {
  const result = await f.request(path, options)
  assert.equal(result.status, 200, `${path}: ${JSON.stringify(result.data)}`)
  return result.data
}

test('hosted bootstrap creates private cookie identities without Basic auth and ordinary API calls never allocate visitors', async () => {
  const f = await fixture({ maxVisitors: 1 })
  try {
    for (const path of ['/api/state', '/api/status', '/api/learning']) {
      const denied = await f.request(path)
      assert.equal(denied.status, 409, path)
      assert.equal(denied.headers.get('set-cookie'), null)
    }
    const denied = await f.request('/api/work/new', { body: { problemId: 'double-angle-sin', mode: 'guided' } })
    assert.equal(denied.status, 409)
    const first = await visitor(f)
    const restored = await ok(f, '/api/session', { visitor: first })
    assert.deepEqual(restored, first.session)
    assert.deepEqual((await ok(f, '/api/state', { visitor: first })).session, first.session)
    const excess = await f.request('/api/session')
    assert.ok(excess.status >= 400, `visitor cap accepted extra visitor: ${excess.status}`)
    assert.equal(excess.headers.get('set-cookie'), null)
    assert.deepEqual(await ok(f, '/api/session', { visitor: first }), first.session)
    await f.restart()
    assert.deepEqual(await ok(f, '/api/session', { visitor: first }), first.session)
    assert.ok((await f.request('/api/session')).status >= 400)
  } finally { await f.close() }
})

test('session header binds the active cookie and rejects old tabs before reads or writes', async () => {
  const f = await fixture()
  try {
    const a = await visitor(f), b = await visitor(f)
    assert.notEqual(a.id, b.id)
    assert.notEqual(a.cookie, b.cookie)
    const beforeA = await ok(f, '/api/state', { visitor: a }), beforeB = await ok(f, '/api/state', { visitor: b })
    const headers = [
      { cookie: a.cookie, 'x-pole-session': '' },
      { cookie: '', 'x-pole-session': a.id },
      { cookie: b.cookie, 'x-pole-session': a.id },
      { cookie: a.cookie, 'x-pole-session': b.id },
      { cookie: `${a.cookie}; ${b.cookie}`, 'x-pole-session': a.id },
      { cookie: '__Host-pole-visitor=forged-unrecognized-cookie', 'x-pole-session': a.id },
    ]
    for (const identity of headers) {
      for (const path of ['/api/state', '/api/status', '/api/learning']) assert.equal((await f.request(path, { headers: identity })).status, 409, `${path}: ${JSON.stringify(identity)}`)
      assert.equal((await f.request('/api/work/save', { headers: identity, body: { workId: beforeA.work.id, expectedRevision: 0, document: notebook('old tab must not save'), finalAnswer: 'π' } })).status, 409)
      assert.equal((await f.request('/api/work/new', { headers: identity, body: { problemId: 'double-angle-sin', mode: 'guided' } })).status, 409)
    }
    assert.deepEqual(await ok(f, '/api/state', { visitor: a }), beforeA)
    assert.deepEqual(await ok(f, '/api/state', { visitor: b }), beforeB)
    assert.equal(f.packets.length, 0)
  } finally { await f.close() }
})

test('two hosted visitors keep notebooks, current work, chat, learning, memory and generated catalogues private across restart', async () => {
  const f = await fixture()
  try {
    const a = await visitor(f), b = await visitor(f)
    const originalA = await ok(f, '/api/state', { visitor: a }), originalB = await ok(f, '/api/state', { visitor: b })
    assert.notEqual(originalA.work.id, originalB.work.id)
    assert.deepEqual(originalA.works.map(work => work.id), [originalA.work.id])
    assert.deepEqual(originalB.works.map(work => work.id), [originalB.work.id])
    const work = originalA.work
    await ok(f, '/api/work/save', { visitor: a, body: { workId: work.id, expectedRevision: 0, document: notebook('Приватное решение A'), finalAnswer: 'π/3' } })
    await ok(f, '/api/chat', { visitor: a, body: { workId: work.id, requestId: 'shared-request-id', message: 'Приватный вопрос A', contexts: [] } })
    const prep = (await ok(f, '/api/preparation/start', { visitor: a, body: { workId: work.id, exerciseId: 'root-selection', harder: true } })).work.preparation
    assert.match(prep.exerciseId, /^selection-v1-/)
    await ok(f, '/api/preparation/draft', { visitor: a, body: { workId: work.id, preparationId: prep.id, answer: 'Приватный черновик A' } })
    await ok(f, '/api/learning', { visitor: a, body: { workId: work.id, expectedRevision: 0, entry: 'explain', view: 'episode', episodeId: 'K1', progress: { K1: { step: 1, answers: { private: 'Ответ A' } } } } })
    const check = learningEpisodes.find(episode => episode.id === 'K1').checks[0]
    await ok(f, '/api/learning/answer', { visitor: a, body: { workId: work.id, episodeId: 'K1', checkId: check.id, answer: check.answer } })
    const privateState = await ok(f, '/api/state', { visitor: a })
    assert.equal(privateState.work.preparation.answer, 'Приватный черновик A')
    assert.ok(privateState.exercises.some(exercise => exercise.id === prep.exerciseId))
    assert.deepEqual(await ok(f, '/api/state', { visitor: b }), originalB)
    const learningB = await ok(f, '/api/learning', { visitor: b })
    assert.equal(learningB.session.revision, 0)
    assert.deepEqual(learningB.session.progress, {})
    assert.deepEqual(learningB.evidence, [])
    await f.restart()
    assert.deepEqual(await ok(f, '/api/session', { visitor: a }), a.session)
    assert.deepEqual(await ok(f, '/api/session', { visitor: b }), b.session)
    assert.deepEqual(await ok(f, '/api/state', { visitor: a }), privateState)
    assert.deepEqual(await ok(f, '/api/state', { visitor: b }), originalB)
    await ok(f, '/api/preparation/return', { visitor: a, body: { workId: work.id, preparationId: prep.id } })
    const submitted = await ok(f, '/api/submit', { visitor: a, body: { workId: work.id, requestId: 'private-submission' } })
    assert.equal(submitted.memory.length, 1)
    await ok(f, '/api/work/new', { visitor: a, body: { problemId: 'double-angle-sin', mode: 'guided' } })
    const afterNew = await ok(f, '/api/state', { visitor: a })
    assert.notEqual(afterNew.work.id, work.id)
    assert.equal(afterNew.works.length, 2)
    await ok(f, '/api/work/open', { visitor: a, body: { workId: work.id } })
    assert.equal((await ok(f, '/api/state', { visitor: a })).work.id, work.id)
    assert.deepEqual(await ok(f, '/api/state', { visitor: b }), originalB)
    assert.deepEqual(await ok(f, '/api/learning', { visitor: b }), learningB)
    await ok(f, '/api/chat', { visitor: b, body: { workId: originalB.work.id, requestId: 'shared-request-id', message: 'Вопрос B', contexts: [] } })
    assert.equal(f.packets.at(-1).question, 'Вопрос B')
    assert.deepEqual(f.packets.at(-1).memory, [])
    assert.deepEqual(f.packets.at(-1).history, [])
    assert.deepEqual(f.packets.at(-1).learning.progress, {})
    assert.doesNotMatch(JSON.stringify(f.packets.at(-1)), /Приватн|Ответ A/)
  } finally { await f.close() }
})

test('foreign work IDs fail on every work route without touching either visitor or calling tutor', async () => {
  const f = await fixture()
  try {
    const owner = await visitor(f), intruder = await visitor(f)
    const owned = await ok(f, '/api/state', { visitor: owner }), other = await ok(f, '/api/state', { visitor: intruder })
    const body = { workId: owned.work.id, expectedRevision: 0, document: notebook('foreign overwrite'), finalAnswer: '0', generalAnswer: '0', mode: 'guided', exerciseId: 'sine-basics', preparationId: 'foreign-preparation', answer: 'half', episodeId: 'K1', checkId: 'foreign-check', message: 'foreign question', contexts: [], requestId: 'foreign-request', submissionId: 'foreign-submission' }
    for (const path of ['/api/work/open', '/api/work/save', '/api/work/mode', '/api/work/next', '/api/guidance', '/api/chat', '/api/chat/retry', '/api/preparation/start', '/api/preparation/draft', '/api/preparation/answer', '/api/preparation/return', '/api/learning/answer', '/api/learning/diagnostic', '/api/series/check', '/api/submit', '/api/submit/lookup', '/api/submit/review']) {
      const result = await f.request(path, { visitor: intruder, body })
      assert.equal(result.status, 404, `${path}: ${JSON.stringify(result.data)}`)
      assert.doesNotMatch(JSON.stringify(result.data), /foreign overwrite|foreign question/)
    }
    assert.equal((await f.request('/api/learning', { visitor: intruder, body: { workId: owned.work.id, expectedRevision: 0, view: 'home' } })).status, 409)
    assert.deepEqual(await ok(f, '/api/state', { visitor: owner }), owned)
    assert.deepEqual(await ok(f, '/api/state', { visitor: intruder }), other)
    assert.deepEqual((await ok(f, '/api/learning', { visitor: owner })).evidence, [])
    assert.deepEqual((await ok(f, '/api/learning', { visitor: intruder })).evidence, [])
    assert.equal(f.packets.length, 0)
  } finally { await f.close() }
})

test('switching another visitor current work does not cancel a pending private chat', async () => {
  let finish, begin, signal
  const started = new Promise(resolve => { begin = resolve })
  const f = await fixture({}, (args, packet) => {
    if (packet.question === 'Отложенный вопрос A') {
      signal = args.signal; begin()
      return new Promise(resolve => { finish = resolve })
    }
    return { text: 'Ответ B', runId: 'response-b' }
  })
  try {
    const a = await visitor(f), b = await visitor(f)
    const workA = (await ok(f, '/api/state', { visitor: a })).work
    await ok(f, '/api/state', { visitor: b })
    const pending = f.request('/api/chat', { visitor: a, body: { workId: workA.id, requestId: 'same-id', message: 'Отложенный вопрос A' } })
    await started
    const workB = (await ok(f, '/api/work/new', { visitor: b, body: { problemId: 'double-angle-sin', mode: 'guided' } })).work
    const replyB = await ok(f, '/api/chat', { visitor: b, body: { workId: workB.id, requestId: 'same-id', message: 'Вопрос B' } })
    assert.equal(replyB.reply, 'Ответ B')
    assert.equal(signal.aborted, false)
    finish({ text: 'Приватный отложенный ответ A', runId: 'response-a' })
    const replyA = await pending
    assert.equal(replyA.status, 200)
    assert.equal(replyA.data.reply, 'Приватный отложенный ответ A')
    const stateA = await ok(f, '/api/state', { visitor: a }), stateB = await ok(f, '/api/state', { visitor: b })
    assert.equal(stateA.work.id, workA.id)
    assert.equal(stateB.work.id, workB.id)
    assert.deepEqual(stateA.work.messages.map(message => message.text), ['Отложенный вопрос A', 'Приватный отложенный ответ A'])
    assert.deepEqual(stateB.work.messages.map(message => message.text), ['Вопрос B', 'Ответ B'])
  } finally { finish?.({ text: 'cleanup' }); await f.close() }
})

test('interleaved background reviews write back only into their original visitor scope', async () => {
  const replies = new Map()
  const f = await fixture({}, (_args, packet) => new Promise(resolve => { replies.set(packet.submission.id, resolve) }))
  try {
    const a = await visitor(f), b = await visitor(f)
    const workA = (await ok(f, '/api/state', { visitor: a })).work, workB = (await ok(f, '/api/state', { visitor: b })).work
    const submittedA = await ok(f, '/api/submit', { visitor: a, body: { workId: workA.id, requestId: 'same-submission-id' } })
    const submittedB = await ok(f, '/api/submit', { visitor: b, body: { workId: workB.id, requestId: 'same-submission-id' } })
    assert.equal(submittedA.submission.reviewStatus, 'pending')
    assert.equal(submittedB.submission.reviewStatus, 'pending')
    replies.get(submittedB.submission.id)({ text: 'Разбор только B' })
    await new Promise(setImmediate)
    let stateA = await ok(f, '/api/state', { visitor: a }), stateB = await ok(f, '/api/state', { visitor: b })
    assert.equal(stateA.work.submissions[0].reviewStatus, 'pending')
    assert.equal(stateB.work.submissions[0].review, 'Разбор только B')
    replies.get(submittedA.submission.id)({ text: 'Разбор только A' })
    await new Promise(setImmediate)
    stateA = await ok(f, '/api/state', { visitor: a }); stateB = await ok(f, '/api/state', { visitor: b })
    assert.equal(stateA.work.submissions[0].review, 'Разбор только A')
    assert.equal(stateB.work.submissions[0].review, 'Разбор только B')
    assert.deepEqual(stateA.memory.map(event => event.submissionId), [submittedA.submission.id])
    assert.deepEqual(stateB.memory.map(event => event.submissionId), [submittedB.submission.id])
  } finally { for (const resolve of replies.values()) resolve({ text: 'cleanup' }); await f.close() }
})

test('shutdown recovers pending reviews in both visitor scopes and never replays or accepts late results', async () => {
  const replies = []
  const f = await fixture({}, () => new Promise(resolve => { replies.push(resolve) }))
  try {
    const a = await visitor(f), b = await visitor(f)
    const submissions = []
    for (const [identity, answer] of [[a, 'π/3'], [b, 'π/2']]) {
      const work = (await ok(f, '/api/state', { visitor: identity })).work
      await ok(f, '/api/work/save', { visitor: identity, body: { workId: work.id, expectedRevision: 0, document: notebook(`Решение ${answer}`), finalAnswer: answer } })
      const submitted = await ok(f, '/api/submit', { visitor: identity, body: { workId: work.id, requestId: 'pending-at-restart' } })
      assert.equal(submitted.submission.reviewStatus, 'pending')
      submissions.push(submitted.submission)
    }
    await f.restart()
    const recovered = []
    for (const [index, identity] of [a, b].entries()) {
      const state = await ok(f, '/api/state', { visitor: identity }), saved = state.work.submissions[0]
      assert.equal(saved.id, submissions[index].id)
      assert.equal(saved.reviewStatus, 'failed')
      assert.equal(saved.finalAnswer, submissions[index].finalAnswer)
      assert.deepEqual(saved.document, submissions[index].document)
      assert.deepEqual(saved.result, submissions[index].result)
      assert.equal(saved.review, undefined)
      assert.deepEqual(state.memory.map(event => event.submissionId), [saved.id])
      recovered.push(state)
    }
    assert.equal(f.packets.length, 2)
    for (const resolve of replies) resolve({ text: 'Просроченный ответ прежнего процесса' })
    await new Promise(setImmediate)
    assert.deepEqual(await ok(f, '/api/state', { visitor: a }), recovered[0])
    assert.deepEqual(await ok(f, '/api/state', { visitor: b }), recovered[1])
    assert.equal(f.packets.length, 2)
  } finally { for (const resolve of replies) resolve({ text: 'cleanup' }); await f.close() }
})

test('hosted visitors never adopt the preexisting local notebook or change local current selection', async () => {
  const f = await fixture()
  let local = new Store(f.config.dbPath)
  try {
    const work = local.create('double-angle-sin', 'guided')
    work.document = notebook('Старый локальный черновик')
    work.finalAnswer = 'local-only'
    local.put(work)
    local.close(); local = null
    const a = await visitor(f), b = await visitor(f)
    for (const identity of [a, b]) {
      const state = await ok(f, '/api/state', { visitor: identity })
      assert.notEqual(state.work.id, work.id)
      assert.equal(state.works.some(item => item.id === work.id), false)
      assert.doesNotMatch(JSON.stringify(state), /Старый локальный черновик|local-only/)
      assert.equal((await f.request('/api/work/open', { visitor: identity, body: { workId: work.id } })).status, 404)
    }
    local = new Store(f.config.dbPath)
    assert.equal(local.current().id, work.id)
    assert.equal(local.current().finalAnswer, 'local-only')
    assert.deepEqual(local.current().document, work.document)
    assert.deepEqual(local.list().map(item => item.id), [work.id])
  } finally { local?.close(); await f.close() }
})
