import { useEffect, useRef, useState } from 'react'
import { Extension, Node, mergeAttributes, type Editor, type JSONContent } from '@tiptap/core'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { closeHistory } from '@tiptap/pm/history'
import { MathfieldElement } from 'mathlive'
import { Copy, Keyboard, MessageSquarePlus, Plus, Trash2 } from 'lucide-react'
import './notebook-controls.css'

// This notebook edits notation only. MathLive must never create a compute engine.
MathfieldElement.computeEngine = null
MathfieldElement.soundsDirectory = null
MathfieldElement.fontsDirectory = '/mathlive/fonts'

export interface NotebookSelection {
  blockId: string
  kind: 'text' | 'math'
  quote: string
  latex?: string
  /** ProseMirror document offsets for text; MathLive offsets for mathematics. */
  from?: number
  to?: number
}

export interface EditorBridge {
  undo(): void
  redo(): void
  insertMath(latex?: string): void
  insertMathAfterBlock(blockId: string, latex?: string): void
  insertTemplate(latex: string): void
  focus(): void
  canUndo(): boolean
  canRedo(): boolean
  getContent(): JSONContent
  replaceContent(content: JSONContent): void
  focusBlock(id: string): void
  captureReturnAnchor(): { blockId?: string; position?: number }
  restoreReturnAnchor(anchor: { blockId?: string; position?: number }): void
}

export interface NotebookEditorProps {
  initialContent?: JSONContent
  onChange(content: JSONContent): void
  onSelection(selection: NotebookSelection | null): void
  onReady(bridge: EditorBridge): void
  onRequestAnnotation?(selection: NotebookSelection): void
  /** Explicit whole-formula transfer; the notebook does not infer or simplify it. */
  onUseAsGeneralAnswer?(latex: string): void
  annotatedBlockIds?: string[]
}

const newId = () => crypto.randomUUID()
const identifiable = new Set(['paragraph', 'heading', 'mathBlock'])
const annotationKey = new PluginKey<Set<string>>('notebookAnnotations')

const AnnotationDecoration = Extension.create({
  name: 'annotationDecoration',
  addProseMirrorPlugins() {
    return [new Plugin<Set<string>>({
      key: annotationKey,
      state: {
        init: () => new Set(),
        apply(transaction, previous) {
          const ids = transaction.getMeta(annotationKey) as string[] | undefined
          return ids ? new Set(ids) : previous
        },
      },
      props: {
        decorations(state) {
          const ids = annotationKey.getState(state)
          if (!ids?.size) return DecorationSet.empty
          const decorations: Decoration[] = []
          state.doc.descendants((node, position) => {
            if (identifiable.has(node.type.name) && ids.has(node.attrs.id)) {
              decorations.push(Decoration.node(position, position + node.nodeSize, { class: 'has-annotation' }))
            }
          })
          return DecorationSet.create(state.doc, decorations)
        },
      },
    })]
  },
})

/** Repair old/imported documents and pasted/split duplicate block identities. */
function withBlockIds(content: JSONContent): JSONContent {
  const seen = new Set<string>()
  const visit = (node: JSONContent): JSONContent => {
    let attrs = node.attrs
    if (identifiable.has(node.type ?? '')) {
      let id = typeof attrs?.id === 'string' ? attrs.id : ''
      if (!id || seen.has(id)) id = newId()
      seen.add(id)
      attrs = { ...attrs, id }
    }
    return { ...node, ...(attrs ? { attrs } : {}), ...(node.content ? { content: node.content.map(visit) } : {}) }
  }
  return visit(content)
}

const BlockIdentity = Extension.create({
  name: 'blockIdentity',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        id: {
          default: null,
          parseHTML: element => element.getAttribute('data-block-id'),
          renderHTML: attributes => ({ 'data-block-id': attributes.id }),
        },
      },
    }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(transaction => transaction.docChanged)) return null
        const seen = new Set<string>()
        const transaction = state.tr
        state.doc.descendants((node, position) => {
          if (!identifiable.has(node.type.name)) return
          let id = typeof node.attrs.id === 'string' ? node.attrs.id : ''
          if (!id || seen.has(id)) {
            id = newId()
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, id })
          }
          seen.add(id)
        })
        // Identity repair belongs to the originating edit, never its own undo step.
        return transaction.docChanged ? transaction : null
      },
    })]
  },
})

interface MathRuntime {
  fields: Map<string, MathfieldElement>
  activeField: MathfieldElement | null
  lastMathAnchor?: { blockId: string; position: number; selection: MathfieldElement['selection'] }
  pendingFocus: { id: string; template?: string } | null
  selection(selection: NotebookSelection | null): void
  annotate(selection: NotebookSelection): void
  canUseAsGeneralAnswer(): boolean
  useAsGeneralAnswer(latex: string): void
  refreshControls(): void
}

function rememberMath(field: MathfieldElement, id: string, runtime: MathRuntime) {
  runtime.lastMathAnchor = { blockId: id, position: field.position, selection: structuredClone(field.selection) }
}

function insertIntoMath(field: MathfieldElement, latex: string, runtime: MathRuntime) {
  const saved = runtime.lastMathAnchor
  const selection = runtime.activeField === field ? structuredClone(field.selection)
    : saved && saved.blockId === field.dataset.mathBlockId ? saved.selection : undefined
  field.focus()
  if (selection) field.selection = structuredClone(selection)
  field.insert(latex, { selectionMode: 'placeholder' })
  rememberMath(field, field.dataset.mathBlockId!, runtime)
}

const notationTools = [
  { label: 'Дробь', symbol: 'a/b', latex: '\\frac{#0}{#?}' },
  { label: 'Степень', symbol: 'xⁿ', latex: '#0^{#?}' },
  { label: 'Корень', symbol: '√', latex: '\\sqrt{#0}' },
  { label: 'Пи', symbol: 'π', latex: '\\pi' },
  { label: 'Синус', symbol: 'sin', latex: '\\sin' },
  { label: 'Косинус', symbol: 'cos', latex: '\\cos' },
  { label: 'Скобки', symbol: '( )', latex: '\\left(#0\\right)' },
  { label: 'Равно', symbol: '=', latex: '=' },
]

function mathSnapshot(field: MathfieldElement, id: string, sourceLatex: string): NotebookSelection {
  if (!field.selectionIsCollapsed) {
    const ranges = field.selection.ranges
    const latex = ranges.map(range => field.getValue(range, 'latex')).join(' ')
    return { blockId: id, kind: 'math', quote: latex, latex, from: ranges[0][0], to: ranges[ranges.length - 1][1] }
  }
  return { blockId: id, kind: 'math', quote: sourceLatex, latex: sourceLatex }
}

function leaveMath(props: NodeViewProps, backward: boolean) {
  const position = props.getPos()
  if (position === undefined) return
  const { editor, node } = props
  const boundary = backward ? position : position + node.nodeSize
  const adjacent = backward ? editor.state.doc.resolve(boundary).nodeBefore : editor.state.doc.resolve(boundary).nodeAfter
  if (adjacent?.isTextblock) {
    const target = backward ? boundary - 1 : boundary + 1
    editor.chain().focus().setTextSelection(target).run()
    return
  }
  // Always provide a text landing place, including first/last or adjacent formula blocks.
  const transaction = editor.state.tr.insert(boundary, editor.schema.nodes.paragraph.create({ id: newId() }))
  transaction.setSelection(TextSelection.create(transaction.doc, boundary + 1))
  editor.view.dispatch(transaction)
  editor.view.focus()
}

function deleteMathBlock(props: NodeViewProps, runtime: MathRuntime) {
  const position = props.getPos()
  if (position === undefined) return
  const { editor, node } = props
  // Delete and any required text landing place form one isolated history step.
  const transaction = closeHistory(editor.state.tr).delete(position, position + node.nodeSize)
  const boundary = Math.min(position, transaction.doc.content.size)
  const resolved = transaction.doc.resolve(boundary)
  let target: number
  if (resolved.nodeAfter?.isTextblock) target = boundary + 1
  else if (resolved.nodeBefore?.isTextblock) target = boundary - 1
  else {
    transaction.insert(boundary, editor.schema.nodes.paragraph.create({ id: newId() }))
    target = boundary + 1
  }
  transaction.setSelection(TextSelection.create(transaction.doc, target))
  runtime.activeField = null
  if (runtime.lastMathAnchor?.blockId === node.attrs.id) runtime.lastMathAnchor = undefined
  runtime.selection(null)
  editor.view.dispatch(transaction.scrollIntoView())
  editor.view.dispatch(closeHistory(editor.state.tr))
  editor.view.focus()
}

function copyMathBlock(props: NodeViewProps, runtime: MathRuntime) {
  const position = props.getPos()
  if (position === undefined) return
  const { editor, node } = props
  const id = newId()
  const boundary = position + node.nodeSize
  // Copy notation verbatim, without deriving or simplifying the next step.
  const copied = editor.schema.nodes.mathBlock.create({ id, latex: node.attrs.latex })
  runtime.pendingFocus = { id }
  const transaction = closeHistory(editor.state.tr).insert(boundary, copied)
  editor.view.dispatch(transaction.scrollIntoView())
  editor.view.dispatch(closeHistory(editor.state.tr))
}

function MathBlockView(props: NodeViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<MathfieldElement | null>(null)
  const liveProps = useRef(props)
  liveProps.current = props
  const runtime = props.extension.options.runtime as MathRuntime
  const id = props.node.attrs.id as string

  useEffect(() => {
    const field = new MathfieldElement()
    let disposed = false
    fieldRef.current = field
    field.mathVirtualKeyboardPolicy = 'manual'
    field.smartFence = true
    field.setAttribute('aria-label', 'Редактор формулы. Enter — перейти к тексту')
    field.setAttribute('data-math-block-id', id)
    field.setValue(liveProps.current.node.attrs.latex ?? '', { silenceNotifications: true })

    const snapshot = () => mathSnapshot(field, id, liveProps.current.node.attrs.latex ?? '')
    const onInput = () => {
      const current = liveProps.current
      const latex = field.getValue('latex')
      if (latex !== current.node.attrs.latex) current.updateAttributes({ latex })
      rememberMath(field, id, runtime)
      runtime.selection(mathSnapshot(field, id, latex))
    }
    const onFocus = () => {
      runtime.activeField = field
      rememberMath(field, id, runtime)
      // Separate entering a formula from preceding prose in the shared history.
      const editor = liveProps.current.editor
      editor.view.dispatch(closeHistory(editor.state.tr))
      runtime.selection(snapshot())
    }
    const onBlur = () => {
      rememberMath(field, id, runtime)
      if (runtime.activeField === field) runtime.activeField = null
      const editor = liveProps.current.editor
      if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr))
      runtime.refreshControls()
    }
    const onSelection = () => {
      if (runtime.activeField === field) rememberMath(field, id, runtime)
      runtime.selection(snapshot())
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      const undoKey = key === 'z' || event.code === 'KeyZ'
      const redoKey = key === 'y' || event.code === 'KeyY'
      if (mod && (undoKey || redoKey)) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const editor = liveProps.current.editor
        if (redoKey || event.shiftKey) editor.commands.redo()
        else editor.commands.undo()
      } else if (event.key === 'Backspace' && !event.isComposing && !field.getValue('latex').trim()) {
        event.preventDefault()
        event.stopImmediatePropagation()
        deleteMathBlock(liveProps.current, runtime)
      } else if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        event.stopImmediatePropagation()
        leaveMath(liveProps.current, false)
      }
    }
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return
      event.preventDefault()
      event.stopImmediatePropagation()
      const editor = liveProps.current.editor
      if (event.inputType === 'historyUndo') editor.commands.undo()
      else editor.commands.redo()
    }
    const onMoveOut = (event: CustomEvent<{ direction: string }>) => {
      event.preventDefault()
      leaveMath(liveProps.current, ['backward', 'upward'].includes(event.detail.direction))
    }
    const onMount = () => {
      if (disposed || !field.isConnected) return
      // menuItems requires MathLive's connected editor, unlike deferred options/value.
      field.menuItems = []
      // Shared notebook controls own undo while the virtual keyboard is open too.
      window.mathVirtualKeyboard.editToolbar = 'none'
      runtime.fields.set(id, field)
      if (runtime.pendingFocus?.id === id) {
        const { template } = runtime.pendingFocus
        runtime.pendingFocus = null
        field.focus()
        if (template) field.insert(template, { selectionMode: 'placeholder' })
        else field.position = field.lastOffset
      }
    }
    field.addEventListener('mount', onMount)
    field.addEventListener('input', onInput)
    field.addEventListener('focus', onFocus)
    field.addEventListener('blur', onBlur)
    field.addEventListener('selection-change', onSelection)
    field.addEventListener('keydown', onKeyDown, true)
    field.addEventListener('beforeinput', onBeforeInput, true)
    field.addEventListener('move-out', onMoveOut)
    host.current?.appendChild(field)
    return () => {
      disposed = true
      if (runtime.fields.get(id) === field) runtime.fields.delete(id)
      if (runtime.activeField === field) runtime.activeField = null
      field.removeEventListener('mount', onMount)
      field.removeEventListener('input', onInput)
      field.removeEventListener('focus', onFocus)
      field.removeEventListener('blur', onBlur)
      field.removeEventListener('selection-change', onSelection)
      field.removeEventListener('keydown', onKeyDown, true)
      field.removeEventListener('beforeinput', onBeforeInput, true)
      field.removeEventListener('move-out', onMoveOut)
      field.remove()
      fieldRef.current = null
    }
  }, [id, runtime])

  useEffect(() => {
    const field = fieldRef.current
    const latex = props.node.attrs.latex ?? ''
    if (!field?.isConnected || field.getValue('latex') === latex) return
    const position = field.position
    // Only external changes (including shared undo) update the mounted field.
    field.setValue(latex, { silenceNotifications: true })
    field.position = Math.min(position, field.lastOffset)
    if (runtime.activeField === field) runtime.selection(mathSnapshot(field, id, latex))
  }, [props.node.attrs.latex, id, runtime])

  return <NodeViewWrapper
    className={`math-block${props.selected ? ' is-selected' : ''}`}
    data-block-id={id}
    contentEditable={false}
  >
    <div className="math-block__header">
      <span className="math-block__label">Формула</span>
      <div className="math-block__actions">
        {runtime.canUseAsGeneralAnswer?.() && <button type="button" className="math-block__general-answer"
          aria-label="Использовать всю формулу как общее решение" title="Добавить всю запись в общее решение"
          disabled={!String(props.node.attrs.latex ?? '').trim()}
          onPointerDown={event => event.preventDefault()}
          onClick={() => runtime.useAsGeneralAnswer(liveProps.current.node.attrs.latex ?? '')}>В общее решение</button>}
        <button type="button" className="math-block__copy" aria-label="Скопировать формулу следующей строкой" title="Скопировать строку и продолжить"
          onMouseDown={event => event.preventDefault()}
          onClick={() => copyMathBlock(liveProps.current, runtime)}><Copy size={13} /> Продолжить копию</button>
        <button type="button" className="math-block__annotate" title="Добавить всю формулу в чат"
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            const latex = props.node.attrs.latex ?? ''
            runtime.annotate({ blockId: id, kind: 'math', quote: latex, latex })
          }}><MessageSquarePlus size={12} /> В чат</button>
        <button type="button" className="math-block__delete" aria-label="Удалить формулу" title="Удалить формулу · Ctrl+Z вернёт её"
          onMouseDown={event => event.preventDefault()}
          onClick={() => deleteMathBlock(liveProps.current, runtime)}><Trash2 size={13} /></button>
      </div>
    </div>
    <div className="math-block__field-host" ref={host} />
    <div className="math-block__palette" role="toolbar" aria-label="Символы для этой формулы">
      {notationTools.map(tool => <button key={tool.label} type="button" aria-label={tool.label} title={tool.label}
        onMouseDown={event => event.preventDefault()}
        onClick={() => {
          const field = fieldRef.current
          if (field) insertIntoMath(field, tool.latex, runtime)
        }}>{tool.symbol}</button>)}
      <button type="button" className="math-block__keyboard" aria-label="Открыть математическую клавиатуру для этой формулы"
        onPointerDown={event => event.preventDefault()}
        onClick={() => {
          const field = fieldRef.current
          if (!field) return
          const selection = structuredClone(field.selection)
          field.focus()
          field.selection = selection
          window.mathVirtualKeyboard.show()
        }}><Keyboard size={16} /> Клавиатура</button>
    </div>
    <span className="math-block__hint">Enter — продолжить текст<span className="math-block__chat-hint"> · Выдели часть формулы, чтобы обсудить</span></span>
  </NodeViewWrapper>
}

const MathBlock = Node.create<{ runtime: MathRuntime }>({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      id: { default: null, parseHTML: element => element.getAttribute('data-block-id') },
      latex: { default: '', parseHTML: element => element.getAttribute('data-latex') ?? '' },
    }
  },
  parseHTML() { return [{ tag: 'div[data-math-block]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-math-block': '', 'data-block-id': HTMLAttributes.id, 'data-latex': HTMLAttributes.latex,
    }), HTMLAttributes.latex]
  },
  addNodeView() {
    return ReactNodeViewRenderer(MathBlockView, {
      // MathLive uses shadow DOM, so PM sees its host rather than the textarea.
      // Let MathLive own typing, clipboard and selection events in that host.
      stopEvent: ({ event }) => event.target instanceof Element && !!event.target.closest('math-field, button'),
    })
  },
})

function textSnapshot(editor: Editor): NotebookSelection | null {
  const { selection, doc } = editor.state
  if (selection.empty) return null
  if (!selection.$from.sameParent(selection.$to)) return null
  const quote = doc.textBetween(selection.from, selection.to, '\n').trim()
  if (!quote) return null
  let blockId: string | undefined
  for (let depth = selection.$from.depth; depth > 0; depth--) {
    const node = selection.$from.node(depth)
    if (node.attrs.id) { blockId = node.attrs.id; break }
  }
  if (!blockId) {
    doc.nodesBetween(selection.from, selection.to, node => {
      if (!blockId && node.attrs.id) blockId = node.attrs.id
    })
  }
  return blockId ? { blockId, kind: 'text', quote, from: selection.from, to: selection.to } : null
}

type FloatingControl =
  | { kind: 'quote'; selection: NotebookSelection; left: number; top: number }
  | { kind: 'insert'; blockId: string; left: number; top: number }

function clampControlLeft(left: number, width: number) {
  return Math.max(8, Math.min(left, window.innerWidth - width - 8))
}

function quoteCoordinates(editor: Editor, selection: NotebookSelection, runtime: MathRuntime) {
  if (selection.kind === 'math') {
    const field = runtime.fields.get(selection.blockId)
    if (!field) return null
    // MathLive's public atom bounds use viewport coordinates like PM coordsAtPos.
    const start = field.getElementInfo((selection.from ?? 0) + 1)?.bounds
    const end = field.getElementInfo(selection.to ?? field.lastOffset)?.bounds
    if (start && end) return {
      left: Math.min(start.left, end.left), right: Math.max(start.right, end.right),
      top: Math.min(start.top, end.top), bottom: Math.max(start.bottom, end.bottom),
    }
    return field.getBoundingClientRect()
  }
  const from = editor.view.coordsAtPos(selection.from ?? editor.state.selection.from)
  const to = editor.view.coordsAtPos(selection.to ?? editor.state.selection.to)
  return {
    left: Math.min(from.left, to.left), right: Math.max(from.right, to.right),
    top: Math.min(from.top, to.top), bottom: Math.max(from.bottom, to.bottom),
  }
}

export function NotebookEditor(props: NotebookEditorProps) {
  const callbacks = useRef(props)
  callbacks.current = props
  const container = useRef<HTMLDivElement>(null)
  const bridgeRef = useRef<EditorBridge | null>(null)
  const selectionRef = useRef<NotebookSelection | null>(null)
  const refreshControls = useRef<() => void>(() => {})
  const [control, setControl] = useState<FloatingControl | null>(null)
  const runtimeRef = useRef<MathRuntime | null>(null)
  if (!runtimeRef.current) runtimeRef.current = {
    fields: new Map(), activeField: null, pendingFocus: null,
    selection: selection => {
      selectionRef.current = selection
      callbacks.current.onSelection(selection)
      refreshControls.current()
    },
    annotate: selection => {
      callbacks.current.onSelection(selection)
      callbacks.current.onRequestAnnotation?.(selection)
    },
    canUseAsGeneralAnswer: () => !!callbacks.current.onUseAsGeneralAnswer,
    useAsGeneralAnswer: latex => callbacks.current.onUseAsGeneralAnswer?.(latex),
    refreshControls: () => refreshControls.current(),
  }
  const runtime = runtimeRef.current
  const editor = useEditor({
    extensions: [StarterKit, BlockIdentity, AnnotationDecoration, MathBlock.configure({ runtime })],
    content: withBlockIds(props.initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] }),
    editorProps: {
      attributes: { 'aria-label': 'Тетрадь: текст и формулы', spellcheck: 'false' },
    },
    onUpdate: ({ editor: current }) => callbacks.current.onChange(current.getJSON()),
    onSelectionUpdate: ({ editor: current }) => {
      if (!runtime.activeField && current.isFocused) { runtime.lastMathAnchor = undefined; runtime.selection(textSnapshot(current)) }
    },
    onFocus: ({ editor: current }) => {
      if (!runtime.activeField) { runtime.lastMathAnchor = undefined; runtime.selection(textSnapshot(current)) }
    },
    onBlur: () => refreshControls.current(),
  })

  useEffect(() => {
    if (!editor) return
    let frame = 0
    const measure = () => {
      frame = 0
      if (editor.isDestroyed) return
      const activeElement = document.activeElement
      if (!activeElement || !container.current?.contains(activeElement)) {
        setControl(null)
        if (selectionRef.current) {
          selectionRef.current = null
          callbacks.current.onSelection(null)
        }
        return
      }
      const previous = selectionRef.current
      const mathField = previous?.kind === 'math' ? runtime.fields.get(previous.blockId) : null
      const focusOnQuoteButton = !!activeElement.closest('.editor-context-action')
      const focusOnInsertButton = !!activeElement.closest('.editor-local-insert')
      let selection: NotebookSelection | null = null
      if (mathField && (runtime.activeField === mathField || focusOnQuoteButton) && !mathField.selectionIsCollapsed) {
        selection = mathSnapshot(mathField, previous!.blockId, previous!.latex ?? '')
      } else if (!runtime.activeField && (editor.isFocused || focusOnQuoteButton)) selection = textSnapshot(editor)
      if (selection?.quote.trim()) {
        const rect = quoteCoordinates(editor, selection, runtime)
        if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) { setControl(null); return }
        const top = rect.top >= 50 ? rect.top - 44 : rect.bottom + 8
        setControl({ kind: 'quote', selection,
          left: clampControlLeft((rect.left + rect.right) / 2 - 82, 164),
          top: Math.max(8, Math.min(top, window.innerHeight - 48)),
        })
        return
      }
      const { selection: textSelection } = editor.state
      if (runtime.activeField || (!editor.isFocused && !focusOnInsertButton) || !textSelection.empty || !textSelection.$from.depth) {
        setControl(null); return
      }
      const paragraph = textSelection.$from.parent
      if (paragraph.type.name !== 'paragraph' || !paragraph.attrs.id) { setControl(null); return }
      const element = editor.view.nodeDOM(textSelection.$from.before())
      if (!(element instanceof HTMLElement)) { setControl(null); return }
      const rect = element.getBoundingClientRect()
      const caret = editor.view.coordsAtPos(textSelection.from)
      if (caret.bottom < 0 || caret.top > window.innerHeight) { setControl(null); return }
      setControl({ kind: 'insert', blockId: paragraph.attrs.id,
        left: clampControlLeft(rect.right - 105, 105),
        top: Math.max(8, Math.min(caret.bottom + 3, window.innerHeight - 36)),
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    refreshControls.current = schedule
    editor.on('transaction', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('selectionchange', schedule)
    document.addEventListener('pointerup', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      refreshControls.current = () => {}
      editor.off('transaction', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('selectionchange', schedule)
      document.removeEventListener('pointerup', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [editor, runtime])

  // Set membership, rather than array identity, drives decoration-only transactions.
  const annotationSignature = JSON.stringify([...new Set(props.annotatedBlockIds ?? [])].sort())
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr
      .setMeta(annotationKey, JSON.parse(annotationSignature) as string[])
      .setMeta('addToHistory', false))
  }, [editor, annotationSignature])

  useEffect(() => {
    if (!editor) return
    const insertMath = (latex = '', template?: string) => {
      const id = newId()
      runtime.pendingFocus = { id, template }
      // The mathfield can hold focus while PM retains its previous text selection.
      const active = runtime.activeField ?? (runtime.lastMathAnchor ? runtime.fields.get(runtime.lastMathAnchor.blockId) : undefined)
      let boundary: number | undefined
      if (active) {
        const activeId = active.dataset.mathBlockId
        editor.state.doc.descendants((node, position) => {
          if (node.attrs.id === activeId) boundary = position + node.nodeSize
        })
      }
      const content = [
        { type: 'mathBlock', attrs: { id, latex } },
        { type: 'paragraph', attrs: { id: newId() } },
      ]
      if (boundary !== undefined) editor.chain().focus().insertContentAt(boundary, content).run()
      else editor.chain().focus().insertContent(content).run()
    }
    const bridge: EditorBridge = {
      undo: () => { editor.commands.undo() },
      redo: () => { editor.commands.redo() },
      insertMath,
      insertMathAfterBlock: (blockId, latex = '') => {
        let boundary: number | undefined
        editor.state.doc.descendants((node, position) => {
          if (node.attrs.id === blockId && node.isTextblock) {
            boundary = node.content.size ? position + node.nodeSize : position
          }
        })
        if (boundary === undefined) return
        const id = newId()
        runtime.pendingFocus = { id }
        const content: JSONContent[] = [{ type: 'mathBlock', attrs: { id, latex } }]
        if (!editor.state.doc.resolve(boundary).nodeAfter?.isTextblock) {
          content.push({ type: 'paragraph', attrs: { id: newId() } })
        }
        editor.chain().focus().insertContentAt(boundary, content).run()
      },
      insertTemplate: latex => {
        const field = runtime.activeField ?? (runtime.lastMathAnchor ? runtime.fields.get(runtime.lastMathAnchor.blockId) : undefined)
        if (field) {
          insertIntoMath(field, latex, runtime)
        } else insertMath('', latex)
      },
      focus: () => { editor.commands.focus() },
      canUndo: () => editor.can().undo(),
      canRedo: () => editor.can().redo(),
      getContent: () => editor.getJSON(),
      replaceContent: content => {
        runtime.activeField = null
        runtime.lastMathAnchor = undefined
        runtime.pendingFocus = null
        editor.commands.setContent(withBlockIds(content), { emitUpdate: true })
        callbacks.current.onSelection(null)
      },
      focusBlock: id => {
        const field = runtime.fields.get(id)
        if (field) {
          field.scrollIntoView({ block: 'center', behavior: 'smooth' })
          field.focus()
          return
        }
        editor.state.doc.descendants((node, position) => {
          if (node.attrs.id === id && node.isTextblock) editor.chain().focus().setTextSelection(position + 1).run()
        })
      },
      captureReturnAnchor: () => {
        if (runtime.activeField) return { blockId: runtime.activeField.dataset.mathBlockId, position: runtime.activeField.position }
        if (runtime.lastMathAnchor) return { blockId: runtime.lastMathAnchor.blockId, position: runtime.lastMathAnchor.position }
        const { $from } = editor.state.selection
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth)
          if (node.attrs.id) return { blockId: node.attrs.id, position: $from.pos - $from.start(depth) }
        }
        return {}
      },
      restoreReturnAnchor: anchor => {
        const field = anchor.blockId ? runtime.fields.get(anchor.blockId) : undefined
        if (field) {
          field.focus()
          field.position = Math.max(0, Math.min(anchor.position ?? 0, field.lastOffset))
          return
        }
        let target: number | undefined
        editor.state.doc.descendants((node, position) => {
          if (node.attrs.id === anchor.blockId && node.isTextblock) target = position + 1 + Math.max(0, Math.min(anchor.position ?? 0, node.content.size))
        })
        if (target !== undefined) editor.chain().focus().setTextSelection(target).run()
        else editor.commands.focus('end')
      },
    }
    bridgeRef.current = bridge
    callbacks.current.onReady(bridge)
  }, [editor, runtime])

  return <div className="notebook-editor" ref={container} data-chat-enabled={!!props.onRequestAnnotation}>
    <EditorContent editor={editor} />
    {props.onRequestAnnotation && control?.kind === 'quote' && <div className="editor-context-action" contentEditable={false} role="toolbar" aria-label="Действия с выделенным фрагментом"
      style={{ position: 'fixed', left: control.left, top: control.top }}>
      <button type="button" className="editor-context-action__button" onMouseDown={event => event.preventDefault()}
        onClick={() => { runtime.annotate(control.selection); setControl(null) }}><MessageSquarePlus size={14} /> Добавить в чат</button>
    </div>}
    {control?.kind === 'insert' && <div className="editor-local-insert" contentEditable={false}
      style={{ position: 'fixed', left: control.left, top: control.top }}>
      <button type="button" aria-label="Добавить формулу рядом с этой строкой" onMouseDown={event => event.preventDefault()}
        onClick={() => { bridgeRef.current?.insertMathAfterBlock(control.blockId); setControl(null) }}><Plus size={12} /> Формула</button>
    </div>}
  </div>
}
