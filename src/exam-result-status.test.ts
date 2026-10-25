import test from 'node:test'
import assert from 'node:assert/strict'
import { examResultStatus } from './exam-result-status.ts'
import type { ExamWork } from './exam-ui-types.ts'

function work(): ExamWork {
  return { id: 'work', familyId: 'family', instance: { id: 'instance', title: 'Задача', prompt: '', parts: [{ id: 'number', label: 'Ответ', kind: 'number' }] }, mode: 'review', modeEpoch: 0, revision: 1, answersByPart: { number: '2' }, reasoning: '', completed: true, updatedAt: '', createdAt: '', attempts: [{ id: 'latest', answersByPart: { number: '2' }, reasoning: '', mode: 'solo', independent: true, createdAt: '' }], evaluations: [{ id: 'eval', attemptId: 'latest', partId: 'number', claim: '', scope: '', status: 'correct', summary: '', active: true }], messages: [], exposure: false }
}

test('blank and explicit skipped tasks remain distinct from checked or unsubmitted work', () => {
  const candidate = work()
  candidate.answersByPart = { number: '  ' }
  assert.equal(examResultStatus(candidate).kind, 'blank')
  assert.equal(examResultStatus(candidate, 'skipped').kind, 'skipped')
  candidate.answersByPart.number = '2'
  candidate.attempts = []
  assert.equal(examResultStatus(candidate).kind, 'unsubmitted')
})

test('only all current public parts confirmed can produce confirmed answers', () => {
  const candidate = work()
  assert.equal(examResultStatus(candidate).kind, 'correct')
  candidate.instance.parts.push({ id: 'other', label: 'Второй ответ', kind: 'number' })
  candidate.answersByPart.other = '3'
  candidate.attempts[0].answersByPart!.other = '3'
  assert.equal(examResultStatus(candidate).kind, 'partial')
})

test('correct numeric answer plus unknown proof never becomes a fully confirmed task', () => {
  const candidate = work()
  candidate.instance.parts.push({ id: 'proof', label: 'Обоснование', kind: 'text' })
  candidate.reasoning = 'Моя запись'
  candidate.attempts[0].reasoning = candidate.reasoning
  candidate.evaluations.push({ ...candidate.evaluations[0], id: 'proof-eval', partId: 'proof', status: 'unknown' })
  assert.equal(examResultStatus(candidate).kind, 'pending-proof')
  assert.match(examResultStatus(candidate).detail, /Часть ответов подтверждена/)
  candidate.evaluations[0].status = 'incorrect'
  assert.equal(examResultStatus(candidate).kind, 'incorrect')
  assert.match(examResultStatus(candidate).detail, /обоснование не проверено/)
})

test('a missing proof stays partial, distinct from a submitted proof awaiting verification', () => {
  const candidate = work()
  candidate.instance.parts.push({ id: 'proof', label: 'Обоснование', kind: 'text' })
  assert.equal(examResultStatus(candidate).kind, 'partial')
  assert.match(examResultStatus(candidate).detail, /обоснование не записано/)
})

test('withdrawn evaluation and an old attempt do not confirm the latest answer', () => {
  const candidate = work()
  candidate.evaluations[0].active = false
  assert.equal(examResultStatus(candidate).kind, 'pending')
  candidate.evaluations[0].active = true
  candidate.evaluations[0].attemptId = 'old'
  candidate.attempts.unshift({ ...candidate.attempts[0], id: 'old' })
  assert.equal(examResultStatus(candidate).kind, 'pending')
})

test('edited answers, edited proofs and absent submitted snapshots cannot inherit confirmations', () => {
  const candidate = work()
  candidate.answersByPart.number = '3'
  assert.equal(examResultStatus(candidate).kind, 'pending')
  candidate.answersByPart.number = '2'
  candidate.instance.parts.push({ id: 'proof', label: 'Доказательство', kind: 'text' })
  candidate.reasoning = 'Изменено'
  assert.equal(examResultStatus(candidate).kind, 'pending')
  candidate.reasoning = ''
  delete candidate.attempts[0].answersByPart
  assert.equal(examResultStatus(candidate).kind, 'pending')
})
