import test from 'node:test'
import assert from 'node:assert/strict'
import { families } from './algebra-families.mjs'
import { checkIntervalAnswer } from '../topic-packs.mjs'
import { createInstance, checkPart, publicLesson } from './registry.mjs'

const seeds = [-2147483647, -1001, -17, -1, 0, 1, 2, 17, 97, 2147483647]
const instances = () => families.flatMap(family => family.templates.flatMap(template => seeds.map(seed => ({ family, template, seed, instance: template.build(seed) }))))

test('algebra packs publish honest, deterministic, complete private instances', () => {
  assert.ok(families.length > 0)
  assert.equal(new Set(families.map(f => f.id)).size, families.length)
  for (const family of families) {
    for (const field of ['id', 'title', 'group', 'scope']) assert.equal(typeof family[field], 'string', `${family.id}: ${field}`)
    assert.ok(Number.isSafeInteger(family.version) && family.version >= 1)
    assert.ok(family.exclusions.length > 0, `${family.id}: scope exclusions`)
    assert.ok(family.skills.length > 0, `${family.id}: skills`)
    assert.ok(family.templates.length >= 2, `${family.id}: structurally distinct templates`)
    assert.equal(new Set(family.templates.map(t => t.id)).size, family.templates.length)
    for (const year of ['2026', '2027']) assert.ok(Array.isArray(family.alignments[year]))
    for (const field of ['meaning', 'notation', 'conditions', 'why']) assert.ok(family.lesson[field]?.trim(), `${family.id}: lesson ${field}`)
    assert.ok(family.lesson.example.prompt && family.lesson.example.solution)
    assert.ok(family.lesson.probe.prompt && family.lesson.probe.explanation)
  }
  for (const { family, template, seed, instance } of instances()) {
    const label = `${family.id}/${template.id}/${seed}`
    assert.deepEqual(instance, template.build(seed), `${label}: determinism`)
    assert.equal(instance.familyId, family.id, label)
    assert.equal(instance.templateId, template.id, label)
    assert.equal(instance.version, family.version, label)
    assert.equal(instance.id, `${family.id}:${family.version}:${template.id}:${seed}`, `${label}: versioned identity`)
    assert.equal(instance.seed, seed, label)
    assert.ok(instance.prompt?.trim(), label)
    assert.ok(instance.parts.length > 0, label)
    assert.ok(Object.isFrozen(instance), `${label}: private instance frozen`)
    assert.ok(Object.isFrozen(instance.parts) && Object.isFrozen(instance.reference), `${label}: nested private data frozen`)
    assert.equal(new Set(instance.parts.map(p => p.id)).size, instance.parts.length, label)
    for (const part of instance.parts) {
      assert.ok(Object.hasOwn(part, 'expected'), `${label}: oracle`)
      assert.ok(instance.reference.some(ref => ref.partId === part.id && ref.text), `${label}: reference for ${part.id}`)
      if (part.check === 'interval') assert.equal(checkIntervalAnswer(part.expected, part.expected).status, 'correct', `${label}: parseable exact interval`)
    }
  }
})

test('seed boundaries reject nonintegers and unsafe or out-of-range input', () => {
  for (const family of families) for (const template of family.templates) {
    for (const seed of [NaN, Infinity, -Infinity, 1.5, '1', null, undefined, 2147483648, -2147483648, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => template.build(seed), RangeError, `${family.id}/${template.id}: ${String(seed)}`)
    }
  }
})

// This reader is deliberately independent of the production interval parser:
// point membership permits direct comparison with the original inequality.
function intervalContains(answer, x) {
  if (answer === '∅' || answer === '{}') return false
  return answer.replace(/−/g, '-').split(/\s*(?:U|∪)\s*/).some(chunk => {
    const match = /^([[(])\s*([^;]+);\s*([^\])]+)\s*([\])])$/.exec(chunk.trim())
    assert.ok(match, `Unreadable authored interval ${answer}`)
    const number = text => /^(?:\+?inf|∞)$/.test(text.trim()) ? Infinity : /^(?:-inf|-∞)$/.test(text.trim()) ? -Infinity : text.trim().split('/').map(Number).reduce((a, b) => a / b)
    const left = number(match[2]), right = number(match[3])
    return (x > left || (x === left && match[1] === '[')) && (x < right || (x === right && match[4] === ']'))
  })
}

function near(actual, expected, label) { assert.ok(Math.abs(actual - expected) < 1e-8 * Math.max(1, Math.abs(expected)), `${label}: ${actual} != ${expected}`) }

// Small arithmetic reader for the authored prompt grammar. It has no knowledge
// of seed arithmetic, expected answers, or the generators' sign-chart method.
function evaluate(source, x = 0, variables = {}) {
  const text = source.replace(/−/g, '-').replace(/·/g, '*').replaceAll('[', '(').replaceAll(']', ')').replace(/²/g, '^2').replace(/³/g, '^3').replace(/₄/g, '4').replace(/₂/g, '2').replace(/log_\(1\/2\)/g, 'logHalf').replace(/\s/g, '')
  const tokens = text.match(/logHalf|log2|sqrt|sin|cos|tg|√|π|[a-z]|\d+(?:\.\d+)?|[()+\-*/^]/g) ?? []
  assert.equal(tokens.join(''), text, `Unsupported prompt arithmetic ${source}`)
  let i = 0
  const atom = () => {
    const token = tokens[i++]
    if (token === '(') { const result = add(); assert.equal(tokens[i++], ')'); return result }
    if (token === '+') return atom()
    if (token === '-') return -atom()
    if (['√', 'sqrt', 'log2', 'logHalf', 'sin', 'cos', 'tg'].includes(token)) {
      const value = atom()
      return ({ '√': Math.sqrt, sqrt: Math.sqrt, log2: Math.log2, logHalf: n => Math.log(n) / Math.log(0.5), sin: Math.sin, cos: Math.cos, tg: Math.tan })[token](value)
    }
    if (token === 'x') return x
    if (token === 'π') return Math.PI
    if (Object.hasOwn(variables, token)) return variables[token]
    assert.ok(/^\d/.test(token ?? ''), `Unexpected token ${token} in ${source}`)
    return Number(token)
  }
  const power = () => { let value = atom(); if (tokens[i] === '^') { i++; value **= power() } return value }
  const mul = () => {
    let value = power()
    while (i < tokens.length && ![')', '+', '-'].includes(tokens[i])) {
      const op = tokens[i] === '*' || tokens[i] === '/' ? tokens[i++] : '*'
      const rhs = power(); value = op === '*' ? value * rhs : value / rhs
    }
    return value
  }
  const add = () => { let value = mul(); while (tokens[i] === '+' || tokens[i] === '-') { const op = tokens[i++], rhs = mul(); value = op === '+' ? value + rhs : value - rhs } return value }
  const value = add(); assert.equal(i, tokens.length); return value
}

function relation(prompt) {
  const source = prompt.replace(/^Реши(?: неравенство)? /, '').replace(/\.$/, '')
  const match = /^(.*?)\s*(≥|≤|<|>)\s*(.*?)$/.exec(source)
  assert.ok(match, `No inequality in ${prompt}`)
  return x => {
    const left = evaluate(match[1], x), right = evaluate(match[3], x)
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false
    return ({ '≥': () => left >= right, '≤': () => left <= right, '>': () => left > right, '<': () => left < right })[match[2]]()
  }
}

test('logarithm and rational lesson probes preserve original domains and non-strict zeros', () => {
  const logarithms = families.find(f => f.id === 'algebra.equations.log-exp').lesson
  const formula = logarithms.probe.prompt.replace(/^Найди область определения /, '').replace(/\.$/, '')
  for (let i = -80; i <= 80; i++) {
    const x = i / 4
    assert.equal(intervalContains(logarithms.probe.answer, x), Number.isFinite(evaluate(formula, x)))
  }
  // A positive product does not make either original logarithm defined.
  assert.ok((-5 - 3) * (-5 + 3) > 0)
  assert.equal(Number.isFinite(evaluate(formula, -5)), false)
  const [left, right] = logarithms.example.prompt.replace(/^Реши /, '').replace(/\.$/, '').split('=')
  const roots = Array.from({ length: 41 }, (_, i) => i - 20).filter(x => {
    const a = evaluate(left, x), b = evaluate(right, x)
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9
  })
  assert.deepEqual(roots, [4])

  const rational = families.find(f => f.id === 'algebra.rational-sign').lesson
  const satisfies = relation(rational.probe.prompt)
  for (let i = -80; i <= 80; i++) {
    const x = i / 4
    assert.equal(intervalContains(rational.probe.answer, x), satisfies(x))
  }
  assert.equal(intervalContains(rational.probe.answer, 2), true, 'non-strict inequality includes zero numerator')
  assert.equal(intervalContains(rational.probe.answer, 5), false, 'zero denominator remains forbidden')
  const example = relation(rational.example.prompt)
  assert.equal(example(1), true)
  assert.equal(example(0.9), false)
  assert.equal(example(1.1), false)
  assert.equal(example(3), false)
})

test('exponential substitution gets its own frozen lesson while neighbouring templates retain theirs', () => {
  const family = families.find(f => f.id === 'algebra.equations.log-exp')
  const direct = family.templates.find(t => t.id === 'exponential-substitution').build(7)
  assert.equal(family.version, 3)
  assert.ok(Object.isFrozen(direct.lesson) && Object.isFrozen(direct.lesson.probe) && Object.isFrozen(direct.lesson.example))
  const instance = createInstance(family.id, 2)
  assert.equal(instance.templateId, 'exponential-substitution')
  assert.deepEqual(instance.lesson, direct.lesson)
  assert.notEqual(Number(instance.lesson.probe.answer), Number(instance.parts[0].expected), 'probe asks about a different equation and variable')
  for (const templateId of ['log-linear', 'log-product-domain', 'exponent-linear']) {
    const other = createInstance(family.id, 7, templateId)
    assert.deepEqual(other.lesson, family.lesson, `${templateId}: existing family material preserved`)
    assert.equal(family.templates.find(t => t.id === templateId).build(7).lesson, undefined)
  }
  const visible = publicLesson(instance.lesson)
  assert.equal(Object.hasOwn(visible.probe, 'answer'), false)
  assert.equal(Object.hasOwn(visible.probe, 'explanation'), false)
})

test('powers, tangents and symmetric distance select their own lesson without replacing neighbouring resources', () => {
  for (const [familyId, templateId, version] of [
    ['algebra.expressions', 'power-quotient', 2],
    ['analysis.derivative', 'tangent-intercept', 3],
    ['algebra.systems', 'symmetric-distance', 2],
  ]) {
    const family = families.find(f => f.id === familyId)
    assert.equal(family.version, version)
    const direct = family.templates.find(t => t.id === templateId).build(7)
    const auto = createInstance(familyId, family.templates.findIndex(t => t.id === templateId))
    const explicit = createInstance(familyId, 7, templateId)
    assert.deepEqual(auto.lesson, direct.lesson, `${familyId}: automatic template selection`)
    assert.deepEqual(explicit.lesson, direct.lesson, `${familyId}: explicit template selection`)
    assert.notDeepEqual(explicit.lesson, family.lesson)
    assert.ok(Object.isFrozen(direct.lesson) && Object.isFrozen(direct.lesson.example) && Object.isFrozen(direct.lesson.probe))
    for (const neighbour of family.templates.filter(t => t.id !== templateId)) {
      assert.equal(neighbour.build(7).lesson, undefined)
      assert.deepEqual(createInstance(familyId, 7, neighbour.id).lesson, family.lesson, `${familyId}/${neighbour.id}`)
    }
    const visible = publicLesson(explicit.lesson)
    assert.deepEqual(visible.example, explicit.lesson.example)
    assert.equal(Object.hasOwn(visible.probe, 'answer'), false)
    assert.equal(Object.hasOwn(visible.probe, 'explanation'), false)
  }
})

test('new template lesson examples and probes agree with independent arithmetic and the production checker', () => {
  for (const [familyId, templateId] of [
    ['algebra.expressions', 'power-quotient'],
    ['analysis.derivative', 'tangent-intercept'],
    ['algebra.systems', 'symmetric-distance'],
  ]) {
    const { lesson, parts } = createInstance(familyId, 7, templateId)
    for (const [exercise, isProbe] of [[lesson.example, false], [lesson.probe, true]]) {
      let independent, wrongAnswers = []
      if (templateId === 'power-quotient') {
        independent = evaluate(exercise.prompt.replace(/^Вычисли /, '').replace(/\.$/, ''))
        wrongAnswers = [independent * 2, independent / 2]
      } else if (templateId === 'tangent-intercept') {
        const [, formula, at] = /f\(x\)=(.*?) найди.*абсциссой (-?\d+)/.exec(exercise.prompt)
        const a = Number(at), f = x => evaluate(formula, x), h = 1e-4
        const slope = (f(a + h) - f(a - h)) / (2 * h)
        independent = f(a) - slope * a
        wrongAnswers = [f(a), slope]
        // The secants of the actual example must approach the tangent slope,
        // rather than interpreting an undefined h=0 quotient as a slope.
        let previousError = Infinity
        for (const delta of [1, 0.1, 0.01]) {
          const error = Math.abs((f(a + delta) - f(a)) / delta - slope)
          assert.ok(error < previousError)
          previousError = error
        }
      } else {
        const [, sum, product] = /x\+y=(-?\d+), xy=(-?\d+)/.exec(exercise.prompt)
        // Enumerate pairs satisfying the authored conditions, without using
        // the square-of-the-difference identity taught in the lesson.
        const pairs = []
        for (let x = -20; x <= 20; x++) for (let y = -20; y <= 20; y++) {
          if (x + y === Number(sum) && x * y === Number(product)) pairs.push([x, y])
        }
        assert.equal(pairs.length, 2)
        const distances = [...new Set(pairs.map(([x, y]) => Math.abs(x - y)))]
        assert.equal(distances.length, 1)
        independent = distances[0]
        wrongAnswers = [-independent, Number(sum)]
      }
      const displayedAnswer = isProbe ? Number(exercise.answer) : evaluate(/Ответ: ([−\d]+)\./.exec(exercise.solution)[1])
      near(displayedAnswer, independent, `${templateId}/${isProbe ? 'probe' : 'example'}`)
      if (isProbe) {
        const part = { id: 'probe', kind: exercise.kind, check: 'numeric', expected: exercise.answer }
        assert.equal(checkPart(part, String(displayedAnswer)).status, 'correct')
        for (const wrong of wrongAnswers) assert.equal(checkPart(part, String(wrong)).status, 'incorrect')
        assert.notEqual(Number(parts[0].expected), displayedAnswer, `${templateId}: probe does not reveal the active answer`)
      }
    }
  }
})

test('logarithmic inequality lesson retains its original domain and the exponential probe comparison', () => {
  const family = families.find(f => f.id === 'algebra.inequalities.log-exp')
  assert.equal(family.version, 3)
  const { lesson } = createInstance(family.id, 7, 'log-decreasing')
  const example = relation(lesson.example.prompt), probe = relation(lesson.probe.prompt)
  for (const x of [-3, 0, 1, 1.25, 1.5, 2, 2.25, 3]) {
    assert.equal(example(x), x > 1 && x <= 2, `logarithmic example at ${x}`)
    assert.equal(intervalContains(lesson.probe.answer, x), probe(x), `exponential probe at ${x}`)
  }
  assert.equal(checkPart({ id: 'probe', kind: 'interval', check: 'interval', expected: lesson.probe.answer }, '(-inf;2)').status, 'correct')
  assert.equal(checkPart({ id: 'probe', kind: 'interval', check: 'interval', expected: lesson.probe.answer }, '(2;inf)').status, 'incorrect')
})

test('substitution lesson example and probe independently preserve the square and the positive t domain', () => {
  const { lesson } = createInstance('algebra.equations.log-exp', 2)
  for (const [prompt, isProbe] of [[lesson.example.prompt, false], [lesson.probe.prompt, true]]) {
    const [, bText, cText] = /4\^x − (\d+)·2\^x − (\d+) = 0/.exec(prompt)
    const b = Number(bText), c = Number(cText)
    // Solve the quadratic by its discriminant, independently of the authored factoring.
    const discriminant = b*b+4*c
    const candidates = [(b-Math.sqrt(discriminant))/2, (b+Math.sqrt(discriminant))/2]
    const admissible = candidates.filter(t => t > 0)
    assert.equal(admissible.length, 1)
    assert.ok(candidates.some(t => t < 0))
    for (const t of candidates) near(t*t-b*t-c, 0, 'quadratic candidate')
    const resultX = Math.log2(admissible[0])
    near(4**resultX-b*2**resultX-c, 0, 'return to original equation')
    if (isProbe) {
      assert.equal(checkPart({ id: 'probe', kind: 'number', check: 'numeric', expected: lesson.probe.answer }, String(admissible[0])).status, 'correct')
      assert.equal(checkPart({ id: 'probe', kind: 'number', check: 'numeric', expected: lesson.probe.answer }, String(candidates.find(t => t < 0))).status, 'incorrect')
    } else {
      const displayedX = Number(/получаем x=(\d+)/.exec(lesson.example.solution)[1])
      near(displayedX, resultX, 'worked example x')
    }
    for (let i = -64; i <= 64; i++) {
      const x = i/8, t = 2**x
      assert.ok(t > 0)
      near(4**x, t*t, 'exponential becomes square')
      near(evaluate(`4^x − ${b}·2^x − ${c}`, x), evaluate(`t² − ${b}t − ${c}`, x, { t }), 'same equation after substitution')
    }
  }
  assert.ok(2**(-1) > 0, 'negative x is allowed; positivity constrains t')
  assert.equal(Number.isFinite(Math.log2(0)), false)
  assert.equal(Number.isFinite(Math.log2(-2)), false)
  assert.notEqual(4**2, 2*(2**2), 'replacing the square by 2t is not an identity')
})

test('rational answer sets agree with original signed expression and every critical boundary', () => {
  const family = families.find(f => f.id === 'algebra.rational-sign')
  assert.ok(family)
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed), expected = instance.parts[0].expected
    const satisfies = relation(instance.prompt)
    // Quarter-step grid covers each authored integer boundary and both sides;
    // the wider points exercise unbounded tails and cancelled poles.
    const finiteBoundaries = [...expected.matchAll(/(?:[[(;])\s*([+-]?\d+(?:\/\d+)?)/g)].map(m => evaluate(m[1]))
    const points = [...Array.from({ length: 161 }, (_, i) => (i - 80) / 4), -1000000, 1000000, ...finiteBoundaries.flatMap(x => [x - 1e-7, x, x + 1e-7])]
    for (const x of points) assert.equal(intervalContains(expected, x), satisfies(x), `${template.id}/${seed}, x=${x}: ${instance.prompt}`)
  }
})

test('logarithmic and radical inequalities preserve domains and comparison direction', () => {
  for (const family of families.filter(f => ['algebra.inequalities.log-exp', 'algebra.inequalities.radical'].includes(f.id))) {
    for (const template of family.templates) for (const seed of seeds) {
      const instance = template.build(seed), satisfies = relation(instance.prompt)
      for (let i = -160; i <= 240; i++) {
        const x = i / 8
        assert.equal(intervalContains(instance.parts[0].expected, x), satisfies(x), `${template.id}/${seed}, x=${x}: ${instance.prompt}`)
      }
    }
  }
})

test('function domain, range, and maximal strict increase agree with actual values', () => {
  const family = families.find(f => f.id === 'functions.properties')
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed), answer = instance.parts[0].expected
    const expression = /f\(x\)=(.*?)(?:\. |\.$)/.exec(instance.prompt)[1]
    const f = x => evaluate(expression, x)
    if (template.id === 'root-and-pole-domain') {
      for (let i = -80; i <= 80; i++) { const x = i / 4; assert.equal(intervalContains(answer, x), Number.isFinite(f(x)), `${instance.prompt}: x=${x}`) }
    } else if (template.id === 'downward-range') {
      const values = Array.from({ length: 401 }, (_, i) => f((i - 200) / 4))
      const maximum = Math.max(...values)
      assert.equal(checkIntervalAnswer(answer, `(-inf;${maximum}]`).status, 'correct', instance.prompt)
      for (const y of values) assert.equal(intervalContains(answer, y), true)
    } else {
      const xs = Array.from({ length: 401 }, (_, i) => (i - 200) / 4)
      const vertex = xs.reduce((best, x) => f(x) < f(best) ? x : best, xs[0])
      assert.equal(checkIntervalAnswer(answer, `[${vertex};inf)`).status, 'correct', instance.prompt)
      const included = xs.filter(x => intervalContains(answer, x))
      for (let i = 1; i < included.length; i++) assert.ok(f(included[i]) > f(included[i - 1]), instance.prompt)
      assert.ok(f(vertex - 0.1) > f(vertex), 'adding left-neighbor would break strict increase')
    }
  }
})

test('reconstructed coefficients satisfy all displayed point constraints', () => {
  const family = families.find(f => f.id === 'functions.reconstruction')
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed), answer = evaluate(String(instance.parts[0].expected))
    const points = [...instance.prompt.matchAll(/\((-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?)\)/g)].map(m => m.slice(1).map(Number))
    assert.equal(points.length, 2, instance.prompt)
    if (template.id === 'vertex-scale') {
      const [[h, v], [x, y]] = points
      near(answer * (x - h) ** 2 + v, y, instance.prompt)
      assert.notEqual(x, h)
    } else {
      const [[x1, y1], [x2, y2]] = points
      const coefficients = template.id === 'line-intercept' ? [(y1 - answer) / x1, (y2 - answer) / x2] : [(y1 - answer) * x1, (y2 - answer) * x2]
      near(coefficients[0], coefficients[1], instance.prompt)
      if (instance.table) assert.deepEqual(instance.table.rows, points)
    }
  }
})

test('derivative answers agree with numerical tangents, endpoint extrema, and sign changes', () => {
  const family = families.find(f => f.id === 'analysis.derivative')
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed), answer = instance.parts[0].expected
    if (template.id === 'tangent-intercept') {
      const [, formula, at] = /f\(x\)=(.*?) проведена касательная при x=(-?\d+)/.exec(instance.prompt)
      const x = Number(at), f = z => evaluate(formula, z), h = 1e-4
      const slope = (f(x + h) - f(x - h)) / (2 * h)
      near(evaluate(String(answer)), f(x) - slope * x, instance.prompt)
    } else if (template.id === 'closed-segment-maximum') {
      const [, formula, lo, hi] = /f\(x\)=(.*?) на \[(-?\d+);(-?\d+)\]/.exec(instance.prompt)
      const lower = Number(lo), upper = Number(hi)
      const maximum = Math.max(...Array.from({ length: 513 }, (_, i) => evaluate(formula, lower + (upper - lower) * i / 512)))
      near(evaluate(String(answer)), maximum, instance.prompt)
    } else {
      const formula = /f′\(x\)=(.*?)\./.exec(instance.prompt)[1]
      if (template.id === 'derivative-multiplicity') {
        const minima = Array.from({ length: 41 }, (_, i) => i - 20).filter(x => evaluate(formula, x) === 0 && evaluate(formula, x - 0.01) < 0 && evaluate(formula, x + 0.01) > 0)
        near(evaluate(String(answer)), minima.length, instance.prompt)
      } else {
        for (let i = -80; i <= 80; i++) { const x = i / 4; assert.equal(intervalContains(answer, x), evaluate(formula, x) <= 0, `${instance.prompt}, x=${x}`) }
      }
    }
  }
})

function integrate(f, a, b, tolerance = 1e-10, depth = 20) {
  const mid = (a + b) / 2, fa = f(a), fm = f(mid), fb = f(b)
  const whole = (b - a) * (fa + 4 * fm + fb) / 6
  const leftMid = (a + mid) / 2, rightMid = (mid + b) / 2
  const split = (mid - a) * (fa + 4 * f(leftMid) + fm) / 6 + (b - mid) * (fm + 4 * f(rightMid) + fb) / 6
  if (depth <= 0 || Math.abs(split - whole) < 15 * tolerance) return split + (split - whole) / 15
  return integrate(f, a, mid, tolerance / 2, depth - 1) + integrate(f, mid, b, tolerance / 2, depth - 1)
}

test('integral and area answers agree with independent numerical accumulation', () => {
  const family = families.find(f => f.id === 'analysis.integral')
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed), answer = evaluate(String(instance.parts[0].expected))
    let result
    if (template.id === 'constant-by-point') {
      const [, formula, x, y] = /F′\(x\)=(.*?), F\((-?\d+)\)=(-?\d+)/.exec(instance.prompt)
      result = Number(y) + integrate(z => evaluate(formula, z), Number(x), 0)
    } else if (template.id === 'definite-linear') {
      const [, high, formula] = /от 0 до (\d+) \((.*?)\) dx/.exec(instance.prompt)
      result = integrate(z => evaluate(formula, z), 0, Number(high))
    } else {
      const [, formula, low, high] = /между y=(.*?), осью Ox и прямыми x=(-?\d+), x=(-?\d+)/.exec(instance.prompt)
      result = integrate(z => Math.abs(evaluate(formula, z)), Number(low), Number(high))
    }
    near(answer, result, instance.prompt)
  }
})

test('system answers satisfy both simultaneous conditions', () => {
  const family = families.find(f => f.id === 'algebra.systems')
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed), answer = instance.parts[0].expected
    if (template.id === 'linear-two-variable') {
      const [, sum, difference] = /x\+y=(-?\d+), 2x−y=(-?\d+)/.exec(instance.prompt)
      const x = evaluate(String(answer)), y = Number(sum) - x
      near(2 * x - y, Number(difference), instance.prompt)
    } else if (template.id === 'symmetric-distance') {
      const [, sum, product] = /x\+y=(\d+), xy=(\d+)/.exec(instance.prompt)
      const solutions = []
      for (let x = -50; x <= 50; x++) for (let y = -50; y <= 50; y++) if (x + y === Number(sum) && x * y === Number(product)) solutions.push([x, y])
      assert.equal(solutions.length, 2, instance.prompt)
      for (const [x, y] of solutions) near(evaluate(String(answer)), Math.abs(x - y), instance.prompt)
    } else {
      const [, first, second] = /Реши систему (.*?), (.*?)\./.exec(instance.prompt)
      const a = relation(`Реши ${first}.`), b = relation(`Реши ${second}.`)
      for (let i = -80; i <= 80; i++) { const x = i / 4; assert.equal(intervalContains(answer, x), a(x) && b(x), `${instance.prompt}, x=${x}`) }
    }
  }
})

test('numeric expressions are checked by evaluating the displayed expression', () => {
  const family = families.find(f => f.id === 'algebra.expressions')
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed)
    let expression, variables = {}
    if (instance.prompt.startsWith('При a=')) {
      const [, a, body] = /^При a=−(\d+) найди (.*)\.$/.exec(instance.prompt)
      variables.a = -Number(a); expression = body
    } else expression = instance.prompt.replace(/^Вычисли /, '').replace(/\.$/, '')
    near(evaluate(expression, 0, variables), evaluate(String(instance.parts[0].expected)), `${template.id}/${seed}`)
  }
})

test('elementary, radical, and logarithmic equations have the displayed admissible roots', () => {
  for (const family of families.filter(f => ['algebra.equations.elementary', 'algebra.equations.radical', 'algebra.equations.log-exp'].includes(f.id))) {
    for (const template of family.templates) for (const seed of seeds) {
      const instance = template.build(seed)
      const equation = instance.prompt.replace(/^Реши /, '').replace(/^Найди сумму всех корней уравнения /, '').replace(/\. Найди сумму всех корней\.$/, '').replace(/\.$/, '')
      const [left, right] = equation.split(' = ')
      assert.ok(left && right, instance.prompt)
      const valid = x => { const a = evaluate(left, x), b = evaluate(right, x); return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9 }
      const roots = Array.from({ length: 201 }, (_, i) => i - 100).filter(valid)
      const answer = evaluate(String(instance.parts[0].expected))
      if (/сумму/.test(instance.prompt)) {
        assert.ok(roots.length >= 2, `${template.id}: nontrivial roots`)
        near(answer, roots.reduce((a, b) => a + b, 0), instance.prompt)
      } else {
        assert.equal(valid(answer), true, `${template.id}/${seed}: candidate in original equation`)
        assert.deepEqual(roots, [answer], `${template.id}/${seed}: all integer roots and domain exclusions`)
      }
    }
  }
})

test('trigonometric segment selection enumerates displayed quarter-pi candidates and respects bounds', () => {
  const family = families.find(f => f.id === 'algebra.equations.trig-segment')
  for (const template of family.templates) for (const seed of seeds) {
    const instance = template.build(seed)
    const [, equation, low, high] = /(?:Реши |Найди сумму корней )(.*?)=0 на \[(.*?);(.*?)\]/.exec(instance.prompt)
    const lower = evaluate(low), upper = evaluate(high)
    const candidates = Array.from({ length: 161 }, (_, i) => (i - 80) * Math.PI / 4)
    const roots = candidates.filter(x => x >= lower - 1e-10 && x <= upper + 1e-10 && Math.abs(evaluate(equation, x)) < 1e-9)
    assert.ok(roots.length > 0, instance.prompt)
    const coefficient = evaluate(String(instance.parts[0].expected))
    if (/сумму/.test(instance.prompt)) near(coefficient, roots.reduce((a, b) => a + b, 0) / Math.PI, instance.prompt)
    else { assert.equal(roots.length, 1, instance.prompt); near(coefficient, roots[0] / Math.PI, instance.prompt) }
  }
})
