import { useEffect, useId, useRef, useState } from 'react'
import { MathAnswer } from './MathAnswer'

/** A notation editor only: the caller owns the destination and draft revision. */
export function ExamFormulaComposer({ initialValue = '', editing = false, onInsert, onClose, disabled = false, error }: {
  initialValue?: string; editing?: boolean; onInsert(latex: string): void; onClose(): void; disabled?: boolean; error?: string
}) {
  const [latex, setLatex] = useState(initialValue)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const titleId = useId()
  const helpId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // The native modal isolates background inputs. Keep MathLive's keyboard
    // inside the modal as well, otherwise native inertness would block its keys.
    window.mathVirtualKeyboard.hide()
    window.mathVirtualKeyboard.container = dialog
    dialog.showModal()
    const frame = requestAnimationFrame(() => dialog.querySelector<HTMLElement>('math-field')?.focus())
    return () => {
      cancelAnimationFrame(frame)
      window.mathVirtualKeyboard.hide()
      window.mathVirtualKeyboard.container = null
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])

  return <dialog ref={dialogRef} className="exam-formula-dialog" aria-labelledby={titleId} aria-describedby={helpId}
    onCancel={event => { event.preventDefault(); closeRef.current() }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return
      const focusable = [...dialog.querySelectorAll<HTMLElement>('math-field:not([disabled]), button:not([disabled]), [tabindex="0"]')]
        .filter(element => element.getClientRects().length > 0 && element.tabIndex >= 0)
      const first = focusable[0], last = focusable.at(-1)
      if (!first || !last) { event.preventDefault(); dialog.focus(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }}>
    <h2 id={titleId}>{editing ? 'Изменить формулу' : 'Вставить формулу'}</h2>
    <p id={helpId} className="exam-formula-help">{editing ? 'Измени запись. Остальной текст останется на месте.' : 'Набери формулу или собери её кнопками. Она появится в выбранном месте записи.'}</p>
    <MathAnswer label="Твоя формула" value={latex} onChange={setLatex} notation="latex" disabled={disabled}/>
    {error && <p className="exam-formula-error" role="alert">{error}</p>}
    <div className="exam-formula-actions">
      <button type="button" className="exam-secondary" onClick={onClose}>Отмена</button>
      <button type="button" className="exam-primary" disabled={disabled || !latex.trim()} onClick={() => onInsert(latex)}>{editing ? 'Применить' : 'Вставить в запись'}</button>
    </div>
  </dialog>
}
