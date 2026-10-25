import test from 'node:test'
import assert from 'node:assert/strict'
import { examRecommendationAction } from './exam-recommendation.ts'

const base = { familyId: 'triangles', title: 'Треугольники', reason: 'Следующий шаг' }

test('repair and review retain the exact source work instead of replacing the attempt', () => {
  for (const goal of ['repair', 'review']) {
    assert.deepEqual(examRecommendationAction({ ...base, goal, source: { workId: 'saved-draft' } }), { kind: 'open', workId: 'saved-draft' })
  }
})

test('independent, spaced recall and new structure actually request solo work', () => {
  for (const goal of ['independent', 'recall', 'new-structure']) {
    assert.deepEqual(examRecommendationAction({ ...base, goal, mode: 'guided' }), { kind: 'start', familyId: base.familyId, mode: 'solo' })
  }
})

test('transfer requests mixed practice and an unknown source stays a choice', () => {
  assert.deepEqual(examRecommendationAction({ ...base, goal: 'transfer' }), { kind: 'mixed' })
  assert.deepEqual(examRecommendationAction({ ...base, goal: 'repair' }), { kind: 'choose', familyId: base.familyId })
  assert.deepEqual(examRecommendationAction({ ...base, goal: 'future-goal' }), { kind: 'choose', familyId: base.familyId })
})
