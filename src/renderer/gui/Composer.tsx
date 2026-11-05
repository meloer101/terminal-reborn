// A GUI session's input (PRD F23, Figma 49″C `Composer`; `/` menu 49′C, model menu 49′E): a growing text area, ⏎
// sends and ⇧⏎ is a newline (an input method's Enter is left to it); paperclip attaches files, @ mentions one; the
// pickers the agent offers (model · reasoning effort, mode); stop while a turn runs, send otherwise.
import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp, AtSign, Check, ChevronDown, Paperclip, Square, X } from 'lucide-react'
import { matchCommands, type GuiCommand, type GuiConfigOption } from '@shared/gui-chat'
import type { SessionId } from '@shared/types'
import { Segmented } from '../ui/Segmented'
import { composerKey, mention, pickCommand, pickerButtons, pickerSectionTitle, slashQuery, stepIndex, type PickerButton } from './model'
import { addAttachments, draftOf, removeAttachment, setDraft, useGuiSessions } from './store'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
/** The text area grows to this many px (about ten lines), then scrolls. */
const MAX_INPUT_PX = 220

interface Props {
  sessionId: SessionId
  cwd: string
  busy: boolean
  commands: readonly GuiCommand[]
  config: readonly GuiConfigOption[]
  /** A card waits and the draft is empty: ⏎ / ⎋ / 1–9 are the card's (ChatPane routes them). */
  cardWaiting: boolean
  send(text: string, attachments: readonly string[]): void
  interrupt(): void
  setConfig(optionId: string, value: string): void
}

export const Composer = memo(function Composer({ sessionId, cwd, busy, commands, config, cardWaiting, send, interrupt, setConfig }: Props) {
  const draft = useGuiSessions((s) => s.drafts[sessionId]) ?? draftOf(sessionId)
  const attachments = useGuiSessions((s) => s.attachments[sessionId]) ?? []
  const focusRequest = useGuiSessions((s) => s.focus[sessionId] ?? 0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
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

  // The text area grows with its text.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_PX)}px`
  }, [draft])

  // Asked to take the keyboard (selected, a file added, text inserted): never from a dialog in front.
  useEffect(() => {
    if (focusRequest === 0) return
    const input = inputRef.current
    if (!input || input.ownerDocument.querySelector('[role="dialog"][aria-modal="true"]')) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
  }, [focusRequest])

  const submit = (): void => {
    if (empty) return
    send(draft, attachments)
  }
  const pick = (command: GuiCommand | undefined): void => {
    if (!command) return
    setDraft(sessionId, pickCommand(command))
    inputRef.current?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    // An empty composer leaves ⏎ / ⎋ to the card above it (ChatPane).
    if (cardWaiting && empty && !menuOpen && (event.key === 'Enter' || event.key === 'Escape')) return
    const { key, shiftKey, metaKey, ctrlKey, altKey, keyCode } = event
    const action = composerKey({ key, shiftKey, metaKey, ctrlKey, altKey, keyCode, isComposing: event.nativeEvent.isComposing }, { menuOpen, busy })
    if (!action) return
    switch (action) {
      case 'newline':
        return
      case 'send':
        event.preventDefault()
        submit()
        return
      case 'stop':
        event.preventDefault()
        interrupt()
        return
      case 'menu-up':
      case 'menu-down':
        event.preventDefault()
        setMenuIndex((at) => stepIndex(at, action === 'menu-up' ? -1 : 1, matches.length))
        return
      case 'menu-pick':
        event.preventDefault()
        pick(matches[menuIndex])
        return
      case 'menu-close':
        event.preventDefault()
        setMenuDismissed(query)
        return
    }
  }

  const attach = (): void => {
    void window.tr.ui.pickFiles(cwd).then((paths) => addAttachments(sessionId, paths))
  }
  const mentionFile = (): void => {
    void window.tr.ui.pickFiles(cwd).then((paths) => {
      if (paths.length === 0) return
      const current = draftOf(sessionId)
      const added = paths.map((p) => mention(p, cwd)).join('')
      setDraft(sessionId, current && !/\s$/.test(current) ? `${current} ${added}` : `${current}${added}`)
      inputRef.current?.focus()
    })
  }

  return (
    <div className={styles.composerWrap}>
      {menuOpen && <SlashMenu matches={matches} index={menuIndex} onHover={setMenuIndex} onPick={pick} />}
      <div className={styles.composer} data-testid="gui-composer">
        {attachments.length > 0 && (
          <ul className={styles.attachments} aria-label="附件">
            {attachments.map((path) => (
              <li key={path} className={styles.attachment} title={path}>
                <span className={styles.attachmentName}>{path.slice(path.lastIndexOf('/') + 1)}</span>
                <button type="button" className={styles.attachmentRemove} aria-label={`移除 ${path}`} onClick={() => removeAttachment(sessionId, path)}>
                  <X size={12} strokeWidth={1.75} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          placeholder="回复"
          aria-label="回复"
          spellCheck={false}
          value={draft}
          onChange={(e) => {
            setDraft(sessionId, e.currentTarget.value)
            setMenuDismissed(null)
          }}
          onKeyDown={onKeyDown}
        />
        <div className={styles.bar}>
          <button type="button" className={styles.barIcon} aria-label="添加附件" title="添加附件" onClick={attach}>
            <Paperclip {...ICON} />
          </button>
          <button type="button" className={styles.barIcon} aria-label="提及文件" title="提及文件" onClick={mentionFile}>
            <AtSign {...ICON} />
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
