import assert from 'node:assert/strict'
import test from 'node:test'
import { examCoverage, examCoverageReference } from './exam-coverage.ts'

test('coverage is pinned to 2026 and contains every position exactly once', () => {
  assert.equal(examCoverageReference.year, 2026)
  assert.deepEqual(examCoverage.map(entry => entry.position), Array.from({ length: 19 }, (_, i) => i + 1))
})

test('unavailable positions never offer a misleading package link', () => {
  for (const entry of examCoverage) {
    assert.equal(entry.packageIds.length === 0, entry.status === 'unavailable', `position ${entry.position}`)
    assert.ok(entry.detail.length > 20)
  }
  assert.equal(examCoverage.find(entry => entry.position === 13)?.status, 'limited')
  assert.equal(examCoverage.find(entry => entry.position === 15)?.status, 'foundation')
  assert.equal(examCoverage.find(entry => entry.position === 16)?.status, 'foundation')
})
