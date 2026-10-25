import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { families, createInstance, publicInstance, checkPart } from './registry.mjs'

test('automatic and explicit generation cannot share an identity for different effective parameters', () => {
  const automatic = createInstance('number.percent', 1)
  const explicit = createInstance('number.percent', 1, 'reverse')
  assert.equal(automatic.templateId, explicit.templateId)
  assert.equal(automatic.seed, explicit.seed)
  assert.notEqual(automatic.parameterSeed, explicit.parameterSeed)
  assert.notEqual(automatic.prompt, explicit.prompt)
  assert.notDeepEqual(automatic.parts, explicit.parts)
  assert.notEqual(automatic.id, explicit.id)
  for (const concealMethod of [false, true]) {
    assert.notEqual(publicInstance(automatic, { concealMethod }).id, publicInstance(explicit, { concealMethod }).id)
  }
  assert.deepEqual(createInstance('number.percent', 1), automatic)
  assert.deepEqual(createInstance('number.percent', 1, 'reverse'), explicit)
})

test('catalog identities bind task shape and parameters across both generation entry points', () => {
  const seen = new Map()
  const admit = instance => {
    const { digest, ...payload } = instance
    const bytes = JSON.stringify(payload)
    assert.equal(digest, createHash('sha256').update(bytes).digest('hex'), 'The full instance remains covered by its digest')
    if (seen.has(instance.id)) assert.equal(bytes, seen.get(instance.id), `Identity collision: ${instance.id}`)
    else seen.set(instance.id, bytes)
  }
  for (const family of families) {
    const seeds = [...Array.from({ length: family.templates.length * 4 }, (_, seed) => seed), 2_147_483_647]
    for (const seed of seeds) {
      const automatic = createInstance(family.id, seed)
      admit(automatic)
      for (const template of family.templates) admit(createInstance(family.id, seed, template.id))
      const replay = createInstance(family.id, automatic.parameterSeed, automatic.templateId)
      // Explicit replay of the effective seed must still recover the same task.
      assert.equal(replay.prompt, automatic.prompt)
      assert.deepEqual(replay.parts, automatic.parts)
      assert.equal(replay.templateId, automatic.templateId)
      admit(replay)
    }
  }
})

test('historical frozen identities and their numeric answers project without regeneration', () => {
  const historical = {
    id: 'number.percent:2:reverse:g2:1', familyId: 'number.percent', version: 2,
    generatorVersion: 2, templateId: 'reverse', seed: 1, parameterSeed: 0,
    title: 'Цена до скидки', prompt: 'После скидки 20% цена стала 1600 рублей. Найдите цену до скидки.',
    parts: [{ id: 'answer', label: 'Цена до скидки', kind: 'number', check: 'numeric', expected: 2000 }],
    taskDigest: 'retained-task-digest', digest: 'retained-instance-digest',
  }
  const retained = structuredClone(historical)
  const projected = publicInstance(historical)
  assert.equal(projected.id, retained.id)
  assert.equal(projected.prompt, retained.prompt)
  assert.equal(checkPart(historical.parts[0], '2000').status, 'correct')
  const concealed = publicInstance(historical, { concealMethod: true })
  assert.equal(concealed.id, createHash('sha256').update(retained.id).digest('hex').slice(0, 24))
  assert.equal(concealed.parts[0].expected, undefined)
  const fresh = createInstance('number.percent', 1)
  assert.notEqual(fresh.id, retained.id)
  assert.deepEqual(historical, retained, 'Generating a new task must not rewrite a supplied frozen artifact')
})
