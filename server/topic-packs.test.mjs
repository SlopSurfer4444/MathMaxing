import test from 'node:test'
import assert from 'node:assert/strict'
import { topicProblems, publicTopicProblem, topicHelp, checkTopicAnswer, checkTopicPreparation, checkIntervalAnswer } from './topic-packs.mjs'

test('authored graph tasks have independently calculated answers and axes', () => {
  const answers = ['12', '3', '5']
  topicProblems.filter(p => p.packageId === 'graphs').forEach((p, i) => {
    assert.equal(checkTopicAnswer(p, answers[i]).status, 'correct')
    assert.ok(p.graph.xLabel && p.graph.yLabel)
    assert.ok(p.graph.points.length >= 4)
    assert.equal(checkTopicAnswer(p, '9000').status, 'incorrect')
    assert.equal(checkTopicAnswer(p, 'y = x + 2').status, 'unknown')
  })
})
test('inequalities distinguish linear sign change, product roots and forbidden denominator', () => {
  const answers = { 'inequality-linear-v1': 'x <= 4', 'inequality-negative-v1': 'x > 3', 'inequality-product-v1': '[2; +∞) ∪ (−∞; -1]', 'inequality-domain-v1': '[2;inf) U (-inf;-1)' }
  for (const [id, answer] of Object.entries(answers)) assert.equal(checkTopicAnswer(id, answer).status, 'correct', id)
  assert.equal(checkTopicAnswer('inequality-domain-v1', '(-inf;-1] U [2;inf)').status, 'incorrect')
  assert.equal(checkTopicAnswer('inequality-negative-v1', '[3;inf)').status, 'incorrect')
})
test('interval grammar is exact, canonicalizes unions and never evaluates expressions', () => {
  for (const [a, b] of [['[0;1] U (1;2]', '[0;2]'], ['[0,5;3/2]', '[1/2;1.5]'], ['[2;3] U [1;2]', '[1;3]'], ['(1;1)', '∅'], ['x≥-2', '[-2;inf)']]) assert.equal(checkIntervalAnswer(a, b).status, 'correct', a)
  assert.equal(checkIntervalAnswer('(0;1) U (1;2)', '(0;2)').status, 'incorrect')
  assert.equal(checkIntervalAnswer('[0;1.00000000000000000000001]', '[0;1]').status, 'incorrect')
  for (const value of ['[0;1/0]', '[−∞;2]', '[3;1]', '(0;NaN)', 'process.exit()', 'x*x>0', 'x > inf', '[0,2]']) assert.equal(checkIntervalAnswer(value, '[0;2]').status, 'unknown', value)
})
test('public problem and mini-check payloads exclude grading answers', () => {
  for (const p of topicProblems) {
    const pub = publicTopicProblem(p), h = topicHelp(p)
    assert.equal('answer' in pub, false)
    assert.equal('solution' in pub, false)
    assert.equal('help' in pub, false)
    assert.deepEqual(pub.skills, [])
    assert.equal('answer' in h.check, false)
    assert.equal('feedback' in h.check, false)
    assert.equal(checkTopicPreparation(p, p.help.check.answer).status, 'correct')
    assert.ok(h.introduction.length > 60 && h.steps.length >= 3)
    assert.ok(h.example.steps.length >= 2)
    assert.ok(h.why.length > 200, `${p.id} explains the rule beyond its worked example`)
    assert.equal('why' in pub, false)
  }
})
test('alternative interval forms preserve all endpoint semantics', () => {
  for (const [a, b] of [['2 >= x', '(-inf;2]'], ['-1 < x ≤ 2', '(-1;2]'], ['2 ≥ x > -1', '(-1;2]'], ['x ∈ [1/2; 2]', '[0,5;2]'], ['[1/-2;2]', '[-0.5;2]']]) assert.equal(checkIntervalAnswer(a, b).status, 'correct', a)
  for (const a of ['2 < x < -1', '-1 < x > 2', 'x ∈ [1/0;2]', '(inf;inf)']) assert.equal(checkIntervalAnswer(a, '[0;2]').status, 'unknown', a)
})
