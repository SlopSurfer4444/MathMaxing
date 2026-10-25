import test from 'node:test'
import assert from 'node:assert/strict'
import { existingFormulaAt, insertExamFormula } from './exam-formula-insertion.ts'

test('inserts a fraction between untouched prose and restores the caret after it', () => {
  assert.deepEqual(insertExamFormula('До  после', 3, 3, '\\frac{1}{2}'), {
    text: 'До $\\frac{1}{2}$ после', caret: 16,
  })
})

test('replaces only selected prose, including reversed selection coordinates', () => {
  const original = 'Сначала старое затем'
  assert.deepEqual(insertExamFormula(original, 14, 8, 'x^2'), { text: 'Сначала $x^2$ затем', caret: 13 })
  assert.equal(original, 'Сначала старое затем')
})

test('inserts raw notation inside each supported math delimiter without nesting', () => {
  for (const [open, close] of [['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]) {
    const original = `До ${open}a+b${close} после`
    const start = 3 + open.length + 2
    assert.deepEqual(insertExamFormula(original, start, start, '\\sqrt{2}'), {
      text: `До ${open}a+\\sqrt{2}b${close} после`, caret: start + '\\sqrt{2}'.length,
    })
    assert.equal(insertExamFormula(original, 3 + open.length, 6 + open.length, 'c').text, `До ${open}c${close} после`)
  }
})

test('selection of a whole formula or several whole formulas replaces safely', () => {
  assert.deepEqual(insertExamFormula('До $$a+b$$ после', 3, 10, 'c'), { text: 'До $$c$$ после', caret: 8 })
  assert.equal(insertExamFormula('До $a$ и $b$ после', 3, 12, 'c').text, 'До $c$ после')
})

test('refuses selections crossing math boundaries instead of corrupting prose or delimiters', () => {
  for (const [open, close] of [['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]) {
    const original = `До ${open}abc${close} после`
    const inner = 3 + open.length + 1
    assert.throws(() => insertExamFormula(original, 1, inner, 'x'), /границ/)
    assert.throws(() => insertExamFormula(original, inner, original.length, 'x'), /границ/)
    if (open.length === 2) assert.throws(() => insertExamFormula(original, 4, 4, 'x'), /границ/)
  }
})

test('a caret immediately outside a formula preserves its existing delimiters', () => {
  assert.equal(insertExamFormula('До $a$ после', 3, 3, 'x').text, 'До $x$$a$ после')
  assert.equal(insertExamFormula('До $a$ после', 6, 6, 'x').text, 'До $a$$x$ после')
})

test('coordinates are bounded, truncated and never leak Infinity or NaN into slicing', () => {
  assert.deepEqual(insertExamFormula('abc', -3, 1.8, 'x'), { text: '$x$bc', caret: 3 })
  assert.deepEqual(insertExamFormula('abc', 100, 100, 'x'), { text: 'abc$x$', caret: 6 })
  for (const value of [Infinity, -Infinity, NaN]) assert.deepEqual(insertExamFormula('abc', value, value, 'x'), { text: 'abc$x$', caret: 6 })
})

test('empty input or nested wrapper notation is refused before any draft changes', () => {
  for (const value of ['', ' \n ', '$x$', '$$x$$', '\\(x\\)', '\\[x\\]']) assert.throws(() => insertExamFormula('Оставь запись', 0, 13, value))
  assert.equal(insertExamFormula('', 0, 0, ' \\left(x\\right) ').text, '$\\left(x\\right)$')
})

test('does not treat code notation as an existing formula and refuses invisible code insertion', () => {
  for (const original of ['Код `$a$` затем', '```text\n$a$\n```\nЗатем', '~~~text\n$a$\n~~~\nЗатем']) {
    const inner = original.indexOf('a')
    assert.throws(() => insertExamFormula(original, inner, inner, 'x'), /кода/)
    assert.equal(insertExamFormula(original, original.length, original.length, 'x').text, `${original}$x$`)
  }
})

test('a new wrapper cannot silently pair with an unmatched source delimiter', () => {
  for (const original of ['До $a затем', 'До \\(a затем', 'До \\[a затем']) {
    assert.throws(() => insertExamFormula(original, original.length, original.length, 'x'), /незакрытая/)
    assert.equal(insertExamFormula(original, 3, original.length, 'x').text, 'До $x$')
  }
})

test('existing formula prefill covers caret, content selection and a whole selected wrapper', () => {
  for (const [open, close] of [['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]) {
    const original = `До ${open}\\frac{1}{2}+x${close} после`
    const start = 3, end = original.length - ' после'.length
    const expected = { latex: '\\frac{1}{2}+x', start, end }
    assert.deepEqual(existingFormulaAt(original, start + open.length, start + open.length), expected)
    assert.deepEqual(existingFormulaAt(original, end - close.length, end - close.length), expected)
    assert.deepEqual(existingFormulaAt(original, start + open.length + 2, end - close.length - 1), expected)
    assert.deepEqual(existingFormulaAt(original, end, start), expected)
    const found = existingFormulaAt(original, start + open.length + 2, start + open.length + 2)!
    assert.deepEqual(insertExamFormula(original, found.start, found.end, '\\sqrt{3}'), {
      text: `До ${open}\\sqrt{3}${close} после`, caret: 3 + open.length + '\\sqrt{3}'.length + close.length,
    })
  }
})

test('multiline display math retains its full source when opened and replaced', () => {
  const original = 'До\n$$a=1\n+b$$\nПосле'
  const found = existingFormulaAt(original, original.indexOf('b'), original.indexOf('b') + 1)
  assert.deepEqual(found, { latex: 'a=1\n+b', start: 3, end: 13 })
  assert.equal(insertExamFormula(original, found!.start, found!.end, 'c=2').text, 'До\n$$c=2$$\nПосле')
})

test('prose, outer boundary carets and partial delimiter selections do not open an existing formula', () => {
  const original = 'До $$abc$$ после'
  for (const [start, end] of [[0, 0], [3, 3], [10, 10], [4, 4], [3, 7], [7, 10], [0, 10]]) {
    assert.equal(existingFormulaAt(original, start, end), null)
  }
})

test('prefill never combines two formulas or crosses from one formula into prose', () => {
  const original = 'До $a$ и $b$ после'
  assert.equal(existingFormulaAt(original, 4, 10), null)
  assert.equal(existingFormulaAt(original, 3, 12), null)
  assert.equal(existingFormulaAt(original, 0, 5), null)
  assert.deepEqual(existingFormulaAt(original, 10, 11), { latex: 'b', start: 9, end: 12 })
})

test('existing formulas in inline, fenced or unfinished code are never offered for editing', () => {
  for (const original of ['Код `$abc$` затем', '```text\n$abc$\n```\nЗатем', '~~~text\n$abc$\n~~~\nЗатем', '```\n$abc$']) {
    const start = original.indexOf('$'), end = original.lastIndexOf('$') + 1
    assert.equal(existingFormulaAt(original, start + 1, start + 1), null)
    assert.equal(existingFormulaAt(original, start, end), null)
  }
  assert.deepEqual(existingFormulaAt('`$code$` и $a$', 12, 12), { latex: 'a', start: 11, end: 14 })
})

test('unmatched or escaped delimiters do not become destructive edit targets', () => {
  for (const original of ['До $abc затем', 'До $$abc затем', 'До \\(abc затем', 'До \\[abc затем', 'До \\$abc$ затем', 'До $abc\\$ затем']) {
    const caret = original.indexOf('b')
    assert.equal(existingFormulaAt(original, caret, caret), null)
  }
  assert.equal(existingFormulaAt('$a$ затем $', 1, 1), null)
  assert.deepEqual(existingFormulaAt('$a$ затем \\$', 1, 1), { latex: 'a', start: 0, end: 3 })
})

test('formula discovery normalizes finite coordinates without inventing a target for invalid carets', () => {
  assert.deepEqual(existingFormulaAt('$abc$', 2.9, 1.2), { latex: 'abc', start: 0, end: 5 })
  for (const value of [Infinity, -Infinity, NaN, -100, 100]) assert.equal(existingFormulaAt('$abc$', value, value), null)
})
