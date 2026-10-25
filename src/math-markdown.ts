export type MarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }

// Shield notation before recognizing Markdown at line starts. Nothing here creates HTML.
export const mathPattern = /\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^\n$]+?\$/g
const listMarker = /^( *)([-+*]|\d+[.)])\s+(.+)$/
const fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/
const headingMarker = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/

/** A deliberately small Markdown subset for tutor prose; raw HTML stays literal text. */
export function parseMathMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const protectedLines = new Set<number>()
  const normalized = lines.join('\n')
  const syntax = normalized.split('')
  // Fence contents have their own grammar: an unmatched dollar there must not
  // consume a heading or a mathematical block after the closing fence.
  let segmentStart = 0
  let position = 0
  const shieldMath = (start: number, end: number) => {
    for (const match of normalized.slice(start, end).matchAll(mathPattern)) {
      const absolute = start + match.index
      const firstLine = normalized.slice(0, absolute).split('\n').length - 1
      for (let offset = 1; offset < match[0].split('\n').length; offset++) protectedLines.add(firstLine + offset)
      for (let offset = 0; offset < match[0].length; offset++) if (syntax[absolute + offset] !== '\n') syntax[absolute + offset] = 'x'
    }
  }
  for (let line = 0; line < lines.length; line++) {
    const fence = lines[line].match(fenceMarker)
    if (fence) {
      shieldMath(segmentStart, position)
      const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
      position += lines[line++].length + 1
      while (line < lines.length && !close.test(lines[line])) position += lines[line++].length + 1
      if (line < lines.length) position += lines[line].length + 1
      segmentStart = position
    } else position += lines[line].length + 1
  }
  shieldMath(segmentStart, normalized.length)
  const shielded = syntax.join('').split('\n')
    .map((line, index) => protectedLines.has(index) && !line ? 'x' : line)
  const blocks: MarkdownBlock[] = []
  let index = 0
  while (index < lines.length) {
    if (!shielded[index].trim()) { index++; continue }
    const fence = shielded[index].match(fenceMarker)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      index++
      // In an unfinished streamed response, retain all content after the opening fence.
      while (index < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[index])) body.push(lines[index++])
      if (index < lines.length) index++
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const heading = shielded[index].match(headingMarker)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: lines[index].replace(/^ {0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '') })
      index++
      continue
    }
    const first = shielded[index].match(listMarker)
    if (first) {
      const ordered = /^\d/.test(first[2])
      const indent = first[1].length
      const items: MarkdownBlock[][] = []
      while (index < lines.length) {
        const marker = shielded[index].match(listMarker)
        if (!marker || marker[1].length !== indent || /^\d/.test(marker[2]) !== ordered) break
        const prefixLength = marker[0].length - marker[3].length
        const item = [lines[index].slice(prefixLength)]
        index++
        while (index < lines.length) {
          const next = shielded[index]
          if (protectedLines.has(index)) {
            item.push(lines[index++])
          } else if (next.trim() && next.match(/^ */)![0].length > indent) {
            item.push(lines[index].slice(Math.min(prefixLength, lines[index].match(/^ */)![0].length)))
            index++
          } else if (!next.trim() && index + 1 < lines.length && shielded[index + 1].match(/^ */)![0].length > indent) {
            item.push(''); index++
          } else break
        }
        items.push(parseMathMarkdown(item.join('\n')))
      }
      blocks.push({ kind: 'list', ordered, start: ordered ? Number.parseInt(first[2]) : 1, items })
      continue
    }
    const paragraph = [lines[index++]]
    while (index < lines.length && shielded[index].trim() && !fenceMarker.test(shielded[index]) && !headingMarker.test(shielded[index]) && !listMarker.test(shielded[index])) paragraph.push(lines[index++])
    blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
  }
  return blocks
}
