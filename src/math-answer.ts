import { normalizeSimpleFractions } from './math-notation.ts'
// Presentation-only normalization. Do not simplify or discard unsupported math:
// the exact checker must still return "unknown" for syntax outside its contract.
export function canonicalMathAnswer(value: string): string {
  return normalizeSimpleFractions(value)
    .replace(/\\(?:quad|qquad|enspace|thinspace|medspace|thickspace)\b|\\[,;! ]/g, '')
}

export function toMathAnswerLatex(value: string): string {
  return value.replace(/(?<![A-Za-z\\])pi(?![A-Za-z])/g, '\\pi')
    .replaceAll('π', '\\pi ')
}
