import { createHash } from 'node:crypto'
import { families as numeric } from './numeric-families.mjs'
import { families as algebra } from './algebra-families.mjs'
import { families as geometry } from './geometry-families.mjs'
import { checkNumericAnswer } from '../percentages.mjs'
import { checkIntervalAnswer } from '../topic-packs.mjs'
import { checkRoots, checkSeries } from '../root-checker.mjs'
import { publicStepModel } from '../../shared/step-model.mjs'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
export const families = [...numeric, ...algebra, ...geometry]
const byId = new Map()
for (const family of families) {
  if (!family.id || byId.has(family.id) || !family.templates?.length || !family.lesson?.probe) throw Error(`Invalid family: ${family.id}`)
  if (new Set(family.templates.map(t => t.id)).size !== family.templates.length) throw Error(`Duplicate template: ${family.id}`)
  byId.set(family.id, family)
}
export function getFamily(id) {
  const family = typeof id === 'string' && byId.get(id)
  if (!family) throw fail('Это семейство пока не опубликовано. Сохранённое решение можно прочитать.', 404)
  return family
}
export function createInstance(familyId, seed = 0, templateId) {
  const family = getFamily(familyId)
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647) throw fail('Некорректный номер варианта')
  const template = templateId === undefined ? family.templates[seed % family.templates.length] : family.templates.find(t => t.id === templateId)
  if (!template) throw fail('Такой вариант семейства не опубликован', 404)
  // Selecting a template and varying its parameters must be independent.
  // Reusing seed % N inside a builder can otherwise exclude whole cases:
  // a two-template family reaches only odd seeds in its second builder.
  // Explicit template callers already choose the structure independently.
  const parameterSeed = templateId === undefined ? Math.floor(seed / family.templates.length) : seed
  const instance = structuredClone(template.build(parameterSeed))
  if (!instance || typeof instance.prompt !== 'string' || !instance.parts?.length || instance.parts.length > 12) throw Error(`Invalid authored task: ${familyId}`)
  if (new Set(instance.parts.map(p => p.id)).size !== instance.parts.length) throw Error(`Duplicate part: ${familyId}`)
  for (const part of instance.parts) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(part.id) || !['numeric', 'interval', 'proof', 'roots', 'series', 'choice'].includes(part.check)) throw Error(`Invalid checker: ${familyId}`)
    if (part.expected === undefined || (typeof part.expected === 'number' && !Number.isFinite(part.expected))) throw Error(`Missing answer: ${familyId}`)
    if (part.check !== 'proof') {
      const validation = checkPart(part, Array.isArray(part.expected) ? part.expected.join('; ') : String(part.expected))
      if (validation.status !== 'correct') throw Error(`Invalid authored answer: ${familyId}/${template.id}/${part.id}: ${validation.summary}`)
    }
  }
  // Version the seed mapping independently of authored family revisions. Old
  // frozen instances keep their identity even when a family was not edited.
  const generatorVersion = 2
  // The same requested seed can select different parameters through automatic
  // and explicit template calls. Bind both seeds so those tasks cannot alias.
  const frozen = { ...instance, id: `${familyId}:${family.version}:${template.id}:g${generatorVersion}:${seed}:p${parameterSeed}`, familyId, version: family.version, generatorVersion, templateId: template.id, seed, parameterSeed, lesson: structuredClone({ ...family.lesson, ...instance.lesson }) }
  frozen.digest = createHash('sha256').update(JSON.stringify(frozen)).digest('hex')
  return frozen
}

export function publicInstance(instance, { concealMethod = false } = {}) {
  // Explicit projection: never spread a private instance into an API response.
  const out = {
    id: concealMethod ? createHash('sha256').update(instance.id).digest('hex').slice(0, 24) : instance.id,
    version: instance.version,
    title: concealMethod ? 'Задача' : instance.title,
    prompt: instance.prompt,
    parts: instance.parts.map(p => ({ id: p.id, label: p.label, kind: p.kind, ...(p.prompt ? { prompt: p.prompt } : {}), ...(p.answerUnit ? { answerUnit: p.answerUnit } : {}) })),
    ...(instance.svg ? { svg: instance.svg } : {}), ...(instance.table ? { table: structuredClone(instance.table) } : {}),
  }
  if (!concealMethod) Object.assign(out, { familyId: instance.familyId, templateId: instance.templateId, ...(publicStepModel(instance.lesson?.interaction) ? {stepModelAvailable:true} : {}) })
  return out
}

export function publicFamily(family) {
  return { id: family.id, title: family.title, group: family.group, version: family.version, scope: family.scope, exclusions: family.exclusions ?? [], prerequisites: family.prerequisites ?? [], alignments: family.alignments, skills: family.skills, templateCount: family.templates.length, verification: family.templates.some(t => t.build(0).parts.some(p => p.check === 'proof')) ? 'partial' : 'exact-answer' }
}
export function publicLesson(lesson) {
  const interaction = publicStepModel(lesson.interaction)
  return { meaning: lesson.meaning, notation: lesson.notation, conditions: lesson.conditions, why: lesson.why, example: structuredClone(lesson.example), pitfalls: lesson.pitfalls, probe: { prompt: lesson.probe.prompt, kind: lesson.probe.kind, ...(lesson.probe.choices ? { choices: structuredClone(lesson.probe.choices) } : {}) }, links: lesson.links ?? [], ...(interaction ? {interaction} : {}) }
}
function intervalNotation(value) {
  return value.replace(/\\(?:mathbb\{R\}|mathbb R)|ℝ|^R$/g, '(-inf;+inf)').replace(/\\cup/g, '∪').replace(/\{\s*([^{};]+)\s*\}/g, '[$1;$1]').replace(/∞/g, 'inf')
}
export function checkPart(part, answer) {
  const meta = { checker: `mathmaxing.${part.check}`, checkerVersion: 1, scope: part.scope ?? (part.check === 'proof' ? 'Обоснование целиком' : 'Ответ в указанной части') }
  if (typeof answer !== 'string' || answer.length > 16000) return { ...meta, status: 'unknown', summary: 'Запись не удалось прочитать. Сохрани её и уточни формат.' }
  if (!answer.trim()) return { ...meta, status: 'unknown', summary: 'Ответ не указан.' }
  if (part.check === 'proof') return { ...meta, status: 'unknown', summary: 'Обоснование сохранено. Автоматическая проверка числа не подтверждает доказательство; его можно обсудить и закончить занятие без выдуманной оценки.' }
  let result
  if (part.check === 'numeric') result = checkNumericAnswer(answer, String(part.expected))
  else if (part.check === 'interval') result = checkIntervalAnswer(intervalNotation(answer), intervalNotation(String(part.expected)))
  else if (part.check === 'roots') result = checkRoots(answer, part.expected)
  else if (part.check === 'series') result = checkSeries(answer, part.expected)
  else if (part.check === 'choice') result = { status: answer.trim() === String(part.expected).trim() ? 'correct' : 'incorrect', summary: answer.trim() === String(part.expected).trim() ? 'Ответ совпадает.' : 'Ответ пока не совпадает. Проверь условие и выбранный случай.' }
  else throw fail('Проверка этого формата пока не опубликована', 422)
  return { ...meta, ...result }
}

export const examEditions = {
  '2026': { id: '2026', label: 'ЕГЭ 2026', status: 'final', taskCount: 19, maxPoints: 32, durationMinutes: 235, source: 'https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2026/ma_11_2026.zip' },
  '2027': { id: '2027', label: 'Проект ЕГЭ 2027', status: 'draft', taskCount: 20, maxPoints: 33, durationMinutes: 235, source: 'https://doc.fipi.ru/ege/demoversii-specifikacii-kodifikatory/2027/ma_11_2027.zip' },
}
export function coverageFor(edition = '2026') {
  if (!Object.hasOwn(examEditions, edition)) throw fail('Выбери опубликованную редакцию экзамена')
  return Array.from({ length: examEditions[edition].taskCount }, (_, i) => {
    const matches = families.filter(f => f.alignments[edition]?.includes(i + 1))
    return { position: i + 1, familyIds: matches.map(f => f.id), status: matches.length ? 'published-subtypes' : 'unavailable', templateCount: matches.reduce((n, f) => n + f.templates.length, 0), scope: matches.map(f => ({ id: f.id, scope: f.scope, exclusions: f.exclusions })) }
  })
}
