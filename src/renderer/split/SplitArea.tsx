// The terminal area (PRD F20 · Figma 21 Section 301:15658): one session, or two to four side by side as a split.
// Each pane is today's session view — its own header and the session's full, interactive terminal — and the panes
// exactly fill the area, a strip of glass between neighbours that drags to resize (double-click evens the two out).
// A session dragged from the sidebar, or a pane by its title, drops on a pane's middle (replace / swap) or an edge
// (a new pane on that side). The terminals stay where TerminalArea mounted them; this only places them. Every window has
// its own (F20 · 多窗口): a secondary window's panes borrow their terminals into its document (PaneHosts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { X } from 'lucide-react'
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { dropRect, evenSplit, measureSplit, PICKER_PANE, resizeSplit, type PaneBox, type Rect, type Size, type SplitHandle, type SplitNode } from '@shared/split-layout'
import type { SessionId } from '@shared/types'
import { MAIN_WINDOW, viewRoot } from '@shared/window-layout'
import { glyphStatus } from '../lifecycle/present'
import { SessionHeader } from '../session-header/SessionHeader'
import { subscribeClock } from '../sidebar/clock'
import { shownEverywhere, useWorkspace } from '../state/workspace'
import { usePaneView, useSidebarCollapsed, useWindowKey, useWindowScope } from '../state/window-scope'
import { PaneHosts, TerminalArea } from '../terminal/TerminalArea'
import { IconButton } from '../ui/IconButton'
import { StatusGlyph } from '../ui/StatusGlyph'
import { pressSession } from './drag'
import './font-zoom'
import { dropLabel, pickerRows, stackHandles } from './model'
import { setSplitGeometry, useSessionDrag, type SessionDrag } from './store'
import styles from './SplitArea.module.css'

/** A pane's header (= --titlebar-height); its terminal fills the rest of the pane. */
const HEADER = 36
/** The drop target sits this far inside the part of the pane it will take (Figma 21D). */
const DROP_INSET = 8

const box = ({ x, y, width, height }: Rect): CSSProperties => ({ left: x, top: y, width, height })
const NO_PANES: { panes: PaneBox[]; handles: SplitHandle[] } = { panes: [], handles: [] }

export function SplitArea() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const windowKey = useWindowKey()
  const view = usePaneView()
  const split = view.split
  const activeId = useWorkspace((s) => (s.sessions.some((x) => x.id === view.activeSessionId) ? view.activeSessionId : null))
  const drag = useSessionDrag((s) => (s.drag?.window === windowKey ? s.drag : null))
  // While the new pane's picker has the keyboard, no session pane is the focused one (Figma 21G).
  const picking = usePickerFocus((s) => s.focused)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      const area = { width: el.clientWidth, height: el.clientHeight }
      setSize(area)
      setSplitGeometry(windowKey, { element: el, area })
    }
    measure()
    // The window's own ResizeObserver: one from the main window does not see a secondary window's layout.
    const Observer = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.ResizeObserver ?? ResizeObserver
    const observer = new Observer(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      setSplitGeometry(windowKey, null)
    }
  }, [windowKey])

  const root: SplitNode | null = split ?? (activeId ? viewRoot({ split: null, activeSessionId: activeId }) : null)
  const { panes, handles } = useMemo(() => (root ? measureSplit(root, size.width, size.height) : NO_PANES), [root, size.width, size.height])
  const placements = useMemo(
    () =>
      Object.fromEntries(
        panes.filter((p) => p.id !== PICKER_PANE).map((p) => [p.id, { x: p.x, y: p.y + HEADER, width: p.width, height: Math.max(0, p.height - HEADER) }])
      ),
    [panes]
  )
  const many = panes.length > 1

  return (
    <div ref={ref} className={styles.area} data-panes={panes.length}>
      {windowKey === MAIN_WINDOW ? <TerminalArea placements={placements} /> : <PaneHosts placements={placements} />}
      {panes.map((p) =>
        p.id === PICKER_PANE ? (
          <PanePicker key={PICKER_PANE} rect={p} top={p.y === 0} lead={p.x === 0 && p.y === 0} />
        ) : (
          <PaneHeader key={p.id} rect={p} focused={p.id === activeId && !picking} many={many} />
        )
      )}
      {stackHandles(handles).map((h) => (
        <Hairline key={`${h.path.join('.')}:${h.index}`} handle={h} />
      ))}
      {drag?.drop && <DropMark drag={drag} panes={panes} root={root} />}
    </div>
  )
}

function PaneHeader({ rect, focused, many }: { rect: PaneBox; focused: boolean; many: boolean }) {
  const id = rect.id
  const chrome = useMemo(
    () => ({
      focused,
      lead: rect.x === 0 && rect.y === 0,
      top: rect.y === 0,
      onClose: many ? () => useWorkspace.getState().closePane(id) : undefined,
      onTitlePointerDown: many ? (e: PointerEvent<HTMLElement>) => pressSession(e, id, 'pane') : undefined
    }),
    [focused, many, id, rect.x, rect.y]
  )
  return (
    <div
      className={styles.header}
      style={{ left: rect.x, top: rect.y, width: rect.width }}
      data-pane-id={id}
      data-focused={focused}
      // A click on the header (not its buttons) puts the keyboard in this pane.
      onPointerDown={(e) => {
        if (!focused && (e.target as HTMLElement).closest('button, input') === null) useWorkspace.getState().setActiveSession(id)
      }}
    >
      <SessionHeader sessionId={id} pane={chrome} />
    </div>
  )
}

/** The glass between two panes: an 8 px strip that drags to resize, with a short grip always shown in its middle. */
function Hairline({ handle }: { handle: SplitHandle }) {
  const across = handle.dir === 'row'
  const [dragging, setDragging] = useState(false)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const base = useWorkspace.getState().split
    if (e.button !== 0 || !base) return
    e.preventDefault()
    const el = e.currentTarget
    const start = across ? e.clientX : e.clientY
    el.setPointerCapture(e.pointerId)
    setDragging(true)
    const move = (ev: globalThis.PointerEvent): void => {
      const delta = (across ? ev.clientX : ev.clientY) - start
      useWorkspace.getState().setSplit(resizeSplit(base, handle.path, handle.index, delta, handle.span))
    }
    const end = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      setDragging(false)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }
  const onDoubleClick = () => {
    const split = useWorkspace.getState().split
    if (split) useWorkspace.getState().setSplit(evenSplit(split, handle.path, handle.index))
  }
  return (
    <div
      className={styles.hairline}
      style={box(handle)}
      data-dir={handle.dir}
      data-dragging={dragging}
      role="separator"
      aria-orientation={across ? 'vertical' : 'horizontal'}
      aria-label={across ? '调整宽度' : '调整高度'}
      title="拖动调整大小，双击两边等分"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  )
}

/** Where a dragged session will land (Figma 21D), or why it cannot (21E: an edge with four panes open). */
function DropMark({ drag, panes, root }: { drag: SessionDrag; panes: PaneBox[]; root: SplitNode | null }) {
  const drop = drag.drop
  const target = drop && panes.find((p) => p.id === drop.id)
  if (!drop || !target) return null
  const label = dropLabel(drop, drag.id, root)
  if ('refused' in drop) {
    if (!drag.local) return null
    return (
      <span className={styles.hint} data-refused={drop.refused} style={{ left: drag.local.x + 18, top: drag.local.y - 44 }}>
        {label}
      </span>
    )
  }
  const part = dropRect(target, drop.zone)
  const inset = { x: part.x + DROP_INSET, y: part.y + DROP_INSET, width: Math.max(0, part.width - 2 * DROP_INSET), height: Math.max(0, part.height - 2 * DROP_INSET) }
  return (
    <div className={styles.drop} style={box(inset)} data-zone={drop.zone} aria-hidden>
      <span className={styles.hint}>{label}</span>
    </div>
  )
}

const usePickerFocus = create<{ focused: boolean }>(() => ({ focused: false }))

const useClockNow = (): number => useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / 15_000) * 15_000)

/** ⌘D / ⇧⌘D's new pane (Figma 21G): the sessions not shown yet, filtered as you type; ↵ shows one, Esc cancels. */
function PanePicker({ rect, top, lead }: { rect: PaneBox; top: boolean; lead: boolean }) {
  const [filter, setFilter] = useState('')
  const [at, setAt] = useState(0)
  const now = useClockNow()
  const { projects, worktrees, sessions, shown } = useWorkspace(
    useShallow((s) => ({ projects: s.projects, worktrees: s.worktrees, sessions: s.sessions, shown: shownEverywhere(s).join('\n') }))
  )
  const sidebarCollapsed = useSidebarCollapsed()
  // Sessions another pane or window shows are not offered (one place at a time).
  const rows = useMemo(() => pickerRows({ projects, worktrees, sessions, shown: shown.split('\n'), now, filter }), [projects, worktrees, sessions, shown, now, filter])
  const highlighted = Math.min(at, Math.max(0, rows.length - 1))
  const pick = (id: SessionId) => useWorkspace.getState().pickForPane(id)
  const cancel = () => useWorkspace.getState().closePane(PICKER_PANE)
  // A removed element sends no blur: the panes get their focus look back when the picker goes.
  useEffect(() => () => usePickerFocus.setState({ focused: false }), [])

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setAt(Math.min(rows.length - 1, Math.max(0, highlighted + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      const row = rows[highlighted]
      if (!row) return
      e.preventDefault()
      pick(row.session.id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
  }

  return (
    <section
      className={styles.picker}
      style={box(rect)}
      data-pane-id={PICKER_PANE}
      aria-label="选择这一格显示的会话"
      onKeyDown={onKeyDown}
      onFocus={() => usePickerFocus.setState({ focused: true })}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) usePickerFocus.setState({ focused: false })
      }}
    >
      <header className={styles.pickerBar} data-drag-region={top} data-sidebar-collapsed={lead && sidebarCollapsed}>
        <h2 className={styles.pickerTitle}>选择这一格显示的会话</h2>
        <span className={styles.spacer} />
        <span className={styles.keys}>↵ 显示 · Esc 取消</span>
        <IconButton label="取消这一格" onClick={cancel}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
      </header>
      <div className={styles.pickerBody}>
        <input
          className={styles.filter}
          type="text"
          placeholder="搜索会话、项目或分支"
          aria-label="搜索会话"
          spellCheck={false}
          autoFocus
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setAt(0)
          }}
        />
        {rows.length === 0 ? (
          <p className={styles.empty}>{filter ? '没有匹配的会话' : '没有其他会话了。⌘N 新建一个'}</p>
        ) : (
          <div className={styles.list} role="listbox" aria-label="会话">
            {rows.map((row, i) => (
              <button
                key={row.session.id}
                type="button"
                role="option"
                aria-selected={i === highlighted}
                className={styles.pick}
                data-highlighted={i === highlighted}
                data-pick-id={row.session.id}
                tabIndex={-1}
                onMouseEnter={() => setAt(i)}
                onClick={() => pick(row.session.id)}
              >
                <StatusGlyph status={glyphStatus(row.session)} />
                <span className={styles.pickTitle}>{row.title}</span>
                {row.where && <span className={styles.where}>{row.where}</span>}
                <span className={styles.spacer} />
                <span className={styles.status}>{[row.statusLabel, row.time].filter(Boolean).join(' · ')}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

/** Follows the pointer while a session is dragged (Figma 21D DragGhost); mounted once per window. */
export function SessionDragGhost() {
  const { key: windowKey, win } = useWindowScope()
  const drag = useSessionDrag((s) => (s.drag?.window === windowKey ? s.drag : null))
  const session = useWorkspace((s) => (drag ? s.sessions.find((x) => x.id === drag.id) : undefined))
  if (!drag || !session) return null
  if (drag.outside) {
    // Past the window's edge the ghost cannot follow: it waits at the edge and says what releasing does (F20 · 多窗口).
    return (
      <span
        className={styles.hint}
        data-outside
        style={{ left: clamp(drag.x + 14, 8, win.innerWidth - 220), top: clamp(drag.y + 18, 8, win.innerHeight - 40) }}
        aria-hidden
      >
        松开在新窗口中打开
      </span>
    )
  }
  return (
    <div className={styles.ghost} style={{ left: drag.x + 14, top: drag.y + 18 }} aria-hidden>
      <StatusGlyph status={glyphStatus(session)} />
      <span className={styles.ghostTitle}>{session.title}</span>
    </div>
  )
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))
