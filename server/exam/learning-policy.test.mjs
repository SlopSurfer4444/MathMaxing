import test from 'node:test'
import assert from 'node:assert/strict'
import { selectLearningRoute, summarizeLearnerEvidence } from './learning-policy.mjs'
const families = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }]
const now = Date.parse('2026-10-23T10:00:00Z')
const event = overrides => ({ id: 'event', attemptId: 'attempt', familyId: 'a', workId: 'work', status: 'correct', independent: true, createdAt: new Date(now).toISOString(), ...overrides })
test('assisted success calls for a fresh independent task, never a mastery percentage', () => {
  const route = selectLearningRoute({ families, observations: [event({ independent: false })], now })
  assert.equal(route.recommendations[0].goal, 'independent')
  assert.equal(route.recommendations[0].mode, 'solo')
  assert.equal(route.plannedSessions.length, 3)
  assert.equal('mastery' in route.learnerMemory[0], false)
})
test('a completed unverified proof is not an endless repair gate', () => {
  const route = selectLearningRoute({ families, observations: [event({ status: 'unknown' })], workSummaries: [{ id: 'work', completed: true }], now })
  assert.equal(route.recommendations[0].goal, 'new-structure')
  assert.equal(route.recommendations[0].source.attemptId, 'attempt')
})
test('revisable latest observations, elapsed time and refusal cooldown change suggestions', () => {
  const old = event({ id: 'old', createdAt: '2026-10-10T10:00:00Z' })
  assert.equal(selectLearningRoute({ families, observations: [old], now }).recommendations[0].goal, 'recall')
  const repaired = event({ id: 'new', status: 'incorrect' })
  assert.equal(selectLearningRoute({ families, observations: [old, repaired], now }).learnerMemory[0].observationId, 'new')
  const cooled = selectLearningRoute({ families, observations: [repaired], dismissed: [{ familyId: 'a', until: new Date(now + 1000).toISOString() }], now })
  assert.equal(cooled.recommendations.some(r => r.familyId === 'a'), false)
})

test('repeated attempts in one work do not become a recurring difficulty across tasks', () => {
  const events = Array.from({ length: 4 }, (_, i) => event({ id: `e${i}`, status: 'incorrect', createdAt: new Date(now - i * 1000).toISOString() }))
  assert.equal(summarizeLearnerEvidence(events, now)[0].supportHypothesis, null)
  const otherWork = event({ id: 'another', workId: 'another-work', status: 'incorrect', createdAt: new Date(now - 500).toISOString() })
  const repeated = summarizeLearnerEvidence([...events, otherWork], now)[0]
  assert.equal(repeated.distinctWorkCount, 2)
  assert.deepEqual(new Set(repeated.supportHypothesis.observationIds), new Set(['e0', 'another']))
  const corrected = event({ id: 'fixed', createdAt: new Date(now + 1).toISOString() })
  assert.equal(summarizeLearnerEvidence([...events, otherWork, corrected], now)[0].supportHypothesis, null)
})

test('memory bounds each family and records dated independence instead of inventing mastery', () => {
  const events = Array.from({ length: 80 }, (_, i) => event({ id: `b${i}`, familyId: 'b', workId: `bwork${i}`, createdAt: new Date(now - i * 1000).toISOString() }))
  events.push(event({ id: 'old-a', createdAt: '2026-10-10T10:00:00Z' }))
  const memories = summarizeLearnerEvidence(events, now)
  const old = memories.find(memory => memory.familyId === 'a')
  assert.equal(old.observationId, 'old-a')
  assert.equal(old.daysSinceIndependent, 13)
  assert.equal(old.recentEvidence[0].attemptId, 'attempt')
  assert.equal(memories.find(memory => memory.familyId === 'b').independentCorrectCount, 12)
  assert.equal(memories.find(memory => memory.familyId === 'b').recentEvidence.length, 6)
  assert.equal('mastery' in old, false)
})
