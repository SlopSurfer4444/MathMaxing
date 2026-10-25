import test from 'node:test'
import assert from 'node:assert/strict'
import { percentageProblems, checkNumericAnswer, publicPercentageProblem, percentageHelp } from './percentages.mjs'
import { percentageVariantFromId, nextPercentageVariant } from './percentage-variants.mjs'

const families = ['discount', 'successive', 'reverse', 'comparison']
const from = (family, seed) => percentageVariantFromId(`percent-practice-v1-${family}-${seed}`)

test('generated IDs accept only exact families, versions and canonical uint32 seeds', () => {
  for (const bad of [null, 1, {}, 'percent-practice-v1-discount--1', 'percent-practice-v1-discount-01',
    'percent-practice-v1-discount-1.0', 'percent-practice-v1-discount-1e2',
    'percent-practice-v1-discount-4294967296', 'percent-practice-v1-discount-9999999999',
    'percent-practice-v2-discount-1', 'percent-practice-v1-transfer-1',
    'percent-practice-v1-DISCOUNT-1', 'percent-practice-v1-discount-1-extra'])
    assert.equal(percentageVariantFromId(bad), null, String(bad))
  for (const family of families) {
    assert.ok(from(family, 0))
    assert.ok(from(family, 0xffffffff))
  }
})

test('all four families reconstruct deterministically with exact arithmetic at seed boundaries', () => {
  for (const family of families) for (const seed of [0, 1, 2, 3, 4, 5, 6, 127, 99999, 0xfffffffe, 0xffffffff]) {
    const problem = from(family, seed)
    assert.deepEqual(from(family, seed), problem)
    const { initial, percent } = problem.generation.parameters
    const n = BigInt(initial), p = BigInt(percent)
    const finalNumerator = n * (100n - p) * (100n + p)
    if (family !== 'discount') assert.equal(finalNumerator % 10000n, 0n, 'two changes have exact integer prices')
    const expected = family === 'discount' ? `${n * (100n - p)}/100`
      : family === 'reverse' ? String(n)
        : family === 'comparison' ? `${p * p}/100`
          : `${finalNumerator}/10000`
    assert.equal(checkNumericAnswer(problem.answer, expected).status, 'correct', problem.id)
    assert.equal(problem.packageId, 'percentages')
    assert.equal(problem.kind, 'numeric')
    assert.equal(problem.percentageFamily, family)
    assert.equal(problem.description, problem.prompt)
    assert.ok(problem.skills.length >= 2)
    assert.equal(problem.generation.generatorVersion, 1)
    assert.ok(!problem.solution.includes('undefined'))
    const publicProblem = publicPercentageProblem(problem)
    assert.equal(publicProblem.answer, undefined)
    assert.equal(publicProblem.generation, undefined)
    assert.equal(percentageHelp(problem).check.answer, undefined)
  }
})

test('retries stay at the same skill and avoid authored/seen IDs and prompts', () => {
  for (const [index, source] of percentageProblems.entries()) {
    const history = [{ problemId: source.id }]
    let current = source
    const prompts = new Set([source.prompt]), ids = new Set([source.id])
    for (let i = 0; i < 80; i++) {
      const next = nextPercentageVariant(current, history)
      assert.equal(next.percentageFamily, families[index])
      assert.deepEqual(next.skills, source.skills)
      assert.ok(!ids.has(next.id))
      assert.ok(!prompts.has(next.prompt))
      history.push({ problemId: next.id })
      ids.add(next.id); prompts.add(next.prompt)
      current = next
    }
  }
})

test('prompt fences work even when history carries an unrecognized ID', () => {
  const source = percentageProblems[0], blocked = from('discount', 0)
  const history = [{ id: 'external', prompt: blocked.prompt }, from('discount', 1).id,
    { problem: from('discount', 2) }]
  const original = structuredClone(history)
  assert.equal(nextPercentageVariant(source, history).id, from('discount', 3).id)
  assert.deepEqual(history, original)
  assert.equal(nextPercentageVariant(from('discount', 0xffffffff)).id, from('discount', 0).id)
})

test('unknown sources and mismatched families cannot silently advance or choose another skill', () => {
  for (const bad of [null, {}, { ...percentageProblems[0], packageId: 'percent' },
    { ...percentageProblems[0], percentageFamily: 'reverse' },
    { ...percentageProblems[0], kind: 'roots' },
    { ...percentageProblems[0], id: 'percent-practice-v1-discount-4294967296' }])
    assert.equal(nextPercentageVariant(bad), null)
  const source = from('discount', 7)
  for (const conflict of [{ family: 'reverse' }, { seed: 999 }, { family: 'discount-extra' },
    { seed: -1 }, { seed: 4294967296 }, { seed: '7' }, { packageVersion: 2 }, { generatorVersion: 2 }])
    assert.equal(nextPercentageVariant({ ...source, generation: { ...source.generation, ...conflict } }), null)
})

test('trusted frozen metadata identifies retired variants and respects their seed and family', () => {
  for (const family of families) {
    const frozen = { ...from(family, 7), id: `retired-${family}-variant` }
    assert.equal(nextPercentageVariant(frozen).id, from(family, 8).id)
    const withoutFamilyTag = { ...frozen }
    delete withoutFamilyTag.percentageFamily
    assert.equal(nextPercentageVariant(withoutFamilyTag).id, from(family, 8).id)
    assert.equal(nextPercentageVariant({ ...frozen, percentageFamily: 'unknown' }), null)
    assert.equal(nextPercentageVariant({ ...frozen, generation: { family, seed: 7 } }), null)
    assert.equal(nextPercentageVariant({ ...frozen, generation: { ...frozen.generation, seed: 0xffffffff } }).generation.seed, 0)
    const seen = { ...from(family, 8), id: 'retired-next-variant', prompt: 'Previous wording' }
    assert.equal(nextPercentageVariant(frozen, [seen]).id, from(family, 9).id)
  }
})

test('authored help is copied privately and the reused successive example asks its question', () => {
  const before = structuredClone(percentageProblems)
  for (const [index, family] of families.entries()) {
    const value = from(family, 0)
    assert.equal(value.help.why, percentageProblems[index].help.why)
    assert.deepEqual(value.help.check, percentageProblems[index].help.check)
    value.help.steps.push('local edit')
  }
  assert.deepEqual(percentageProblems, before)
  assert.match(from('successive', 0).help.example.prompt, /Сколько рублей стоит билет теперь\?$/)
})
