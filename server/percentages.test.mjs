import test from 'node:test'
import assert from 'node:assert/strict'
import { percentageProblems, publicPercentageProblem, checkNumericAnswer, checkPercentageAnswer, percentageHelp, checkPercentagePreparation } from './percentages.mjs'

test('four authored problems have hand-derived answers for distinct actions', () => {
  for (const [id, answer] of [
    ['percent-discount-v1', '1200'],
    ['percent-successive-v1', '1440'],
    ['percent-reverse-v1', '2000'],
    ['percent-transfer-v1', '1'],
  ]) assert.equal(checkPercentageAnswer(id, answer).status, 'correct', id)
  assert.equal(checkPercentageAnswer('percent-discount-v1', '300').status, 'incorrect', 'discount amount is not new price')
  assert.equal(checkPercentageAnswer('percent-successive-v1', '1500').status, 'incorrect', 'equal changes do not cancel')
  assert.equal(checkPercentageAnswer('percent-reverse-v1', '1920').status, 'incorrect', 'final value is not original')
  assert.equal(checkPercentageAnswer('percent-transfer-v1', '99').status, 'incorrect', 'remaining percent is not reduction')
})

test('numeric comparison handles comma, fractions and signs exactly', () => {
  for (const input of ['12,5', '12.500', '25/2', ' 50 / 4 ', '+12.5', '-25/-2'])
    assert.equal(checkNumericAnswer(input, '12.5').status, 'correct', input)
  assert.equal(checkNumericAnswer('−3/2', '-1,5').status, 'correct')
  assert.equal(checkNumericAnswer('0.1', '1/10').status, 'correct')
  assert.equal(checkNumericAnswer('1/3', '0.333333333333333333333333333333').status, 'incorrect', 'no tolerance silently approves rounded answers')
  assert.equal(checkNumericAnswer('9007199254740993', '9007199254740992').status, 'incorrect', 'no IEEE754 rounding')
  assert.equal(checkNumericAnswer('-0', '0').status, 'correct')
})

test('an exact wrong-answer check does not reveal a method before help is requested', () => {
  const result = checkPercentageAnswer('percent-successive-v1', '1500')
  assert.deepEqual(result, { status: 'incorrect', summary: 'Числовой ответ пока не совпадает. Можно изменить запись и проверить ещё раз.' })
})

test('unrecognized or malformed answers stay unknown, not wrong', () => {
  for (const input of ['', '1/0', '1/2/3', '1200 рублей', '1%', '1+1', '1e3', 'Infinity', 'NaN', '<script>', '\\frac{1}{2}', '1 200', null, 1200, '9'.repeat(161)])
    assert.equal(checkNumericAnswer(input, '1200').status, 'unknown', String(input))
  assert.throws(() => checkNumericAnswer('1', 'invalid'), /авторский/)
})

test('public problem allowlist excludes solutions, private answers and help', () => {
  for (const problem of percentageProblems) {
    const publicValue = publicPercentageProblem(problem)
    assert.equal(publicValue.kind, 'numeric')
    assert.equal(publicValue.packageId, 'percentages')
    for (const key of ['answer', 'solution', 'help', 'roots', 'equation', 'interval']) assert.equal(Object.hasOwn(publicValue, key), false, key)
    assert.deepEqual(publicValue.skills, [])
    assert.equal(publicValue.description, publicValue.prompt)
  }
})

test('preparation asks a smaller different question, without leaking its answer', () => {
  for (const [id, expected] of [
    ['percent-discount-v1', '150'], ['percent-successive-v1', '600'],
    ['percent-reverse-v1', '500'], ['percent-transfer-v1', '5'],
  ]) {
    const help = percentageHelp(id)
    assert.ok(help.example.steps.length >= 2)
    assert.equal(Object.hasOwn(help.check, 'answer'), false)
    assert.equal(Object.hasOwn(help.check, 'feedback'), false)
    assert.equal(checkPercentagePreparation(id, expected).status, 'correct')
    assert.equal(checkPercentagePreparation(id, '').status, 'unknown')
    assert.equal(checkPercentagePreparation(id, '-99').status, 'incorrect')
  }
  assert.throws(() => percentageHelp('missing'), { status: 404 })
})
