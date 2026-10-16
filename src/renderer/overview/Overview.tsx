// Status overview (PRD F9 · Figma 11 列表 / 11b 看板 / 11c 预览). Replaces the terminal in the main area;
// the terminals stay mounted behind it. Keyboard: ↑↓ move · Space preview · ↵ enter · Esc closes the
// preview, then the overview.
import { useEffect, useMemo, useRef, useSyncExternalStore, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, PanelLeft, Search } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { needsAttention } from '@shared/session-status'
import type { SessionId } from '@shared/types'
import { subscribeClock } from '../sidebar/clock'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { StatusGlyph } from '../ui/StatusGlyph'
import { buildOverview, moveSelection, orderedIds, overviewSummary, type OverviewGroup, type OverviewRow } from './model'
import { Peek } from './Peek'
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
  const { view, collapsed, selectedId, peekId, filter, setView, toggleGroup, select, setPeek, setFilter } = useOverviewStore()
  const bodyRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(
    () => buildOverview({ projects, worktrees, sessions, now, filter }),
    [projects, worktrees, sessions, filter, now]
  )
  const collapsedSet = useMemo(() => new Set(view === 'board' ? [] : collapsed), [collapsed, view])
  const ids = useMemo(() => orderedIds(groups, collapsedSet), [groups, collapsedSet])
  const attention = sessions.filter((s) => needsAttention(s.status)).length
  const peekSession = peekId ? sessions.find((s) => s.id === peekId) : undefined

  // Keep a selection that exists; default to the first row so ↵ / Space work right away.
  useEffect(() => {
    if (selectedId === null || !ids.includes(selectedId)) select(ids[0] ?? null)
  }, [ids, selectedId, select])
  useEffect(() => {
    if (peekId && !sessions.some((s) => s.id === peekId)) setPeek(null)
  }, [peekId, sessions, setPeek])
  useEffect(() => bodyRef.current?.focus(), [])
  useEffect(() => {
    if (selectedId) bodyRef.current?.querySelector(`[data-session-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    const inText = (e.target as HTMLElement).closest('input, textarea') !== null
    if (e.key === 'Escape') {
      e.preventDefault()
      if (peekId) setPeek(null)
      else if (inText && filter) setFilter('')
      else setMainView('session')
      bodyRef.current?.focus()
      return
    }
    if (inText && !(e.target === filterRef.current && (e.key === 'ArrowDown' || e.key === 'Enter'))) return
    // Space / ↵ on a group header, the view switch or a peek button keep their own meaning.
    if ((e.key === ' ' || e.key === 'Enter') && (e.target as HTMLElement).closest('button') !== null) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      select(moveSelection(ids, selectedId, e.key === 'ArrowDown' ? 1 : -1))
      if (inText) bodyRef.current?.focus()
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault()
      enterSession(selectedId)
    } else if (e.key === ' ' && selectedId) {
      e.preventDefault()
      setPeek(peekId === selectedId ? null : selectedId)
    } else if (e.key === '/' ) {
      e.preventDefault()
      filterRef.current?.focus()
    }
  }

  const onRowClick = (id: SessionId) => {
    // A click previews; the preview's 进入会话 (or a double-click / ↵) opens the terminal.
    setPeek(peekId === id ? null : id)
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
      <div className={styles.content}>
        <div
          ref={bodyRef}
          className={styles.body}
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
                onToggle={() => toggleGroup(g.key)}
                onClick={onRowClick}
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
        {/* Keyed by session: switching the preview starts with a fresh snapshot and an empty reply. */}
        {peekSession && <Peek key={peekSession.id} session={peekSession} onClose={() => setPeek(null)} />}
      </div>
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
  onToggle,
  onClick
}: {
  group: OverviewGroup
  collapsed: boolean
  selectedId: SessionId | null
  onToggle(): void
  onClick(id: SessionId): void
}) {
  return (
    <section className={styles.group} aria-label={group.label}>
      <button type="button" className={styles.groupHeader} aria-expanded={!collapsed} onClick={onToggle}>
        <span className={styles.chevron}>{collapsed ? <ChevronRight {...ICON} /> : <ChevronDown {...ICON} />}</span>
        <h2>{group.label}</h2>
        <span className={styles.count}>{group.rows.length}</span>
      </button>
      {!collapsed &&
        group.rows.map((row) => <ListRow key={row.session.id} row={row} selected={row.session.id === selectedId} onClick={onClick} />)}
    </section>
  )
}

function ListRow({ row, selected, onClick }: { row: OverviewRow; selected: boolean; onClick(id: SessionId): void }) {
  const id = row.session.id
  return (
    <div
      id={`overview-row-${id}`}
      className={styles.row}
      role="option"
      aria-selected={selected}
      data-selected={selected}
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
      <span className={styles.stat}>{row.stat}</span>
      <span className={styles.time}>{row.time}</span>
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
      {group.rows.map((row) => {
        const id = row.session.id
        const selected = id === selectedId
        return (
          <div
            key={id}
            id={`overview-row-${id}`}
            className={styles.item}
            role="option"
            aria-selected={selected}
            data-selected={selected}
            data-session-id={id}
            data-tone={row.tone}
            onClick={() => onClick(id)}
            onDoubleClick={() => enterSession(id)}
          >
            <span className={styles.itemHead}>
              <StatusGlyph status={row.status} />
              <span className={styles.rowTitle}>{row.title}</span>
              <span className={styles.time}>{row.time}</span>
            </span>
            <span className={styles.where}>{row.where}</span>
            {row.summary && <span className={styles.itemSummary}>{row.summary}</span>}
            {row.stat && <span className={styles.stat}>{row.stat}</span>}
          </div>
        )
      })}
    </section>
  )
}
