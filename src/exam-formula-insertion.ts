import { mathPattern } from './math-markdown.ts'

export interface ExamFormulaInsertion { text: string; caret: number }
export interface ExistingExamFormula { latex: string; start: number; end: number }

function selectionRange(text: string, start: number, end: number) {
  const coordinate = (value: number) => Number.isFinite(value) ? Math.min(text.length, Math.max(0, Math.trunc(value))) : text.length
  const a = coordinate(start), b = coordinate(end)
  return { from: Math.min(a, b), to: Math.max(a, b) }
}

function escapedAt(text: string, position: number): boolean {
  let slashes = 0
  while (position > 0 && text[--position] === '\\') slashes++
  return slashes % 2 === 1
}

function codeRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = []
  const lines = [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0])
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], fence = line[0].match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`)
      const start = line.index
      while (++i < lines.length && !closing.test(lines[i][0])) { /* retain the whole fence */ }
      ranges.push({ start, end: i < lines.length ? lines[i].index + lines[i][0].length : text.length })
    } else {
      for (const inline of line[0].matchAll(/`[^`\n]+`/g)) ranges.push({ start: line.index + inline.index, end: line.index + inline.index + inline[0].length })
    }
  }
  return ranges
}

/** Prefill an editor only for one complete, unambiguous existing formula.
 * Returned offsets include its wrappers: pass them to insertExamFormula() to
 * replace the formula in one draft edit while preserving its display style.
 * A caret exactly outside a wrapper still means insertion into prose.
 */
export function existingFormulaAt(text: string, start: number, end: number): ExistingExamFormula | null {
  const { from, to } = selectionRange(text, start, end)
  const masked = text.split('')
  const mask = (start: number, end: number) => { for (let i = start; i < end; i++) if (masked[i] !== '\n') masked[i] = ' ' }
  for (const code of codeRanges(text)) {
    const overlaps = from === to ? from > code.start && from < code.end : from < code.end && to > code.start
    if (overlaps) return null
    mask(code.start, code.end)
  }
  let found: ExistingExamFormula | null = null
  for (const match of masked.join('').matchAll(new RegExp(mathPattern.source, mathPattern.flags))) {
    const open = match.index, close = open + match[0].length
    const width = match[0].startsWith('$$') || match[0].startsWith('\\') ? 2 : 1
    // The renderer's small grammar can match an escaped dollar. Do not offer
    // destructive editing for such an ambiguous source span.
    if (escapedAt(text, open) || escapedAt(text, close - width)) return null
    const inContent = from >= open + width && to <= close - width
    const wholeFormula = from === open && to === close
    if (inContent || wholeFormula) found = { latex: text.slice(open + width, close - width), start: open, end: close }
    mask(open, close)
  }
  if (!found) return null
  for (const delimiter of masked.join('').matchAll(/\$|\\[\[\]()]/g)) {
    if (!escapedAt(text, delimiter.index)) return null
  }
  return found
}

/** Insert notation without interpreting it or modifying unselected prose.
 * A partial delimiter selection is refused so the caller can retain its draft.
 */
export function insertExamFormula(text: string, start: number, end: number, latex: string): ExamFormulaInsertion {
  const formula = latex.trim()
  if (!formula) throw new Error('Сначала запиши формулу.')
  // Delimiters belong to the surrounding text, never to the mathfield value.
  if (formula.includes('$') || /\\[\[\]()]/.test(formula)) throw new Error('Введи саму формулу без знаков $ или скобок LaTeX вокруг неё.')
  const { from, to } = selectionRange(text, start, end)
  const masked = text.split('')
  const mask = (start: number, end: number) => { for (let i = start; i < end; i++) if (masked[i] !== '\n') masked[i] = ' ' }
  for (const code of codeRanges(text)) {
    const overlaps = from === to ? from > code.start && from < code.end : from < code.end && to > code.start
    if (overlaps && !(from <= code.start && to >= code.end)) throw new Error('Поставь курсор вне записи кода, чтобы формула отображалась как формула.')
    mask(code.start, code.end)
  }
  let inside = false
  let wrapper: { open: string; close: string } | null = null
  for (const match of masked.join('').matchAll(new RegExp(mathPattern.source, mathPattern.flags))) {
    const open = match.index, close = open + match[0].length
    const width = match[0].startsWith('$$') || match[0].startsWith('\\') ? 2 : 1
    mask(open, close)
    if (from === open && to === close) wrapper = { open: text.slice(open, open + width), close: text.slice(close - width, close) }
    if (from >= open + width && to <= close - width) { inside = true; continue }
    // An outer-boundary caret belongs to prose; a whole selected formula can
    // be replaced. Any partial overlap would leave a broken delimiter behind.
    const overlaps = from === to ? from > open && from < close : from < close && to > open
    if (overlaps && !(from <= open && to >= close)) throw new Error('Выдели формулу целиком или поставь курсор внутри неё, не захватывая её границу.')
  }
  // A new $ wrapper could pair with an old unmatched dollar and change how
  // untouched text renders. Refuse until that source boundary is repaired.
  if (!inside) {
    mask(from, to)
    if (/\$|\\[\[\]()]/.test(masked.join(''))) throw new Error('В записи есть незакрытая граница формулы. Сначала закрой её или выдели вместе с заменяемым текстом.')
  }
  const insertion = inside ? formula : wrapper ? `${wrapper.open}${formula}${wrapper.close}` : `$${formula}$`
  return { text: text.slice(0, from) + insertion + text.slice(to), caret: from + insertion.length }
}
