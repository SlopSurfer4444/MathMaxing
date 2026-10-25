import type { JSONContent } from '@tiptap/core'

export type AnswerPart = 'a' | 'b'
export type AnswerBlock = { id: string; kind: 'text' | 'math'; value: string }
export type NotebookAnswers = {
  generalAnswer: string
  finalAnswer: string
  a: AnswerBlock[]
  b: AnswerBlock[]
}

function plainText(node: JSONContent): string {
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(plainText).join('')
}

/** Answer membership belongs to whole blocks; their values always come from the document. */
export function deriveNotebookAnswers(doc: JSONContent): NotebookAnswers {
  const a: AnswerBlock[] = []
  const b: AnswerBlock[] = []
  function visit(node: JSONContent, path: string) {
    if (['paragraph', 'heading', 'mathBlock'].includes(node.type ?? '') && Array.isArray(node.attrs?.answerParts)) {
      const block: AnswerBlock = {
        id: typeof node.attrs?.id === 'string' ? node.attrs.id : `answer-block-${path}`,
        kind: node.type === 'mathBlock' ? 'math' : 'text',
        value: node.type === 'mathBlock'
          ? (typeof node.attrs?.latex === 'string' ? node.attrs.latex : '')
          : plainText(node),
      }
      if (node.attrs.answerParts.includes('a')) a.push(block)
      if (node.attrs.answerParts.includes('b')) b.push(block)
    }
    node.content?.forEach((child, index) => visit(child, `${path}-${index}`))
  }
  visit(doc, '0')
  const joined = (blocks: AnswerBlock[]) => blocks.filter(block => block.value.trim()).map(block => block.value).join('\n')
  return { a, b, generalAnswer: joined(a), finalAnswer: joined(b) }
}

/** Keep independently saved answers as explicit blocks without rewriting their notation. */
export function migrateLegacyAnswers(doc: JSONContent, generalAnswer: string, finalAnswer: string): JSONContent {
  const derived = deriveNotebookAnswers(doc)
  const additions: JSONContent[] = []
  const ids = new Set<string>()
  function collectIds(node: JSONContent) {
    if (typeof node.attrs?.id === 'string') ids.add(node.attrs.id)
    node.content?.forEach(collectIds)
  }
  collectIds(doc)
  for (const [part, value, existing] of [
    ['a', generalAnswer, derived.generalAnswer],
    ['b', finalAnswer, derived.finalAnswer],
  ] as const) {
    // An earlier migration may already have preserved this independent value
    // alongside other answer blocks, so compare individual blocks as well.
    if (!value.trim() || value === existing || derived[part].some(block => block.value === value)) continue
    let id: string
    do { id = `legacy-answer-${part}-${crypto.randomUUID()}` } while (ids.has(id))
    ids.add(id)
    additions.push({ type: 'mathBlock', attrs: { id, latex: value, answerParts: [part] } })
  }
  return additions.length ? { ...doc, content: [...(doc.content ?? []), ...additions] } : doc
}
