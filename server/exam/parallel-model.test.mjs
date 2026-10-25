import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateParallelModel } from '../../shared/parallel-model.mjs'
import { geometryFamilies } from './geometry-families.mjs'
import { createInstance } from './registry.mjs'

const facts = Object.freeze({ ad: 6, db: 3, ae: 10, ec: 5 })

test('the full-side ratios and common included angle provide a local basis only', () => {
  const result = evaluateParallelModel(facts, 'sides-angle')
  assert.equal(result.status, 'correct')
  assert.deepEqual(result.sides, { ab: 9, ac: 15 })
  assert.deepEqual(result.ratios, { left: 2 / 3, right: 2 / 3 })
  assert.equal(result.parallel, true)
  assert.equal(result.mastery, false)
  assert.match(result.scope, /только выбранное основание/)
  assert.match(result.scope, /ABC невырожден, D внутри AB, E внутри AC/)
  assert.match(result.scope, /Полнота доказательства.*не проверены/)
  assert.deepEqual(facts, { ad: 6, db: 3, ae: 10, ec: 5 })
})

test('changing EC preserves the common angle but removes the proportional-side basis', () => {
  const result = evaluateParallelModel({ ...facts, ec: 6 }, 'sides-angle')
  assert.equal(result.status, 'incorrect')
  assert.deepEqual(result.sides, { ab: 9, ac: 16 })
  assert.deepEqual(result.ratios, { left: 2 / 3, right: 5 / 8 })
  assert.equal(result.parallel, false)
  assert.equal(result.mastery, false)
  // Independent realization: A=(0,0), B=(AB,0), C=(0,AC),
  // D=(AD,0), E=(0,AE); the determinant of DE and BC is nonzero.
  assert.notEqual(-facts.ad * result.sides.ac + facts.ae * result.sides.ab, 0)
})

test('assuming parallel angles is circular even when the numeric conclusion is true', () => {
  const result = evaluateParallelModel(facts, 'parallel-angles')
  assert.equal(result.parallel, true)
  assert.equal(result.status, 'incorrect')
  assert.match(result.summary, /требуется доказать/)
  assert.equal(result.mastery, false)
})

test('alternative and unknown choices remain unverified rather than wrong proofs', () => {
  for (const choice of ['other', '', 'vector-method', 'not-published']) {
    const result = evaluateParallelModel(facts, choice)
    assert.equal(result.status, 'unknown')
    assert.equal(result.parallel, true)
    assert.equal(result.mastery, false)
  }
  assert.match(evaluateParallelModel(facts, 'other').summary, /Фалеса.*векторное/)
})

test('exact cross products distinguish unequal fractions even if Number ratios coincide', () => {
  const close = { ad: 1_000_000_000, db: 999_999_999, ae: 999_999_999, ec: 999_999_998 }
  const result = evaluateParallelModel(close, 'sides-angle')
  assert.equal(result.ratios.left, result.ratios.right, 'This fixture reaches the floating-point ambiguity')
  assert.equal(result.parallel, false)
  assert.equal(result.status, 'incorrect')
  assert.equal(BigInt(close.ad) * BigInt(close.ec) - BigInt(close.ae) * BigInt(close.db), -1n)
  assert.equal(evaluateParallelModel({ ad: 1e9, db: 1e9, ae: 1e9, ec: 1e9 }, 'sides-angle').parallel, true)
})

test('invalid facts fail explicitly without invented ratios or coercion', () => {
  for (const invalid of [null, undefined, [], '6,3,10,5', {}, { ...facts, ec: undefined }]) {
    assert.throws(() => evaluateParallelModel(invalid, 'sides-angle'), RangeError)
  }
  for (const key of ['ad', 'db', 'ae', 'ec']) {
    for (const value of [0, -0, -1, .5, NaN, Infinity, '6', 1_000_000_001, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => evaluateParallelModel({ ...facts, [key]: value }, 'other'), RangeError)
    }
  }
})

test('only new converse-parallel tasks carry the frozen interaction and actual builder lengths', () => {
  const family = geometryFamilies.find(item => item.id === 'geom.plane.similarity')
  assert.equal(family.version, 4)
  for (const item of geometryFamilies) for (const template of item.templates) {
    for (const seed of [0, 1, 9, 2_147_483_647]) {
      const direct = template.build(seed)
      if (template.id !== 'converse-parallel') {
        assert.equal(direct.lesson?.interaction, undefined)
        continue
      }
      const interaction = direct.lesson.interaction
      assert.deepEqual({ id: interaction.id, version: interaction.version, kind: interaction.kind }, {
        id: 'converse-parallel', version: 1, kind: 'converse-parallel',
      })
      assert.ok(interaction.title)
      assert.ok(Object.isFrozen(interaction) && Object.isFrozen(interaction.facts))
      assert.match(direct.prompt, /невырожденном.*внутри AB.*внутри AC/)
      assert.match(direct.prompt, /Параллельность DE и BC не дана/)
      const renderedFacts = Object.fromEntries(['AD', 'DB', 'AE', 'EC'].map(name => [name.toLowerCase(), Number(direct.prompt.match(new RegExp(`${name} = (\\d+)`))[1])]))
      assert.deepEqual(interaction.facts, renderedFacts)
      const result = evaluateParallelModel(interaction.facts, 'sides-angle')
      assert.equal(result.parallel, true)
      assert.equal(-renderedFacts.ad * result.sides.ac + renderedFacts.ae * result.sides.ab, 0)
      const frozen = createInstance(item.id, seed, template.id)
      assert.deepEqual(frozen.lesson.interaction, interaction)
    }
  }
})
