/**
 * Adapted from kucukkanat/liquid-glass, revision
 * 2ef3c5d3005a181f089b38d8b3188fc9163eecc2/packages/glass/src/displacement.ts.
 * Copyright (c) 2026 kucukkanat. MIT License; see THIRD_PARTY_LICENSE.txt.
 * Changes: bounded single-resolution raster and shared bounded map cache.
 */

const mapCache = new Map<string, string>()
const MAX_MAP_SIDE = 512
const CACHE_LIMIT = 8

function roundedBoxDistance(x: number, y: number, halfWidth: number, halfHeight: number, radius: number) {
  const qx = Math.abs(x) - halfWidth + radius
  const qy = Math.abs(y) - halfHeight + radius
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
}

/** Geometry only: scrolling, transforms and pointer movement never rebuild a map. */
export function getDisplacementMap(width: number, height: number, radius: number): string | null {
  const ratio = Math.min(1, MAX_MAP_SIDE / Math.max(width, height))
  const rasterWidth = Math.max(1, Math.round(width * ratio))
  const rasterHeight = Math.max(1, Math.round(height * ratio))
  const rasterRadius = Math.min(radius * ratio, rasterWidth / 2, rasterHeight / 2)
  const bevel = Math.max(1, Math.min(18, radius * 0.7) * ratio)
  const key = `${rasterWidth}:${rasterHeight}:${rasterRadius.toFixed(2)}:${bevel.toFixed(2)}`
  const cached = mapCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = rasterWidth
  canvas.height = rasterHeight
  const context = canvas.getContext('2d')
  if (!context) return null
  const pixels = context.createImageData(rasterWidth, rasterHeight)
  const halfWidth = rasterWidth / 2
  const halfHeight = rasterHeight / 2
  const distance = (x: number, y: number) => roundedBoxDistance(x, y, halfWidth, halfHeight, rasterRadius)

  for (let y = 0; y < rasterHeight; y += 1) {
    for (let x = 0; x < rasterWidth; x += 1) {
      const px = x - halfWidth + 0.5
      const py = y - halfHeight + 0.5
      const d = distance(px, py)
      let nx = 0
      let ny = 0
      if (d <= 0 && d >= -bevel) {
        const t = Math.max(0, Math.min(1, (d + bevel) / bevel))
        const magnitude = t * t * t * (t * (t * 6 - 15) + 10)
        const gx = distance(px + 1, py) - distance(px - 1, py)
        const gy = distance(px, py + 1) - distance(px, py - 1)
        const length = Math.hypot(gx, gy) || 1
        nx = (-gx / length) * magnitude
        ny = (-gy / length) * magnitude
      }
      const offset = (y * rasterWidth + x) * 4
      pixels.data[offset] = 128 + nx * 127
      pixels.data[offset + 1] = 128 + ny * 127
      pixels.data[offset + 2] = 128
      pixels.data[offset + 3] = 255
    }
  }

  context.putImageData(pixels, 0, 0)
  const url = canvas.toDataURL('image/png')
  if (mapCache.size >= CACHE_LIMIT) mapCache.delete(mapCache.keys().next().value!)
  mapCache.set(key, url)
  return url
}
