import { useEffect } from 'react'
import { useWorkspace } from '../state/workspace'
import { startActivityReporting } from '../state/activity'
import { EngineRestartedCard } from '../lifecycle/EngineRestartedCard'
import { LifecycleCard } from '../lifecycle/LifecycleCard'
import { Sidebar } from '../sidebar/Sidebar'
import { SessionHeader } from '../session-header/SessionHeader'
import { TerminalArea } from '../terminal/TerminalArea'
import { Composer } from '../composer/Composer'
import { PromptBar } from '../prompt-bar/PromptBar'
import { CommandPalette } from '../command-palette/CommandPalette'
import { StatusBridge } from '../status/StatusBridge'
import { AppearanceBridge } from '../appearance/AppearanceBridge'
import { SettingsDialog } from '../settings/SettingsDialog'
import { RightPanel } from '../panels/RightPanel'
import { Overview } from '../overview/Overview'
import styles from './AppShell.module.css'

/**
 * Window layout (Figma Screens 01–08):
 *   sidebar 264 │ main: header 44 / terminal / composer — or the overview │ right panel (changes 440 · graph 560)
 * Each region is owned by one feature directory; this file only arranges them.
 */
export function AppShell() {
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const rightPanel = useWorkspace((s) => s.rightPanel)
  const overview = useWorkspace((s) => s.mainView === 'overview')
  useEffect(() => startActivityReporting(), [])

  return (
    <div className={styles.shell}>
      {!sidebarCollapsed && (
        <aside className={styles.sidebar} data-region="sidebar">
          <Sidebar />
        </aside>
      )}
      <main className={styles.main} data-region="main">
        {/* The overview (PRD F9) takes the main area; terminals and the composer stay mounted behind it. */}
        {overview ? <Overview /> : <SessionHeader />}
        <section className={styles.terminal} data-region="terminal" data-hidden={overview}>
          <TerminalArea />
        </section>
        <div className={styles.sessionOnly} data-hidden={overview}>
          <EngineRestartedCard />
          <LifecycleCard />
          <PromptBar />
          <Composer />
        </div>
      </main>
      {rightPanel && (
        <aside
          className={styles.panel}
          data-region="panel"
          style={{ width: rightPanel === 'graph' ? 'var(--panel-width-graph)' : 'var(--panel-width-changes)' }}
        >
          <RightPanel tab={rightPanel} />
        </aside>
      )}
      <CommandPalette />
      <StatusBridge />
      <AppearanceBridge />
      <SettingsDialog />
    </div>
  )
}
