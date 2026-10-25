import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { materials, materialRelations } from '../../shared/materials-data.mjs'
import { allowedMaterialResource, getMaterialResource, relevantMaterials } from './material-resources.mjs'

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const trig = 'algebra.equations.trig-segment'
const metrics = 'geom.plane.metrics'

test('the shared migration baseline is retained while radians receives an explicit new version', async () => {
  const facade = await import('../../src/materials.ts')
  assert.deepEqual(facade.materials, materials)
  assert.deepEqual(facade.materialRelations, materialRelations)
  // Original migration hashes still guard every untouched article and relation.
  // The one amended article is preserved verbatim for old quote/snapshot checks.
  const previous = JSON.parse(readFileSync(new URL('./fixtures/radians-v3.json', import.meta.url), 'utf8'))
  const baseline = materials.map(item => item.id === previous.id ? previous : item)
  assert.equal(hash({ materials: baseline, materialRelations }), '6a267c47c336e9becb1e9f00356ef9cd7af339ad9244c1802bec067ce7c33454')
  assert.equal(hash(baseline.map(item => JSON.stringify(item))), 'fbaf36e9fe37aecef8d386779d103eb2808df5db2fa2d91d333854d91d2ce016')
  const current = getMaterialResource('radians')
  assert.equal(previous.version, 3)
  assert.equal(current.version, 4)
  assert.notEqual(facade.materialSource(previous.id), JSON.stringify(previous))
  assert.equal(facade.materialSource('missing-article'), null)
})

test('all authored links resolve and resource snapshots contain exactly the original article and relations', () => {
  assert.equal(materials.length, 10)
  for (const article of materials) {
    const resource = getMaterialResource(article.id)
    assert.deepEqual(Object.keys(resource).sort(), ['article', 'digest', 'id', 'relations', 'title', 'version'])
    assert.deepEqual(resource.article, article)
    assert.deepEqual(resource.relations, materialRelations[article.id])
    assert.equal(resource.version, article.version)
    assert.equal(resource.title, article.title)
    assert.equal(resource.digest, hash({ article, relations: materialRelations[article.id] }))
    for (const related of [...resource.relations.prerequisites, ...resource.relations.related]) {
      assert.equal(getMaterialResource(related).id, related)
    }
    assert.equal('probe' in resource, false)
    assert.equal('expected' in resource, false)
    assert.equal('familyId' in resource, false)
  }
})

test('contextual suggestions are narrow authored seeds instead of the whole related graph', () => {
  assert.deepEqual(relevantMaterials(trig).map(item => item.id), ['radians', 'unit-circle', 'sine', 'cosine', 'interval'])
  assert.deepEqual(relevantMaterials(metrics).map(item => item.id), ['right-triangle'])
  for (const item of relevantMaterials(trig)) assert.deepEqual(Object.keys(item).sort(), ['id', 'title'])
  assert.deepEqual(relevantMaterials('algebra.rational-sign'), [])
  assert.deepEqual(relevantMaterials('unknown.family'), [])
  assert.deepEqual(relevantMaterials('constructor'), [])
})

test('admission follows only the transitive authored closure, including cycles, within ten resources', () => {
  for (const familyId of [trig, metrics]) {
    const pending = relevantMaterials(familyId).map(item => item.id), visited = new Set()
    while (pending.length) {
      const id = pending.shift()
      if (visited.has(id)) continue
      visited.add(id)
      const resource = allowedMaterialResource(familyId, id)
      pending.push(...resource.relations.prerequisites, ...resource.relations.related)
    }
    assert.ok(visited.size <= 10)
    // Both entry points currently reach all ten articles through authored links.
    assert.equal(visited.size, 10)
    for (const article of materials) assert.equal(allowedMaterialResource(familyId, article.id).id, article.id)
  }
  for (const familyId of ['algebra.rational-sign', 'unknown.family', 'sine', 'constructor']) {
    assert.throws(() => allowedMaterialResource(familyId, 'sine'), { status: 400 })
  }
})

test('unknown resources, family IDs passed as resources and malformed inputs never bypass admission', () => {
  for (const id of ['unpublished', trig, 'constructor']) {
    assert.throws(() => getMaterialResource(id), { status: 404 })
    assert.throws(() => allowedMaterialResource(trig, id), { status: 404 })
  }
  for (const id of ['', ' sine', '../sine', null, {}, 1]) {
    assert.throws(() => getMaterialResource(id), { status: 400 })
    assert.throws(() => allowedMaterialResource(trig, id), { status: 400 })
    assert.throws(() => relevantMaterials(id), { status: 400 })
    assert.throws(() => allowedMaterialResource(id, 'sine'), { status: 400 })
  }
})

test('returned resource descriptors are deeply frozen and isolated from the shared source', () => {
  const resource = allowedMaterialResource(trig, 'sine')
  const inspect = value => {
    if (!value || typeof value !== 'object') return
    assert.equal(Object.isFrozen(value), true)
    Object.values(value).forEach(inspect)
  }
  inspect(resource)
  assert.notEqual(resource.article, materials.find(item => item.id === 'sine'))
  assert.throws(() => { resource.article.title = 'changed' }, TypeError)
  assert.throws(() => { resource.relations.related.push('injected') }, TypeError)
  assert.throws(() => { resource.article.proof[0].text = 'changed' }, TypeError)
  const suggestions = relevantMaterials(trig)
  suggestions[0].title = 'local edit'
  assert.notEqual(relevantMaterials(trig)[0].title, 'local edit')
})
