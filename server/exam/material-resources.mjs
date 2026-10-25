import { createHash } from 'node:crypto'
import { materials, materialRelations } from '../../shared/materials-data.mjs'

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const idOf = (value, name) => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]{0,127}$/.test(value)) throw fail(`Некорректное поле ${name}`)
  return value
}

// Contextual entry points, not artificial task families or prerequisite gates.
const familySeeds = freeze({
  'algebra.equations.trig-segment': ['radians', 'unit-circle', 'sine', 'cosine', 'interval'],
  'geom.plane.metrics': ['right-triangle'],
})
const resources = new Map()
for (const material of materials) {
  if (resources.has(material.id)) throw Error(`Duplicate material: ${material.id}`)
  const article = structuredClone(material)
  const relations = structuredClone(materialRelations[material.id] ?? { prerequisites: [], related: [] })
  const digest = createHash('sha256').update(JSON.stringify({ article, relations })).digest('hex')
  resources.set(material.id, freeze({ id: material.id, version: material.version, title: material.title, article, relations, digest }))
}
for (const resource of resources.values()) {
  for (const id of [...resource.relations.prerequisites, ...resource.relations.related]) {
    if (!resources.has(id)) throw Error(`Missing related material: ${resource.id} -> ${id}`)
  }
}

const allowedByFamily = new Map()
for (const [familyId, seeds] of Object.entries(familySeeds)) {
  const allowed = new Set()
  const pending = [...seeds]
  while (pending.length) {
    const id = pending.shift()
    if (allowed.has(id)) continue
    const resource = resources.get(id)
    if (!resource) throw Error(`Missing material seed: ${familyId} -> ${id}`)
    allowed.add(id)
    if (allowed.size > 10) throw Error(`Material closure exceeds its bound: ${familyId}`)
    pending.push(...resource.relations.prerequisites, ...resource.relations.related)
  }
  allowedByFamily.set(familyId, allowed)
}

export function getMaterialResource(id) {
  const resource = resources.get(idOf(id, 'materialId'))
  if (!resource) throw fail('Этот учебный материал не опубликован.', 404)
  return resource
}

export function relevantMaterials(familyId) {
  idOf(familyId, 'familyId')
  const seeds = Object.hasOwn(familySeeds, familyId) ? familySeeds[familyId] : []
  return seeds.map(id => { const { id: materialId, title } = getMaterialResource(id); return { id: materialId, title } })
}

export function allowedMaterialResource(familyId, id) {
  idOf(familyId, 'familyId')
  const resource = getMaterialResource(id)
  if (!allowedByFamily.get(familyId)?.has(resource.id)) throw fail('Этот материал не связан с текущей темой.')
  return resource
}
