import { useEffect } from 'react'
import { useWorkspace } from '../state/workspace'
import { startActivityReporting } from '../state/activity'
import { EngineRestartedCard } from '../lifecycle/EngineRestartedCard'
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
import styles from './AppShell.module.css'

/**
 * Window layout (Figma Screens 01–08):
 *   sidebar 264 │ main: header 44 / terminal / composer │ right panel (changes 440 · graph 560)
 * Each region is owned by one feature directory; this file only arranges them.
 */
export function AppShell() {
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const rightPanel = useWorkspace((s) => s.rightPanel)
  useEffect(() => startActivityReporting(), [])

  return (
    <div className={styles.shell}>
      {!sidebarCollapsed && (
        <aside className={styles.sidebar} data-region="sidebar">
          <Sidebar />
        </aside>
      )}
      <main className={styles.main} data-region="main">
        <SessionHeader />
        <section className={styles.terminal} data-region="terminal">
          <TerminalArea />
        </section>
        <EngineRestartedCard />
        <PromptBar />
        <Composer />
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
