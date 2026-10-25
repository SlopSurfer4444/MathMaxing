import assert from 'node:assert/strict'
import test from 'node:test'
import { contextualMaterials, hasMaterialContext } from './material-context.ts'

test('family materials vary and independent work does not suggest a method', () => {
  assert.ok(contextualMaterials('G1').some(item => item.id === 'double-angle'))
  assert.ok(!contextualMaterials('G2').some(item => item.id === 'double-angle'))
  assert.ok(contextualMaterials('G3').some(item => item.id === 'unit-circle'))
  for (const family of ['G1', 'G2', 'G3']) {
    assert.equal(contextualMaterials(family).length, 4)
    assert.deepEqual(contextualMaterials(family, true), [])
    assert.equal(hasMaterialContext(family), true)
  }
  assert.equal(hasMaterialContext('unknown'), false)
  assert.equal(hasMaterialContext(), false)
})
