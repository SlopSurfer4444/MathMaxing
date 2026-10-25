import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'

async function componentModule(path: string, dependencies: Record<string, string> = {}) {
  let source = (await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^import '\.\/[^']+\.css'\r?\n/gm, '')
  for (const name of ['mathlive', 'react', 'lucide-react']) source = source.replaceAll(`from '${name}'`, `from '${import.meta.resolve(name)}'`)
  for (const [name, url] of Object.entries(dependencies)) source = source.replaceAll(`from '${name}'`, `from '${url}'`)
  const transformed = await transformWithOxc(source, path, { jsx: { runtime: 'automatic' } })
  return 'data:text/javascript;base64,' + Buffer.from(transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))).toString('base64')
}

test('review renders every finding and preserves objection uncertainty without changing exact result', async () => {
  const mathUrl = await componentModule('./components/MathContent.tsx', {
    '../materials': import.meta.resolve('./materials.ts'), '../math-markdown': import.meta.resolve('./math-markdown.ts'),
  })
  const { ReviewCycle } = await import(await componentModule('./components/ReviewCycle.tsx', { './MathContent': mathUrl }))
  const submission = {
    id: 's1', reason: 'submitted', result: { status: 'correct', summary: 'Ответ верен' }, reviewStatus: 'ready',
    findings: [0, 1, 2].map(i => ({ id: 'f' + i, status: i === 0 ? 'uncertain' : 'open', source: 'model',
      anchor: { kind: 'block', quote: `Строка ${i} <script>bad()</script>` }, message: `Замечание ${i}`, objections: i === 0 ? [
        { id: 'o1', status: 'ready', verdict: 'uncertain', explanation: 'Я проверил выше', message: 'Не могу подтвердить' },
      ] : [],
    })),
  }
  const markup = renderToStaticMarkup(createElement(ReviewCycle, {
    submission, work: { id: 'w1', mode: 'review', revision: 1, modeEpoch: 1, submissions: [submission] }, busy: false,
    onAction: async () => {}, onLocate: () => {}, requestSelfcheck: async () => ({ checklist: [] }), onRetry: () => {},
  }))
  for (const text of ['Замечание 0', 'Замечание 1', 'Замечание 2', 'Ещё замечания (1)', 'Не могу подтвердить', 'Исправить своё решение', 'Что проверить самому']) assert.ok(markup.includes(text), text)
  assert.ok(markup.includes('Нужна дополнительная проверка'))
  assert.ok(markup.includes('&lt;script&gt;bad()&lt;/script&gt;'))
  assert.ok(!markup.includes('<script>'))
  assert.equal(submission.result.status, 'correct')
  const offline = renderToStaticMarkup(createElement(ReviewCycle, {
    submission: { ...submission, findings: [], reviewStatus: 'failed', reviewError: 'Связь прервалась' },
    work: { id: 'w1', mode: 'guided', correctionOf: 's1', revision: 2, modeEpoch: 2, submissions: [submission] }, busy: false,
    onAction: async () => {}, onLocate: () => {}, requestSelfcheck: async () => ({ checklist: [] }), onRetry: () => {},
  }))
  assert.ok(offline.includes('Связь прервалась'))
  assert.ok(offline.includes('Повторить разбор'))
  assert.ok(offline.includes('Что проверить самому'))
  assert.match(offline, /disabled="">Исправь запись и проверь снова/)
  assert.ok(offline.includes('Замечания относятся к прошлой записи'))
})
