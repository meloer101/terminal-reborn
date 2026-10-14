import { useCallback, useMemo, useRef, type KeyboardEvent } from 'react'
import { PanelLeft, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../state/workspace'
import { addProjectInteractive, openNewSessionMenu, openSessionContextMenu } from '../state/session-actions'
import { IconButton } from '../ui/IconButton'
import { NavItem } from './NavItem'
import { ProjectHeader } from './ProjectHeader'
import { SessionRow } from './SessionRow'
import { adjacentSessionId, buildSidebarGroups, visibleSessionIds } from './model'
import './shortcuts-runtime'
import styles from './Sidebar.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

/** Status sidebar — Figma screens 01 / 02 / 08. Pure view over the workspace store. */
export function Sidebar() {
  const { projects, worktrees, sessions, activeSessionId, setActiveSession, toggleSidebar } = useWorkspace(
    useShallow((s) => ({
      projects: s.projects,
      worktrees: s.worktrees,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      setActiveSession: s.setActiveSession,
      toggleSidebar: s.toggleSidebar
    }))
  )
  const listRef = useRef<HTMLDivElement>(null)
  const onRowContextMenu = useCallback((id: string) => void openSessionContextMenu(id), [])

  const groups = useMemo(() => buildSidebarGroups({ projects, worktrees, sessions }), [projects, worktrees, sessions])
  const ids = useMemo(() => visibleSessionIds(groups), [groups])
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
        <NavItem icon={<Plus {...ICON} />} label="新任务" shortcut="⌘N" onClick={() => void openNewSessionMenu()} />
        <NavItem icon={<Search {...ICON} />} label="跳转到…" shortcut="⌘K" />
      </nav>
      <div className={styles.sessions} ref={listRef} onKeyDown={onListKeyDown}>
        {groups.map((group) => (
          <section key={group.id} className={styles.group} aria-label={group.title}>
            <ProjectHeader name={group.title} count={group.rows.length} />
            {group.rows.map((row) => (
              <SessionRow
                key={row.session.id}
                row={row}
                selected={row.session.id === activeSessionId}
                tabStop={row.session.id === tabStopId}
                onSelect={setActiveSession}
                onContextMenu={onRowContextMenu}
              />
            ))}
          </section>
        ))}
        {groups.length === 0 && (
          <div className={styles.empty}>
            <p>还没有会话</p>
            <button type="button" className={styles.emptyAction} onClick={() => void addProjectInteractive()}>
              添加项目…
            </button>
          </div>
        )}
      </div>
      <div className={styles.footer}>
        <NavItem icon={<SlidersHorizontal {...ICON} />} label="设置" shortcut="⌘," />
      </div>
    </>
  )
}
