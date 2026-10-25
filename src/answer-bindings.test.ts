import test from 'node:test'
import assert from 'node:assert/strict'
import type { JSONContent } from '@tiptap/core'
import { deriveNotebookAnswers, migrateLegacyAnswers } from './answer-bindings.ts'

const text = (id: string, value: string, answerParts: unknown = []): JSONContent => ({
  type: 'paragraph', attrs: { id, answerParts }, content: [{ type: 'text', text: value }],
})
const math = (id: string, latex: string, answerParts: unknown = []): JSONContent => ({
  type: 'mathBlock', attrs: { id, latex, answerParts },
})
const document = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

test('answer groups follow document order through nested blocks and retain whole text and formulas', () => {
  const doc = document(
    text('intro', 'Unmarked'),
    { type: 'heading', attrs: { id: 'heading', answerParts: ['a'] }, content: [
      { type: 'text', text: 'First', marks: [{ type: 'bold' }] },
      { type: 'hardBreak' }, { type: 'text', text: 'second' },
    ] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [math('formula', 'x=\\pi', ['a', 'b'])] }] },
    text('explanation', '  Explanation  ', ['b']),
    math('empty', '', ['a']),
  )
  assert.deepEqual(deriveNotebookAnswers(doc), {
    a: [
      { id: 'heading', kind: 'text', value: 'First\nsecond' },
      { id: 'formula', kind: 'math', value: 'x=\\pi' },
      { id: 'empty', kind: 'math', value: '' },
    ],
    b: [
      { id: 'formula', kind: 'math', value: 'x=\\pi' },
      { id: 'explanation', kind: 'text', value: '  Explanation  ' },
    ],
    generalAnswer: 'First\nsecond\nx=\\pi', finalAnswer: 'x=\\pi\n  Explanation  ',
  })
})

test('edits, membership removal and block deletion immediately change derived answers', () => {
  const original = document(math('one', 'x=1', ['a', 'b']), text('two', 'Therefore', ['a']))
  assert.equal(deriveNotebookAnswers(original).generalAnswer, 'x=1\nTherefore')
  const edited = document(math('one', 'x=2', ['b']), text('two', 'Thus', ['a']))
  assert.equal(deriveNotebookAnswers(edited).generalAnswer, 'Thus')
  assert.equal(deriveNotebookAnswers(edited).finalAnswer, 'x=2')
  assert.deepEqual(deriveNotebookAnswers(document()), { a: [], b: [], generalAnswer: '', finalAnswer: '' })
})

test('unknown markers, unsupported node types and duplicate markers do not add phantom answer blocks', () => {
  const doc = document(
    text('string', 'ignored', 'a'), text('invalid', 'ignored', ['c', null]),
    { type: 'codeBlock', attrs: { id: 'code', answerParts: ['a'] }, content: [{ type: 'text', text: 'ignored' }] },
    text('known', 'kept', ['unknown', 'a', 'a', 'b']), text('blank', ' \n ', ['a']),
  )
  const result = deriveNotebookAnswers(doc)
  assert.equal(result.generalAnswer, 'kept')
  assert.equal(result.finalAnswer, 'kept')
  assert.deepEqual(result.a.map(block => block.id), ['known', 'blank'])
  assert.deepEqual(result.b.map(block => block.id), ['known'])
})

test('legacy migration preserves existing document bytes and exact multiline notation without mutating input', () => {
  const doc = { ...document(text('existing', 'Original', ['a'])), attrs: { custom: ['metadata'] },
    annotations: [{ id: 'annotation', quote: 'Original' }] } as JSONContent
  doc.content![0].attrs!.custom = { nested: 'untouched' }
  const before = JSON.stringify(doc)
  const legacy = '  x = \\frac{\\pi}{3}\r\ny = -5pi/3; \\text{a; b}\n '
  const migrated = migrateLegacyAnswers(doc, legacy, '0\n\\pi')
  assert.equal(JSON.stringify(doc), before)
  assert.deepEqual(migrated.content?.slice(0, 1), doc.content)
  assert.deepEqual(migrated.attrs, doc.attrs)
  assert.deepEqual(migrated.annotations, doc.annotations)
  assert.equal(migrated.content?.[1].attrs?.latex, legacy)
  assert.equal(migrated.content?.[2].attrs?.latex, '0\n\\pi')
  assert.deepEqual(migrated.content?.[1].attrs?.answerParts, ['a'])
  const ids = migrated.content!.map(node => node.attrs?.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0))
  assert.deepEqual(migrateLegacyAnswers(migrated, legacy, '0\n\\pi'), migrated)
})

test('migration skips matching aggregate answers, existing exact blocks and empty legacy fields', () => {
  const doc = document(math('one', 'x=1', ['a']), text('two', 'or', ['a']), math('three', 'x=2', ['a', 'b']))
  assert.equal(migrateLegacyAnswers(doc, 'x=1\nor\nx=2', 'x=2'), doc)
  assert.equal(migrateLegacyAnswers(doc, 'x=1', ' \n '), doc)
  const migrated = migrateLegacyAnswers(document(), 'same', 'same')
  assert.equal(migrated.content?.length, 2)
  assert.equal(deriveNotebookAnswers(migrated).generalAnswer, 'same')
  assert.equal(deriveNotebookAnswers(migrated).finalAnswer, 'same')
  assert.equal(migrateLegacyAnswers(migrated, 'same', 'same'), migrated)
})
