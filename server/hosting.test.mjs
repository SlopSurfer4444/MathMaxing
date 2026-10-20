import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadServerConfig } from './config.mjs'
import { createRequestGuard } from './http-security.mjs'
import { OpenAITutor } from './openai-adapter.mjs'
import { createTutor } from './tutor-provider.mjs'
import { CodexTutor } from './codex-adapter.mjs'
import { snapshotDatabase } from '../scripts/database-snapshot.mjs'

const env = { POLE_MODE: 'hosted', POLE_TUTOR_PROVIDER: 'openai', POLE_ALLOWED_ORIGINS: 'https://review.example.test', POLE_DB_PATH: '.runtime/hosting-test.sqlite', OPENAI_API_KEY: 'test-only-not-a-key', OPENAI_MODEL: 'configured-test-model' }
function response() { const res = new EventEmitter(); res.headers = {}; res.setHeader = (key, value) => res.headers[key] = value; return res }
const request = (headers = {}) => ({ method: 'POST', headers: { origin: env.POLE_ALLOWED_ORIGINS, 'x-pole-client': 'notebook-v1', ...headers } })
const complete = (text = 'Объяснение') => new Response(JSON.stringify({ id: 'response-test', status: 'completed', model: 'actual-test-model', output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] }))
function provider(options = {}) { const db = new DatabaseSync(':memory:'); const tutor = new OpenAITutor({ db, apiKey: 'test-only-not-a-key', model: 'configured-test-model', fetchImpl: async () => complete(), ...options }); return { db, tutor, close: async () => { await tutor.close(); db.close() } } }

test('local Codex remains default; hosted configuration fails closed', async () => {
  const local = loadServerConfig({}); const tutor = createTutor(local); assert.ok(tutor instanceof CodexTutor); await tutor.close()
  const hosted = loadServerConfig(env); assert.equal(hosted.host, '127.0.0.1'); assert.deepEqual(hosted.origins, [env.POLE_ALLOWED_ORIGINS])
  for (const patch of [{ POLE_TUTOR_PROVIDER: 'codex' }, { POLE_ALLOWED_ORIGINS: '' }, { POLE_ALLOWED_ORIGINS: 'https://review.example.test/path' }, { POLE_ALLOWED_ORIGINS: 'http://review.example.test' }, { POLE_DB_PATH: '' }, { OPENAI_API_KEY: '' }, { POLE_HTTP_CONCURRENT: 'NaN' }, { POLE_MAX_VISITORS: '0' }]) assert.throws(() => loadServerConfig({ ...env, ...patch }))
})
test('backend checks exact origin and CSRF marker before visitor authentication', () => {
  const guard = createRequestGuard(loadServerConfig(env))
  for (const headers of [{ origin: 'https://review.example.test.evil.test' }, { origin: 'https://review.example.test:444' }, { 'x-pole-client': '' }, { 'sec-fetch-site': 'cross-site' }]) assert.throws(() => guard(request(headers), response()), { status: 403 })
  guard(request(), response())
})
test('HTTP limits release once on finish/close and reset each minute', () => {
  let time = 0; const guard = createRequestGuard({ ...loadServerConfig(env), maxHttpConcurrent: 1, requestsPerMinute: 3 }, { now: () => time })
  const first = response(); guard(request(), first)
  assert.throws(() => guard(request(), response()), { status: 429 })
  first.emit('finish'); first.emit('close'); const third = response(); guard(request(), third); third.emit('close')
  assert.throws(() => guard(request(), response()), { status: 429 })
  time = 60000; guard(request(), response())
})

test('CLIProxy configuration uses its own server key and only a literal loopback endpoint', () => {
  const proxy={...env,POLE_TUTOR_PROVIDER:'cliproxy',CLIPROXY_API_KEY:'test-only-proxy-key'}
  const config=loadServerConfig(proxy)
  assert.equal(config.apiKey,'test-only-proxy-key');assert.equal(config.proxyBaseUrl,'http://127.0.0.1:8317/v1')
  assert.equal(loadServerConfig({...proxy,CLIPROXY_BASE_URL:'http://[::1]:8317/v1'}).proxyBaseUrl,'http://[::1]:8317/v1')
  for(const base of ['https://127.0.0.1:8317/v1','http://example.com/v1','http://localhost:8317/v1','http://127.0.0.1:8317/v1/responses','http://user:pass@127.0.0.1:8317/v1','http://127.0.0.1:8317/v1?key=secret','http://127.0.0.1:8317/v1#fragment'])assert.throws(()=>loadServerConfig({...proxy,CLIPROXY_BASE_URL:base}))
  assert.throws(()=>loadServerConfig({...proxy,CLIPROXY_API_KEY:''}))
})
test('API contract sends text, limits, server key and store:false; no tools or SDK retry', async () => {
  let calls = 0, delta = ''
  const f = provider({ fetchImpl: async (url, init) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error'); assert.equal(init.headers.Authorization, 'Bearer test-only-not-a-key')
    const data = JSON.parse(init.body); assert.equal(data.instructions, 'system'); assert.equal(data.input, 'question'); assert.deepEqual(data.tools, []); assert.equal(data.tool_choice, 'none'); assert.equal(data.store, false); assert.equal(data.stream, false); assert.equal(data.max_output_tokens, 3000)
    return complete('Пояснение π')
  } })
  try {
    assert.equal((await f.tutor.status()).connected, false)
    const answer = await f.tutor.respond({ prompt: 'question', system: 'system', onDelta: text => delta += text })
    assert.deepEqual(answer, { text: 'Пояснение π', model: 'actual-test-model', runId: 'response-test' }); assert.equal(delta, answer.text); assert.equal(calls, 1); assert.equal((await f.tutor.status()).connected, true)
  } finally { await f.close() }
})
test('provider failure is sanitized, not retried, and consumes daily budget', async () => {
  let calls = 0; const f = provider({ requestsPerDay: 1, fetchImpl: async () => { calls++; return new Response('secret upstream details test-only-not-a-key', { status: 401 }) } })
  try {
    await assert.rejects(f.tutor.respond({ prompt: 'q', system: 's' }), { code: 'OPENAI_AUTH' })
    await assert.rejects(f.tutor.respond({ prompt: 'q', system: 's' }), { code: 'OPENAI_LIMIT' }); assert.equal(calls, 1)
    assert.doesNotMatch((await f.tutor.status()).error, /test-only-not-a-key/)
  } finally { await f.close() }
})
test('busy, timeout, abort and oversized input do not silently replay', async () => {
  let calls = 0; const f = provider({ timeoutMs: 20, maxInputChars: 20, fetchImpl: async (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true })) } })
  try {
    await assert.rejects(f.tutor.respond({ prompt: 'x'.repeat(30), system: 's' }), { code: 'OPENAI_INPUT_LIMIT' }); assert.equal(calls, 0)
    const first = f.tutor.respond({ prompt: 'q', system: 's' }); const timed = assert.rejects(first, { code: 'OPENAI_TIMEOUT' })
    await assert.rejects(f.tutor.respond({ prompt: 'q', system: 's' }), { code: 'OPENAI_BUSY' }); await timed
    const controller = new AbortController(); const second = f.tutor.respond({ prompt: 'q', system: 's', signal: controller.signal }); controller.abort()
    await assert.rejects(second, { code: 'OPENAI_CANCELLED' }); assert.equal(calls, 2)
  } finally { await f.close() }
})
test('truncated and tool responses cannot become successful tutor replies', async () => {
  for (const data of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [{ type: 'function_call' }] }, { status: 'completed', output: [] }]) {
    const f = provider({ fetchImpl: async () => new Response(JSON.stringify(data)) })
    try { await assert.rejects(f.tutor.respond({ prompt: 'q', system: 's' }), { status: 502 }) } finally { await f.close() }
  }
})
test('consistent backup includes WAL, restores to new DB and retains daily budget after restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pole-snapshot-')), source = join(dir, 'demo.sqlite'), snapshot = join(dir, 'backup.sqlite'), restored = join(dir, 'restored.sqlite')
  const db = new DatabaseSync(source)
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE works(id TEXT PRIMARY KEY, data TEXT); INSERT INTO works VALUES('demo','draft')")
    const tutor = new OpenAITutor({ db, apiKey: 'test-only', model: 'test-model', requestsPerDay: 1, fetchImpl: async () => complete() }); await tutor.respond({ prompt: 'q', system: 's' }); await tutor.close()
    await snapshotDatabase(source, snapshot); await snapshotDatabase(snapshot, restored)
    await assert.rejects(snapshotDatabase(snapshot, restored), /already exists/)
    const recovered = new DatabaseSync(restored)
    try {
      assert.equal(recovered.prepare('SELECT data FROM works').get().data, 'draft')
      const restarted = new OpenAITutor({ db: recovered, apiKey: 'test-only', model: 'test-model', requestsPerDay: 1, fetchImpl: async () => { throw Error('must not call') } })
      await assert.rejects(restarted.respond({ prompt: 'q', system: 's' }), { code: 'OPENAI_LIMIT' }); await restarted.close()
    } finally { recovered.close() }
  } finally { db.close(); await rm(dir, { recursive: true, force: true }) }
})
