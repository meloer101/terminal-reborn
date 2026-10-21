// Board → session overlay (PRD F9 · Figma 11v2-D 108:4366, SessionOverlayBar 104:287): a centered modal over the
// whole window with the sessions' full, interactive terminals — one, or up to four as separate windows. A window's
// bar drags it onto another (the middle swaps them, an edge puts it beside that one); the gaps drag to resize the
// windows, and each edge of the overlay moves on its own (remembered; double-click restores the default). The
// top-right window's bar adds a session through a picker tile. Esc (outside a terminal) and the scrim close the
// overlay; a window's × closes that window, and the last one closes the overlay.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Columns2, X } from 'lucide-react'
import type { SessionId } from '@shared/types'
import { IconButton } from '../ui/IconButton'
import { StatusGlyph } from '../ui/StatusGlyph'
import { getXtermSurface } from '../terminal/registry'
import { BorrowedTerminal, TERMINAL_HOST_SELECTOR } from './BorrowedTerminal'
import { ReviewButton } from '../review/ReviewButton'
import { SessionRadarTag } from '../conflict-radar/RadarTag'
import { CompareBar } from '../attempts/AttemptGroups'
import { EnterButton } from './EnterButton'
import enterStyles from './EnterButton.module.css'
import type { OverviewRow } from './model'
import {
  cornerTile,
  dropRect,
  dropZone,
  layoutIds,
  MAX_PANES,
  measureLayout,
  moveInLayout,
  PICKER_SLOT,
  fitRect,
  resizeColumns,
  resizeRect,
  resizeRows,
  type DropZone,
  type PaneLayout,
  type PanelEdge,
  type Rect,
  type SplitHandle,
  type TileBox
} from './pane-layout'
import { enterSession, useOverviewStore } from './store'
import styles from './SessionOverlay.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

/** The space between windows, which is also where they resize (px; --space-12). */
const GAP = 12

/** How far the pointer moves on a bar before it becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4

/** How long to wait for an added session's terminal to open before giving up on focusing it (~1 s at 60 fps). */
const FOCUS_WAIT_FRAMES = 60

const EDGES: readonly PanelEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

interface Drag {
  id: SessionId
  target: { id: SessionId; zone: DropZone } | null
}

const box = ({ x, y, width, height }: Rect): CSSProperties => ({ left: x, top: y, width, height })

export function SessionOverlay({
  layout,
  rows,
  candidates,
  onClose
}: {
  layout: PaneLayout
  /** Every row on the board, to look the open sessions up in. */
  rows: OverviewRow[]
  /** Sessions the picker offers: every other one on the board, in board order. */
  candidates: OverviewRow[]
  onClose(): void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [drag, setDrag] = useState<Drag | null>(null)
  const picking = useOverviewStore((s) => s.picking)
  // 一题多解: the group being compared; its members' windows get a compare bar.
  const compareGroup = useOverviewStore((s) => s.compareGroup)
  const overlayRect = useOverviewStore((s) => s.overlayRect)
  /** The rect while an edge is being dragged; stored (and remembered) on release. */
  const [liveRect, setLiveRect] = useState<Rect | null>(null)
  const viewport = useViewport()
  const stored = liveRect ?? overlayRect
  const panelRect = stored ? fitRect(stored, viewport) : null
  const { setPicking, addPane, closePane, setLayout, setOverlayRect } = useOverviewStore.getState()

  // While picking, the layout holds the picker's slot too (store.ts), so it resizes and moves like a window.
  const ids = layoutIds(layout)
  const { tiles, handles } = measureLayout(layout, size.width, size.height, GAP)
  const tilesRef = useRef<TileBox[]>(tiles)
  useEffect(() => {
    tilesRef.current = tiles
  })
  const canAdd = !picking && ids.length < MAX_PANES
  const corner = cornerTile(layout)
  const byId = new Map(rows.map((r) => [r.session.id, r]))

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const measure = () => setSize({ width: panel.clientWidth, height: panel.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [])
  useEffect(() => panelRef.current?.focus(), [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    // Keys typed in a terminal are the session's (agents use Esc to interrupt or decline).
    if (target.closest(TERMINAL_HOST_SELECTOR)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && target.closest('button') === null) {
      // The window the focus is in, or the first one.
      const id = target.closest<HTMLElement>('[data-pane-id]')?.dataset.paneId ?? ids[0]
      if (!id) return
      e.preventDefault()
      enterSession(id)
    }
  }
  const onScrimMouseDown = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }
  const onPick = (id: SessionId) => {
    addPane(id)
    focusTerminalSoon(id)
  }

  /** The window under a point in the panel, and which part of it — never the dragged one or the picker. */
  const targetAt = (dragged: SessionId, clientX: number, clientY: number): Drag['target'] => {
    const panel = panelRef.current?.getBoundingClientRect()
    if (!panel) return null
    const x = clientX - panel.left
    const y = clientY - panel.top
    const tile = tilesRef.current.find((t) => t.id !== dragged && t.id !== PICKER_SLOT && x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height)
    return tile ? { id: tile.id, zone: dropZone((x - tile.x) / tile.width, (y - tile.y) / tile.height) } : null
  }

  const onBarPointerDown = (id: SessionId, e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') !== null || ids.length < 2) return
    const bar = e.currentTarget
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    let last: Drag['target'] = null
    bar.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
      dragging = true
      last = targetAt(id, ev.clientX, ev.clientY)
      setDrag({ id, target: last })
    }
    const end = (ev: globalThis.PointerEvent) => {
      bar.removeEventListener('pointermove', move)
      bar.removeEventListener('pointerup', end)
      bar.removeEventListener('pointercancel', end)
      const current = useOverviewStore.getState().layout
      if (dragging && ev.type === 'pointerup' && last && current) setLayout(moveInLayout(current, id, last.id, last.zone))
      setDrag(null)
    }
    bar.addEventListener('pointermove', move)
    bar.addEventListener('pointerup', end)
    bar.addEventListener('pointercancel', end)
  }

  const onSplitPointerDown = (handle: SplitHandle, e: PointerEvent<HTMLElement>) => {
    const base = useOverviewStore.getState().layout
    if (e.button !== 0 || !base) return
    e.preventDefault()
    const el = e.currentTarget
    const start = handle.kind === 'column' ? e.clientX : e.clientY
    const count = handle.kind === 'column' ? base.columns.length : (base.columns[handle.column]?.ids.length ?? 1)
    const span = (handle.kind === 'column' ? size.width : size.height) - GAP * (count - 1)
    if (span <= 0) return
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      const delta = ((handle.kind === 'column' ? ev.clientX : ev.clientY) - start) / span
      setLayout(handle.kind === 'column' ? resizeColumns(base, handle.index, delta) : resizeRows(base, handle.column, handle.index, delta))
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  const onEdgePointerDown = (edge: PanelEdge, e: PointerEvent<HTMLElement>) => {
    const panel = panelRef.current
    if (e.button !== 0 || !panel) return
    e.preventDefault()
    const el = e.currentTarget
    // The scrim fills the window, so the panel's client rect is its place in the window.
    const { left, top, width, height } = panel.getBoundingClientRect()
    const start = { x: left, y: top, width, height }
    const x0 = e.clientX
    const y0 = e.clientY
    let last: Rect | null = null
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      last = resizeRect(start, edge, ev.clientX - x0, ev.clientY - y0, { width: window.innerWidth, height: window.innerHeight })
      setLiveRect(last)
    }
    const end = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      if (last) setOverlayRect(last)
      setLiveRect(null)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  const target = drag?.target ?? null
  const dropTile = target ? tiles.find((t) => t.id === target.id) : undefined

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown} data-region="overview-overlay">
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={ids.map((id) => byId.get(id)?.title ?? '').join(' · ')}
        tabIndex={-1}
        data-dragging={drag !== null}
        data-placed={panelRect !== null}
        style={panelRect ? box(panelRect) : undefined}
        onKeyDown={onKeyDown}
      >
        {tiles.map((tile) => {
          if (tile.id === PICKER_SLOT) {
            return <Picker key={PICKER_SLOT} style={box(tile)} rows={candidates} onPick={onPick} onCancel={() => setPicking(false)} />
          }
          const row = byId.get(tile.id)
          if (!row) return null
          return (
            <Pane
              key={tile.id}
              row={row}
              style={box(tile)}
              movable={ids.length > 1}
              dragged={drag?.id === tile.id}
              onBarPointerDown={(e) => onBarPointerDown(tile.id, e)}
              onAdd={canAdd && corner === tile.id ? () => setPicking(true) : undefined}
              onClose={() => (ids.length === 1 ? onClose() : closePane(tile.id))}
              below={compareGroup ? <CompareBar groupId={compareGroup} sessionId={tile.id} /> : null}
            />
          )
        })}
        {handles.map((h) => (
          <div
            key={h.kind === 'column' ? `c${h.index}` : `r${h.column}-${h.index}`}
            className={styles.split}
            style={box(h)}
            data-kind={h.kind}
            role="separator"
            aria-orientation={h.kind === 'column' ? 'vertical' : 'horizontal'}
            aria-label={h.kind === 'column' ? '调整宽度' : '调整高度'}
            onPointerDown={(e) => onSplitPointerDown(h, e)}
          />
        ))}
        {dropTile && target && <div className={styles.drop} style={box(dropRect(dropTile, target.zone))} aria-hidden />}
        {EDGES.map((edge) => (
          <div
            key={edge}
            className={styles.edge}
            data-edge={edge}
            title="拖动调整大小，双击恢复默认"
            aria-hidden
            onPointerDown={(e) => onEdgePointerDown(edge, e)}
            onDoubleClick={() => setOverlayRect(null)}
          />
        ))}
      </div>
    </div>
  )
}

function Pane({
  row,
  style,
  movable,
  dragged,
  onBarPointerDown,
  onAdd,
  onClose,
  below
}: {
  row: OverviewRow
  style: CSSProperties
  movable: boolean
  dragged: boolean
  onBarPointerDown(e: PointerEvent<HTMLElement>): void
  onAdd?: () => void
  onClose(): void
  /** Under the title bar, above the terminal (一题多解's compare bar). */
  below?: ReactNode
}) {
  const id = row.session.id
  return (
    <section className={styles.tile} style={style} data-pane-id={id} data-dragged={dragged} aria-label={row.title}>
      <header className={styles.bar} data-movable={movable} onPointerDown={onBarPointerDown}>
        <StatusGlyph status={row.status} />
        <span className={styles.title}>{row.title}</span>
        {row.where && <span className={styles.where}>{row.where}</span>}
        <span className={styles.radar}>
          <SessionRadarTag sessionId={id} />
        </span>
        <span className={styles.spacer} />
        <span className={styles.status}>{[row.statusLabel, row.time].filter(Boolean).join(' · ')}</span>
        <span className={styles.divider} aria-hidden />
        {row.session.status === 'done_unread' && <ReviewButton sessionId={id} className={enterStyles.enter} />}
        <EnterButton sessionId={id} />
        {onAdd && (
          <button type="button" className={`${enterStyles.enter} ${styles.add}`} aria-label="并排添加会话" title="并排添加会话" onClick={onAdd}>
            <Columns2 {...ICON} />
            并排
          </button>
        )}
        <IconButton label="关闭" onClick={onClose}>
          <X {...ICON} />
        </IconButton>
      </header>
      {below}
      <div className={styles.terminal}>
        <BorrowedTerminal session={row.session} variant="overlay" />
      </div>
    </section>
  )
}

/** The tile that picks the next session to show: every other session on the board, in board order. */
function Picker({
  style,
  rows,
  onPick,
  onCancel
}: {
  style: CSSProperties
  rows: OverviewRow[]
  onPick(id: SessionId): void
  onCancel(): void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => listRef.current?.querySelector('button')?.focus(), [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = [...(listRef.current?.querySelectorAll('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[Math.min(buttons.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (!next) return
    e.preventDefault()
    next.focus()
  }

  return (
    <section className={styles.tile} style={style} aria-label="添加会话">
      <header className={styles.bar}>
        <span className={styles.title}>添加会话</span>
        <span className={styles.spacer} />
        <IconButton label="取消" onClick={onCancel}>
          <X {...ICON} />
        </IconButton>
      </header>
      {rows.length === 0 ? (
        <p className={styles.pickerEmpty}>看板上没有其他会话了。</p>
      ) : (
        <div ref={listRef} className={styles.picker} onKeyDown={onKeyDown}>
          {rows.map((row) => (
            <button key={row.session.id} type="button" className={styles.pick} data-pick-id={row.session.id} onClick={() => onPick(row.session.id)}>
              <StatusGlyph status={row.status} />
              <span className={styles.pickTitle}>{row.title}</span>
              {row.where && <span className={styles.where}>{row.where}</span>}
              <span className={styles.spacer} />
              <span className={styles.status}>{[row.statusLabel, row.time].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** The window's size, kept current so a remembered overlay rect is fitted into a window that shrank. */
function useViewport(): { width: number; height: number } {
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return viewport
}

/** The keyboard follows a just-added session into its terminal, which opens a frame or more later. */
function focusTerminalSoon(id: SessionId): void {
  let tries = 0
  const attempt = (): void => {
    const surface = getXtermSurface(id)
    if (!surface) {
      if (tries++ < FOCUS_WAIT_FRAMES) requestAnimationFrame(attempt)
      return
    }
    void surface.whenOpen().then(() => surface.focus())
  }
  requestAnimationFrame(attempt)
}
