// The composer's text (PRD F23, Figma 50C–E): a Tiptap (ProseMirror) editor with bold, italic, strike, inline code,
// bullet and ordered lists, quotes and code blocks. A list, quote or code block starts from `- ` / `1. ` / `> ` / ```
// at a line's start; marks come from the 格式 toolbar, the toolbar over a selection, or ⌘I / ⌘⇧S / ⌘E (⌘B and ⌘⇧B are
// the app's). `**x**` typed inline stays text. The draft in the store is the text the agent gets (rich-text.ts); text
// set from outside (a picked command, inserted text, a restored draft) comes in as plain lines. Paste is plain text,
// spaces kept; pasted or dropped files are the chat's (attachFileInput). Keys go to the Composer first.
import { useEffect, useLayoutEffect, useReducer, useRef, useState, type RefObject } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import { Fragment, Slice } from '@tiptap/pm/model'
import { Selection } from '@tiptap/pm/state'
import { Bold, Code, Italic, List, ListOrdered, SquareCode, Strikethrough, TextQuote } from 'lucide-react'
import { PATHS_DRAG_TYPE } from '../terminal/attachments'
import { docText, textDoc } from './rich-text'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

/** Where the caret is, for the Composer's keys: ⏎ is a newline in a code block, ⇧⏎ a new item in a list. */
export interface CaretContext {
  inCode: boolean
  inList: boolean
  inQuote: boolean
}

interface Props {
  draft: string
  onChange(text: string): void
  /** The Composer's keys: true when it took the key (the editor does nothing more with it). */
  onKeyDown(event: KeyboardEvent, caret: CaretContext): boolean
  editorRef: RefObject<Editor | null>
  toolbarOpen: boolean
}

const caretOf = (editor: Editor): CaretContext => ({ inCode: editor.isActive('codeBlock'), inList: editor.isActive('listItem'), inQuote: editor.isActive('blockquote') })

export function ComposerEditor({ draft, onChange, onKeyDown, editorRef, toolbarOpen }: Props) {
  // The text the editor last reported: a draft equal to it came from the editor itself.
  const reported = useRef(draft)
  // The editor's callbacks are set once; they reach the latest props through this.
  const handlers = useRef({ onChange, onKeyDown })
  useLayoutEffect(() => {
    handlers.current = { onChange, onKeyDown }
  })
  const plainPaste = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false, horizontalRule: false, underline: false, link: false, dropcursor: false, trailingNode: false }),
      Placeholder.configure({ placeholder: '回复' })
    ],
    content: textDoc(draft),
    // Only the line-start shortcuts (lists, quote, code block); `**x**` and the like stay as typed. No paste rules.
    enableInputRules: ['bulletList', 'orderedList', 'blockquote', 'codeBlock'],
    enablePasteRules: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: styles.input ?? '', role: 'textbox', 'aria-label': '回复', 'aria-multiline': 'true', 'data-gui-input': '', spellcheck: 'false' },
      handleKeyDown: (view, event) => {
        const current = editorRef.current
        return current ? handlers.current.onKeyDown(event, caretOf(current)) : false
      },
      // Pasted text goes in as plain lines with its spaces (code from an editor keeps its indentation); HTML is not
      // parsed. Files and pictures never get here: the chat takes them first (attachFileInput).
      handlePaste: (view, event) => {
        if (plainPaste.current) return false
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (!text || !event.clipboardData?.getData('text/html')) return false
        plainPaste.current = true
        try {
          view.pasteText(text, event)
        } finally {
          plainPaste.current = false
        }
        return true
      },
      clipboardTextParser: (text, _context, _plain, view) => {
        const lines = text.replace(/\r\n?/g, '\n').split('\n')
        const { schema } = view.state
        const paragraphs = lines.map((line) => schema.nodes.paragraph!.create(null, line ? schema.text(line) : null))
        return Slice.maxOpen(Fragment.from(paragraphs))
      },
      // Files dropped on the text are the chat's attachments, not text.
      handleDrop: (_view, event) => !!event.dataTransfer && (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(PATHS_DRAG_TYPE))
    },
    onUpdate: ({ editor }) => {
      const text = docText(editor.getJSON())
      reported.current = text
      handlers.current.onChange(text)
    }
  })

  useEffect(() => {
    editorRef.current = editor
    return () => {
      editorRef.current = null
    }
  }, [editor, editorRef])

  // A draft set from outside: text added after what is there goes in at the end (the formatting stays); anything else
  // replaces the text.
  useLayoutEffect(() => {
    if (draft === reported.current) return
    const before = reported.current
    reported.current = draft
    if (before !== '' && draft.startsWith(before)) {
      appendLines(editor, draft.slice(before.length))
      return
    }
    editor.commands.setContent(textDoc(draft), { emitUpdate: false })
  }, [draft, editor])

  return (
    <>
      <div className={styles.inputScroll}>
        <EditorContent editor={editor} />
      </div>
      {toolbarOpen && <FormatButtons editor={editor} className={styles.formatBar} label="格式" />}
      {!toolbarOpen && <SelectionToolbar editor={editor} />}
    </>
  )
}

/** Text at the end of the document, its lines as new paragraphs after the last one's end. */
function appendLines(editor: Editor, text: string): void {
  const [first = '', ...rest] = text.split('\n')
  const { tr } = editor.state
  let at = Selection.atEnd(tr.doc).from
  tr.insertText(first, at)
  at += first.length
  for (const line of rest) {
    tr.split(at)
    at = Selection.atEnd(tr.doc).from
    tr.insertText(line, at)
    at += line.length
  }
  editor.view.dispatch(tr)
}

type Format = 'bold' | 'italic' | 'strike' | 'code' | 'bulletList' | 'orderedList' | 'blockquote' | 'codeBlock'

const BUTTONS: readonly { format: Format; label: string; icon: typeof Bold; run(editor: Editor): boolean; can(editor: Editor): boolean }[] = [
  { format: 'bold', label: '粗体', icon: Bold, run: (e) => e.chain().focus().toggleBold().run(), can: (e) => e.can().toggleBold() },
  { format: 'italic', label: '斜体 ⌘I', icon: Italic, run: (e) => e.chain().focus().toggleItalic().run(), can: (e) => e.can().toggleItalic() },
  { format: 'strike', label: '删除线 ⌘⇧S', icon: Strikethrough, run: (e) => e.chain().focus().toggleStrike().run(), can: (e) => e.can().toggleStrike() },
  { format: 'code', label: '行内代码 ⌘E', icon: Code, run: (e) => e.chain().focus().toggleCode().run(), can: (e) => e.can().toggleCode() },
  { format: 'bulletList', label: '无序列表', icon: List, run: (e) => e.chain().focus().toggleBulletList().run(), can: (e) => e.can().toggleBulletList() },
  { format: 'orderedList', label: '有序列表', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run(), can: (e) => e.can().toggleOrderedList() },
  { format: 'blockquote', label: '引用', icon: TextQuote, run: (e) => e.chain().focus().toggleBlockquote().run(), can: (e) => e.can().toggleBlockquote() },
  { format: 'codeBlock', label: '代码块', icon: SquareCode, run: (e) => e.chain().focus().toggleCodeBlock().run(), can: (e) => e.can().toggleCodeBlock() }
]

/** 50D / 50E: the eight format buttons, the one under the caret highlighted; marks | blocks. */
function FormatButtons({ editor, className, label }: { editor: Editor; className: string | undefined; label: string }) {
  // Drawn again after every transaction (the caret moved, a format changed).
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    editor.on('transaction', redraw)
    return () => {
      editor.off('transaction', redraw)
    }
  }, [editor])
  const state = Object.fromEntries(BUTTONS.map((b) => [b.format, { active: editor.isActive(b.format), can: b.can(editor) }])) as Record<Format, { active: boolean; can: boolean }>
  return (
    <div className={className} role="toolbar" aria-label={label} data-testid="gui-format-bar">
      {BUTTONS.map(({ format, label: name, icon: Icon, run }) => (
        <span key={format} className={styles.formatGroup}>
          {format === 'bulletList' && <span className={styles.formatDivider} aria-hidden />}
          <button
            type="button"
            className={styles.formatButton}
            aria-label={name}
            title={name}
            aria-pressed={state[format].active}
            disabled={!state[format].can}
            // The text keeps its selection and the keyboard.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => run(editor)}
          >
            <Icon {...ICON} />
          </button>
        </span>
      ))}
    </div>
  )
}

/** 50E: over a selection, the same buttons, while the toolbar is closed. */
function SelectionToolbar({ editor }: { editor: Editor }) {
  const selection = useEditorState({
    editor,
    selector: ({ editor }) => {
      const { from, to, empty } = editor.state.selection
      return { from, to, show: !empty && editor.isFocused && !editor.isActive('codeBlock') }
    }
  })
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const bar = ref.current
    const host = bar?.offsetParent
    if (!selection.show || !bar || !host) {
      setPlace(null)
      return
    }
    const start = editor.view.coordsAtPos(selection.from)
    const end = editor.view.coordsAtPos(selection.to)
    const frame = host.getBoundingClientRect()
    const middle = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2
    const left = Math.min(Math.max(0, middle - frame.left - bar.offsetWidth / 2), frame.width - bar.offsetWidth)
    setPlace({ left: Math.round(left), top: Math.round(Math.min(start.top, end.top) - frame.top - bar.offsetHeight - 6) })
  }, [selection, editor])

  if (!selection.show) return null
  return (
    <div ref={ref} className={styles.selectionBar} style={place ? { left: place.left, top: place.top } : { visibility: 'hidden' }}>
      <FormatButtons editor={editor} className={styles.selectionButtons} label="选中文字的格式" />
    </div>
  )
}
