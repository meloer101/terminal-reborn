import { useCallback, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { Folder, Gauge, LayoutList, PanelLeft, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { MAIN_WINDOW, shownIn } from '@shared/window-layout'
import { shownEverywhere, useWorkspace, windowEffects } from '../state/workspace'
import { usePaneView, useSecondaryWindow, useWindowKey } from '../state/window-scope'
import { pressSession } from '../split/drag'
import { newSessionInProject, openProjectInteractive, openProjectMenu, openSessionContextMenu } from '../state/session-actions'
import { IconButton } from '../ui/IconButton'
import type { MenuAnchor } from '../ui/menu'
import { NavItem } from './NavItem'
import { UpdateEntry } from './UpdateEntry'
import { openCommandPalette } from '../command-palette'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { toggleOverview } from '../overview/store'
import { StatusGlyph } from '../ui/StatusGlyph'
import { openSettings } from '../settings/SettingsDialog'
import { ProjectHeader } from './ProjectHeader'
import { SelectionDrops } from './SelectionDrop'
import { SessionRow } from './SessionRow'
import { adjacentSessionId, buildSidebarGroups, visibleSessionIds } from './model'
import './shortcuts-runtime'
import styles from './Sidebar.module.css'
import { formatAccelerator } from '../ui/menu-model'
import { SHORTCUTS } from '@shared/shortcuts'

const ICON = { size: 16, strokeWidth: 1.75 } as const

/**
 * Status sidebar — Figma screens 01 / 02 / 08. Pure view over the workspace store. In a project's own window
 * (F20 · 多窗口) it lists only that project; the row of the session the keyboard is in, in this window, is selected.
 */
export function Sidebar() {
  const windowKey = useWindowKey()
  const scope = useSecondaryWindow()?.projectId ?? null
  const { projects: allProjects, worktrees, sessions, collapsedProjectIds, setActiveSession, toggleSidebar, toggleProjectCollapsed, mainOverview } =
    useWorkspace(
      useShallow((s) => ({
        projects: s.projects,
        worktrees: s.worktrees,
        sessions: s.sessions,
        collapsedProjectIds: s.collapsedProjectIds,
        setActiveSession: s.setActiveSession,
        toggleSidebar: s.toggleSidebar,
        toggleProjectCollapsed: s.toggleProjectCollapsed,
        mainOverview: s.mainView === 'overview'
      }))
    )
  const overview = windowKey === MAIN_WINDOW && mainOverview
  const paneView = usePaneView()
  const activeSessionId = paneView.activeSessionId
  // The sessions this window's panes show: each has a glass block under its row (Figma 37B).
  const inPanes = useMemo(() => (overview ? [] : shownIn(paneView)), [overview, paneView])
  const projects = useMemo(() => (scope === null ? allProjects : allProjects.filter((p) => p.id === scope)), [allProjects, scope])
  // Sessions shown anywhere (PRD F20); those in another window only get the 1px outline, this window's have blocks.
  const shown = useWorkspace((s) => shownEverywhere(s).join('\n'))
  // The overview belongs to the main window: from another window, that one comes forward.
  const onOverview = useCallback(() => {
    if (windowKey !== MAIN_WINDOW) {
      useWorkspace.getState().focusWindow(MAIN_WINDOW)
      windowEffects.reveal(MAIN_WINDOW)
    }
    toggleOverview()
  }, [windowKey])
  const listRef = useRef<HTMLDivElement>(null)
  const onRowContextMenu = useCallback((id: string, anchor: MenuAnchor) => void openSessionContextMenu(id, anchor), [])
  const onRowPress = useCallback((e: PointerEvent<HTMLElement>, id: string) => pressSession(e, id, 'sidebar'), [])

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
        <IconButton label="隐藏侧栏" title={`隐藏侧栏 · ${formatAccelerator(SHORTCUTS['toggle-sidebar'])}`} onClick={toggleSidebar}>
          <PanelLeft {...ICON} />
        </IconButton>
      </div>
      <nav className={styles.nav} aria-label="导航">
        <NavItem icon={<Folder {...ICON} />} label="打开项目…" shortcut={formatAccelerator(SHORTCUTS['open-project'])} onClick={() => void openProjectInteractive()} />
        <NavItem icon={<Search {...ICON} />} label="跳转到…" shortcut={formatAccelerator(SHORTCUTS['command-palette'])} onClick={openCommandPalette} />
        <NavItem
          icon={<LayoutList {...ICON} />}
          label="总览"
          shortcut={formatAccelerator(SHORTCUTS['toggle-overview'])}
          selected={overview}
          title={waiting.length > 0 ? `${waiting.length} 个会话需要你 · ${formatAccelerator(SHORTCUTS['toggle-overview'])}` : `总览 · ${formatAccelerator(SHORTCUTS['toggle-overview'])}`}
          badge={
            waiting[0] && (
              <>
                <StatusGlyph status={waiting[0].status} />
                {waiting.length}
              </>
            )
          }
          onClick={onOverview}
        />
      </nav>
      <div className={styles.sessions} ref={listRef} onKeyDown={onListKeyDown}>
        <SelectionDrops ids={inPanes} />
        {groups.map((group) => (
          <section key={group.id} className={styles.group} aria-label={group.title}>
            <ProjectHeader
              name={group.title}
              count={group.sessionCount}
              collapsed={group.collapsed}
              attention={group.attention}
              onToggle={() => toggleProjectCollapsed(group.id)}
              onNewSession={() => newSessionInProject(group.id)}
              onMenu={(anchor) => void openProjectMenu(group.id, anchor)}
            />
            {group.rows.map((row) => (
              <SessionRow
                key={row.session.id}
                row={row}
                selected={!overview && row.session.id === activeSessionId}
                shown={!overview && !inPanes.includes(row.session.id) && shown.split('\n').includes(row.session.id)}
                onPress={onRowPress}
                tabStop={row.session.id === tabStopId}
                onSelect={setActiveSession}
                onContextMenu={onRowContextMenu}
              />
            ))}
            {!group.collapsed && group.sessionCount === 0 && (
              <button type="button" className={styles.newSession} aria-haspopup="dialog" onClick={() => newSessionInProject(group.id)}>
                <Plus {...ICON} />
                新建会话
              </button>
            )}
          </section>
        ))}
        {groups.length === 0 && (
          <p className={styles.empty}>还没有项目</p>
        )}
      </div>
      <div className={styles.footer}>
        <UpdateEntry />
        <NavItem icon={<Gauge {...ICON} />} label="额度" shortcut={formatAccelerator(SHORTCUTS['open-usage'])} onClick={() => openSettings('usage')} />
        <NavItem icon={<SlidersHorizontal {...ICON} />} label="设置" shortcut={formatAccelerator(SHORTCUTS.settings)} onClick={() => openSettings()} />
      </div>
    </>
  )
}
