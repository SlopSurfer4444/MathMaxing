import { useEffect, useId, useRef } from 'react'
import { MathfieldElement } from 'mathlive'
import { canonicalMathAnswer, toMathAnswerLatex } from '../math-answer'
import './MathAnswer.css'

// Answer entry is notation only, including when mounted outside the notebook.
MathfieldElement.computeEngine = null
MathfieldElement.soundsDirectory = null
MathfieldElement.fontsDirectory = '/mathlive/fonts'

const symbols = [
  { label: 'Дробь', text: 'a/b', latex: '\\frac{#?}{#?}' },
  { label: 'Число пи', text: 'π', latex: '\\pi' },
  { label: 'Минус', text: '−', latex: '-' },
  { label: 'Скобки', text: '( )', latex: '\\left(#?\\right)' },
  { label: 'Разделить ответы', text: ';', latex: ';' },
]

export function MathAnswer({ value, onChange, disabled = false, label, id, multiple = false }: {
  value: string; onChange(value: string): void; disabled?: boolean; label: string; id?: string; multiple?: boolean
}) {
  const generatedId = useId()
  const fieldId = id ?? `math-answer-${generatedId}`
  const host = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  const current = useRef({ value, onChange, disabled, label, fieldId })
  current.current = { value, onChange, disabled, label, fieldId }

  useEffect(() => {
    const field = new MathfieldElement()
    fieldRef.current = field
    field.mathVirtualKeyboardPolicy = 'manual'
    field.smartFence = false
    field.readOnly = current.current.disabled
    field.id = current.current.fieldId
    field.setAttribute('aria-label', current.current.label)
    field.setValue(toMathAnswerLatex(current.current.value), { silenceNotifications: true })
    const change = () => current.current.onChange(canonicalMathAnswer(field.value))
    const mount = () => { field.menuItems = [] }
    field.addEventListener('mount', mount)
    field.addEventListener('input', change)
    host.current?.appendChild(field)
    return () => {
      if (document.activeElement === field) window.mathVirtualKeyboard.hide()
      field.removeEventListener('input', change)
      field.removeEventListener('mount', mount)
      field.remove()
      fieldRef.current = null
    }
  }, [])

  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.readOnly = disabled
    field.setAttribute('aria-label', label)
    field.id = fieldId
    // Echoes from typing must not reset the caret or MathLive undo history.
    if (canonicalMathAnswer(field.value) !== canonicalMathAnswer(toMathAnswerLatex(value))) {
      field.setValue(toMathAnswerLatex(value), { silenceNotifications: true })
    }
  }, [value, disabled, label, fieldId])

  return <div className={`math-answer${disabled ? ' is-disabled' : ''}`}>
    <label htmlFor={fieldId} onClick={() => fieldRef.current?.focus()}>{label}</label>
    <div className="math-answer-field" ref={host}/>
    <div className="math-answer-symbols" role="group" aria-label="Символы для ответа">
      {symbols.map(symbol => <button key={symbol.label} type="button" aria-label={symbol.label} title={symbol.label} disabled={disabled}
        onPointerDown={event => event.preventDefault()}
        onClick={() => {
          const field = fieldRef.current
          if (!field || disabled) return
          // MathLive focus()/blur() retain model.selection. Keep keyboard users'
          // last selected range as well as the caret when entering the palette.
          const selection = structuredClone(field.selection)
          field.focus()
          field.selection = selection
          field.insert(symbol.latex)
          current.current.onChange(canonicalMathAnswer(field.value))
        }}>{symbol.text}</button>)}
      <button type="button" className="math-answer-keyboard" disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => {
        const wasVisible = window.mathVirtualKeyboard.visible
        fieldRef.current?.focus()
        if (wasVisible) window.mathVirtualKeyboard.hide()
        else window.mathVirtualKeyboard.show()
      }}>Математическая клавиатура</button>
    </div>
    {multiple && <small>Несколько ответов разделяй точкой с запятой.</small>}
  </div>
}
