/** Imported archives are data, not trusted DOM. Render drawings as isolated images. */
export function examFigureSource(svg: unknown): string | undefined {
  if (typeof svg !== 'string' || svg.length > 200000 || !/^\s*<svg[\s>]/i.test(svg)) return undefined
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
