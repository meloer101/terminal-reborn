// A secondary window (PRD F20 · 多窗口): a pane dragged out of a window, or a project opened in a window of its own.
// The same layout as the main window — sidebar (only the window's project) │ terminal area with its own split — without
// the right panel and the overview, which stay in the main window. Drawn by the main window's renderer
// (secondary-windows.tsx), so the sessions, their status and their terminals are the very same ones.
import { useEffect } from 'react'
import { useWorkspace } from '../state/workspace'
import { useIsKeyWindow, usePaneView, useSecondaryWindow, useSidebarCollapsed, useWindowScope } from '../state/window-scope'
import { SessionErrorBar } from '../lifecycle/SessionErrorBar'
import { SetupStrip } from '../scripts/SetupStrip'
import { Sidebar } from '../sidebar/Sidebar'
import { SessionHeader } from '../session-header/SessionHeader'
import { SessionDragGhost, SplitArea } from '../split/SplitArea'
import { CommandPalette } from '../command-palette/CommandPalette'
import { NewSessionSheet } from '../new-session/NewSessionSheet'
import { PlanStrip } from '../attempts/PlanStrip'
import { SameTaskSheet } from '../attempts/SameTaskSheet'
import { MenuHost } from '../ui/MenuHost'
import { sidebarWidthFor } from './layout'
import styles from './AppShell.module.css'
import empty from './SecondaryShell.module.css'

export function SecondaryShell() {
  const { win } = useWindowScope()
  const record = useSecondaryWindow()
  const collapsed = useSidebarCollapsed()
  const isKey = useIsKeyWindow()
  const view = usePaneView()
  const hasSession = useWorkspace((s) => view.activeSessionId !== null && s.sessions.some((x) => x.id === view.activeSessionId))
  const project = useWorkspace((s) => (record?.projectId ? s.projects.find((p) => p.id === record.projectId) : undefined))
  const sidebarWidth = sidebarWidthFor(win.innerWidth, useWorkspace((s) => s.sidebarWidth))

  // A window that just opened has the keyboard: its terminal takes it once it is there.
  useEffect(() => {
    win.focus()
  }, [win])

  return (
    <div className={styles.shell}>
      {!collapsed && (
        <aside className={styles.sidebar} data-region="sidebar" style={{ width: `${sidebarWidth}px` }}>
          <Sidebar />
        </aside>
      )}
      <div className={styles.surface}>
        <main className={styles.main} data-region="main">
          {!hasSession && <SessionHeader />}
          <section className={styles.terminal} data-region="split">
            <SplitArea />
            {!hasSession && (
              <div className={empty.empty}>
                <p className={empty.title}>{project ? `${project.name} 没有在这里显示的会话` : '这个窗口没有在显示的会话'}</p>
                <p className={empty.hint}>从侧栏选一个会话，或按 ⌘N 新建。关掉这个窗口，会话照常运行。</p>
              </div>
            )}
          </section>
          <SessionErrorBar />
          <SetupStrip />
          <PlanStrip />
        </main>
      </div>
      {/* Sheets and the palette open in the window with the keyboard. */}
      {isKey && <CommandPalette />}
      {isKey && <NewSessionSheet />}
      {isKey && <SameTaskSheet />}
      <MenuHost />
      <SessionDragGhost />
    </div>
  )
}
