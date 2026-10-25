import { useEffect, useId, useRef } from 'react'
import { MathfieldElement } from 'mathlive'
import { canonicalMathAnswer, toMathAnswerLatex } from '../math-answer'
import './MathAnswer.css'

// Answer entry is notation only, including when mounted outside the notebook.
MathfieldElement.computeEngine = null
MathfieldElement.soundsDirectory = null
MathfieldElement.fontsDirectory = `${import.meta.env.BASE_URL}mathlive/fonts`

const symbols = [
  { label: 'Дробь', text: 'a/b', latex: '\\frac{#?}{#?}' },
  { label: 'Число пи', text: 'π', latex: '\\pi' },
  { label: 'Минус', text: '−', latex: '-' },
  { label: 'Скобки', text: '( )', latex: '\\left(#?\\right)' },
  { label: 'Разделить ответы', text: ';', latex: ';' },
]
const formulaSymbols = [
  { label: 'Степень', text: 'xⁿ', latex: '#?^{#?}' },
  { label: 'Квадратный корень', text: '√', latex: '\\sqrt{#?}' },
]

export function MathAnswer({ value, onChange, disabled = false, label, id, multiple = false, mode = 'math', answerKey, notation = 'canonical' }: {
  value: string; onChange(value: string): void; disabled?: boolean; label: string; id?: string; multiple?: boolean; mode?: 'number' | 'math'; answerKey?: string; notation?: 'canonical' | 'latex'
}) {
  const generatedId = useId()
  const fieldId = id ?? `math-answer-${generatedId}`
  const host = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  const numberRef = useRef<HTMLInputElement>(null)
  const current = useRef({ value, onChange, disabled, label, fieldId, notation })
  current.current = { value, onChange, disabled, label, fieldId, notation }
  const readValue = (field: MathfieldElement) => current.current.notation === 'latex' ? field.getValue('latex') : canonicalMathAnswer(field.value)

  useEffect(() => {
    if (mode === 'number') return
    const field = new MathfieldElement()
    fieldRef.current = field
    field.mathVirtualKeyboardPolicy = 'manual'
    field.smartFence = false
    field.readOnly = current.current.disabled
    field.id = current.current.fieldId
    field.setAttribute('aria-label', current.current.label)
    field.setValue(notation === 'latex' ? current.current.value : toMathAnswerLatex(current.current.value), { silenceNotifications: true })
    const change = () => current.current.onChange(readValue(field))
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
  }, [mode, notation])

  useEffect(() => {
    const field = fieldRef.current
    if (!field) return
    field.readOnly = disabled
    field.setAttribute('aria-label', label)
    field.id = fieldId
    // Echoes from typing must not reset the caret or MathLive undo history.
    const incoming = notation === 'latex' ? value : toMathAnswerLatex(value)
    const matches = notation === 'latex' ? field.getValue('latex') === incoming : canonicalMathAnswer(field.value) === canonicalMathAnswer(incoming)
    if (!matches) {
      field.setValue(incoming, { silenceNotifications: true })
    }
  }, [value, disabled, label, fieldId, mode, notation])

  // A new probe retains its input host and focus, but has its own undo history.
  useEffect(() => { fieldRef.current?.resetUndo() }, [answerKey])

  if (mode === 'number') return <div className={`math-answer math-answer-number${disabled ? ' is-disabled' : ''}`}>
    <label htmlFor={fieldId}>{label}</label>
    <div className="math-answer-number-row">
      <input ref={numberRef} id={fieldId} type="text" inputMode={multiple ? 'text' : 'decimal'} autoComplete="off" spellCheck={false} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}/>
      <button type="button" aria-label="Вставить минус" disabled={disabled} onPointerDown={event => event.preventDefault()} onClick={() => {
        const field = numberRef.current
        if (!field) return
        const start = field.selectionStart ?? value.length, end = field.selectionEnd ?? start
        onChange(`${value.slice(0, start)}-${value.slice(end)}`)
        field.focus({ preventScroll: true })
        requestAnimationFrame(() => field.setSelectionRange(start + 1, start + 1))
      }}>−</button>
    </div>
    {multiple && <small>Несколько ответов разделяй точкой с запятой.</small>}
  </div>

  return <div className={`math-answer${disabled ? ' is-disabled' : ''}`}>
    <label htmlFor={fieldId} onClick={() => fieldRef.current?.focus()}>{label}</label>
    <div className="math-answer-field" ref={host}/>
    <div className="math-answer-symbols" role="group" aria-label="Символы для ответа">
      {(notation === 'latex' ? [...symbols, ...formulaSymbols] : symbols).map(symbol => <button key={symbol.label} type="button" aria-label={symbol.label} title={symbol.label} disabled={disabled}
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
          current.current.onChange(readValue(field))
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
