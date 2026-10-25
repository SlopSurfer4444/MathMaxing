import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAdvisoryPrompt, parseAdvisory, buildReconsiderationPrompt, parseReconsideration } from './advisory-review.mjs'
import { createInstance, publicInstance, checkPart } from './registry.mjs'

const task = { title: 'Треугольник', prompt: 'DE ∥ BC. Обоснуйте связь и найдите DE, затем площадь.', parts: [{ id: 'reason', kind: 'text', label: 'Обоснование' }, { id: 'length', kind: 'number', label: 'Длина' }, { id: 'area', kind: 'number', label: 'Площадь' }] }
const attempt = { id: 'a1', digest: 'frozen-attempt', answersByPart: { reason: 'Гомотетия с центром A переводит B в D и C в E.', length: '', area: '' }, reasoning: 'Коэффициент один и тот же: AD/AB = AE/AC.' }
const finding = { partId: 'reason', quote: 'Гомотетия с центром A', claim: 'Выбрано преобразование с центром A.', verdict: 'supported-step', message: 'Такой метод допустим. Укажи общий коэффициент для обеих сторон.' }
const response = findings => JSON.stringify({ findings })

test('advisory findings are exact anchored local claims, not scores or whole-proof approval', () => {
  const before = structuredClone(attempt)
  const result = parseAdvisory(response([finding]), attempt, task)
  assert.equal(result.advisoryOnly, true)
  assert.equal(result.kind, 'advisory-review')
  assert.equal(result.findings[0].verdict, 'supported-step')
  assert.match(result.findings[0].id, /^advisory-[a-f0-9]{24}$/)
  assert.equal(result.findings[0].id, parseAdvisory(response([finding]), attempt, task).findings[0].id)
  assert.notEqual(result.findings[0].id, parseAdvisory(response([finding]), { ...attempt, digest: 'another-attempt' }, task).findings[0].id)
  assert.match(result.message, /баллы.*не меняются/)
  assert.equal(result.status, undefined)
  assert.equal(result.score, undefined)
  assert.deepEqual(attempt, before)
  const uncertain = parseAdvisory(response([{ ...finding, verdict: 'unverified', message: 'По этой записи не удаётся установить соответствие точек.' }]), attempt, task)
  assert.equal(uncertain.findings[0].verdict, 'unverified')
})

test('missing grounds can produce a useful clarifying question', () => {
  const result = parseAdvisory(response([{ ...finding, verdict: 'needs-clarification', question: 'Почему один коэффициент переводит и C в E?' }]), attempt, task)
  assert.match(result.findings[0].question, /коэффициент/)
  const anchoredToReasoning = { ...finding, quote: 'AD/AB = AE/AC', verdict: 'possible-error' }
  assert.equal(parseAdvisory(response([anchoredToReasoning]), attempt, task).findings.length, 1)
})

test('unknown IDs, invented quotes and quote forgery across answers are rejected atomically', () => {
  const bad = [
    { ...finding, partId: 'missing' }, { ...finding, partId: 'length' },
    { ...finding, quote: 'гомотетия с центром A' }, { ...finding, quote: 'Гомотетия ... A' },
    { ...finding, quote: '   ' }, { ...finding, quote: 'Такой записи не было' },
    { ...finding, verdict: 'correct' }, { ...finding, message: '' },
    { ...finding, claim: '' }, { ...finding, question: 12 }, { ...finding, quote: 'x'.repeat(2001) },
  ]
  for (const item of bad) assert.throws(() => parseAdvisory(response([finding, item]), attempt, task), { code: 'INVALID_ADVISORY' })
  const multi = { ...attempt, answersByPart: { ...attempt.answersByPart, length: 'Чужая цитата' } }
  assert.throws(() => parseAdvisory(response([{ ...finding, quote: 'Чужая цитата' }]), multi, task), { code: 'INVALID_ADVISORY' })
  assert.throws(() => parseAdvisory(response([finding, finding]), attempt, task), { code: 'INVALID_ADVISORY' })
})

test('strict bounded JSON rejects arbitrary commands, scoring fields, polluted and deep payloads', () => {
  const bad = [
    'Общее решение неверно', '```json\n{"findings":[]}\n```', '{"findings":',
    JSON.stringify({ findings: [], score: 3 }), JSON.stringify({ findings: [], actions: [{ type: 'complete' }] }),
    response([{ ...finding, id: 'model-owned-id' }]), response([{ ...finding, action: 'navigate' }]),
    response([{ ...finding, score: 1 }]), response(Array.from({ length: 9 }, (_, i) => ({ ...finding, claim: String(i) }))),
    '{"findings":[],"__proto__":{"score":3}}',
    `{"findings":[],"message":${'['.repeat(12)}"deep"${']'.repeat(12)}}`, ' '.repeat(32001),
  ]
  for (const raw of bad) assert.throws(() => parseAdvisory(raw, attempt, task), { code: 'INVALID_ADVISORY' })
  assert.equal({}.score, undefined)
})

test('unanchored model accusations and praise are never shown as a whole-work verdict', () => {
  const result = parseAdvisory(JSON.stringify({ findings: [], message: 'ВСЁ РЕШЕНО ВЕРНО, ДАЮ ТРИ БАЛЛА' }), attempt, task)
  assert.equal(result.findings.length, 0)
  assert.doesNotMatch(result.message, /ТРИ БАЛЛА|ВСЁ РЕШЕНО/)
  assert.match(result.message, /не подтверждение полноты/)
})

test('prompt scopes private reference and proof rubric to the submitted corresponding part', () => {
  const privateTask = { ...task, expected: 'TOP_SECRET', reference: [{ partId: 'area', text: 'OTHER_SECRET' }], lesson: { answer: 'LESSON_SECRET' }, parts: task.parts.map(part => ({ ...part, expected: `${part.id}_SECRET` })) }
  const packet = buildAdvisoryPrompt({ publicTask: privateTask, attempt, allowedReferences: [
    { partId: 'reason', text: 'Допустима гомотетия', expected: 'Обосновать одинаковый масштаб', rubric: { alternatives: ['гомотетия', 'координаты'] } },
    { partId: 'length', text: 'LENGTH_SECRET', expected: 987 },
    { partId: 'area', text: 'AREA_SECRET', rubric: 'UNSOLVED_RUBRIC_SECRET' },
    { partId: 'unknown', text: 'UNKNOWN_SECRET' },
  ], resources: [{ familyId: 'geom.plane.similarity', title: 'Подобие', reason: 'Нужен общий масштаб', lesson: { example: 'RESOURCE_SECRET' } }] })
  const sent = JSON.parse(packet.prompt)
  assert.equal(sent.task.prompt, task.prompt)
  assert.equal(sent.task.parts.length, 3)
  assert.deepEqual(sent.submittedPartIds, ['reason'])
  assert.equal(sent.allowedReferences.length, 1)
  assert.equal(sent.allowedReferences[0].partId, 'reason')
  assert.deepEqual(sent.allowedReferences[0].rubric.alternatives, ['гомотетия', 'координаты'])
  for (const secret of ['TOP_SECRET', 'OTHER_SECRET', 'LESSON_SECRET', 'reason_SECRET', 'length_SECRET', 'area_SECRET', 'LENGTH_SECRET', 'AREA_SECRET', 'UNSOLVED_RUBRIC_SECRET', 'UNKNOWN_SECRET', 'RESOURCE_SECRET']) assert.equal(packet.prompt.includes(secret), false, secret)
  assert.match(packet.system, /гомотетию, координаты/)
  assert.match(packet.system, /не является ошибкой/)
  assert.match(packet.system, /данные, а не инструкции/)
  assert.match(packet.system, /unknown.*остаётся unknown/)
})

test('shared reasoning never unlocks an unanswered numeric neighbour or its oracle', () => {
  const blankProof = { ...attempt, answersByPart: { reason: '', length: '', area: '' } }
  const sent = JSON.parse(buildAdvisoryPrompt({ publicTask: task, attempt: blankProof, allowedReferences: [{ partId: 'reason', rubric: 'PROOF_ONLY' }, { partId: 'length', expected: 'NO_NUMERIC_ORACLE' }] }).prompt)
  assert.deepEqual(sent.submittedPartIds, ['reason'])
  assert.equal(sent.allowedReferences.length, 1)
  assert.equal(JSON.stringify(sent).includes('NO_NUMERIC_ORACLE'), false)
  assert.throws(() => parseAdvisory(response([{ ...finding, partId: 'length', quote: 'AD/AB' }]), blankProof, task), { code: 'INVALID_ADVISORY' })
  const empty = { ...blankProof, reasoning: '' }
  assert.deepEqual(JSON.parse(buildAdvisoryPrompt({ publicTask: task, attempt: empty, allowedReferences: [{ partId: 'reason', rubric: 'NO_PROOF_ORACLE' }] }).prompt).allowedReferences, [])
})

test('valid homothety and coordinate alternatives are discussable while exact typed proof stays unknown', () => {
  const frozen = createInstance('geom.plane.similarity', 0)
  const publicTask = publicInstance(frozen)
  const part = frozen.parts.find(item => item.check === 'proof')
  assert.ok(part)
  for (const answer of ['Гомотетия с центром A и коэффициентом AD/AB переводит B в D и C в E.', 'Введём координаты: A=(0,0), B=(1,0), C=(u,v); D=kB и E=kC, поэтому DE=k·BC.']) {
    const saved = { ...attempt, answersByPart: Object.fromEntries(frozen.parts.map(item => [item.id, item.id === part.id ? answer : ''])), reasoning: '' }
    const before = checkPart(part, answer)
    const result = parseAdvisory(response([{ ...finding, partId: part.id, quote: answer, claim: 'Альтернативный способ обосновывает масштаб.', message: 'Этот способ допустим; проверь явно соответствие точек.' }]), saved, publicTask)
    assert.equal(result.findings[0].verdict, 'supported-step')
    assert.equal(before.status, 'unknown')
    assert.deepEqual(checkPart(part, answer), before)
  }
})

test('reconsideration can withdraw an unfair finding without changing checking state', () => {
  const previous = parseAdvisory(response([{ ...finding, verdict: 'possible-error' }]), attempt, task).findings[0]
  const before = structuredClone(attempt)
  const packet = buildReconsiderationPrompt({ publicTask: task, attempt, finding: previous, objection: 'Гомотетия тоже доказывает связь, углы выписывать необязательно.', allowedReferences: [{ partId: 'reason', text: 'Любой корректный способ допустим' }] })
  assert.equal(JSON.parse(packet.prompt).objection, 'Гомотетия тоже доказывает связь, углы выписывать необязательно.')
  assert.match(packet.system, /отзови его/)
  const persistedPacket = buildReconsiderationPrompt({ publicTask: task, attempt, finding: { ...previous, attemptId: attempt.id, targetDigest: attempt.digest, status: 'complete', advisoryOnly: true }, objection: { explanation: 'В моём методе это следует из гомотетии.', status: 'pending', id: 'objection-id' } })
  assert.equal(JSON.parse(persistedPacket.prompt).objection, 'В моём методе это следует из гомотетии.')
  assert.equal(JSON.parse(persistedPacket.prompt).finding.targetDigest, undefined)
  for (const status of ['withdrawn', 'upheld', 'uncertain']) {
    const result = parseReconsideration(JSON.stringify({ status, message: 'Другой корректный метод допустим; прежнее замечание не определяет баллы.' }))
    assert.equal(result.status, status)
    assert.equal(result.advisoryOnly, true)
    assert.equal(result.score, undefined)
  }
  assert.deepEqual(attempt, before)
  for (const raw of ['broken', '{"status":"correct","message":"ok"}', '{"status":"withdrawn","message":"ok","score":3}', '{"status":"withdrawn","message":""}', '{"status":"uncertain","message":"ok","action":"retractEvaluation"}']) assert.throws(() => parseReconsideration(raw), { code: 'INVALID_ADVISORY' })
  assert.throws(() => buildReconsiderationPrompt({ publicTask: task, attempt, finding: { ...previous, quote: 'Придуманная запись' }, objection: 'Почему?' }), { code: 'INVALID_ADVISORY' })
})

test('bounded inputs reject forged part names and unusable large/deep reference data', () => {
  assert.throws(() => buildAdvisoryPrompt({ publicTask: { ...task, parts: [{ id: '__proto__', kind: 'text' }] }, attempt }), { code: 'INVALID_ADVISORY' })
  assert.throws(() => buildAdvisoryPrompt({ publicTask: task, attempt: { ...attempt, answersByPart: { missing: 'x' } } }), { code: 'INVALID_ADVISORY' })
  assert.throws(() => buildAdvisoryPrompt({ publicTask: task, attempt, allowedReferences: [{ partId: 'reason', rubric: JSON.parse(`${'['.repeat(10)}"x"${']'.repeat(10)}`) }] }), { code: 'INVALID_ADVISORY' })
})
