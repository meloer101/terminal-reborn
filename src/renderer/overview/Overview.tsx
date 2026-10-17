// Status overview (PRD F9 · Figma 11 v2: list 106:3640 / 106:4038, board 108:4091 / 108:4366). Replaces the
// terminal in the main area; the terminals stay mounted behind it. A row opens the session's own terminal in place
// (list) or in an overlay (board). Keyboard: ↑↓ move · Space opens / closes · ↵ enter · Esc closes, then leaves.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronUp, PanelLeft, Search } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { needsAttention } from '@shared/session-status'
import type { SessionId } from '@shared/types'
import { subscribeClock } from '../sidebar/clock'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { StatusGlyph } from '../ui/StatusGlyph'
import { BorrowedTerminal, TERMINAL_HOST_SELECTOR } from './BorrowedTerminal'
import { EnterButton } from './EnterButton'
import {
  buildOverview,
  clampTrayHeight,
  moveSelection,
  orderedIds,
  overviewSummary,
  type OverviewGroup,
  type OverviewRow
} from './model'
import { SessionOverlay } from './SessionOverlay'
import { enterSession, useOverviewStore, type OverviewView } from './store'
import styles from './Overview.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

const TICK_MS = 15_000

/** "Now" on the shared 15 s clock, so "已等 3m" keeps counting without re-rendering on every frame. */
function useClockNow(): number {
  return useSyncExternalStore(subscribeClock, () => Math.floor(Date.now() / TICK_MS) * TICK_MS)
}

export function Overview() {
  const { projects, worktrees, sessions, sidebarCollapsed, toggleSidebar, setMainView } = useWorkspace(
    useShallow((s) => ({
      projects: s.projects,
      worktrees: s.worktrees,
      sessions: s.sessions,
      sidebarCollapsed: s.sidebarCollapsed,
      toggleSidebar: s.toggleSidebar,
      setMainView: s.setMainView
    }))
  )
  const now = useClockNow()
  const { view, collapsed, selectedId, openId, filter, setView, toggleGroup, select, setOpen, setFilter } = useOverviewStore()
  const bodyRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(
    () => buildOverview({ projects, worktrees, sessions, now, filter }),
    [projects, worktrees, sessions, filter, now]
  )
  const collapsedSet = useMemo(() => new Set(view === 'board' ? [] : collapsed), [collapsed, view])
  const ids = useMemo(() => orderedIds(groups, collapsedSet), [groups, collapsedSet])
  const attention = sessions.filter((s) => needsAttention(s.status)).length
  const openRow = openId ? groups.flatMap((g) => g.rows).find((r) => r.session.id === openId) : undefined

  // Keep a selection that exists; default to the first row so ↵ / Space work right away.
  useEffect(() => {
    if (selectedId === null || !ids.includes(selectedId)) select(ids[0] ?? null)
  }, [ids, selectedId, select])
  // A session that was closed or filtered out takes its open terminal with it. One that changes status keeps it
  // open and moves with it, even into a folded group (answering in the tray moves 等你处理 → 运行中).
  useEffect(() => {
    if (openId && !groups.some((g) => g.rows.some((r) => r.session.id === openId))) setOpen(null)
  }, [openId, groups, setOpen])
  useEffect(() => bodyRef.current?.focus(), [])
  useEffect(() => {
    if (selectedId) bodyRef.current?.querySelector(`[data-session-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const closeOpen = () => {
    setOpen(null)
    bodyRef.current?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    const target = e.target as HTMLElement
    // Keys typed in a session's terminal are the session's — Esc included, which agents use to interrupt or
    // decline. The overlay handles its own keys.
    if (target.closest(TERMINAL_HOST_SELECTOR) || target.closest('[role="dialog"]')) return
    const inText = target.closest('input, textarea') !== null
    if (e.key === 'Escape') {
      e.preventDefault()
      if (openId) setOpen(null)
      else if (inText && filter) setFilter('')
      else setMainView('session')
      bodyRef.current?.focus()
      return
    }
    if (inText && !(e.target === filterRef.current && (e.key === 'ArrowDown' || e.key === 'Enter'))) return
    // Space / ↵ on a group header, the view switch or a row's buttons keep their own meaning.
    if ((e.key === ' ' || e.key === 'Enter') && target.closest('button') !== null) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      select(moveSelection(ids, selectedId, e.key === 'ArrowDown' ? 1 : -1))
      if (inText) bodyRef.current?.focus()
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault()
      enterSession(selectedId)
    } else if (e.key === ' ' && selectedId) {
      e.preventDefault()
      setOpen(openId === selectedId ? null : selectedId)
    } else if (e.key === '/') {
      e.preventDefault()
      filterRef.current?.focus()
    }
  }

  const onRowClick = (id: SessionId) => {
    // A click opens the session's terminal (in place, or in the overlay); 进入会话 / ↵ / a double-click go there.
    setOpen(openId === id ? null : id)
    bodyRef.current?.focus()
  }

  return (
    <div className={styles.overview} data-region="overview" onKeyDown={onKeyDown}>
      <header className={styles.header} data-sidebar-collapsed={sidebarCollapsed}>
        {sidebarCollapsed && (
          <IconButton label="显示侧栏" onClick={toggleSidebar}>
            <PanelLeft {...ICON} />
          </IconButton>
        )}
        <h1 className={styles.title}>总览</h1>
        <span className={styles.summary}>{overviewSummary(sessions, attention)}</span>
        <span className={styles.spacer} />
        <label className={styles.filter}>
          <Search {...ICON} />
          <input
            ref={filterRef}
            type="search"
            value={filter}
            placeholder="过滤  p:项目  s:状态"
            aria-label="过滤会话"
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <ViewSwitch view={view} onChange={setView} />
      </header>
      <div
        ref={bodyRef}
        className={styles.body}
        data-view={view}
        tabIndex={-1}
        role="listbox"
        aria-label="会话"
        aria-activedescendant={selectedId ? `overview-row-${selectedId}` : undefined}
      >
        {sessions.length === 0 ? (
          <p className={styles.empty}>还没有会话。打开一个项目，在侧栏的项目上点 ＋ 新建会话。</p>
        ) : view === 'list' ? (
          groups.map((g) => (
            <ListGroup
              key={g.key}
              group={g}
              collapsed={collapsedSet.has(g.key)}
              selectedId={selectedId}
              openId={openId}
              onToggle={() => toggleGroup(g.key)}
              onClick={onRowClick}
              onCollapse={closeOpen}
            />
          ))
        ) : (
          <div className={styles.board}>
            {groups.map((g) => (
              <BoardColumn key={g.key} group={g} selectedId={selectedId} onClick={onRowClick} />
            ))}
          </div>
        )}
        {sessions.length > 0 && ids.length === 0 && filter && <p className={styles.empty}>没有匹配“{filter}”的会话。</p>}
      </div>
      {/* Keyed by session: switching sessions starts a fresh overlay (focus, borrow). */}
      {view === 'board' && openRow && <SessionOverlay key={openRow.session.id} row={openRow} onClose={closeOpen} />}
    </div>
  )
}

function ViewSwitch({ view, onChange }: { view: OverviewView; onChange(view: OverviewView): void }) {
  return (
    <span className={styles.switch} role="radiogroup" aria-label="视图">
      {(['list', 'board'] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={view === v} data-selected={view === v} onClick={() => onChange(v)}>
          {v === 'list' ? '列表' : '看板'}
        </button>
      ))}
    </span>
  )
}

function ListGroup({
  group,
  collapsed,
  selectedId,
  openId,
  onToggle,
  onClick,
  onCollapse
}: {
  group: OverviewGroup
  collapsed: boolean
  selectedId: SessionId | null
  openId: SessionId | null
  onToggle(): void
  onClick(id: SessionId): void
  onCollapse(): void
}) {
  return (
    <section className={styles.group} aria-label={group.label}>
      <button type="button" className={styles.groupHeader} aria-expanded={!collapsed} onClick={onToggle}>
        <span className={styles.chevron}>{collapsed ? <ChevronRight {...ICON} /> : <ChevronDown {...ICON} />}</span>
        <h2>{group.label}</h2>
        <span className={styles.count}>{group.rows.length}</span>
      </button>
      {group.rows
        .filter((row) => !collapsed || row.session.id === openId)
        .map((row) =>
          row.session.id === openId ? (
            <ExpandedRow key={row.session.id} row={row} selected={row.session.id === selectedId} onClick={onClick} onCollapse={onCollapse} />
          ) : (
            <ListRow key={row.session.id} row={row} selected={row.session.id === selectedId} onClick={onClick} />
          )
        )}
    </section>
  )
}

interface RowProps {
  row: OverviewRow
  selected: boolean
  onClick(id: SessionId): void
}

/** OverviewRow v2 (104:191): 40 high, every cell 20 high and centered. */
function ListRow({ row, selected, onClick, expanded = false, trailing }: RowProps & { expanded?: boolean; trailing?: ReactNode }) {
  const id = row.session.id
  return (
    <div
      id={`overview-row-${id}`}
      className={styles.row}
      role="option"
      aria-selected={selected}
      aria-expanded={expanded}
      data-selected={selected}
      data-expanded={expanded}
      data-session-id={id}
      data-tone={row.tone}
      onClick={() => onClick(id)}
      onDoubleClick={() => enterSession(id)}
    >
      <span className={styles.statusCell}>
        <StatusGlyph status={row.status} />
        <span className={styles.statusLabel}>{row.statusLabel}</span>
      </span>
      <span className={styles.rowTitle}>{row.title}</span>
      <span className={styles.where}>{row.where}</span>
      <span className={styles.summaryCell}>{row.summary}</span>
      {trailing ?? (
        <>
          <span className={styles.stat}>{row.stat}</span>
          <span className={styles.time} data-emphasis={row.timeEmphasis}>
            {row.time}
          </span>
          <span className={styles.trailing} aria-hidden>
            <ChevronDown {...ICON} />
          </span>
        </>
      )}
    </div>
  )
}

/** Figma 11v2-B: the row and the session's full terminal below it, in one tray; the rows after it move down. */
function ExpandedRow({ row, selected, onClick, onCollapse }: RowProps & { onCollapse(): void }) {
  const trayRef = useRef<HTMLDivElement>(null)
  const stored = useOverviewStore((s) => s.trayHeight)
  const setTrayHeight = useOverviewStore((s) => s.setTrayHeight)
  const [dragging, setDragging] = useState<number | null>(null)
  const height = clampTrayHeight(dragging ?? stored, window.innerHeight)

  // Block body on purpose: Chromium's scrollIntoView returns a promise, which must not become the effect cleanup.
  useEffect(() => {
    trayRef.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  const onResizeStart = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const handle = e.currentTarget
    const startY = e.clientY
    const start = height
    handle.setPointerCapture(e.pointerId)
    const next = (y: number) => clampTrayHeight(start + y - startY, window.innerHeight)
    const move = (ev: globalThis.PointerEvent) => setDragging(next(ev.clientY))
    const end = (ev: globalThis.PointerEvent) => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      setTrayHeight(next(ev.clientY))
      setDragging(null)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  return (
    <div ref={trayRef} className={styles.tray} role="group" aria-label={`${row.title} 的终端`}>
      <ListRow
        row={row}
        selected={selected}
        onClick={onClick}
        expanded
        trailing={
          <span className={styles.trailingExpanded}>
            <EnterButton sessionId={row.session.id} />
            <button
              type="button"
              className={styles.collapse}
              aria-label="收起"
              title="收起"
              onClick={(e) => {
                e.stopPropagation()
                onCollapse()
              }}
            >
              <ChevronUp {...ICON} />
            </button>
          </span>
        }
      />
      <div className={styles.trayTerminal} style={{ height }}>
        <BorrowedTerminal session={row.session} variant="tray" />
      </div>
      <div
        className={styles.resize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="调整终端高度"
        data-dragging={dragging !== null}
        onPointerDown={onResizeStart}
      />
    </div>
  )
}

function BoardColumn({ group, selectedId, onClick }: { group: OverviewGroup; selectedId: SessionId | null; onClick(id: SessionId): void }) {
  return (
    <section className={styles.column} aria-label={group.label}>
      <div className={styles.columnHeader}>
        <h2>{group.label}</h2>
        <span className={styles.count}>{group.rows.length}</span>
      </div>
      {group.rows.map((row) => (
        <StatusCard key={row.session.id} row={row} selected={row.session.id === selectedId} onClick={onClick} />
      ))}
    </section>
  )
}

/** StatusCard (104:286): a borderless status-colored block; status is also the glyph's shape and the column. */
function StatusCard({ row, selected, onClick }: RowProps) {
  const id = row.session.id
  return (
    <div
      id={`overview-row-${id}`}
      className={styles.card}
      role="option"
      aria-selected={selected}
      data-selected={selected}
      data-session-id={id}
      data-card={row.card}
      onClick={() => onClick(id)}
      onDoubleClick={() => enterSession(id)}
    >
      <span className={styles.cardHead}>
        <StatusGlyph status={row.status} />
        <span className={styles.cardTitle}>{row.title}</span>
        <span className={styles.cardMeta} data-emphasis={row.timeEmphasis}>
          {row.time}
        </span>
      </span>
      {row.where && <span className={styles.cardWhere}>{row.where}</span>}
      {row.summary && <span className={styles.cardSummary}>{row.summary}</span>}
      {row.stat && <span className={styles.cardStat}>{row.stat}</span>}
    </div>
  )
}
