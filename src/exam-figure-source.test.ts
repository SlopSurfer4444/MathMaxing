import test from 'node:test'
import assert from 'node:assert/strict'
import { examFigureSource } from './exam-figure-source.ts'
test('archive drawings are encoded in an image resource, never injected into application DOM', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>ABC</text></svg>'
  const source = examFigureSource(svg)!
  assert.ok(source.startsWith('data:image/svg+xml;charset=utf-8,'))
  assert.equal(source.includes('<'), false)
  assert.equal(decodeURIComponent(source.split(',')[1]), svg)
  assert.equal(examFigureSource('<div>not a drawing</div>'), undefined)
  assert.equal(examFigureSource('<svg>' + 'a'.repeat(200000)), undefined)
})
