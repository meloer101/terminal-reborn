import { useEffect, useSyncExternalStore } from 'react'
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
import { RIGHT_PANEL_AVAILABLE } from '../panels/availability'
import { EmptyMain } from './EmptyMain'
import { panelMode } from './layout'
import styles from './AppShell.module.css'

const subscribeResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const windowWidth = () => window.innerWidth

/**
 * Window layout (Figma Screens 01–08):
 *   sidebar 264 │ main: header 44 / terminal / composer │ right panel (changes 440 · graph 560)
 * Each region is owned by one feature directory; this file only arranges them.
 * Main never gets narrower than --main-min-width: when docking the panel would squeeze it, the panel floats
 * over main's right edge instead (B13, layout.ts).
 */
export function AppShell() {
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const hasSession = useWorkspace((s) => s.sessions.some((x) => x.id === s.activeSessionId))
  const savedPanel = useWorkspace((s) => s.rightPanel)
  const rightPanel = RIGHT_PANEL_AVAILABLE ? savedPanel : null
  const width = useSyncExternalStore(subscribeResize, windowWidth)
  const mode = rightPanel ? panelMode(width, !sidebarCollapsed, rightPanel) : null
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
          {!hasSession && <EmptyMain />}
        </section>
        <EngineRestartedCard />
        <LifecycleCard />
        <PromptBar />
        <Composer />
      </main>
      {rightPanel && (
        <aside
          className={styles.panel}
          data-region="panel"
          data-mode={mode}
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
