import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'

test('React renderer escapes model HTML and preserves interactive references beside notation', async () => {
  // Reuse Vite's installed TSX transform so Node's strip-types runner can render
  // the actual component, without introducing a second test runtime.
  let source = (await readFile(new URL('./components/MathContent.tsx', import.meta.url), 'utf8')).replace("import './math-content.css'", '')
  for (const name of ['mathlive', 'react', 'lucide-react']) source = source.replaceAll(`from '${name}'`, `from '${import.meta.resolve(name)}'`)
  source = source.replace("from '../materials'", `from '${import.meta.resolve('./materials.ts')}'`).replace("from '../math-markdown'", `from '${import.meta.resolve('./math-markdown.ts')}'`)
  const transformed = await transformWithOxc(source, 'MathContent.tsx', { jsx: { runtime: 'automatic' } })
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime')))
  const { MathContent } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const markup = renderToStaticMarkup(createElement(MathContent, {
    text: '### Проверка\n\n- **Синус** $x$\n- <script>alert(1)</script>\n\n[[annotation:2]] [[material:unit-circle]] [[exercise:K1]]\n\n```html\n<img src=x onerror=alert(1)>\n```',
    onOpenMaterial: () => {}, onOpenExercise: () => {}, exercises: [{ id: 'K1', title: 'Проба' }],
    renderAnnotation: (index: number) => createElement('button', null, 'Заметка ' + index),
  }))
  assert.match(markup, /<h3 class="tutor-heading"><span>Проверка<\/span><\/h3>/)
  assert.match(markup, /<ul class="tutor-list"><li>/)
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.ok(!markup.includes('<script>'))
  assert.match(markup, /Заметка 2/)
  assert.match(markup, /Единичная окружность/)
  assert.match(markup, /Проба/)
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.ok(markup.includes('ML__'))
})
