import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMathMarkdown } from './math-markdown.ts'

// Visible tutor response transcribed from audit frames 04/05; markup restored
// around the visible notation. The excerpt ends before the obscured mobile text.
const auditExcerpt = `Давай с начала, по одному шагу. Пока не будем решать уравнение.

### Шаг 1. Угол — поворот, синус — высота

Представь колесо со спицей длиной $1$. Его край — **единичная окружность**: все точки края находятся на расстоянии $1$ от центра.

Сначала спица направлена вправо.
Поворачиваем её — точка на конце движется по окружности.

- **Угол** $x$ показывает, на сколько повернули спицу.
- **Синус** $\\sin x$ показывает, на какой высоте оказалась точка относительно центра. Выше центра — плюс, ниже — минус.

Если хочется посмотреть и подвигать точку, можно открыть [[material:unit-circle]].`

test('audit tutor excerpt has a heading, real list and intact math/material references', () => {
  const blocks = parseMathMarkdown(auditExcerpt)
  assert.equal(blocks[1].kind, 'heading')
  assert.deepEqual(blocks[1], { kind: 'heading', level: 3, text: 'Шаг 1. Угол — поворот, синус — высота' })
  assert.ok(blocks.some(block => block.kind === 'list' && !block.ordered && block.items.length === 2))
  assert.match(JSON.stringify(blocks), /unit-circle/)
  assert.ok(JSON.stringify(blocks).includes('\\\\sin x'))
})

test('block-looking notation remains a single exact mathematical fragment', () => {
  const math = '$$\n- x\n\n### y\n$$'
  assert.deepEqual(parseMathMarkdown(math), [{ kind: 'paragraph', text: math }])
  const bracketMath = '\\[\n1. x\n\\]'
  assert.deepEqual(parseMathMarkdown(bracketMath), [{ kind: 'paragraph', text: bracketMath }])
  const list = parseMathMarkdown('- $$\nx + y\n$$\n- второй')
  assert.equal(list[0].kind, 'list')
  if (list[0].kind === 'list') assert.deepEqual(list[0].items[0], [{ kind: 'paragraph', text: '$$\nx + y\n$$' }])
})

test('fences are literal, accept unfinished streams and retain embedded delimiters', () => {
  const code = '<script>alert(1)</script>\n### raw\n$math$ [[annotation:2]]'
  assert.deepEqual(parseMathMarkdown('```html\n' + code + '\n```'), [{ kind: 'code', text: code }])
  assert.deepEqual(parseMathMarkdown('~~~\n' + code), [{ kind: 'code', text: code }])
  assert.deepEqual(parseMathMarkdown('````\n```\n````'), [{ kind: 'code', text: '```' }])
  assert.deepEqual(parseMathMarkdown('```\n$$\n```\n### После кода\n\n$$\n- x\n$$'), [
    { kind: 'code', text: '$$' }, { kind: 'heading', level: 3, text: 'После кода' }, { kind: 'paragraph', text: '$$\n- x\n$$' },
  ])
})

test('lists preserve start, nesting and continuation; paragraphs keep literal HTML and references', () => {
  const blocks = parseMathMarkdown('3. первая\n   продолжение\n   - вложенная\n4. вторая\n\n<img src=x onerror=alert(1)> [[annotation:2]] [[exercise:K1]]')
  assert.equal(blocks[0].kind, 'list')
  if (blocks[0].kind === 'list') {
    assert.equal(blocks[0].start, 3)
    assert.equal(blocks[0].items.length, 2)
    assert.equal(blocks[0].items[0][1].kind, 'list')
  }
  assert.deepEqual(blocks[1], { kind: 'paragraph', text: '<img src=x onerror=alert(1)> [[annotation:2]] [[exercise:K1]]' })
  assert.deepEqual(parseMathMarkdown('текст\n\nещё'), [{ kind: 'paragraph', text: 'текст' }, { kind: 'paragraph', text: 'ещё' }])
})
