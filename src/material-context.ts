import { materials } from './materials.ts'

const contextualIds: Record<string, string[]> = {
  G1: ['double-angle', 'zero-product', 'division', 'interval'],
  G2: ['sine', 'cosine', 'zero-product', 'interval'],
  G3: ['sine', 'unit-circle', 'angle-addition', 'interval'],
}

export function contextualMaterials(family?: string | null, solo = false) {
  // Do not suggest a method while the learner is working independently.
  if (solo) return []
  const ids = family ? contextualIds[family] : undefined
  return (ids ?? contextualIds.G1).flatMap(id => materials.filter(item => item.id === id))
}

export function hasMaterialContext(family?: string | null) {
  return !!family && Object.hasOwn(contextualIds, family)
}
