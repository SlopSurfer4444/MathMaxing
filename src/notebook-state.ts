import type { JSONContent } from '@tiptap/core'
import { materialSource } from './materials.ts'

export const STORAGE_KEY = 'pole.notebook.v1'
export type Anchor = { blockId: string; kind: 'text' | 'math'; quote: string; latex?: string; origin?: 'notebook' | 'material' | 'work'; title?: string }
export type ChatContext = { anchor: Anchor; source: string }
export type Annotation = {
  id: string; anchor: Anchor; source: string; createdAt: string; resolved: boolean;
  messages: { id: string; text: string; createdAt: string }[]
  contexts?: ChatContext[]
}
export type NotebookState = { version: 1; document: JSONContent; annotations: Annotation[]; savedAt: string }

export const starterDocument: JSONContent = {
  type: 'doc', content: [
    { type: 'paragraph', attrs: { id: 'intro' }, content: [{ type: 'text', text: 'Начну с формулы двойного угла. Так в обеих частях появится cos x.' }] },
    { type: 'mathBlock', attrs: { id: 'formula-1', latex: '2\\sin x\\cos x=\\cos x' } },
    { type: 'paragraph', attrs: { id: 'reasoning' }, content: [{ type: 'text', text: 'Перенесу всё в левую часть и вынесу общий множитель:' }] },
    { type: 'mathBlock', attrs: { id: 'formula-2', latex: '\\cos x(2\\sin x-1)=0' } },
    { type: 'paragraph', attrs: { id: 'continue' }, content: [{ type: 'text', text: 'Теперь можно рассмотреть два случая.' }] },
    { type: 'paragraph', attrs: { id: 'next' } },
  ],
}

export function findBlock(doc: JSONContent, id: string): JSONContent | undefined {
  if (doc.attrs?.id === id) return doc
  for (const node of doc.content ?? []) { const found = findBlock(node, id); if (found) return found }
}

export function blockSignature(node: JSONContent): string {
  return JSON.stringify({ type: node.type, latex: node.attrs?.latex, content: node.content ?? [] })
}

export function anchorStatus(doc: JSONContent, annotation: Annotation): 'current' | 'changed' | 'removed' {
  if (annotation.anchor.origin === 'work') return 'current'
  if (annotation.anchor.origin === 'material') {
    const source = materialSource(annotation.anchor.blockId)
    return source === null ? 'removed' : source === annotation.source ? 'current' : 'changed'
  }
  const block = findBlock(doc, annotation.anchor.blockId)
  return !block ? 'removed' : blockSignature(block) === annotation.source ? 'current' : 'changed'
}

export function createAnnotation(doc: JSONContent, anchor: Anchor, message: string): Annotation | null {
  const block = findBlock(doc, anchor.blockId)
  if (!block || !message.trim()) return null
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), anchor: { ...anchor }, source: blockSignature(block), createdAt: now, resolved: false,
    messages: [{ id: crypto.randomUUID(), text: message.trim(), createdAt: now }] }
}

// Local data is a convenience, never an excuse to silently replace a damaged draft.
export function parseSavedNotebook(raw: string): NotebookState {
  const data = JSON.parse(raw)
  const allowed = new Set(['doc', 'paragraph', 'heading', 'text', 'mathBlock', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule', 'codeBlock'])
  function validNode(node: unknown, depth = 0): boolean {
    if (depth > 30 || !node || typeof node !== 'object') return false
    const n = node as JSONContent
    if (!n.type || !allowed.has(n.type)) return false
    if (n.type === 'text' && typeof n.text !== 'string') return false
    if (n.type === 'mathBlock' && (typeof n.attrs?.latex !== 'string' || typeof n.attrs?.id !== 'string')) return false
    return n.content === undefined || (Array.isArray(n.content) && n.content.every(c => validNode(c, depth + 1)))
  }
  if (data.version !== 1 || data.document?.type !== 'doc' || !validNode(data.document) || !Array.isArray(data.annotations) || typeof data.savedAt !== 'string') throw new Error('Неверный формат тетради')
  for (const a of data.annotations) {
    if (typeof a.id !== 'string' || !a.anchor || typeof a.anchor.blockId !== 'string' || typeof a.anchor.quote !== 'string' || !['math', 'text'].includes(a.anchor.kind) || typeof a.source !== 'string' || typeof a.resolved !== 'boolean' || !Array.isArray(a.messages) || a.messages.some((m: { text?: unknown; id?: unknown }) => typeof m.text !== 'string' || typeof m.id !== 'string')) throw new Error('Неверный формат заметок')
  }
  return data
}

export function freshNotebook(): NotebookState {
  return { version: 1, document: structuredClone(starterDocument), annotations: [], savedAt: new Date().toISOString() }
}
