import type { JSONContent } from '@tiptap/core'
import type { Submission } from './api-types'

/** A check belongs to the exact submitted writing, not merely its final number. */
export function isCurrentSubmission(submission: Submission | undefined, document: JSONContent, finalAnswer: string, generalAnswer = ''): boolean {
  return !!submission && submission.finalAnswer === finalAnswer && (submission.generalAnswer ?? '') === generalAnswer && JSON.stringify(submission.document) === JSON.stringify(document)
}
