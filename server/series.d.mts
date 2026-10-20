export type SeriesReference = { a: string; d: string }
export function checkSeries(answer: string, expected: SeriesReference[]): { status: 'correct' | 'incorrect' | 'unknown'; summary: string }
