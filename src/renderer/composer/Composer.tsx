// Composer — Figma component `Composer` (11:172, AgentRunning=true/false).
//
// Editor choice: a plain <textarea>, not contenteditable. The input is plain text that goes to
// the agent as a bracketed paste, so rich content is useless; a textarea gives native selection,
// ⌘A / ⌘⌫ / ⌥⌫, undo/redo and the most predictable IME behaviour for free, with no sanitising
// of pasted HTML. Autogrow is a few lines of scrollHeight maths.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import { ArrowUp, AtSign, Image as ImageIcon, Paperclip, Square } from 'lucide-react'
import type { SessionId } from '@shared/types'
import { BLOCKING_DIALOG_HINT, sendPassthrough, submitPrompt, useBlockingDialog } from '../session-io'
import { useActiveSession } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { pathsInsertion, imageExtensionFor, pickPastedImage, restoreAfterFailure } from './attachments'
import { decideKey, isFocusShortcut } from './composer-keys'
import { browserStorage, createDraftStore } from './drafts'
import styles from './Composer.module.css'

const MAX_LINES = 10
const drafts = createDraftStore(browserStorage())

interface EditorState {
  sessionId: SessionId | null
  text: string
}

/** Keep the textarea focused and its selection intact when a toolbar button is pressed. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

function insertAtCaret(el: HTMLTextAreaElement, build: (before: string) => string): void {
  el.focus()
  const start = el.selectionStart
  const text = build(el.value.slice(0, start))
  if (text.length === 0) return
  // execCommand keeps the native undo stack; fall back to setRangeText if it is refused.
  if (!document.execCommand('insertText', false, text)) {
    el.setRangeText(text, start, el.selectionEnd, 'end')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

export function Composer() {
  const active = useActiveSession()
  const sessionId = active?.session.id ?? null
  const running = active?.session.status === 'running'
  const blocked = useBlockingDialog(sessionId) !== null

  const [state, setState] = useState<EditorState>(() => ({
    sessionId,
    text: sessionId ? drafts.get(sessionId) : ''
  }))
  const [error, setError] = useState<{ sessionId: SessionId; message: string } | null>(null)
  const [dragging, setDragging] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)

  // Restore the draft when the active session changes (adjust state during render, no flash).
  let text = state.text
  if (state.sessionId !== sessionId) {
    text = sessionId ? drafts.get(sessionId) : ''
    setState({ sessionId, text })
  }

  const setText = useCallback((id: SessionId, next: string) => {
    drafts.set(id, next)
    setState({ sessionId: id, text: next })
  }, [])

  // Autogrow: 1 line up to MAX_LINES, then scroll.
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = parseFloat(getComputedStyle(el).lineHeight) * MAX_LINES
    el.style.height = `${Math.min(el.scrollHeight, max)}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [text])

  // ⌘L focuses the composer from anywhere.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!isFocusShortcut(e)) return
      e.preventDefault()
      textareaRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const submit = useCallback(async () => {
    const el = textareaRef.current
    if (!sessionId || !el || sendingRef.current || blocked) return
    const value = el.value
    if (value.trim().length === 0) return
    sendingRef.current = true
    setError(null)
    setText(sessionId, '')
    el.focus()
    try {
      await submitPrompt(sessionId, value.trimEnd())
    } catch (err) {
      const restored = restoreAfterFailure(value, drafts.get(sessionId))
      drafts.set(sessionId, restored)
      setState((prev) => (prev.sessionId === sessionId ? { sessionId, text: restored } : prev))
      setError({ sessionId, message: err instanceof Error ? err.message : String(err) })
    } finally {
      sendingRef.current = false
    }
  }, [sessionId, setText, blocked])

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!sessionId) return
    const n = e.nativeEvent
    const action = decideKey(
      {
        key: n.key,
        keyCode: n.keyCode,
        isComposing: n.isComposing,
        shiftKey: n.shiftKey,
        metaKey: n.metaKey,
        ctrlKey: n.ctrlKey,
        altKey: n.altKey
      },
      { text: e.currentTarget.value }
    )
    switch (action.type) {
      case 'default':
        return
      case 'swallow':
        e.preventDefault()
        return
      case 'send':
        e.preventDefault()
        void submit()
        return
      case 'passthrough':
        e.preventDefault()
        sendPassthrough(sessionId, action.key)
        return
    }
  }

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    if (!sessionId) return
    setError(null)
    setText(sessionId, e.target.value)
  }

  const insertPaths = (paths: string[]) => {
    const el = textareaRef.current
    if (!el || paths.length === 0) return
    insertAtCaret(el, (before) => pathsInsertion(paths, before))
  }

  const pathsFromFiles = (files: FileList | File[]): string[] =>
    Array.from(files)
      .map((f) => window.tr.files.pathForFile(f))
      .filter((p) => p.length > 0)

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const hasText = e.clipboardData.getData('text/plain').length > 0
    const index = pickPastedImage(items, hasText)
    if (index < 0) return
    const file = items[index]?.getAsFile()
    const ext = file ? imageExtensionFor(file.type) : null
    if (!file || !ext) return
    e.preventDefault()
    void file
      .arrayBuffer()
      .then((bytes) => window.tr.files.saveTempImage(bytes, ext))
      .then((path) => insertPaths([path]))
      .catch((err: unknown) => {
        if (sessionId) setError({ sessionId, message: err instanceof Error ? err.message : String(err) })
      })
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    setDragging(false)
    insertPaths(pathsFromFiles(e.dataTransfer.files))
  }

  const onPickFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) insertPaths(pathsFromFiles(e.target.files))
    e.target.value = ''
  }

  const canSend = sessionId !== null && !blocked && text.trim().length > 0
  const visibleError = error && error.sessionId === sessionId ? error.message : null

  return (
    <div
      className={styles.composer}
      data-dragging={dragging}
      data-agent-running={running}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <textarea
        ref={textareaRef}
        className={styles.input}
        rows={1}
        value={text}
        disabled={sessionId === null}
        spellCheck={false}
        aria-label="输入框"
        placeholder={
          blocked ? BLOCKING_DIALOG_HINT : running ? '智能体运行中，↵ 发送会排队' : '输入任务或回复，↵ 发送，⇧↵ 换行'
        }
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
      />
      {visibleError && (
        <p className={styles.error} role="alert">
          发送失败：{visibleError}
        </p>
      )}
      <div className={styles.toolbar}>
        <IconButton label="添加文件" onMouseDown={keepFocus} onClick={() => attachInputRef.current?.click()}>
          <Paperclip size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="引用文件"
          onMouseDown={keepFocus}
          onClick={() => {
            const el = textareaRef.current
            if (el) insertAtCaret(el, (before) => (before.length > 0 && !/\s$/.test(before) ? ' @' : '@'))
          }}
        >
          <AtSign size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="添加图片" onMouseDown={keepFocus} onClick={() => imageInputRef.current?.click()}>
          <ImageIcon size={16} strokeWidth={1.75} />
        </IconButton>
        <span className={styles.spacer} />
        {running && sessionId && (
          <IconButton label="中断（Esc）" onMouseDown={keepFocus} onClick={() => sendPassthrough(sessionId, 'escape')}>
            <Square size={16} strokeWidth={1.75} />
          </IconButton>
        )}
        <button
          type="button"
          className={styles.send}
          aria-label="发送"
          title="发送（↵）"
          disabled={!canSend}
          onMouseDown={keepFocus}
          onClick={() => void submit()}
        >
          <ArrowUp size={16} strokeWidth={1.75} />
        </button>
      </div>
      <input ref={attachInputRef} type="file" multiple hidden onChange={onPickFiles} />
      <input ref={imageInputRef} type="file" multiple accept="image/*" hidden onChange={onPickFiles} />
    </div>
  )
}
