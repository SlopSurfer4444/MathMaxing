import test from 'node:test'
import assert from 'node:assert/strict'
import { getFamily, createInstance, publicInstance } from './registry.mjs'

test('automatic template selection reaches consecutive parameter seeds in every structure', () => {
  for (const familyId of ['model.optimization', 'distribution.normal', 'model.text', 'algebra.equations.radical']) {
    const family = getFamily(familyId)
    const seen = new Map(family.templates.map(template => [template.id, []]))
    for (let seed = 0; seed < family.templates.length * 12; seed++) {
      const instance = createInstance(familyId, seed)
      seen.get(instance.templateId).push(instance.parameterSeed)
      const direct = createInstance(familyId, instance.parameterSeed, instance.templateId)
      assert.equal(instance.prompt, direct.prompt)
      assert.deepEqual(instance.parts, direct.parts)
      assert.equal('parameterSeed' in publicInstance(instance), false)
      assert.equal(instance.generatorVersion, 2)
      assert.match(instance.id, /:g2:/)
      assert.equal('generatorVersion' in publicInstance(instance), false)
    }
    for (const values of seen.values()) assert.deepEqual(values, Array.from({ length: 12 }, (_, i) => i))
  }
})

test('actual normal-family assignment varies both questions instead of tying z to template parity', () => {
  const answers = new Map()
  for (let seed = 0; seed < 40; seed++) {
    const instance = createInstance('distribution.normal', seed)
    if (!answers.has(instance.templateId)) answers.set(instance.templateId, new Set())
    answers.get(instance.templateId).add(String(instance.parts[0].expected))
  }
  for (const values of answers.values()) assert.ok(values.size >= 2, 'each normal question must exercise both authored z values')
})
