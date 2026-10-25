import test from 'node:test'
import assert from 'node:assert/strict'
import { makeApp } from './index.mjs'
import { Store } from './store.mjs'

test('mixed routes reject mutating GET and isolate visitor state, work and receipts', async () => {
  const app = makeApp({ store: new Store(':memory:'), tutor: { status: async () => ({ connected: true }), respond: async () => ({ text: 'test' }), close() {} } })
  try {
    const a = app.store.forVisitor(crypto.randomUUID()), b = app.store.forVisitor(crypto.randomUUID())
    const call = (store, method, path, body = {}) => app.route(method, path, body, store)
    const command = { requestId: crypto.randomUUID(), expectedRevision: 0 }
    await assert.rejects(call(a, 'GET', '/api/mixed/start', command), { status: 404 })
    assert.equal(a.list().length, 0)
    await assert.rejects(call(a, 'POST', '/api/mixed/start', { expectedRevision: 0 }), { status: 400 })
    const started = await call(a, 'POST', '/api/mixed/start', command)
    assert.equal(started.work.mode, 'solo')
    assert.equal((await call(a, 'POST', '/api/mixed/start', command)).work.id, started.work.id)
    assert.equal((await call(b, 'GET', '/api/mixed')).mixed, null)
    await assert.rejects(call(b, 'POST', '/api/mixed/next', { requestId: crypto.randomUUID(), expectedRevision: 1 }), { status: 409 })
    const another = await call(b, 'POST', '/api/mixed/start', command)
    assert.notEqual(another.work.id, started.work.id)
    await assert.rejects(call(a, 'POST', '/api/topics/help', { workId: started.work.id, expectedRevision: 0, expectedModeEpoch: 0 }), { status: 403 })
    assert.equal((await call(a, 'GET', '/api/mixed')).mixed.currentWorkId, started.work.id)
  } finally { await app.close() }
})
