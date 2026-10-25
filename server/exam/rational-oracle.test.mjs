import test from 'node:test'
import assert from 'node:assert/strict'
import { solveRationalSign } from './rational-oracle.mjs'
import { checkIntervalAnswer } from '../topic-packs.mjs'

const f = (a, b, multiplicity = 1) => ({ a, b, multiplicity })
const solve = (numerator, denominator, relation = '>=', coefficient = 1) => solveRationalSign({ numerator, denominator, relation, coefficient })

test('exact rational endpoints, leading signs, and all four relations', () => {
  assert.equal(solve([f(6, -4)], []), '[2/3;inf)')
  assert.equal(solve([f(-6, -4)], [], '>'), '(-inf;-2/3)')
  assert.equal(solve([f(6, -4)], [], '<'), '(-inf;2/3)')
  assert.equal(solve([f(6, -4)], [], '<='), '(-inf;2/3]')
  assert.equal(solve([f(6, -4)], [], '>=', -2), '(-inf;2/3]')
  assert.equal(solve([f(100, -99)], [f(99, -98)], '>='), '(-inf;98/99)∪[99/100;inf)')
  assert.equal(solve([], [f(-3, -2)], '>='), '(-inf;-2/3)')
})

test('multiplicities, equivalent roots and original poles survive all cancellations', () => {
  assert.equal(solve([f(1, -1, 2)], [f(1, -3)]), '[1;1]∪(3;inf)')
  assert.equal(solve([f(2, -2), f(-3, 3)], [], '<='), '(-inf;inf)')
  assert.equal(solve([f(1, -1, 2)], [], '<='), '[1;1]')
  assert.equal(solve([f(1, -1, 2)], [], '>'), '(-inf;1)∪(1;inf)')
  assert.equal(solve([f(1, -1, 2)], [], '>='), '(-inf;inf)')
  assert.equal(solve([f(2, -2)], [f(3, -3)], '>='), '(-inf;1)∪(1;inf)')
  assert.equal(solve([f(1, -1, 3)], [f(1, -1, 2)], '<='), '(-inf;1)')
  assert.equal(solve([f(1, -1)], [f(1, -1, 2)], '>='), '(1;inf)')
  assert.equal(solve([f(1, 0)], [f(1, -2, 2)], '>'), '(0;2)∪(2;inf)')
})

test('constants, empty sets, singleton unions, and zero coefficient domain', () => {
  assert.equal(solve([], [], '>'), '(-inf;inf)')
  assert.equal(solve([], [], '<='), '∅')
  assert.equal(solve([], [], '<', -100), '(-inf;inf)')
  assert.equal(solve([f(1, 1, 2), f(1, -2, 2)], [], '<='), '[-1;-1]∪[2;2]')
  for (const relation of ['>=', '<=']) {
    assert.equal(solve([], [], relation, 0), '(-inf;inf)')
    assert.equal(solve([f(1, 0)], [f(1, -1), f(2, -2), f(3, 2)], relation, 0), '(-inf;-2/3)∪(-2/3;1)∪(1;inf)')
  }
  for (const relation of ['>', '<']) assert.equal(solve([f(1, 0)], [f(1, 0)], relation, 0), '∅')
  assert.equal(solveRationalSign({ relation: '>=' }), '(-inf;inf)')
})

test('rejects out-of-scope expressions instead of approximating or silently ignoring fields', () => {
  for (const value of [null, [], 'x', { relation: '=' }, { relation: '≥' }, { relation: '>=', extra: 1 }]) assert.throws(() => solveRationalSign(value))
  for (const coefficient of [101, -101, 0.5, NaN, Infinity, '1', 1n, null]) assert.throws(() => solveRationalSign({ relation: '>=', coefficient }))
  for (const factor of [f(0, 1), f(101, 0), f(1, -101), f(1.5, 2), f(1, NaN), f(1, 0, 0), f(1, 0, 9), f(1, 0, 1.5), f(1, 0, null), null, { a: 1, b: 0, power: 2 }]) {
    for (const side of ['numerator', 'denominator']) assert.throws(() => solveRationalSign({ relation: '>=', [side]: [factor] }))
  }
  for (const side of ['numerator', 'denominator']) {
    for (const list of [null, {}, new Array(1), Array.from({ length: 9 }, () => f(1, 0))]) assert.throws(() => solveRationalSign({ relation: '>=', [side]: list }))
  }
  assert.equal(solve(Array.from({ length: 8 }, () => f(-100, 100, 8)), [], '>='), '(-inf;inf)')
})

// Independent observer: substitute a rational x into the original factors using
// BigInt arithmetic, and parse the returned intervals without the sign chart.
const cmp = (a, b) => a[0] * b[1] - b[0] * a[1]
const rational = value => value.split('/').map(BigInt).concat(1n).slice(0, 2)
function contains(answer, x) {
  if (answer === '∅') return false
  return answer.split('∪').some(piece => {
    const [lo, hi] = piece.slice(1, -1).split(';')
    const lower = lo === '-inf' || (piece[0] === '[' ? cmp(x, rational(lo)) >= 0n : cmp(x, rational(lo)) > 0n)
    const upper = hi === 'inf' || (piece.at(-1) === ']' ? cmp(x, rational(hi)) <= 0n : cmp(x, rational(hi)) < 0n)
    return lower && upper
  })
}
function originalAccepts(spec, x) {
  const product = list => list.reduce((p, factor) => p * (BigInt(factor.a) * x[0] + BigInt(factor.b) * x[1]) ** BigInt(factor.multiplicity), 1n)
  const denominator = product(spec.denominator)
  if (denominator === 0n) return false
  const signed = BigInt(spec.coefficient) * product(spec.numerator) * denominator
  return spec.relation === '>' ? signed > 0n : spec.relation === '>=' ? signed >= 0n : spec.relation === '<' ? signed < 0n : signed <= 0n
}

test('seeded independent substitution checks original expressions, rational roots, and bounded maximum powers', () => {
  let state = 310323
  const next = n => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n }
  for (let sample = 0; sample < 240; sample++) {
    const makeFactors = () => Array.from({ length: next(9) }, () => f((next(2) ? -1 : 1) * (next(100) + 1), next(201) - 100, next(8) + 1))
    const spec = { coefficient: next(201) - 100, numerator: makeFactors(), denominator: makeFactors(), relation: ['>', '>=', '<', '<='][next(4)] }
    const answer = solveRationalSign(spec)
    const samples = [[-101n, 1n], [101n, 1n], ...Array.from({ length: 50 }, () => [BigInt(next(2001) - 1000), BigInt(next(100) + 1)])]
    const boundaries = [...spec.numerator, ...spec.denominator].map(({ a, b }) => a > 0 ? [-BigInt(b), BigInt(a)] : [BigInt(b), -BigInt(a)]).sort((a, b) => cmp(a, b) < 0n ? -1 : cmp(a, b) > 0n ? 1 : 0)
    samples.push(...boundaries)
    for (let i = 1; i < boundaries.length; i++) {
      const [a, b] = [boundaries[i - 1], boundaries[i]]
      if (cmp(a, b) !== 0n) samples.push([a[0] * b[1] + b[0] * a[1], 2n * a[1] * b[1]])
    }
    for (const x of samples) assert.equal(contains(answer, x), originalAccepts(spec, x), `${JSON.stringify(spec)} at ${x}: ${answer}`)
    assert.equal(checkIntervalAnswer(answer, answer).status, 'correct', answer)
  }
})
