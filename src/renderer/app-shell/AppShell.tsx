import { useEffect, useSyncExternalStore } from 'react'
import { useWorkspace } from '../state/workspace'
import { startActivityReporting } from '../state/activity'
import { EngineRestartedCard } from '../lifecycle/EngineRestartedCard'
import { SessionErrorBar } from '../lifecycle/SessionErrorBar'
import { Sidebar } from '../sidebar/Sidebar'
import { SessionHeader } from '../session-header/SessionHeader'
import { TerminalArea } from '../terminal/TerminalArea'
import { CommandPalette } from '../command-palette/CommandPalette'
import { StatusBridge } from '../status/StatusBridge'
import { AppearanceBridge } from '../appearance/AppearanceBridge'
import { SettingsDialog } from '../settings/SettingsDialog'
import { RightPanel } from '../panels/RightPanel'
import { Overview } from '../overview/Overview'
import { MenuHost } from '../ui/MenuHost'
import { EmptyMain } from './EmptyMain'
import './menu-commands'
import { panelMode } from './layout'
import styles from './AppShell.module.css'

const subscribeResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const windowWidth = () => window.innerWidth

/**
 * Window layout (Figma Screens 01–08):
 *   sidebar 264 │ main: header 44 / terminal — or the overview │ right panel card (F17, 480 by default, user-sized)
 * The terminal is the whole input and output surface: keys go straight to the PTY, as in any terminal.
 * Each region is owned by one feature directory; this file only arranges them.
 * Main never gets narrower than --main-min-width: when docking the panel would squeeze it, the panel floats
 * over main's right edge instead (B13, layout.ts).
 */
export function AppShell() {
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const overview = useWorkspace((s) => s.mainView === 'overview')
  const hasSession = useWorkspace((s) => s.sessions.some((x) => x.id === s.activeSessionId))
  // The panel follows the active session's worktree, so it shows beside a session (not the overview or welcome page).
  const savedPanel = useWorkspace((s) => s.rightPanel)
  const rightPanel = hasSession && !overview ? savedPanel : null
  const panelWidth = useWorkspace((s) => s.rightPanelWidth)
  const width = useSyncExternalStore(subscribeResize, windowWidth)
  const mode = rightPanel ? panelMode(width, !sidebarCollapsed, panelWidth) : null
  useEffect(() => startActivityReporting(), [])

  return (
    <div className={styles.shell}>
      {!sidebarCollapsed && (
        <aside className={styles.sidebar} data-region="sidebar">
          <Sidebar />
        </aside>
      )}
      <main className={styles.main} data-region="main">
        {/* The overview (PRD F9) takes the main area; the terminals stay mounted (hidden) behind it. */}
        {overview ? <Overview /> : <SessionHeader />}
        <section className={styles.terminal} data-region="terminal" data-hidden={overview}>
          <TerminalArea />
          {!hasSession && <EmptyMain />}
        </section>
        <div className={styles.sessionOnly} data-hidden={overview}>
          <EngineRestartedCard />
          <SessionErrorBar />
        </div>
      </main>
      {rightPanel && (
        <aside
          className={styles.panel}
          data-region="panel"
          data-mode={mode}
          style={{ width: `calc(${panelWidth}px + var(--panel-inset))` }}
        >
          <RightPanel view={rightPanel} />
        </aside>
      )}
      <CommandPalette />
      <StatusBridge />
      <AppearanceBridge />
      <SettingsDialog />
      <MenuHost />
    </div>
  )
}
