import test from 'node:test';
import assert from 'node:assert/strict';
import { families } from './reasoning-families.mjs';

const family = (id) => families.find((item) => item.id === id);
const template = (familyId, id) => family(familyId).templates.find((item) => item.id === id);
const answer = (work, id) => work.parts.find((part) => part.id === id).expected;
const seeds = [...Array.from({ length: 500 }, (_, i) => i - 170), 315, 630, 945, 1260, 1575, -2_147_483_647, 2_147_483_647];

// Read the actual rendered equation, not the generator's seed arithmetic.
function offset(expression, variable) {
  const match = expression.trim().match(new RegExp(`^${variable}(?: ([+−]) (\\d+))?$`));
  assert.ok(match, `Cannot read ${expression}`);
  return match[1] ? (match[1] === '+' ? 1 : -1) * Number(match[2]) : 0;
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function assertFrozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertFrozen(child);
}

test('reasoning families have scoped lessons, valid internal prerequisites and independent proof parts', () => {
  assert.equal(families.length, 4);
  assert.equal(new Set(families.map((item) => item.id)).size, families.length);
  const ids = new Set(families.map((item) => item.id));
  for (const item of families) {
    assert.ok(Number.isInteger(item.version) && item.version > 0);
    assert.ok(item.scope.length > 40);
    assert.ok(item.exclusions.length >= 3);
    assert.deepEqual(item.alignments, item.group === 'Параметры' ? { '2026': [18], '2027': [19] } : { '2026': [19], '2027': [20] });
    for (const prerequisite of item.prerequisites) assert.ok(ids.has(prerequisite.familyId));
    for (const link of item.lesson.links) assert.ok(ids.has(link));
    for (const key of ['meaning', 'notation', 'conditions', 'why']) assert.ok(item.lesson[key].length > 30);
    assert.ok(item.lesson.example.prompt && item.lesson.example.solution);
    assert.ok(item.lesson.pitfalls.length >= 3);
    assert.equal(item.lesson.probe.kind, 'number');
    assert.equal(typeof item.lesson.probe.answer, 'number');
    assert.equal(item.templates.length, 2);
    for (const variant of item.templates) {
      const work = variant.build(21);
      assert.equal(work.familyId, item.id);
      assert.equal(work.version, item.version);
      assert.equal(work.templateId, variant.id);
      assert.equal(work.seed, 21);
      assert.equal(new Set(work.parts.map((part) => part.id)).size, work.parts.length);
      assert.ok(work.parts.some((part) => part.check === 'numeric'));
      assert.ok(work.parts.some((part) => part.check === 'proof'));
      for (const part of work.parts) {
        assert.equal(part.maxPoints, undefined, 'No invented point allocations');
        assert.ok(work.reference.some((entry) => entry.partId === part.id && entry.text));
        if (part.check === 'proof') {
          assert.equal(part.kind, 'text');
          assert.match(part.scope, /Автоматическая проверка доказательства.*не выполняются/);
          assert.match(part.scope, /другие верные методы/);
        } else {
          assert.equal(part.kind, 'number');
          assert.ok(Number.isFinite(part.expected));
        }
      }
    }
  }
});

test('every builder is deterministic, bounded, preserves signed seeds and deeply freezes all authored data', () => {
  assertFrozen(families);
  for (const item of families) for (const variant of item.templates) {
    for (const seed of [-2_147_483_647, -1, 0, 1, 2_147_483_647]) {
      const first = variant.build(seed), second = variant.build(seed);
      assert.deepEqual(first, second);
      assert.equal(first.seed, seed);
      assertFrozen(first);
      assert.throws(() => { first.parts[0].expected = 100; }, TypeError);
    }
    for (const bad of [undefined, null, '1', NaN, Infinity, 0.5, 2_147_483_648, -2_147_483_648]) {
      assert.throws(() => variant.build(bad), RangeError);
    }
    assert.notEqual(variant.build(0).prompt, variant.build(1).prompt);
  }
});

test('root-count lesson probe counts only roots on the selected absolute-value branch', () => {
  const probe = family('parameter.root-count').lesson.probe;
  const [, aText, bText] = probe.prompt.match(/\|y\| = (\d+)y \+ (\d+)/);
  const a = Number(aText), b = Number(bText), roots = new Set(), branchRoots = new Set();
  // Enumerate rational values in the original equation, independent of branch formulas.
  for (let numerator = -8; numerator <= 8; numerator++) for (let denominator = 1; denominator <= 8; denominator++) {
    if (Math.abs(numerator) !== a * numerator + b * denominator) continue;
    const divisor = gcd(numerator, denominator), key = `${numerator / divisor}/${denominator / divisor}`;
    roots.add(key);
    if (numerator >= 0) branchRoots.add(key);
  }
  assert.equal(probe.answer, branchRoots.size);
  assert.equal(branchRoots.size, 0);
  assert.deepEqual(roots, new Set(['-1/3']), 'the whole equation still has a negative-branch root');
});

test('linear degeneration includes both no solutions and infinitely many, with a single root otherwise', () => {
  const variant = template('parameters.degeneracy', 'vanishing-linear');
  const seen = new Set();
  for (const seed of seeds) {
    const work = variant.build(seed);
    const [, left, right] = work.prompt.match(/Дано уравнение \((a[^)]*)\)x = (a[^,]*),/);
    const l = offset(left, 'a'), r = offset(right, 'a'), critical = -l || 0;
    assert.equal(answer(work, 'a'), critical);
    const reference = work.reference.find((item) => item.partId === 'b').text;
    const criticalRhs = critical + r;
    seen.add(criticalRhs === 0 ? 'infinite' : 'none');
    assert.match(reference, criticalRhs === 0 ? /бесконечно много корней/ : /корней нет/);
    for (const a of [critical - 2, critical - 1, critical + 1, critical + 2]) {
      const x = (a + r) / (a + l);
      assert.ok(Math.abs((a + l) * x - (a + r)) < 1e-10);
      assert.notEqual(a + l, 0);
    }
  }
  assert.deepEqual(seen, new Set(['infinite', 'none']));
});

test('quadratic degeneration has a persistent zero root and loses exactly one distinct root at the stated parameter', () => {
  const variant = template('parameters.degeneracy', 'vanishing-quadratic');
  for (const seed of seeds) {
    const work = variant.build(seed);
    const [, coefficient, linear] = work.prompt.match(/Исследуйте \((a[^)]*)\)x² \+ (\d+)x = 0/);
    const c = offset(coefficient, 'a'), b = Number(linear), critical = answer(work, 'a');
    assert.equal(critical + c, 0);
    assert.ok(b > 0);
    for (const a of [critical - 3, critical + 2]) {
      const roots = [0, -b / (a + c)];
      assert.equal(new Set(roots).size, 2);
      for (const x of roots) assert.ok(Math.abs((a + c) * x * x + b * x) < 1e-10);
    }
    assert.match(work.reference[1].text, /нуля или бесконечного числа корней не бывает/);
  }
});

test('square root counts cover below, at, and above the critical level of the rendered equation', () => {
  const variant = template('parameter.root-count', 'shifted-square');
  const observedCounts = new Set();
  for (const seed of seeds) {
    const work = variant.build(seed);
    const [, xExpression, aExpression] = work.prompt.match(/Рассмотрим \((x[^)]*)\)² = (a[^.]*)./);
    const c = offset(aExpression, 'a'), h = -offset(xExpression, 'x');
    const probeA = Number(work.prompt.match(/Сколько различных корней при a = (-?\d+)/)[1]);
    assert.equal(answer(work, 'a') + c, 0);
    const rhs = probeA + c;
    // Enumerate candidates from the nonnegative square root, deduplicating the boundary root.
    const roots = rhs < 0 ? [] : [...new Set([h + Math.sqrt(rhs), h - Math.sqrt(rhs)])];
    assert.equal(answer(work, 'b'), roots.length);
    for (const x of roots) assert.ok(Math.abs((x - h) ** 2 - rhs) < 1e-10);
    observedCounts.add(roots.length);
  }
  assert.deepEqual(observedCounts, new Set([0, 1, 2]));
});

test('absolute-value root oracle checks both boundaries and both outer regions by exact rational enumeration', () => {
  const variant = template('parameter.root-count', 'sloped-absolute');
  const regions = new Set();
  for (const seed of seeds) {
    const work = variant.build(seed);
    const [, kText, xExpression, rightExpression, bText] = work.prompt.match(/Дано (\d+)\|(x[^|]*)\| = a\((x[^)]*)\) \+ (\d+)/);
    assert.equal(xExpression, rightExpression);
    const k = Number(kText), b = Number(bText), a = Number(work.prompt.match(/Сколько различных корней при a = (-?\d+)/)[1]);
    const roots = new Set();
    // Every nonzero solution has numerator ±b and denominator at most k+|a|.
    // Enumerating rational candidates and testing the original equation avoids branch-count formulas.
    for (let numerator = -b; numerator <= b; numerator++) {
      for (let denominator = 1; denominator <= k + Math.abs(a); denominator++) {
        if (k * Math.abs(numerator) === a * numerator + b * denominator) {
          const divisor = gcd(numerator, denominator);
          roots.add(`${numerator / divisor}/${denominator / divisor}`);
        }
      }
    }
    assert.equal(answer(work, 'a'), k);
    assert.equal(answer(work, 'b'), roots.size);
    const region = a < -k ? 'left' : a === -k ? 'left-boundary' : a < k ? 'middle' : a === k ? 'right-boundary' : 'right';
    regions.add(region);
    assert.match(work.reference.find((entry) => entry.partId === 'c').text, /ветви не пересекаются/);
  }
  assert.equal(regions.size, 5);
});

test('all parity constructions have valid examples; exhaustive admissible pairs rule out equal parity', () => {
  const variant = template('integer.construction', 'parity-sum');
  for (const seed of seeds) {
    const work = variant.build(seed);
    const [, lowerText, sumText] = work.prompt.match(/не меньше (\d+), x \+ y = (\d+)/);
    const lower = Number(lowerText), sum = Number(sumText), pairs = [];
    for (let x = lower; x <= sum - lower; x++) pairs.push([x, sum - x]);
    assert.ok(pairs.length > 1, 'More than one acceptable example exists');
    for (const [x, y] of pairs) assert.equal((x % 2) + (y % 2), answer(work, 'a'));
    assert.ok(pairs.some(([x, y]) => x === lower && y >= lower));
    assert.match(work.reference[1].text, /Любой другой допустимый пример подходит/);
  }
});

test('integer rectangles: enumerate all positive integer sides to verify maximum, construction, and impossibility', () => {
  const variant = template('integer.construction', 'integer-rectangle');
  for (const seed of seeds) {
    const work = variant.build(seed);
    const perimeter = Number(work.prompt.match(/периметр (\d+)/)[1]);
    const target = Number(work.prompt.match(/прямоугольник площади (\d+)/)[1]);
    const impossible = Number(work.prompt.match(/что площадь (\d+)/)[1]);
    const areas = [];
    for (let x = 1; 2 * x < perimeter; x++) {
      const y = perimeter / 2 - x;
      if (Number.isInteger(y) && y > 0) areas.push(x * y);
    }
    assert.equal(answer(work, 'a'), Math.max(...areas));
    assert.ok(areas.includes(target));
    assert.ok(!areas.includes(impossible));
  }
});

test('product maxima match exhaustive search for odd and even sums and have attained bounds', () => {
  const variant = template('integer.bounds-divisibility', 'fixed-sum-product');
  const parities = new Set();
  for (const seed of seeds) {
    const work = variant.build(seed), sum = Number(work.prompt.match(/x \+ y = (\d+)/)[1]);
    const products = Array.from({ length: sum - 1 }, (_, i) => (i + 1) * (sum - i - 1));
    assert.equal(answer(work, 'a'), Math.max(...products));
    assert.ok(products.includes(answer(work, 'a')));
    parities.add(sum % 2);
  }
  assert.equal(parities.size, 2);
});

test('universal divisor equals the gcd of a full consecutive residue window, including negatives and zeros', () => {
  const variant = template('integer.bounds-divisibility', 'universal-divisor');
  for (const seed of seeds) {
    const work = variant.build(seed);
    const [, mText, ...factorTexts] = work.prompt.match(/N\(n\) = (\d+)\((n[^)]*)\)\((n[^)]*)\)\((n[^)]*)\)/);
    const m = Number(mText), offsets = factorTexts.map((factor) => offset(factor, 'n'));
    assert.equal(offsets[1] - offsets[0], 1);
    assert.equal(offsets[2] - offsets[1], 1);
    const values = Array.from({ length: 41 }, (_, i) => offsets.reduce((product, c) => product * (i - 20 + c), m));
    const d = answer(work, 'a');
    assert.ok(values.includes(0));
    assert.ok(values.some((value) => value < 0));
    assert.ok(values.includes(d), 'Exact positive witness rules out a larger universal divisor');
    assert.equal(values.reduce((divisor, value) => gcd(divisor, value), 0), d);
    assert.ok(values.every((value) => value % d === 0));
  }
});
