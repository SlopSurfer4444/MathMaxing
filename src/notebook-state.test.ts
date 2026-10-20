import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anchorStatus, createAnnotation, findBlock, freshNotebook, parseSavedNotebook } from './notebook-state.ts'

test('annotation keeps historical formula and becomes current again after undo', () => {
  const state = freshNotebook()
  const a = createAnnotation(state.document, { blockId: 'formula-1', kind: 'math', quote: 'original' }, 'Почему?')!
  assert.equal(anchorStatus(state.document, a), 'current')
  const before = structuredClone(state.document)
  findBlock(state.document, 'formula-1')!.attrs!.latex = 'x=2'
  assert.equal(anchorStatus(state.document, a), 'changed')
  assert.equal(a.anchor.quote, 'original')
  assert.equal(anchorStatus(before, a), 'current')
})
test('unrelated edits preserve anchor; removed source retains note', () => {
  const state = freshNotebook()
  const a = createAnnotation(state.document, { blockId: 'formula-1', kind: 'math', quote: 'original' }, 'Вопрос')!
  findBlock(state.document, 'intro')!.content = [{ type: 'text', text: 'Другая мысль' }]
  assert.equal(anchorStatus(state.document, a), 'current')
  state.document.content = state.document.content!.filter(n => n.attrs?.id !== 'formula-1')
  assert.equal(anchorStatus(state.document, a), 'removed')
  assert.equal(a.messages[0].text, 'Вопрос')
})
test('saved work round trips; corrupt data and empty notes are rejected', () => {
  const state = freshNotebook()
  assert.deepEqual(parseSavedNotebook(JSON.stringify(state)), state)
  assert.throws(() => parseSavedNotebook('{'))
  assert.throws(() => parseSavedNotebook(JSON.stringify({ ...state, document: { type: 'doc', content: [{ type: 'script' }] } })))
  assert.equal(createAnnotation(state.document, { blockId: 'missing', kind: 'text', quote: '' }, 'hello'), null)
  assert.equal(createAnnotation(state.document, { blockId: 'intro', kind: 'text', quote: '' }, ' '), null)
})
