import test from 'node:test'
import assert from 'node:assert/strict'
import type { AssistanceGuidance } from './api-types.ts'
import { acknowledgeClarification, clarificationKey, clarificationSource, loadClarification, parseClarification, sameClarificationSource, type ClarificationDraft } from './assistance-draft.ts'

const guidance: AssistanceGuidance = { id: 'guidance-one', kind: 'question', revision: 3, modeEpoch: 2, contextKey: 'context-one', text: 'Почему правило работает?', question: { prompt: 'Что изменилось?' } }
const entry: ClarificationDraft = { version: 1, workId: 'work-one', text: '  Мой точный\nответ  ', source: clarificationSource(guidance), updatedAt: '2026-10-23T20:00:00Z' }
function memoryStorage(value: string | null = JSON.stringify(entry)) {
  const values = new Map<string, string>(value === null ? [] : [[clarificationKey(entry.workId), value]])
  return { values, getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key) } }
}

test('a clarification survives remount with exact text and its original source', () => {
  const storage = memoryStorage()
  assert.deepEqual(loadClarification(storage, entry.workId), { entry, failed: false })
  assert.deepEqual(loadClarification(storage, entry.workId), { entry, failed: false })
  assert.deepEqual(loadClarification(storage, 'other-work'), { entry: null, failed: false })
  assert.equal(storage.values.size, 1)
})

test('producer payload rejects wrong work, invalid format, version and oversized data', () => {
  assert.equal(parseClarification(JSON.stringify(entry), 'other-work'), null)
  assert.equal(parseClarification('{broken', entry.workId), null)
  const invalid = [
    { ...entry, version: 2 },
    { ...entry, text: 'x'.repeat(4001) },
    { ...entry, source: undefined },
    { ...entry, source: { ...entry.source, guidanceId: 'x'.repeat(201) } },
    { ...entry, source: { ...entry.source, revision: 1.5 } },
    { ...entry, source: { ...entry.source, modeEpoch: NaN } },
    { ...entry, source: { ...entry.source, contextKey: 'x'.repeat(513) } },
    { ...entry, source: { ...entry.source, text: 'x'.repeat(12001) } },
    { ...entry, source: { ...entry.source, question: 'x'.repeat(4001) } },
  ]
  for (const value of invalid) assert.equal(parseClarification(JSON.stringify(value), entry.workId), null)
  assert.equal(parseClarification(JSON.stringify({ ...entry, text: 'x'.repeat(4000) }), entry.workId)?.text.length, 4000)
})

test('a changed guidance, revision, epoch or context never accepts the old inline answer', () => {
  const source = clarificationSource(guidance)
  assert.equal(sameClarificationSource(source, clarificationSource({ ...guidance, text: 'Другой показанный текст' })), true)
  for (const change of [{ id: 'guidance-two' }, { revision: 4 }, { modeEpoch: 3 }, { contextKey: 'context-two' }]) {
    assert.equal(sameClarificationSource(source, clarificationSource({ ...guidance, ...change })), false)
  }
  assert.equal(sameClarificationSource(null, source), false)
  assert.equal(sameClarificationSource(source, null), false)
  assert.equal(parseClarification(JSON.stringify({ ...entry, source: null }), entry.workId)?.text, entry.text)
})

test('missing, corrupt and unavailable storage remain distinct and loading never deletes data', () => {
  assert.deepEqual(loadClarification(memoryStorage(null), entry.workId), { entry: null, failed: false })
  const corrupt = memoryStorage('bad')
  assert.deepEqual(loadClarification(corrupt, entry.workId), { entry: null, failed: true })
  assert.equal(corrupt.values.get(clarificationKey(entry.workId)), 'bad')
  const unavailable = { getItem() { throw Error('storage unavailable') }, removeItem() { assert.fail('load must not remove') } }
  assert.deepEqual(loadClarification(unavailable, entry.workId), { entry: null, failed: true })
})

test('acknowledgement clears only the exact work, text and source snapshot after unmount', () => {
  const source = entry.source!
  for (const newer of [
    { ...entry, text: 'Новый ответ' },
    { ...entry, source: { ...source, guidanceId: 'guidance-two' } },
    { ...entry, source: { ...source, revision: source.revision + 1 } },
    { ...entry, source: { ...source, modeEpoch: source.modeEpoch + 1 } },
    { ...entry, source: { ...source, contextKey: 'context-two' } },
  ]) {
    const storage = memoryStorage(JSON.stringify(newer))
    acknowledgeClarification(storage, entry.workId, entry.text, source)
    assert.deepEqual(loadClarification(storage, entry.workId).entry, newer)
  }
  const storage = memoryStorage()
  acknowledgeClarification(storage, 'other-work', entry.text, source)
  assert.equal(storage.values.size, 1)
  acknowledgeClarification(storage, entry.workId, entry.text, source)
  assert.equal(storage.values.size, 0)
  acknowledgeClarification(storage, entry.workId, entry.text, source)
  assert.equal(storage.values.size, 0)
})

test('failed acknowledgement cleanup preserves the durable entry for recovery', () => {
  const storage = memoryStorage()
  assert.throws(() => acknowledgeClarification({ ...storage, removeItem() { throw Error('blocked') } }, entry.workId, entry.text, entry.source!), /blocked/)
  assert.deepEqual(loadClarification(storage, entry.workId).entry, entry)
})

test('original source excerpts fit the persisted producer contract', () => {
  const source = clarificationSource({ ...guidance, id: 'i'.repeat(300), contextKey: 'c'.repeat(600), text: 'x'.repeat(13000), question: { prompt: 'q'.repeat(5000) } })
  assert.equal(source.guidanceId.length, 200)
  assert.equal(source.contextKey.length, 512)
  assert.equal(source.text.length, 12000)
  assert.equal(source.question.length, 4000)
  assert.ok(parseClarification(JSON.stringify({ ...entry, source }), entry.workId))
})
