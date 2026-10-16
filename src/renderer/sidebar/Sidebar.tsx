import { useCallback, useMemo, useRef, type KeyboardEvent } from 'react'
import { Folder, LayoutList, PanelLeft, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../state/workspace'
import { openNewSessionMenu, openProjectInteractive, openProjectMenu, openSessionContextMenu } from '../state/session-actions'
import { IconButton } from '../ui/IconButton'
import { NavItem } from './NavItem'
import { openCommandPalette } from '../command-palette'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { toggleOverview } from '../overview/store'
import { StatusGlyph } from '../ui/StatusGlyph'
import { openSettings } from '../settings/SettingsDialog'
import { ProjectHeader } from './ProjectHeader'
import { SessionRow } from './SessionRow'
import { adjacentSessionId, buildSidebarGroups, visibleSessionIds } from './model'
import './shortcuts-runtime'
import styles from './Sidebar.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

/** Status sidebar — Figma screens 01 / 02 / 08. Pure view over the workspace store. */
export function Sidebar() {
  const { projects, worktrees, sessions, collapsedProjectIds, activeSessionId, setActiveSession, toggleSidebar, toggleProjectCollapsed, overview } =
    useWorkspace(
      useShallow((s) => ({
        projects: s.projects,
        worktrees: s.worktrees,
        sessions: s.sessions,
        collapsedProjectIds: s.collapsedProjectIds,
        activeSessionId: s.activeSessionId,
        setActiveSession: s.setActiveSession,
        toggleSidebar: s.toggleSidebar,
        toggleProjectCollapsed: s.toggleProjectCollapsed,
        overview: s.mainView === 'overview'
      }))
    )
  const listRef = useRef<HTMLDivElement>(null)
  const onRowContextMenu = useCallback((id: string) => void openSessionContextMenu(id), [])

  const groups = useMemo(
    () => buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds }),
    [projects, worktrees, sessions, collapsedProjectIds]
  )
  const ids = useMemo(() => visibleSessionIds(groups), [groups])
  const waiting = useMemo(() => sessions.filter((s) => needsAttention(s.status)).sort(compareByUrgency), [sessions])
  // Roving tabindex: the selected row if it is listed, else the first one.
  const tabStopId = activeSessionId !== null && ids.includes(activeSessionId) ? activeSessionId : (ids[0] ?? null)

  const onListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const focusedId = (e.target as HTMLElement).closest<HTMLElement>('[data-session-id]')?.dataset.sessionId ?? null
      const next = adjacentSessionId(groups, focusedId ?? activeSessionId, e.key === 'ArrowDown' ? 1 : -1)
      if (!next) return
      e.preventDefault()
      setActiveSession(next)
      listRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(next)}"]`)?.focus()
    },
    [groups, activeSessionId, setActiveSession]
  )

  return (
    <>
      <div className={styles.titlebar}>
        {/* Native traffic lights (hiddenInset, x=16 y=16) sit over this gap. */}
        <div className={styles.trafficLights} aria-hidden />
        <IconButton label="隐藏侧栏" onClick={toggleSidebar}>
          <PanelLeft {...ICON} />
        </IconButton>
      </div>
      <nav className={styles.nav} aria-label="导航">
        <NavItem icon={<Folder {...ICON} />} label="打开项目…" shortcut="⌘O" onClick={() => void openProjectInteractive()} />
        <NavItem icon={<Search {...ICON} />} label="跳转到…" shortcut="⌘K" onClick={openCommandPalette} />
        <NavItem
          icon={<LayoutList {...ICON} />}
          label="总览"
          shortcut="⌘⇧A"
          selected={overview}
          title={waiting.length > 0 ? `${waiting.length} 个会话需要你 · ⌘⇧A` : '总览 · ⌘⇧A'}
          badge={
            waiting[0] && (
              <>
                <StatusGlyph status={waiting[0].status} />
                {waiting.length}
              </>
            )
          }
          onClick={toggleOverview}
        />
      </nav>
      <div className={styles.sessions} ref={listRef} onKeyDown={onListKeyDown}>
        {groups.map((group) => (
          <section key={group.id} className={styles.group} aria-label={group.title}>
            <ProjectHeader
              name={group.title}
              count={group.sessionCount}
              collapsed={group.collapsed}
              attention={group.attention}
              onToggle={() => toggleProjectCollapsed(group.id)}
              onNewSession={() => void openNewSessionMenu(group.id)}
              onMenu={() => void openProjectMenu(group.id)}
            />
            {group.rows.map((row) => (
              <SessionRow
                key={row.session.id}
                row={row}
                selected={!overview && row.session.id === activeSessionId}
                tabStop={row.session.id === tabStopId}
                onSelect={setActiveSession}
                onContextMenu={onRowContextMenu}
              />
            ))}
            {!group.collapsed && group.sessionCount === 0 && (
              <button type="button" className={styles.newSession} onClick={() => void openNewSessionMenu(group.id)}>
                <Plus {...ICON} />
                新建会话
              </button>
            )}
          </section>
        ))}
        {groups.length === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>还没有项目</p>
            <p className={styles.emptyText}>打开一个代码仓库或文件夹，就能在里面启动 Claude Code、Codex 或终端。</p>
            <button type="button" className={styles.emptyAction} onClick={() => void openProjectInteractive()}>
              打开项目…
            </button>
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <NavItem icon={<SlidersHorizontal {...ICON} />} label="设置" shortcut="⌘," onClick={openSettings} />
      </div>
    </>
  )
}
