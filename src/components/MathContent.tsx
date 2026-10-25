import { convertLatexToMarkup } from 'mathlive'
import { createElement, Fragment, type ReactNode } from 'react'
import { BookOpen, ArrowUpRight } from 'lucide-react'
import { materials } from '../materials'
import { parseMathMarkdown, type MarkdownBlock } from '../math-markdown'
import './math-content.css'

export function MathText({ value, display = false }: { value: string; display?: boolean }) {
  let html = ''
  try { html = convertLatexToMarkup(value) } catch { return <code>{value}</code> }
  // Only MathLive-generated notation enters this element; prose stays in React text nodes.
  return <span className={`math-display ${display ? 'is-display' : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
}

export function MathContent({ text, renderAnnotation, onOpenMaterial, exercises, onOpenExercise }: { text: string; renderAnnotation?(index: number): ReactNode; onOpenMaterial?(id: string): void; exercises?: { id: string; title: string }[]; onOpenExercise?(id: string): void }) {
  const pattern = /(`[^`\n]+`|\*\*[\s\S]+?\*\*|\[\[exercise:[^\]\n]+\]\]|\[\[material:[^\]\n]+\]\]|\[\[annotation:\d+\]\]|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^\n$]+?\$)/g
  const render = (value: string): ReactNode[] => { const pieces = value.split(pattern)
  return pieces.map((piece, i) => {
    if (piece.startsWith('`') && piece.endsWith('`')) return <code className="tutor-inline-code" key={i}>{piece.slice(1, -1)}</code>
    if (piece.startsWith('**') && piece.endsWith('**')) return <strong key={i}>{render(piece.slice(2, -2))}</strong>
    const exercise = piece.match(/^\[\[exercise:([^\]]+)\]\]$/)
    if (exercise) {
      const item = exercises?.find(candidate => candidate.id === exercise[1])
      return item && onOpenExercise ? <button className="tutor-material-link" key={i} onClick={() => onOpenExercise(item.id)}><BookOpen size={14} /><span>{item.title}<small>Подготовка · затем вернёмся к решению</small></span><ArrowUpRight size={14} /></button> : <span className="material-link-unavailable" key={i}>Упражнение сейчас недоступно</span>
    }
    const reference = piece.match(/^\[\[material:([^\]]+)\]\]$/)
    if (reference && onOpenMaterial) {
      const article = materials.find(item => item.id === reference[1])
      if (!article) return <span className="material-link-unavailable" key={i}>Статья пока недоступна</span>
      return <button className="tutor-material-link" key={i} onClick={() => onOpenMaterial(article.id)} aria-label={`Открыть статью «${article.title}»`}><BookOpen size={14} /><span>{article.title}{article.diagram && <small>{article.diagram === 'circle' ? 'Интерактивная окружность' : 'Объяснение с рисунком'}</small>}</span><ArrowUpRight size={14} /></button>
    }
    const annotation = piece.match(/^\[\[annotation:(\d+)\]\]$/)
    if (annotation) return renderAnnotation ? <Fragment key={i}>{renderAnnotation(Number(annotation[1]))}</Fragment> : <span key={i}>{piece}</span>
    const display = piece.startsWith('$$') || piece.startsWith('\\[')
    const math = display || piece.startsWith('\\(') || (piece.startsWith('$') && piece.endsWith('$'))
    if (!math) {
      let prose = piece
      if (/^(\$\$|\\\[)/.test(pieces[i - 1] ?? '')) prose = prose.trimStart()
      if (/^(\$\$|\\\[)/.test(pieces[i + 1] ?? '')) prose = prose.trimEnd()
      return <span key={i}>{prose.split(/(\*\*[^*]+\*\*)/g).map((part, j) => part.startsWith('**') && part.endsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part)}</span>
    }
    const length = piece.startsWith('$') && !display ? 1 : 2
    return <MathText key={i} value={piece.slice(length, -length)} display={display} />
  })
  }
  const renderBlocks = (blocks: MarkdownBlock[]): ReactNode[] => blocks.map((block, i) => {
    if (block.kind === 'code') return <pre className="tutor-code" key={i}><code>{block.text}</code></pre>
    if (block.kind === 'heading') return createElement(`h${block.level}`, { key: i, className: 'tutor-heading' }, render(block.text))
    if (block.kind === 'list') {
      const children = block.items.map((item, j) => <li key={j}>{renderBlocks(item)}</li>)
      return block.ordered ? <ol className="tutor-list" start={block.start} key={i}>{children}</ol> : <ul className="tutor-list" key={i}>{children}</ul>
    }
    return <div className="tutor-paragraph" key={i}>{render(block.text)}</div>
  })
  return <div className="math-content">{renderBlocks(parseMathMarkdown(text))}</div>
}
