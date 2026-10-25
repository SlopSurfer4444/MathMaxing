import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { captureExamQuote, examQuoteFieldDigest, locateExamQuote, uniqueExamQuoteRange } from './exam-quote-selection.ts'

test('trimmed second-occurrence selection keeps its actual UTF-16 range including Unicode before it', () => {
  const text = '🙂 Сначала x>0. Потом:  x>0 \n далее', selected = text.lastIndexOf('x>0')
  const captured = captureExamQuote(text, selected - 2, selected + 5)!
  assert.deepEqual(captured, { quote: 'x>0', start: selected, end: selected + 3 })
  assert.equal(text.slice(captured.start, captured.end), captured.quote)
  const clipped = captureExamQuote('До  abcdef  после', 2, 12, 4)!
  assert.deepEqual(clipped, { quote: 'abcd', start: 4, end: 8 })
  for (const [start, end] of [[0, 0], [-1, 3], [0, 100], [NaN, 4], [1.5, 3]]) assert.equal(captureExamQuote(text, start, end), null)
})

test('field identity is SHA-256 compatible with server JSON-string hashing', async () => {
  for (const value of ['', 'Строка 🙂\n\\frac{1}{2}', 'x>0']) assert.equal(await examQuoteFieldDigest(value), createHash('sha256').update(JSON.stringify(value)).digest('hex'))
})

test('exact location uses the second range and refuses changed fields or forged slices', async () => {
  const text = 'Первое x>0. Второе x>0.', start = text.lastIndexOf('x>0')
  const anchor = { start, end: start + 3, fieldDigest: await examQuoteFieldDigest(text) }
  assert.deepEqual(await locateExamQuote(text, 'x>0', anchor), { start, end: start + 3 })
  assert.equal(await locateExamQuote(text.replace('Первое', 'Другое'), 'x>0', anchor), null)
  assert.equal(await locateExamQuote(text, 'x>0', { ...anchor, start: start + 1 }), null)
  assert.equal(await locateExamQuote(text, 'x>0', { ...anchor, fieldDigest: '0'.repeat(64) }), null)
  assert.equal(await locateExamQuote(text, 'x>0', { start }), null)
})

test('legacy location requires a single literal occurrence and counts overlapping occurrences', async () => {
  assert.deepEqual(await locateExamQuote('До x>0 после', 'x>0', {}), { start: 3, end: 6 })
  assert.equal(await locateExamQuote('x>0 затем x>0', 'x>0', {}), null)
  assert.equal(uniqueExamQuoteRange('aaa', 'aa'), null)
  assert.equal(uniqueExamQuoteRange('abc', ''), null)
})
