// A GUI session's input (PRD F23, Figma 52F–H; `/` menu 49′C, model menu 49′E; formats 50C–E): one line in the box —
// + adds attachments, the formatted text (ComposerEditor), stop while a turn runs, send otherwise; it grows upward as
// lines are added, + and send staying at its foot. ⏎ sends and ⇧⏎ is a newline — a new item in a list; in a code block
// ⏎ is a newline too (an input method's Enter is left to it). Under the box: 格式 (the format buttons), the pickers the
// agent offers (model · reasoning effort, mode) and the context ring (ContextButton).
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowUp, Check, ChevronDown, Plus, Square, Type, X } from 'lucide-react'
import { matchCommands, type GuiCommand, type GuiConfigOption } from '@shared/gui-chat'
import type { AgentKind, SessionId } from '@shared/types'
import { Segmented } from '../ui/Segmented'
import { ComposerEditor, type CaretContext } from './ComposerEditor'
import { ContextButton } from './ContextButton'
import { composerKey, pickCommand, pickerButtons, pickerSectionTitle, slashQuery, stepIndex, thumbnailUrl, type PickerButton } from './model'
import { addAttachments, draftOf, removeAttachment, setDraft, useGuiSessions } from './store'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const

interface Props {
  sessionId: SessionId
  agent: AgentKind
  cwd: string
  busy: boolean
  commands: readonly GuiCommand[]
  config: readonly GuiConfigOption[]
  /** A card waits: with the composer empty, ⏎ / ⎋ / 1–9 / ↑↓ go to `cardKey` first (ChatPane). */
  cardWaiting: boolean
  /** Answers the waiting card from a key typed into the empty composer; true when the card took it. */
  cardKey(event: KeyboardEvent): boolean
  send(text: string, attachments: readonly string[]): void
  interrupt(): void
  setConfig(optionId: string, value: string): void
}

export const Composer = memo(function Composer({ sessionId, agent, cwd, busy, commands, config, cardWaiting, cardKey, send, interrupt, setConfig }: Props) {
  const draft = useGuiSessions((s) => s.drafts[sessionId]) ?? draftOf(sessionId)
  const attachments = useGuiSessions((s) => s.attachments[sessionId]) ?? []
  const focusRequest = useGuiSessions((s) => s.focus[sessionId] ?? 0)
  const editorRef = useRef<Editor | null>(null)
  const [formatOpen, setFormatOpen] = useState(false)
  // The highlighted command, for the query it was moved in (a new query starts at the top).
  const [menuAt, setMenuAt] = useState<{ query: string | null; index: number }>({ query: null, index: 0 })
  const [menuDismissed, setMenuDismissed] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ button: PickerButton; anchor: HTMLElement } | null>(null)

  const query = slashQuery(draft)
  const matches = query !== null && query !== menuDismissed ? matchCommands(commands, query) : []
  const menuOpen = matches.length > 0
  const menuIndex = menuAt.query === query ? menuAt.index : 0
  const setMenuIndex = (update: number | ((at: number) => number)): void =>
    setMenuAt({ query, index: typeof update === 'function' ? update(menuIndex) : update })
  const empty = draft.trim() === '' && attachments.length === 0

  // Asked to take the keyboard (selected, a file added, text inserted): never from a dialog in front.
  useEffect(() => {
    if (focusRequest === 0) return
    const editor = editorRef.current
    if (!editor || editor.view.dom.ownerDocument.querySelector('[role="dialog"][aria-modal="true"]')) return
    editor.commands.focus('end', { scrollIntoView: false })
  }, [focusRequest])

  const submit = (): void => {
    if (empty) return
    send(draft, attachments)
  }
  const pick = (command: GuiCommand | undefined): void => {
    if (!command) return
    setDraft(sessionId, pickCommand(command))
    // After the editor took the new text: the caret goes after the command.
    requestAnimationFrame(() => editorRef.current?.commands.focus('end'))
  }

  /** ⇧⏎: a new item in a list (an empty one leaves the list), a newline in a code block, else a new line. */
  const newline = (editor: Editor, caret: CaretContext): void => {
    if (caret.inCode) editor.view.dispatch(editor.state.tr.insertText('\n'))
    else if (caret.inList) void (editor.commands.splitListItem('listItem') || editor.commands.liftListItem('listItem'))
    else if (caret.inQuote && editor.state.selection.$from.parent.content.size === 0) editor.commands.lift('blockquote')
    // A new line starts plain: inline code or bold at the end of the line above does not carry on.
    else editor.commands.splitBlock({ keepMarks: false })
  }

  const onKeyDown = (event: KeyboardEvent, caret: CaretContext): boolean => {
    // An empty composer gives the card above it its keys (ChatPane).
    if (cardWaiting && empty && !menuOpen && cardKey(event)) return true
    const { key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing } = event
    const action = composerKey({ key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing }, { menuOpen, busy, inCode: caret.inCode })
    const editor = editorRef.current
    switch (action) {
      case null:
        return false
      case 'newline':
        // ⏎ in a code block is the editor's (three in a row leave it).
        if (!editor || (caret.inCode && !shiftKey)) return false
        newline(editor, caret)
        return true
      case 'send':
        submit()
        return true
      case 'stop':
        interrupt()
        return true
      case 'menu-up':
      case 'menu-down':
        setMenuIndex((at) => stepIndex(at, action === 'menu-up' ? -1 : 1, matches.length))
        return true
      case 'menu-pick':
        pick(matches[menuIndex])
        return true
      case 'menu-close':
        setMenuDismissed(query)
        return true
    }
  }

  const attach = (): void => {
    void window.tr.ui.pickFiles(cwd).then((paths) => addAttachments(sessionId, paths))
  }

  return (
    <div className={styles.composerWrap} data-testid="gui-composer">
      {menuOpen && <SlashMenu matches={matches} index={menuIndex} onHover={setMenuIndex} onPick={pick} />}
      <div className={styles.composer} data-testid="gui-composer-box">
        {attachments.length > 0 && (
          <ul className={styles.attachments} aria-label="附件">
            {attachments.map((path) => (
              <Attachment key={path} path={path} remove={() => removeAttachment(sessionId, path)} />
            ))}
          </ul>
        )}
        <div className={styles.composerLine}>
          {/* The buttons leave the keyboard and the caret in the text. */}
          <button type="button" className={styles.barIcon} aria-label="添加附件" title="添加附件" onMouseDown={(e) => e.preventDefault()} onClick={attach}>
            <Plus {...ICON} />
          </button>
          <div className={styles.composerText}>
            <ComposerEditor
              draft={draft}
              onChange={(text) => {
                setDraft(sessionId, text)
                setMenuDismissed(null)
              }}
              onKeyDown={onKeyDown}
              editorRef={editorRef}
              toolbarOpen={formatOpen}
            />
          </div>
          {busy ? (
            <button type="button" className={styles.round} aria-label="停止" title="停止 ⎋" onClick={interrupt}>
              <Square {...ICON} />
            </button>
          ) : (
            <button type="button" className={styles.round} aria-label="发送" title="发送 ↵" disabled={empty} onClick={submit}>
              <ArrowUp {...ICON} />
            </button>
          )}
        </div>
      </div>
      <div className={styles.under}>
        <button
          type="button"
          className={styles.barIcon}
          aria-label="格式"
          title="格式"
          aria-pressed={formatOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setFormatOpen(!formatOpen)}
        >
          <Type {...ICON} />
        </button>
        <span className={styles.spacer} />
        {pickerButtons(config).map((button) => (
          <button
            key={button.key}
            type="button"
            className={styles.picker}
            aria-haspopup="dialog"
            aria-expanded={picker?.button.key === button.key}
            onClick={(e) => {
              const anchor = e.currentTarget
              setPicker((open) => (open?.button.key === button.key ? null : { button, anchor }))
            }}
          >
            <span>{button.label}</span>
            <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
          </button>
        ))}
        <ContextButton sessionId={sessionId} agent={agent} />
      </div>
      {picker && (
        <PickerMenu
          button={pickerButtons(config).find((b) => b.key === picker.button.key) ?? picker.button}
          anchor={picker.anchor}
          onPick={(optionId, value) => setConfig(optionId, value)}
          onClose={() => {
            picker.anchor.focus()
            setPicker(null)
          }}
        />
      )}
    </div>
  )
})

/** 50C: a picture as a 64 px thumbnail (× on hover), any other file — or a picture that cannot be read — as its name. */
function Attachment({ path, remove }: { path: string; remove(): void }) {
  const [broken, setBroken] = useState(false)
  const url = broken ? null : thumbnailUrl(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const button = (
    <button type="button" className={styles.attachmentRemove} aria-label={`移除 ${path}`} onClick={remove}>
      <X size={12} strokeWidth={1.75} aria-hidden />
    </button>
  )
  if (url) {
    return (
      <li className={styles.thumb} title={path}>
        <img src={url} alt={name} draggable={false} onError={() => setBroken(true)} />
        {button}
      </li>
    )
  }
  return (
    <li className={styles.attachment} title={path}>
      <span className={styles.attachmentName}>{name}</span>
      {button}
    </li>
  )
}

/** 49′C: the agent's commands matching what follows `/`; ↑↓ move, ⏎ / ⇥ pick. */
function SlashMenu({ matches, index, onHover, onPick }: { matches: readonly GuiCommand[]; index: number; onHover(index: number): void; onPick(command: GuiCommand): void }) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])
  return (
    <div ref={listRef} className={`${styles.popover} ${styles.slashMenu}`} role="listbox" aria-label="命令" data-testid="gui-slash-menu">
      <span className={styles.popoverTitle}>命令</span>
      {matches.map((command, i) => (
        <div
          key={command.name}
          role="option"
          aria-selected={i === index}
          data-index={i}
          className={styles.command}
          onMouseEnter={() => onHover(i)}
          // Down, not click: the text area keeps the keyboard.
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(command)
          }}
        >
          <span className={styles.commandName}>/{command.name}</span>
          <span className={styles.commandText}>{command.description}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * 49′E: a picker's choices above its button. Model and reasoning effort share one menu: models as a list (✓ on the
 * current one), effort as segments; any other option (mode) is a list.
 */
function PickerMenu({ button, anchor, onPick, onClose }: { button: PickerButton; anchor: HTMLElement; onPick(optionId: string, value: string): void; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ right: number; bottom: number } | null>(null)

  useLayoutEffect(() => {
    const menu = ref.current
    const host = menu?.offsetParent
    if (!menu || !host) return
    const box = anchor.getBoundingClientRect()
    const frame = host.getBoundingClientRect()
    setPlace({ right: frame.right - box.right, bottom: frame.bottom - box.top + 4 })
    menu.querySelector<HTMLElement>('[aria-checked="true"], button')?.focus({ preventScroll: true })
  }, [anchor])

  useEffect(() => {
    const doc = anchor.ownerDocument
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose()
    }
    doc.addEventListener('mousedown', onDown, true)
    return () => doc.removeEventListener('mousedown', onDown, true)
  }, [anchor, onClose])

  return (
    <div
      ref={ref}
      className={`${styles.popover} ${styles.pickerMenu}`}
      role="dialog"
      aria-label={button.options.map(pickerSectionTitle).join(' · ')}
      style={place ? { right: place.right, bottom: place.bottom } : { visibility: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const rows = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
          const at = rows.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLElement)
          rows[stepIndex(at, e.key === 'ArrowDown' ? 1 : -1, rows.length)]?.focus()
          e.preventDefault()
        }
      }}
    >
      {button.options.map((option) =>
        option.category === 'thought_level' ? (
          <div key={option.id} className={styles.pickerSection}>
            <span className={styles.popoverTitle}>{pickerSectionTitle(option)}</span>
            <Segmented
              label={pickerSectionTitle(option)}
              value={option.current}
              options={option.values.map((v) => ({ value: v.value, label: v.label }))}
              onChange={(value) => onPick(option.id, value)}
              className={styles.pickerSegments}
            />
          </div>
        ) : (
          <div key={option.id} className={styles.pickerSection} role="menu" aria-label={pickerSectionTitle(option)}>
            <span className={styles.popoverTitle}>{pickerSectionTitle(option)}</span>
            {option.values.map((v) => (
              <button
                key={v.value}
                type="button"
                role="menuitemradio"
                aria-checked={v.value === option.current}
                className={styles.pickerRow}
                onClick={() => {
                  onPick(option.id, v.value)
                  // A list with nothing else in the menu is done with one pick.
                  if (button.options.length === 1) onClose()
                }}
              >
                <span className={styles.pickerLabel}>{v.label}</span>
                {v.value === option.current && <Check {...ICON} />}
              </button>
            ))}
          </div>
        )
      )}
    </div>
  )
}
