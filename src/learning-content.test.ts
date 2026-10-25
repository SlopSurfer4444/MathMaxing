import assert from 'node:assert/strict'
import test from 'node:test'
import { learningEpisodes, learningCheck } from './learning-content.ts'

test('each episode has checked practice and a transfer action', () => {
  assert.equal(learningEpisodes.length, 10)
  for (const episode of learningEpisodes) {
    assert.ok(episode.checks.length >= 2)
    assert.equal(episode.checks[1].transfer, true)
    assert.notEqual(episode.checks[0].prompt, episode.checks[1].prompt)
    for (const check of episode.checks) assert.equal(learningCheck(check, check.answer).status, 'correct', check.id)
  }
})
test('roots include both endpoints; order and reduced fractions are immaterial', () => {
  const check = learningEpisodes.find(e => e.id === 'K6')!.checks[1]
  assert.equal(learningCheck(check, '2pi/6;-4pi/6').status, 'correct')
  assert.equal(learningCheck(check, 'pi/3').status, 'incorrect')
  assert.equal(learningCheck(check, '\\frac{\\pi}{3};-\\frac{2\\pi}{3}').status, 'correct')
})
test('reading failure is unknown, never mathematical failure', () => {
  const check = { ...learningEpisodes.find(e => e.id === 'K1')!.checks[1], answer: '1/4' }
  for (const answer of ['не уверен', '1/0', '', '1+2', '(1)(4)', '\\sqrt{2}', '999999999999999999999999999']) assert.equal(learningCheck(check, answer).status, 'unknown', answer)
  assert.equal(learningCheck(check, '-1/4').status, 'incorrect')
  assert.equal(learningCheck(check, '\\frac{2}{8}').status, 'correct')
  assert.equal(learningCheck(check, '\\frac14').status, 'correct')
})
test('negative parameter and two branches retain independent reference answers', () => {
  assert.equal(learningCheck(learningEpisodes.find(e => e.id === 'K5')!.checks[2], '-11pi/6').status, 'correct')
  const transfer = learningEpisodes.find(e => e.id === 'M3')!.checks[1]
  assert.equal(learningCheck(transfer, 'pi;0;pi/3').status, 'correct')
  assert.equal(learningCheck(transfer, 'pi/3;pi').status, 'incorrect')
})

test('meaning comes before notation and revised checks never reuse old identities', () => {
  const first = learningEpisodes[0].checks[0]
  assert.equal(first.kind, 'values')
  assert.equal(learningCheck(first, '-1').status, 'correct')
  assert.equal(learningCheck(first, 'pi').status, 'incorrect')
  assert.ok(!learningEpisodes[0].example.includes('pi'))
  const transfer = learningEpisodes[0].checks[1]
  assert.equal(transfer.id, 'K1-b-v3')
  assert.equal(learningCheck(transfer, '0').status, 'correct')
  assert.equal(learningCheck(transfer, '-1').status, 'incorrect')
  assert.equal(learningCheck(transfer, '1/4').status, 'incorrect')
  for (const episode of learningEpisodes) for (const check of episode.checks) assert.match(check.id, /-v[23]$/)
})
test('own general solutions accept equivalent unions but reject lost branches', () => {
  const single = learningEpisodes.find(e => e.id === 'K5')!.checks[1]
  assert.equal(learningCheck(single, 'x=2pi k; x=pi+2pi m').status, 'correct')
  assert.equal(learningCheck(single, 'x=2pi k').status, 'incorrect')
  const assembly = learningEpisodes.find(e => e.id === 'M1')!.checks[1]
  assert.equal(learningCheck(assembly, 'x=pi/2+pi k; x=-pi/6+2pi n; x=-5pi/6+2pi m').status, 'correct')
  assert.equal(learningCheck(assembly, 'x=-pi/6+2pi n; x=-5pi/6+2pi m').status, 'incorrect')
  assert.equal(learningCheck(assembly, 'x=pi/k').status, 'unknown')
})
test('assembly checks all branches on its own interval and does not blindly include endpoints', () => {
  const assembly = learningEpisodes.find(e => e.id === 'M1')!
  assert.equal(assembly.checks.length, 3)
  const roots = assembly.checks[2]
  assert.equal(learningCheck(roots, '-5pi/6;-pi/2;-pi/6;pi/2').status, 'correct')
  assert.equal(learningCheck(roots, '-pi;-5pi/6;-pi/2;-pi/6;pi/2;pi').status, 'incorrect')
  assert.equal(learningCheck(learningEpisodes.find(e => e.id === 'K6')!.checks[1], '-2pi/3;pi/3;pi/2').status, 'incorrect')
})
test('quadratic substitution requires all algebraic roots before range filtering and return to x', () => {
  const checks = learningEpisodes.find(e => e.id === 'M2')!.checks
  assert.equal(learningCheck(checks[0], '2;1/2').status, 'correct')
  assert.equal(learningCheck(checks[0], '1/2').status, 'incorrect')
  assert.equal(learningCheck(checks[1], '1/2;2').status, 'incorrect')
  assert.equal(learningCheck(checks[1], '1/2').status, 'correct')
  assert.equal(learningCheck(checks[2], 'pi/6;5pi/6').status, 'correct')
})

test('circle probes distinguish cosine from sine and invalidate the previous repeated probe', () => {
  const [cosine, sine] = learningEpisodes.find(episode => episode.id === 'K3')!.checks
  assert.equal(cosine.id, 'K3-a-v3')
  assert.match(cosine.prompt, /косинус/)
  assert.match(cosine.prompt, /слева/)
  assert.equal(learningCheck(cosine, '-1').status, 'correct')
  assert.equal(learningCheck(cosine, '0').status, 'incorrect')
  assert.match(sine.prompt + sine.options?.join(''), /7\\pi\/6/)
})
