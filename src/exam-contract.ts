// Shared public vocabulary; private mathematical keys stay in server/exam.
export type ExamPart = { id: string; label: string; kind: 'number' | 'interval' | 'text' | 'roots' | 'series' | 'choice'; prompt?: string; answerUnit?: string }
export type ExamEditionId = '2026' | '2027'
// Coordinates emitted by the current editor. The server also reads legacy
// coordinate records as opaque saved data; this is not a storage migration.
export type ExamReturnPoint = {scrollY:number;start:number;end:number;partId?:string;kind?:'text'|'math';position?:number;revision?:number}
export type ExamClaim = { id: string; attemptId: string; partId: string; claim: string; scope: string; targetRevision: number; targetDigest: string; status: 'correct' | 'incorrect' | 'unknown'; summary: string; checker: string; checkerVersion: number; active: boolean }
export type ExamAlignment = { editionId: ExamEditionId; positions: number[]; status: 'final' | 'draft' }
