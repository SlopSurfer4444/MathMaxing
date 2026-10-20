import type { JSONContent } from '@tiptap/core'
import type { ChatContext } from './notebook-state'
export type Mode = 'guided' | 'solo' | 'review'
export type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; contexts: ChatContext[]; requestId: string; createdAt: string; status: 'pending' | 'sent' | 'failed'; error?: string; stale?: boolean; sourceRevision?: number }
export type RootResult = { status: 'correct' | 'incorrect' | 'unknown'; summary: string; missing?: string[]; extra?: string[] }
export type Submission = { id: string; problemId: string; document: JSONContent; finalAnswer: string; generalAnswer?: string; createdAt: string; reason: 'submitted' | 'help_requested'; mode: Mode; helpCount: number; result: RootResult; seriesResult?: RootResult; review?: string; reviewStatus?: 'pending' | 'ready' | 'failed'; reviewVersion?: number; reviewError?: string }
export type ReturnAnchor = {blockId?: string; position?: number; scrollY?: number}
export type PreparationExercise = { id:string; title:string; kind:'roots'|'choice'; prompt:string; math?:string; answerFormat:string; choices?:{id:string;label:string;math?:string}[]; explanation:string; materialIds:string[]; selectionSteps?:{seriesMath:string;boundsMath:string;integers:number[];roots:string[];rootsMath:string;substitutionMath:string}[] }
export type Preparation = {id:string; exerciseId:string; answer:string; result?:RootResult; returnAnchor?:ReturnAnchor; completed?:boolean; startedAt:string; returnedAt?:string; documentRevision:number; attempts:{answer:string;result:RootResult;createdAt:string}[]}
export type Work = { id: string; problemId: string; mode: Mode; modeEpoch: number; revision: number; document: JSONContent; finalAnswer: string; generalAnswer?: string; messages: ChatMessage[]; submissions: Submission[]; createdAt: string; updatedAt: string; priorExposure: boolean; preparation?:Preparation; preparationHistory?:Preparation[] }
export type Problem = { id: string; title: string; equation: string; interval: string; description: string; skills: string[] }
export type MemoryEvent = { id: string; problemId: string; summary: string; createdAt: string; independent: boolean; submissionId: string }
export type ProviderStatus = { connected: boolean; configured?: boolean; loading?: boolean; provider: string; model?: string; error?: string }
export type WorkSummary = Pick<Work, 'id' | 'problemId' | 'mode' | 'updatedAt'>
export type AppState = { work: Work; works: WorkSummary[]; problems: Problem[]; exercises: PreparationExercise[]; memory: MemoryEvent[]; provider: ProviderStatus; canImportLocal?: boolean }
