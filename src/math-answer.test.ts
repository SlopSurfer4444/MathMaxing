import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalMathAnswer, toMathAnswerLatex } from './math-answer.ts'

test('legacy pi notation becomes display notation without changing existing commands', () => {
  assert.equal(toMathAnswerLatex('-5pi/3; \\pi/3; 0'), '-5\\pi/3; \\pi/3; 0')
})

test('presentation spacing cannot become accidental root separators', () => {
  assert.equal(canonicalMathAnswer('\\dfrac{\\pi}{3}\\,; -\\pi'), '\\frac{\\pi}{3}; -\\pi')
})
test('MathLive fraction shorthand preserves its exact literal meaning', () => {
  assert.equal(canonicalMathAnswer('\\frac14'), '\\frac{1}{4}')
  assert.equal(canonicalMathAnswer('\\frac{\\pi}2'), '\\frac{\\pi}{2}')
  assert.equal(canonicalMathAnswer('\\frac1{12}'), '\\frac{1}{12}')
})

test('unsupported and unfinished expressions are preserved for unknown checks', () => {
  for (const value of ['\\sqrt{2}', '\\frac{\\pi}{0}', '\\sin(x)', '\\frac{\\placeholder{}}{3}']) {
    assert.equal(canonicalMathAnswer(value), value)
  }
})
