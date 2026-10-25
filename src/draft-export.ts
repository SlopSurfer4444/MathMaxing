import type { NotebookState } from './notebook-state'
import type { Work } from './api-types'

/** Keep the visible draft together; the server version is an explicit recovery base. */
export function currentDraftExport(notebook: NotebookState, work: Work | null, finalAnswer: string, generalAnswer: string) {
  return { ...notebook, finalAnswer, generalAnswer, baseRevision: work?.revision,
    work: work ? { ...work, document: notebook.document, finalAnswer, generalAnswer } : null,
    serverVersion: work }
}
