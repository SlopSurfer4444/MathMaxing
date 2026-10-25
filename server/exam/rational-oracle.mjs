// Exact sign chart for a bounded product of integer linear factors.
// Denominator roots belong to the original domain, even after cancellation.
const relations = new Set(['>', '>=', '<', '<='])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const boundedInteger = (value, low, high, label) => {
  if (!Number.isSafeInteger(value) || value < low || value > high) throw new RangeError(`${label}: expected integer in [${low}, ${high}]`)
  return value
}
const abs = n => n < 0n ? -n : n
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a }
function root(a, b) {
  let n = -BigInt(b), d = BigInt(a)
  if (d < 0n) { n = -n; d = -d }
  const g = gcd(abs(n), d)
  return { n: n / g, d: d / g }
}
const compare = (a, b) => a.n * b.d < b.n * a.d ? -1 : a.n * b.d > b.n * a.d ? 1 : 0
const text = r => r.d === 1n ? String(r.n) : `${r.n}/${r.d}`
function factors(value, label) {
  if (!Array.isArray(value) || value.length > 8) throw new RangeError(`${label}: expected at most 8 linear factors`)
  // Array.from visits sparse entries too: holes must not bypass validation.
  return Array.from(value, factor => {
    if (!record(factor) || Object.keys(factor).some(k => !['a', 'b', 'multiplicity'].includes(k))) throw new TypeError(`${label}: invalid linear factor`)
    const a = boundedInteger(factor.a, -100, 100, `${label}.a`)
    if (a === 0) throw new RangeError(`${label}.a must be nonzero`)
    const b = boundedInteger(factor.b, -100, 100, `${label}.b`)
    const multiplicity = boundedInteger(factor.multiplicity === undefined ? 1 : factor.multiplicity, 1, 8, `${label}.multiplicity`)
    return { a, b, multiplicity }
  })
}

/**
 * Solve coefficient * Π(a*x+b)^multiplicity / Π(a*x+b)^multiplicity relation 0.
 * Coefficient and linear coefficients are integers in [-100,100], a != 0;
 * each factor list has at most eight entries, multiplicity is in [1,8].
 * Returns canonical intervals: ∅, (-inf;inf), [n/d;n/d], or unions using ∪.
 * No polynomial expansion, floating roots, evaluation tolerance, or cancellation.
 */
export function solveRationalSign(input) {
  if (!record(input) || Object.keys(input).some(k => !['coefficient', 'numerator', 'denominator', 'relation'].includes(k))) throw new TypeError('Invalid rational sign specification')
  const { coefficient = 1, numerator = [], denominator = [], relation } = input
  boundedInteger(coefficient, -100, 100, 'coefficient')
  if (!relations.has(relation)) throw new RangeError('relation must be >, >=, <, or <=')
  const top = factors(numerator, 'numerator'), bottom = factors(denominator, 'denominator')
  const roots = new Map()
  let rightSign = Math.sign(coefficient)
  for (const [list, pole] of [[top, false], [bottom, true]]) {
    for (const factor of list) {
      const r = root(factor.a, factor.b), key = text(r)
      const point = roots.get(key) ?? { ...r, multiplicity: 0, pole: false }
      point.multiplicity += factor.multiplicity
      point.pole ||= pole
      roots.set(key, point)
      if (factor.a < 0 && factor.multiplicity % 2) rightSign *= -1
    }
  }
  const points = [...roots.values()].sort(compare)
  const signs = new Array(points.length + 1)
  signs[points.length] = rightSign
  for (let i = points.length - 1; i >= 0; i--) signs[i] = signs[i + 1] * (points[i].multiplicity % 2 ? -1 : 1)
  const accepts = sign => relation === '>' ? sign > 0 : relation === '>=' ? sign >= 0 : relation === '<' ? sign < 0 : sign <= 0
  const intervals = []
  const append = segment => {
    const previous = intervals.at(-1)
    if (previous && previous.hi && segment.lo && compare(previous.hi, segment.lo) === 0 && (previous.closedHi || segment.closedLo)) {
      previous.hi = segment.hi
      previous.closedHi = segment.closedHi
    } else intervals.push(segment)
  }
  for (let i = 0; i <= points.length; i++) {
    if (accepts(signs[i])) append({ lo: points[i - 1] ?? null, hi: points[i] ?? null, closedLo: false, closedHi: false })
    if (i < points.length && !points[i].pole && accepts(0)) append({ lo: points[i], hi: points[i], closedLo: true, closedHi: true })
  }
  return intervals.map(({ lo, hi, closedLo, closedHi }) => `${closedLo ? '[' : '('}${lo ? text(lo) : '-inf'};${hi ? text(hi) : 'inf'}${closedHi ? ']' : ')'}`).join('∪') || '∅'
}
