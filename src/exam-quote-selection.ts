export type ExamQuoteRange = { start: number; end: number; fieldDigest: string }
export type ExamQuoteSlice = { quote: string; start: number; end: number }

/** Textarea offsets are UTF-16 offsets. Trimming and clipping keep that range exact. */
export function captureExamQuote(text: string, start: number, end: number, limit = 1200): ExamQuoteSlice | null {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length) return null
  const selected = text.slice(start, end), trimmed = selected.trim()
  if (!trimmed) return null
  const from = start + selected.length - selected.trimStart().length
  const quote = trimmed.slice(0, limit)
  return quote ? { quote, start: from, end: from + quote.length } : null
}

/** Matches the server's SHA-256 digest(JSON.stringify(text)); no text is persisted here. */
export async function examQuoteFieldDigest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(text))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function uniqueExamQuoteRange(text: string, quote: string): { start: number; end: number } | null {
  if (!quote) return null
  const start = text.indexOf(quote)
  return start < 0 || text.indexOf(quote, start + 1) >= 0 ? null : { start, end: start + quote.length }
}

/** Old history has no identity/range: only an unambiguous literal match is usable. */
export async function locateExamQuote(text: string, quote: string, source: Partial<ExamQuoteRange>): Promise<{ start: number; end: number } | null> {
  const hasAnchor = source.start !== undefined || source.end !== undefined || source.fieldDigest !== undefined
  if (!hasAnchor) return uniqueExamQuoteRange(text, quote)
  if (!Number.isSafeInteger(source.start) || !Number.isSafeInteger(source.end) || source.start! < 0 || source.end! <= source.start! || source.end! > text.length
    || typeof source.fieldDigest !== 'string' || !/^[a-f0-9]{64}$/.test(source.fieldDigest) || text.slice(source.start, source.end) !== quote) return null
  return await examQuoteFieldDigest(text) === source.fieldDigest ? { start: source.start!, end: source.end! } : null
}
