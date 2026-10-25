import test from 'node:test'
import assert from 'node:assert/strict'
import type { ExamSession, ExamWork } from './exam-ui-types.ts'
import { examSessionSummary } from './exam-session-summary.ts'

function work(id: string): ExamWork {
  return { id, familyId: 'family', instance: { id: `instance-${id}`, title: 'Задача', prompt: '', parts: [{ id: 'answer', label: 'Ответ', kind: 'number' }] }, mode: 'review', modeEpoch: 1, revision: 1, answersByPart: { answer: '2' }, reasoning: '', completed: true, updatedAt: '', createdAt: '', attempts: [{ id: `attempt-${id}`, answersByPart: { answer: '2' }, reasoning: '', mode: 'solo', independent: true, createdAt: '' }], evaluations: [{ id: `evaluation-${id}`, attemptId: `attempt-${id}`, partId: 'answer', claim: 'answer', scope: '', status: 'correct', summary: '', active: true }], messages: [], exposure: false }
}

function session(works: ExamWork[]): ExamSession {
  return { id: 'session', edition: '2026', editionStatus: 'final', status: 'submitted', revision: 1, sessionEpoch: 1, currentPosition: 1, deadlineAt: '', remainingSeconds: 0, tasks: works.map((candidate, index) => ({ position: index + 1, maxPoints: 1, workId: candidate.id, work: candidate })) }
}

test('a submitted task belongs to exactly one group; a confirmed fragment never confirms its pending proof', () => {
  const confirmed = work('confirmed'), incorrect = work('incorrect'), blank = work('blank'), proof = work('proof')
  incorrect.evaluations[0].status = 'incorrect'
  blank.answersByPart.answer = ''
  blank.attempts[0].answersByPart!.answer = ''
  proof.instance.parts.push({ id: 'proof', label: 'Обоснование', kind: 'text' })
  proof.reasoning = 'Моя запись'
  proof.attempts[0].reasoning = proof.reasoning
  proof.evaluations.push({ ...proof.evaluations[0], id: 'proof-check', partId: 'proof', status: 'unknown' })
  const result = examSessionSummary(session([confirmed, incorrect, blank, proof]))
  assert.equal(result.kind, 'submitted')
  if (result.kind !== 'submitted') throw Error('Expected submitted summary')
  assert.deepEqual(result.counts, { confirmed: 1, incorrect: 1, skipped: 1, pending: 1 })
  assert.equal(Object.values(result.counts).reduce((sum, value) => sum + value, 0), result.total)
  proof.evaluations[0].status = 'incorrect'
  const withError = examSessionSummary(session([confirmed, incorrect, blank, proof]))
  if (withError.kind !== 'submitted') throw Error('Expected submitted summary')
  assert.deepEqual(withError.counts, { confirmed: 1, incorrect: 2, skipped: 1, pending: 0 })
})

test('partial, changed, unsubmitted and withdrawn evidence all require checking', () => {
  const partial = work('partial'), changed = work('changed'), unsubmitted = work('unsubmitted'), withdrawn = work('withdrawn')
  partial.instance.parts.push({ id: 'other', label: 'Вторая часть', kind: 'number' })
  changed.answersByPart.answer = '3'
  unsubmitted.attempts = []
  withdrawn.evaluations[0].active = false
  const result = examSessionSummary(session([partial, changed, unsubmitted, withdrawn]))
  assert.equal(result.kind, 'submitted')
  if (result.kind !== 'submitted') throw Error('Expected submitted summary')
  assert.deepEqual(result.counts, { confirmed: 0, incorrect: 0, skipped: 0, pending: 4 })
})

test('closed and active sessions expose neither historical check counts nor an accidental score', () => {
  const candidate = session([work('old')])
  candidate.score = { verifiedPoints: 1, maxPoints: 32, pendingProof: 0, summary: 'Old result', final: true }
  candidate.status = 'closed'
  assert.deepEqual(examSessionSummary(candidate), { kind: 'closed' })
  candidate.status = 'active'
  assert.deepEqual(examSessionSummary(candidate), { kind: 'active' })
})

test('valid backend points remain a separate exact lower bound, including zero', () => {
  const candidate = session([work('one')])
  for (const points of [0, 7]) {
    candidate.score = { verifiedPoints: points, maxPoints: 32, pendingProof: 5, summary: 'Not used for counts', final: true }
    const result = examSessionSummary(candidate)
    assert.equal(result.kind, 'submitted')
    if (result.kind !== 'submitted') throw Error('Expected submitted summary')
    assert.deepEqual(result.lowerBound, { points, maxPoints: 32 })
    assert.deepEqual(result.counts, { confirmed: 1, incorrect: 0, skipped: 0, pending: 0 })
    assert.equal('final' in result, false)
  }
})

test('absent or invalid score does not create a zero or estimated score', () => {
  const candidate = session([])
  for (const score of [undefined,
    { verifiedPoints: NaN, maxPoints: 32 }, { verifiedPoints: -1, maxPoints: 32 },
    { verifiedPoints: 33, maxPoints: 32 }, { verifiedPoints: 1.5, maxPoints: 32 },
    { verifiedPoints: 1, maxPoints: 0 }]) {
    candidate.score = score ? { ...score, pendingProof: 0, summary: '', final: false } : undefined
    const result = examSessionSummary(candidate)
    assert.equal(result.kind, 'submitted')
    assert.equal('lowerBound' in result, false)
  }
})
