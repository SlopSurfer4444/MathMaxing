import type { AssistanceGuidance } from './api-types'

export type ClarificationSource = { guidanceId: string; revision: number; modeEpoch: number; contextKey: string; text: string; question: string }
export type ClarificationDraft = { version: 1; workId: string; text: string; source: ClarificationSource | null; updatedAt: string }
export type ClarificationStorage = { getItem(key: string): string | null; removeItem(key: string): void }

export const clarificationKey = (workId: string) => `pole.assistance-reply.v1.${workId}`

export function parseClarification(raw: string, workId: string): ClarificationDraft | null {
  try {
    const value = JSON.parse(raw)
    const source = value?.source
    if (value?.version !== 1 || value.workId !== workId || typeof value.text !== 'string' || value.text.length > 4000 || typeof value.updatedAt !== 'string') return null
    if (source !== null && (!source || typeof source.guidanceId !== 'string' || source.guidanceId.length > 200 || !Number.isSafeInteger(source.revision) || !Number.isSafeInteger(source.modeEpoch) || typeof source.contextKey !== 'string' || source.contextKey.length > 512 || typeof source.text !== 'string' || source.text.length > 12000 || typeof source.question !== 'string' || source.question.length > 4000)) return null
    return value
  } catch { return null }
}

export function loadClarification(storage: ClarificationStorage, workId: string): { entry: ClarificationDraft | null; failed: boolean } {
  try {
    const raw = storage.getItem(clarificationKey(workId))
    const entry = raw ? parseClarification(raw, workId) : null
    return { entry, failed: !!raw && !entry }
  } catch { return { entry: null, failed: true } }
}

export function clarificationSource(guidance: AssistanceGuidance): ClarificationSource {
  return { guidanceId: guidance.id.slice(0, 200), revision: guidance.revision, modeEpoch: guidance.modeEpoch, contextKey: (guidance.contextKey ?? '').slice(0, 512), text: guidance.text.slice(0, 12000), question: (guidance.question?.prompt ?? '').slice(0, 4000) }
}

export function sameClarificationSource(a: ClarificationSource | null, b: ClarificationSource | null): boolean {
  return !!a && !!b && a.guidanceId === b.guidanceId && a.revision === b.revision && a.modeEpoch === b.modeEpoch && a.contextKey === b.contextKey
}

/** Runs on acknowledgement even if its original panel has already unmounted. */
export function acknowledgeClarification(storage: ClarificationStorage, workId: string, text: string, source: ClarificationSource): void {
  const raw = storage.getItem(clarificationKey(workId))
  const stored = raw ? parseClarification(raw, workId) : null
  if (stored?.text === text && sameClarificationSource(stored.source, source)) storage.removeItem(clarificationKey(workId))
}
