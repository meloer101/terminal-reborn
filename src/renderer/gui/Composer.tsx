// A GUI session's input (PRD F23, Figma 65; `/` menu 49′C / 59H; formats 50C–E): one box — the formatted text
// (ComposerEditor) on top, under it + (attachments), the pickers (model, reasoning effort, 模式, 快速, the agent's own
// mode), and at the right the context ring (ContextButton) and stop while a turn runs, send otherwise. ⏎ sends and ⇧⏎
// is a newline — a new item in a list; in a code block ⏎ is a newline too (an input method's Enter is left to it).
// Formats are always on: there is no 格式 button, a selection gets the format buttons over it (50E).
// Before anything is said (`switchable`) the model menu lists the agents first, each with its models (Figma 65B).
import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/react'
import { ArrowUp, Check, ChevronDown, ChevronRight, Gauge, ListTodo, Pencil, Plus, Shield, ShieldCheck, Square, X, Zap } from 'lucide-react'
import { agentName, type CliAgent } from '@shared/agents'
import { matchCommands, type GuiCommand, type GuiConfigOption } from '@shared/gui-chat'
import type { AgentAvailability } from '@shared/ipc'
import type { AgentKind, SessionId } from '@shared/types'
import { installedAgents } from '../new-session/sheet-store'
import { openSettings } from '../settings/SettingsDialog'
import { useWorkspace } from '../state/workspace'
import { AgentIcon } from '../ui/AgentIcon'
import { ComposerEditor, insertNewline, type CaretContext } from './ComposerEditor'
import { ContextButton } from './ContextButton'
import {
  composerKey,
  guiAgentMenu,
  modeChanges,
  pickCommand,
  pickerButtons,
  pickerSectionTitle,
  slashGroups,
  slashQuery,
  stepIndex,
  thumbnailUrl,
  type ModeChoice,
  type PickerButton,
  type SlashGroup
} from './model'
import { addAttachments, draftOf, removeAttachment, setDraft, useGuiSessions } from './store'
import styles from './Chat.module.css'

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const
const SMALL = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const

/** Figma 65: each 模式 with its mark, on the button and in its list. */
const MODE_ICON: Record<ModeChoice, typeof Shield> = { ask: Shield, 'accept-edits': Pencil, auto: ShieldCheck, plan: ListTodo }

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
  setConfig(optionId: string, value: string): Promise<unknown>
  /** Figma 65: nothing said yet — the agent can still change (the model menu lists the agents). */
  switchable: boolean
  /** Figma 65B: run another agent (with one of its models, when it listed them before). */
  switchAgent(agent: CliAgent, model: string | undefined): void
}

export const Composer = memo(function Composer({ sessionId, agent, cwd, busy, commands, config, cardWaiting, cardKey, send, interrupt, setConfig, switchable, switchAgent }: Props) {
  const draft = useGuiSessions((s) => s.drafts[sessionId]) ?? draftOf(sessionId)
  const attachments = useGuiSessions((s) => s.attachments[sessionId]) ?? []
  const focusRequest = useGuiSessions((s) => s.focus[sessionId] ?? 0)
  const editorRef = useRef<Editor | null>(null)
  // The highlighted command, for the query it was moved in (a new query starts at the top).
  const [menuAt, setMenuAt] = useState<{ query: string | null; index: number }>({ query: null, index: 0 })
  const [menuDismissed, setMenuDismissed] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ button: PickerButton; anchor: HTMLElement } | null>(null)

  const query = slashQuery(draft)
  // Figma 59H: 命令, then Skills; ↑↓ go down the menu in that order.
  const groups = query !== null && query !== menuDismissed ? slashGroups(matchCommands(commands, query)) : []
  const matches = groups.flatMap((g) => g.commands)
  const menuOpen = matches.length > 0
  const menuIndex = menuAt.query === query ? menuAt.index : 0
  const setMenuIndex = (update: number | ((at: number) => number)): void =>
    setMenuAt({ query, index: typeof update === 'function' ? update(menuIndex) : update })
  const empty = draft.trim() === '' && attachments.length === 0
  const buttons = pickerButtons(config)
  // Before the agent reported its pickers: the model button still names the agent, so it can be switched.
  const shown: PickerButton[] = buttons.some(isModelButton) || !switchable ? buttons : [{ key: 'model', label: '默认', options: [] }, ...buttons]
  // The model option's own id (an ACP agent names it in its configOptions).
  const modelId = config.find((o) => o.category === 'model')?.id

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
        insertNewline(editor, caret)
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

  // 模式: the changes in order (leaving 计划 sends the level first, then plan off).
  const pickMode = async (choice: ModeChoice, planning: boolean): Promise<void> => {
    for (const [id, value] of modeChanges(choice, planning)) await setConfig(id, value)
  }

  const open = picker ? (shown.find((b) => b.key === picker.button.key) ?? picker.button) : null

  return (
    <div className={styles.composerWrap} data-testid="gui-composer">
      {menuOpen && <SlashMenu groups={groups} index={menuIndex} onHover={setMenuIndex} onPick={pick} />}
      <div className={styles.composer} data-testid="gui-composer-box">
        {attachments.length > 0 && (
          <ul className={styles.attachments} aria-label="附件">
            {attachments.map((path) => (
              <Attachment key={path} path={path} remove={() => removeAttachment(sessionId, path)} />
            ))}
          </ul>
        )}
        <div className={styles.composerText}>
          <ComposerEditor
            draft={draft}
            onChange={(text) => {
              setDraft(sessionId, text)
              setMenuDismissed(null)
            }}
            onKeyDown={onKeyDown}
            editorRef={editorRef}
          />
        </div>
        <div className={styles.controls}>
          {/* The buttons leave the keyboard and the caret in the text. */}
          <button type="button" className={styles.barIcon} aria-label="添加附件" title="添加附件" onMouseDown={(e) => e.preventDefault()} onClick={attach}>
            <Plus {...ICON} />
          </button>
          {shown.map((button) =>
            button.toggle ? (
              // 快速 (Figma 65): the mark only, pressed while on; the tooltip says why it is not taking effect.
              <button
                key={button.key}
                type="button"
                className={styles.pickerIcon}
                aria-label={button.label}
                title={button.hint ?? button.label}
                aria-pressed={button.toggle.on}
                data-hint={button.hint ? true : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void setConfig(button.options[0]!.id, button.toggle!.on ? 'off' : 'on')}
              >
                <Zap {...SMALL} />
              </button>
            ) : (
              <button
                key={button.key}
                type="button"
                className={styles.picker}
                aria-haspopup="dialog"
                aria-expanded={picker?.button.key === button.key}
                data-picker={button.key}
                onClick={(e) => {
                  const anchor = e.currentTarget
                  setPicker((at) => (at?.button.key === button.key ? null : { button, anchor }))
                }}
              >
                {buttonMark(button, agent)}
                <span>{button.label}</span>
                <ChevronDown size={12} strokeWidth={1.75} aria-hidden />
              </button>
            )
          )}
          <span className={styles.spacer} />
          <ContextButton sessionId={sessionId} agent={agent} />
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
      {picker && open && (
        <PickerMenu
          button={open}
          anchor={picker.anchor}
          below={switchable}
          agent={agent}
          switchable={switchable}
          onPick={(optionId, value) => void setConfig(optionId, value)}
          onMode={(choice) => void pickMode(choice, open.mode?.current === 'plan')}
          onAgent={(next, model) => {
            setPicker(null)
            if (next === agent) {
              if (model && modelId) void setConfig(modelId, model)
            } else switchAgent(next, model)
          }}
          onClose={() => {
            picker.anchor.focus()
            setPicker(null)
          }}
        />
      )}
    </div>
  )
})

/** The model's button: its option, or the stand-in shown before the agent reported its pickers. */
const isModelButton = (button: PickerButton): boolean => (button.options.length === 0 ? button.key === 'model' : button.options[0]?.category === 'model')

/** What leads each picker button (Figma 65): the agent's mark on the model, a gauge on effort, the 模式's own mark. */
function buttonMark(button: PickerButton, agent: AgentKind): ReactNode {
  if (isModelButton(button)) return <AgentIcon kind={agent} size={14} />
  if (button.options[0]?.category === 'thought_level') return <Gauge {...SMALL} />
  if (button.mode) {
    const Mark = MODE_ICON[button.mode.current]
    return <Mark {...SMALL} />
  }
  return null
}

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

/**
 * 49′C / 59H: the agent's commands matching what follows `/`, under 命令 and Skills; each entry its name · argument
 * hint · description. ↑↓ move, ⏎ / ⇥ pick.
 */
function SlashMenu({ groups, index, onHover, onPick }: { groups: readonly SlashGroup[]; index: number; onHover(index: number): void; onPick(command: GuiCommand): void }) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])
  return (
    <div ref={listRef} className={`${styles.popover} ${styles.slashMenu}`} role="listbox" aria-label="命令" data-testid="gui-slash-menu">
      {groups.map((group) => (
        <div key={group.title} role="group" aria-label={group.title} className={styles.slashGroup} data-testid="gui-slash-group">
          <span className={styles.popoverTitle} aria-hidden>
            {group.title}
          </span>
          {group.commands.map((command, j) => {
            const i = group.start + j
            return (
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
                {command.argumentHint && <span className={styles.commandHint}>{command.argumentHint}</span>}
                <span className={styles.commandText}>{command.description}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

interface PickerMenuProps {
  button: PickerButton
  anchor: HTMLElement
  /** Open under the button (the composer stands in the middle of an empty session), else over it. */
  below: boolean
  agent: AgentKind
  switchable: boolean
  onPick(optionId: string, value: string): void
  onMode(choice: ModeChoice): void
  onAgent(agent: CliAgent, model: string | undefined): void
  onClose(): void
}

/**
 * A picker's choices by its button, left-aligned with it. Model: before anything is said, the agents (Figma 65B) — the
 * hovered one's models beside the list; afterwards the agent's models under its name (65C). 模式: one list, each with
 * its mark (65E). Any other option is a list. ✓ on the current choice.
 */
function PickerMenu({ button, anchor, below, agent, switchable, onPick, onMode, onAgent, onClose }: PickerMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null)

  useLayoutEffect(() => {
    const menu = ref.current
    const host = menu?.offsetParent
    if (!menu || !host) return
    const box = anchor.getBoundingClientRect()
    const frame = host.getBoundingClientRect()
    setPlace(below ? { left: box.left - frame.left, top: box.bottom - frame.top + 4 } : { left: box.left - frame.left, bottom: frame.bottom - box.top + 4 })
    menu.querySelector<HTMLElement>('[aria-checked="true"], [role="menuitemradio"], [role="menuitem"]')?.focus({ preventScroll: true })
  }, [anchor, below])

  useEffect(() => {
    const doc = anchor.ownerDocument
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose()
    }
    // ⎋ closes it wherever the keyboard is (the menu may not have it: a theme change, a click on its gap).
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey, true)
    return () => {
      doc.removeEventListener('mousedown', onDown, true)
      doc.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  const option = button.options[0]
  const label = button.mode ? '模式' : option ? pickerSectionTitle(option) : '模型'
  let body: ReactNode
  // 65B: the agents and the hovered one's models, two menus side by side.
  const pair = isModelButton(button) && switchable && agent !== 'shell'
  if (pair) {
    body = <AgentModels agent={agent} models={option?.values ?? []} current={option?.current} onAgent={onAgent} />
  } else if (button.mode) {
    const mode = button.mode
    body = (
      <div className={styles.pickerSection} role="menu" aria-label="模式">
        {mode.choices.map((c) => {
          const Mark = MODE_ICON[c.value]
          return (
            <PickerRow
              key={c.value}
              checked={c.value === mode.current}
              mark={<Mark {...SMALL} />}
              label={c.label}
              onClick={() => {
                onMode(c.value)
                onClose()
              }}
            />
          )
        })}
      </div>
    )
  } else if (option) {
    body = (
      <div className={styles.pickerSection} role="menu" aria-label={label}>
        {/* 65C: the agent's models under its name. */}
        {option.category === 'model' && agent !== 'shell' && (
          <span className={`${styles.popoverTitle} ${styles.agentTitle}`}>
            <AgentIcon kind={agent} size={14} />
            {agentName(agent)}
          </span>
        )}
        {option.values.map((v) => (
          <PickerRow
            key={v.value}
            checked={v.value === option.current}
            label={v.label}
            onClick={() => {
              onPick(option.id, v.value)
              onClose()
            }}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={pair ? styles.pickerPair : `${styles.popover} ${styles.pickerMenu}`}
      data-below={below || undefined}
      role="dialog"
      aria-label={label}
      style={place ?? { visibility: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const rows = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? [])]
          const at = rows.indexOf(e.currentTarget.ownerDocument.activeElement as HTMLElement)
          rows[stepIndex(at, e.key === 'ArrowDown' ? 1 : -1, rows.length)]?.focus()
          e.preventDefault()
        }
      }}
    >
      {body}
    </div>
  )
}

function PickerRow({ checked, mark, label, onClick }: { checked: boolean; mark?: ReactNode; label: string; onClick(): void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} className={styles.pickerRow} onClick={onClick}>
      {mark}
      <span className={styles.pickerLabel}>{label}</span>
      {checked && <Check {...ICON} />}
    </button>
  )
}

/**
 * Figma 65B: the agents an empty session can run — installed ones (✓ the current, › its models), then 没装 in grey
 * (choosing one opens 设置 · 智能体, where its install command is). The hovered agent's models stand beside the list:
 * the current agent's as it reports them, another's as it listed them last time (or just its default).
 */
function AgentModels({ agent, models, current, onAgent }: { agent: AgentKind; models: readonly { value: string; label: string }[]; current: string | undefined; onAgent(agent: CliAgent, model: string | undefined): void }) {
  const [found, setFound] = useState<AgentAvailability | null>(null)
  const [hovered, setHovered] = useState<CliAgent | null>(agent === 'shell' ? null : agent)
  const picks = useWorkspace((s) => s.guiPicks)
  useEffect(() => {
    let live = true
    void installedAgents().then((next) => live && setFound(next))
    return () => {
      live = false
    }
  }, [])
  const { installed, missing } = guiAgentMenu(found)
  const listed = hovered === agent ? models : (hovered ? picks[hovered]?.models : undefined) ?? []
  const chosen = hovered === agent ? current : hovered ? picks[hovered]?.model : undefined
  return (
    <>
      <div className={`${styles.popover} ${styles.pickerColumn}`} role="menu" aria-label="智能体" data-testid="gui-agent-menu">
        {installed.map((id) => (
          <button
            key={id}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={hovered === id}
            className={styles.pickerRow}
            onMouseEnter={() => setHovered(id)}
            onFocus={() => setHovered(id)}
            onClick={() => setHovered(id)}
          >
            <AgentIcon kind={id} size={14} />
            <span className={styles.pickerLabel}>{agentName(id)}</span>
            <ChevronRight {...SMALL} />
          </button>
        ))}
        {missing.length > 0 && (
          <>
            <span className={styles.menuDivider} role="separator" />
            <span className={styles.popoverTitle}>没装</span>
            {missing.map((id) => (
              <button key={id} type="button" role="menuitem" className={styles.pickerRow} data-muted onMouseEnter={() => setHovered(null)} onClick={() => openSettings('agents', id)}>
                <AgentIcon kind={id} size={14} />
                <span className={styles.pickerLabel}>{agentName(id)}</span>
              </button>
            ))}
          </>
        )}
      </div>
      {hovered && (
        <div className={`${styles.popover} ${styles.pickerColumn}`} role="menu" aria-label={`${agentName(hovered)} 的模型`} data-testid="gui-agent-models">
          {listed.length === 0 ? (
            <PickerRow checked={false} label="默认" onClick={() => onAgent(hovered, undefined)} />
          ) : (
            listed.map((v) => <PickerRow key={v.value} checked={v.value === chosen} label={v.label} onClick={() => onAgent(hovered, v.value)} />)
          )}
        </div>
      )}
    </>
  )
}
