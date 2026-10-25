import { materials } from '../shared/materials-data.mjs'

export { materials, materialRelations } from '../shared/materials-data.mjs'
export type { Material } from '../shared/materials-data.mjs'

export function materialSource(id: string): string | null {
  const material = materials.find(m => m.id === id)
  return material ? JSON.stringify(material) : null
}
