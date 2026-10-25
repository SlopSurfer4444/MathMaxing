/** Explicit, versioned projection of authored learning models. No answer key. */
export function publicStepModel(value) {
  if (!value || value.version !== 1 || typeof value.title !== 'string' || value.title.length > 200) return null
  const facts = value.facts
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return null
  if (value.kind === 'debt-two-payments' && value.id === value.kind) {
    if (!Number.isSafeInteger(facts.principal) || facts.principal <= 0 || facts.principal > 1e9 || !Number.isFinite(facts.rate) || facts.rate < 0 || facts.rate > 100) return null
    return { id: value.id, version: 1, kind: value.kind, title: value.title, facts: { principal: facts.principal, rate: facts.rate } }
  }
  if (value.kind === 'converse-parallel' && value.id === value.kind) {
    const keys = ['ad', 'db', 'ae', 'ec']
    if (!keys.every(key => Number.isSafeInteger(facts[key]) && facts[key] > 0 && facts[key] <= 1e9)) return null
    return { id: value.id, version: 1, kind: value.kind, title: value.title, facts: Object.fromEntries(keys.map(key => [key, facts[key]])) }
  }
  return null
}
