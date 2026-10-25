import test from 'node:test'
import assert from 'node:assert/strict'
import { families, geometryFamilies } from './geometry-families.mjs'
import { createInstance, checkPart, publicLesson } from './registry.mjs'

const get = (familyId, templateId, seed) => geometryFamilies.find(f => f.id === familyId).templates.find(t => t.id === templateId).build(seed)
const expected = (instance, id) => instance.parts.find(p => p.id === id).expected
const nums = text => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => Number(m[0]))
const equalNumeric = (instance, answers) => {
  for (const [id, answer] of Object.entries(answers)) assert.equal(expected(instance, id), answer, `${instance.id}/${id}`)
}

test('geometry families have scoped teaching, alternatives and immutable deterministic tasks', () => {
  assert.equal(geometryFamilies.length, 6)
  assert.equal(new Set(families.map(f => f.id)).size, families.length)
  for (const family of geometryFamilies) {
    assert.ok(family.scope && family.exclusions.length)
    for (const field of ['meaning', 'notation', 'conditions', 'why']) assert.ok(family.lesson[field].length > 20)
    assert.ok(family.lesson.example.prompt && family.lesson.example.solution && family.lesson.probe.explanation)
    assert.ok(family.templates.length >= 2)
    assert.ok(family.alignments['2026'].length && family.alignments['2027'].length)
    for (const t of family.templates) {
      for (const seed of [-2147483647, -29, 0, 1, 88, 2147483647]) {
        const i = t.build(seed)
        assert.deepEqual(i, t.build(seed))
        assert.equal(i.familyId, family.id)
        assert.equal(i.templateId, t.id)
        assert.equal(i.seed, seed)
        assert.equal(i.version, family.version)
        assert.ok(Object.isFrozen(i) && Object.isFrozen(i.parts) && i.parts.every(Object.isFrozen))
        assert.equal(new Set(i.parts.map(p => p.id)).size, i.parts.length)
        for (const p of i.parts) {
          assert.ok(i.reference.some(r => r.partId === p.id))
          if (p.check === 'numeric') assert.ok(Number.isFinite(p.expected))
          else {
            assert.equal(p.check, 'proof')
            assert.equal(p.kind, 'text')
            assert.equal(p.maxPoints, undefined)
            assert.match(p.scope, /автоматической проверки/)
          }
        }
        if (i.svg) {
          assert.match(i.svg, /<title>.+<\/title>/)
          assert.match(i.svg, /role="img"/)
          assert.doesNotMatch(i.svg, /<script|onload=|foreignObject|<image|expected|reference/i)
        }
      }
      for (const seed of [NaN, 1.5, Infinity, 2147483648, -2147483648, '2']) assert.throws(() => t.build(seed), RangeError)
    }
  }
})

test('every template aligned with short positions 1–3 asks for one numeric answer', () => {
  for (const family of geometryFamilies.filter(f => f.alignments['2026'].some(p => p <= 3))) {
    for (const template of family.templates) for (const seed of [0, 1, 29, 2147483647]) {
      const i = template.build(seed)
      assert.equal(i.parts.length, 1, i.id)
      assert.equal(i.parts[0].check, 'numeric', i.id)
    }
  }
  const similarity = geometryFamilies.find(f => f.id === 'geom.plane.similarity')
  assert.deepEqual(similarity.alignments, { '2026': [17], '2027': [18] })
})

test('plane short answers follow the public right-angle dimensions independently', () => {
  for (let seed = -20; seed < 30; seed++) {
    for (const template of ['right-triangle-area', 'right-triangle-circumradius']) {
      const i = get('geom.plane.metrics', template, seed)
      const a = Number(i.prompt.match(/AB=(\d+)/)[1]), b = Number(i.prompt.match(/AC=(\d+)/)[1])
      assert.match(i.prompt, /угол A прямой/)
      if (template.endsWith('area')) equalNumeric(i, { area: a * b / 2 })
      else equalNumeric(i, { radius: Math.hypot(a, b) / 2 })
      const path = i.svg.match(/<path d="M45 250 H([\d.]+) L45 ([\d.]+) Z/)
      const horizontal = Number(path[1]) - 45, vertical = 250 - Number(path[2])
      assert.ok(Math.abs(horizontal / vertical - a / b) < 1e-12)
    }
  }
})

test('public triangle givens independently determine length and area; diagram obeys exact homothety', () => {
  for (let seed = -20; seed < 30; seed++) {
    const direct = get('geom.plane.similarity', 'parallel-length-area', seed)
    const ab = Number(direct.prompt.match(/AB = (\d+)/)[1]), ad = Number(direct.prompt.match(/AD = (\d+)/)[1])
    const bc = Number(direct.prompt.match(/BC = (\d+)/)[1]), S = Number(direct.prompt.match(/S\(ABC\) = (\d+)/)[1])
    equalNumeric(direct, { length: bc * ad / ab, area: S * ad * ad / (ab * ab) })
    const paths = [...direct.svg.matchAll(/<path d="M([^\"]+)"/g)]
    const [ax, ay, bx, by, cx, cy] = nums(paths[0][1]), [dx, dy, ex, ey] = nums(paths[1][1])
    const cross = (x, y, z, w) => x * w - y * z
    const big = Math.abs(cross(bx - ax, by - ay, cx - ax, cy - ay))
    const small = Math.abs(cross(dx - ax, dy - ay, ex - ax, ey - ay))
    assert.equal(cross(ex - dx, ey - dy, cx - bx, cy - by), 0, 'DE parallel BC in authored figure')
    assert.equal(small / big, (ad / ab) ** 2)

    const inverse = get('geom.plane.similarity', 'area-to-length', seed)
    const smallArea = Number(inverse.prompt.match(/S\(ADE\) = (\d+)/)[1]), area = Number(inverse.prompt.match(/S\(ABC\) = (\d+)/)[1]), ac = Number(inverse.prompt.match(/AC = (\d+)/)[1])
    equalNumeric(inverse, { length: ac * (1 - Math.sqrt(smallArea / area)) })
    const converse = get('geom.plane.similarity', 'converse-parallel', seed)
    const AD = Number(converse.prompt.match(/AD = (\d+)/)[1]), DB = Number(converse.prompt.match(/DB = (\d+)/)[1]), AE = Number(converse.prompt.match(/AE = (\d+)/)[1]), EC = Number(converse.prompt.match(/EC = (\d+)/)[1])
    assert.equal(AD / (AD + DB), AE / (AE + EC))
    equalNumeric(converse, { ratio: (AD / (AD + DB)) ** 2 })
  }
})

test('vector examples independently use endpoint subtraction and Euclidean norm', () => {
  for (let seed = -8; seed <= 20; seed++) {
    const plane = get('geom.vector.ops', 'plane-combination', seed)
    const u = nums(plane.prompt.match(/u=\(([^)]+)\)/)[1]), v = nums(plane.prompt.match(/v=\(([^)]+)\)/)[1]), k = Number(plane.prompt.match(/w=u\+\((-?\d+)\)/)[1])
    const x = u[0] + k * v[0], y = u[1] + k * v[1]
    equalNumeric(plane, { norm2: x * x + y * y })
    const space = get('geom.vector.ops', 'space-endpoint', seed)
    const a = nums(space.prompt.match(/A=\(([^)]+)\)/)[1]), ab = nums(space.prompt.match(/AB=\(([^)]+)\)/)[1])
    assert.equal(expected(space, 'x') - a[0], ab[0])
  }
})

test('dot product roots are necessary and sufficient; spatial cosine uses independent lengths', () => {
  const signs = new Set(), squaredCosines = new Set()
  for (let seed = -8; seed <= 20; seed++) {
    const p = get('geom.vector.dot', 'orthogonal-coordinate', seed)
    const u = nums(p.prompt.match(/u=\(([^)]+)\)/)[1]), last = Number(p.prompt.match(/v=\(x;(-?\d+)\)/)[1]), x = expected(p, 'coordinate')
    assert.ok(u.some(v => v !== 0) && (x !== 0 || last !== 0))
    assert.equal(u[0] * x + u[1] * last, 0)
    assert.notEqual(u[0] * (x + 1) + u[1] * last, 0)
    const a = get('geom.vector.dot', 'space-angle', seed)
    const first = nums(a.prompt.match(/u=\(([^)]+)\)/)[1]), second = nums(a.prompt.match(/v=\(([^)]+)\)/)[1])
    const d = first.reduce((s, value, i) => s + value * second[i], 0)
    const norm = v => v.reduce((s, value) => s + value * value, 0)
    equalNumeric(a, { cos2: d * d / (norm(first) * norm(second)) })
    assert.ok(norm(first) > 0 && norm(second) > 0)
    signs.add(Math.sign(d))
    squaredCosines.add(expected(a, 'cos2'))
  }
  assert.deepEqual(signs, new Set([-1, 0, 1]), 'Acute, right and obtuse angles need different dot-product signs')
  assert.ok(squaredCosines.size >= 4, 'A new scale alone must not leave every answer unchanged')
})

test('solid metrics match public dimensions including diameter and inverse cone factor', () => {
  for (let seed = -8; seed <= 20; seed++) {
    const b = get('geom.solid.metrics', 'box-volume-surface', seed)
    const a = Number(b.prompt.match(/AB=(\d+)/)[1]), d = Number(b.prompt.match(/AD=(\d+)/)[1]), h = Number(b.prompt.match(/AA₁=(\d+)/)[1])
    equalNumeric(b, { surface: a * d + a * d + a * h + a * h + d * h + d * h })
    const c = get('geom.solid.metrics', 'cylinder-from-diameter', seed)
    const diameter = Number(c.prompt.match(/равен (\d+)/)[1]), height = Number(c.prompt.match(/высота — (\d+)/)[1])
    equalNumeric(c, { volumePi: diameter * diameter * height / 4 })
    const cone = get('geom.solid.metrics', 'cone-inverse-height', seed)
    const coefficient = Number(cone.prompt.match(/равен (\d+)π/)[1]), radius = Number(cone.prompt.match(/основания — (\d+)/)[1])
    assert.equal(radius * radius * expected(cone, 'height'), 3 * coefficient)
  }
})

test('spatial tasks derive section, angle and actual minimum distance separately from proof', () => {
  const linePairs = new Set(), tangents = new Set()
  for (let seed = -8; seed <= 20; seed++) {
    const section = get('geom.solid.section-angle-distance', 'parallel-section', seed)
    const a = Number(section.prompt.match(/AB=(\d+)/)[1]), b = Number(section.prompt.match(/AD=(\d+)/)[1]), c = Number(section.prompt.match(/AA₁=(\d+)/)[1]), h = Number(section.prompt.match(/AM=(\d+)/)[1])
    assert.ok(0 < h && h < c)
    equalNumeric(section, { area: a * b, volume: a * b * h })
    const angle = get('geom.solid.section-angle-distance', 'diagonal-plane-angle', seed)
    const x = Number(angle.prompt.match(/AB=(\d+)/)[1]), y = Number(angle.prompt.match(/AD=(\d+)/)[1]), z = Number(angle.prompt.match(/AA₁=(\d+)/)[1])
    equalNumeric(angle, { tan: z / Math.hypot(x, y) })
    tangents.add(expected(angle, 'tan'))
    const skew = get('geom.solid.section-angle-distance', 'skew-edge-distance', seed)
    const A = Number(skew.prompt.match(/AB=(\d+)/)[1]), B = Number(skew.prompt.match(/AD=(\d+)/)[1]), C = Number(skew.prompt.match(/AA₁=(\d+)/)[1])
    const pair = skew.prompt.match(/между прямыми (.+?) и докажите/)[1]
    linePairs.add(pair)
    const models = {
      'AB и CC₁': { minimum: B, difference: (s, t) => [A - s, B, t], witness: [A, 0] },
      'AD и BB₁': { minimum: A, difference: (s, t) => [A, -s, t], witness: [0, 0] },
      'AB и A₁D₁': { minimum: C, difference: (s, t) => [-s, t, C], witness: [0, 0] },
    }
    const model = models[pair]
    assert.ok(model, `Unknown line configuration ${pair}`)
    equalNumeric(skew, { distance: model.minimum })
    // Include points outside the edges: the distance concerns entire lines.
    for (const s of [-A, 0, A / 2, A, 3 * A]) for (const t of [-9, 0, 11]) {
      assert.ok(Math.hypot(...model.difference(s, t)) >= model.minimum)
    }
    assert.equal(Math.hypot(...model.difference(...model.witness)), model.minimum)
    assert.equal(skew.parts.filter(p => p.check === 'proof').length, 1)
  }
  assert.equal(linePairs.size, 3)
  assert.ok(tangents.size >= 5, 'Diagonal angle must vary independently of the overall scale')
})

test('template lessons retain the example and probe for the actual reasoning direction', () => {
  for (const [templateId, expectedProbe, phrase] of [
    ['cone-inverse-height', 6, /высот/],
    ['skew-edge-distance', 3, /расстояние/],
    ['area-to-length', 12, /Найдите EC/],
    ['converse-parallel', '1', /Какой первый переход/],
  ]) {
    const familyId = templateId === 'cone-inverse-height' ? 'geom.solid.metrics' : templateId === 'skew-edge-distance' ? 'geom.solid.section-angle-distance' : 'geom.plane.similarity'
    const direct = get(familyId, templateId, 7)
    assert.match(direct.lesson.probe.prompt, phrase)
    assert.equal(direct.lesson.probe.answer, expectedProbe)
    const frozen = createInstance(familyId, 7, templateId)
    assert.deepEqual(frozen.lesson.example, direct.lesson.example)
    assert.deepEqual(frozen.lesson.probe, direct.lesson.probe)
    assert.ok(frozen.lesson.links, 'Partial lesson overrides retain family links')
  }
})

test('inverse-area probe answer reconstructs a positive interior cut with both stated areas', () => {
  const { probe } = createInstance('geom.plane.similarity', 7, 'area-to-length').lesson
  const smallArea = Number(probe.prompt.match(/S\(ADE\)=(\d+)/)[1])
  const bigArea = Number(probe.prompt.match(/S\(ABC\)=(\d+)/)[1])
  const ac = Number(probe.prompt.match(/AC=(\d+)/)[1])
  // Reconstruct the cut from the claimed EC, then check areas by coordinates.
  // This catches using the area ratio as a length ratio or answering AE instead.
  const A = [0, 0], B = [0, 2 * bigArea / ac], C = [ac, 0]
  const E = [ac - probe.answer, 0], D = [0, B[1] * E[0] / ac]
  const area = (p, q, r) => Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2
  assert.ok(0 < E[0] && E[0] < C[0] && 0 < D[1] && D[1] < B[1])
  assert.equal(area(A, B, C), bigArea)
  assert.equal(area(A, D, E), smallArea)
  assert.equal(C[0] - E[0], probe.answer)
})

test('converse contrast loses proportionality while common angle and whole-side sums remain valid', () => {
  const { probe } = createInstance('geom.plane.similarity', 7, 'converse-parallel').lesson
  assert.match(probe.prompt, /Параллельность DE и BC не дана/)
  const [ad, db, ae] = ['AD', 'DB', 'AE'].map(name => Number(probe.prompt.match(new RegExp(`${name}=(\\d+)`))[1]))
  const ecA = Number(/А: EC=(\d+)/.exec(probe.prompt)[1]), ecB = Number(/Б: EC=(\d+)/.exec(probe.prompt)[1])
  const ab = ad+db, acA = ae+ecA, acB = ae+ecB
  assert.equal(ad*acA, ae*ab)
  assert.notEqual(ad*acB, ae*ab)
  // Independent coordinates: A=(0,0), B=(AB,0), E=(0,AE), C=(0,AC).
  const determinant = ac => -ad*ac+ae*ab
  assert.equal(determinant(acA), 0)
  assert.notEqual(determinant(acB), 0)
  const transitions = new Map([
    ['1', ad*acB === ae*ab],
    ['2', ab === ad+db && acB === ae+ecB],
    ['3', ad > 0 && ad < ab && ae > 0 && ae < acB],
  ])
  const failed = [...transitions].filter(([, holds]) => !holds).map(([id]) => id)
  assert.deepEqual(failed, [probe.answer])
  assert.deepEqual(probe.choices.map(choice => choice.id), [...transitions.keys()])
  for (const { id, label } of probe.choices) {
    assert.ok(label)
    assert.equal(checkPart({ id: 'probe', kind: probe.kind, check: probe.kind, expected: probe.answer }, id).status, failed.includes(id) ? 'correct' : 'incorrect')
  }
  for (const templateId of ['parallel-length-area', 'area-to-length']) {
    const other = createInstance('geom.plane.similarity', 7, templateId).lesson.probe
    assert.equal(other.kind, 'number')
    assert.equal(other.choices, undefined)
  }
})

test('public geometry contrast carries choices without its private key or explanation', () => {
  const item = createInstance('geom.plane.similarity', 2)
  assert.equal(item.templateId, 'converse-parallel')
  assert.equal(item.version, 4)
  const visible = publicLesson(item.lesson)
  assert.equal(visible.probe.kind, 'choice')
  assert.deepEqual(visible.probe.choices, item.lesson.probe.choices)
  assert.equal(Object.hasOwn(visible.probe, 'answer'), false)
  assert.equal(Object.hasOwn(visible.probe, 'explanation'), false)
  assert.equal(JSON.stringify(visible).includes(item.lesson.probe.explanation), false)
  for (const { label } of visible.probe.choices) assert.equal(visible.probe.prompt.includes(label), false)
})

test('similarity probe asks for a part of the whole rather than its reciprocal', () => {
  const probe = geometryFamilies.find(f => f.id === 'geom.plane.similarity').lesson.probe
  assert.match(probe.prompt, /Какую часть/)
  assert.doesNotMatch(probe.prompt, /Во сколько раз/)
  assert.equal(probe.answer, (3 / 4) ** 2)
})
