import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import type { ChatContext } from '../exam-chat-draft'
import { MathContent } from './MathContent'
import './exam-quote-source-dialog.css'

export type ExamQuoteSourceDialogProps = {
  context: Readonly<ChatContext>
  onClose(): void
  /** The caller admits an exact current match and owns navigation/closing. */
  onLocate?(): void
}

/** Read-only saved context, never a claim about the current notebook. */
export function ExamQuoteSourceDialog({ context, onClose, onLocate }: ExamQuoteSourceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null), closeButton = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId(), descriptionId = useId()
  const source = context.source
  const field = source?.field === 'answer' ? 'Ответ' : source?.field === 'reasoning' ? 'Ход решения' : 'Цитата из вопроса'

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.showModal()
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      if (dialog.open) dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return <dialog ref={dialogRef} className="exam-quote-source-dialog" aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); closeRef.current() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeRef.current()
    }}>
    <header className="exam-quote-source-heading"><h2 id={titleId}>Сохранённый фрагмент</h2><button ref={closeButton} type="button" aria-label="Закрыть сохранённый фрагмент" onClick={onClose}><X size={19}/></button></header>
    <p id={descriptionId} className="exam-quote-source-note">{!source ? 'Эта цитата сохранилась без снимка исходной записи.' : source.field === 'excerpt' ? 'Сохранённая цитата из вопроса. Её совпадение с записью не установлено.' : 'Снимок записи на момент вопроса. С тех пор запись могла измениться.'}</p>
    {source && <p className="exam-quote-source-meta">Ревизия {source.revision}<span aria-hidden="true"> · </span>{field}{source.field === 'answer' && source.partId ? ` · пункт ${source.partId}` : ''}{source.attemptId ? ' · сданная попытка' : ''}</p>}
    <div className="exam-quote-source-text"><MathContent text={source?.text ?? context.quote}/></div>
    <footer className="exam-quote-source-actions">{onLocate && <button type="button" onClick={onLocate}>Показать в текущей записи</button>}<button type="button" className="exam-quote-source-close" onClick={onClose}>Закрыть</button></footer>
  </dialog>
}
