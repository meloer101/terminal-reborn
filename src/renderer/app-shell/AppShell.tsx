import { useEffect, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { listenForBrowser } from '../panels/browser/store'
import { listenForBackgroundReview } from '../review/background'
import { startPullRequestBridge } from '../pull-requests/store'
import { startConflictRadarBridge } from '../conflict-radar/store'
import { startSessionMetaBridge } from '../session-meta/store'
import { startLimitResumeBridge } from '../limit-resume/bridge'
import { useWorkspace } from '../state/workspace'
import { useIsKeyWindow, usePaneView } from '../state/window-scope'
import { startSecondaryWindows } from './secondary-windows'
import { startActivityReporting } from '../state/activity'
import { EngineRestartedCard } from '../lifecycle/EngineRestartedCard'
import { SessionErrorBar } from '../lifecycle/SessionErrorBar'
import { SetupStrip } from '../scripts/SetupStrip'
import { Sidebar } from '../sidebar/Sidebar'
import { SessionHeader } from '../session-header/SessionHeader'
import { SessionDragGhost, SplitArea } from '../split/SplitArea'
import { CommandPalette } from '../command-palette/CommandPalette'
import { StatusBridge } from '../status/StatusBridge'
import { AppearanceBridge } from '../appearance/AppearanceBridge'
import { SettingsDialog } from '../settings/SettingsDialog'
import { NewSessionSheet } from '../new-session/NewSessionSheet'
import { MergeSheet } from '../panels/merge/MergeSheet'
import { CreatePrSheet } from '../pull-requests/CreatePrSheet'
import { startPrAutomation } from '../pull-requests/auto-fix'
import { ArchiveSheet } from '../archive/ArchiveSheet'
import { RightPanel } from '../panels/RightPanel'
import { Overview } from '../overview/Overview'
import { MenuHost } from '../ui/MenuHost'
import { EmptyMain } from './EmptyMain'
import './menu-commands'
import { SIDEBAR_WIDTH_DEFAULT } from '@shared/workspace-file'
import { startColumnResize } from '../ui/column-resize'
import { panelMode, sidebarWidthFor } from './layout'
import styles from './AppShell.module.css'

const subscribeResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const windowWidth = () => window.innerWidth

/**
 * Window layout (Figma Screens 01–08):
 *   sidebar (264 by default, user-sized) │ main: header 44 / terminal — or the overview │ right panel card (F17, 480 by default, user-sized)
 * The terminal is the whole input and output surface: keys go straight to the PTY, as in any terminal. The terminal
 * area can hold two to four sessions side by side, each with its own header (PRD F20, split/SplitArea).
 * Each region is owned by one feature directory; this file only arranges them.
 * Main never gets narrower than --main-min-width: when docking the panel would squeeze it, the panel floats
 * over main's right edge instead (B13, layout.ts). Main and the panel share one surface (rounded where it meets the
 * sidebar), so the card always floats on the terminal's colour, never on the window or the sidebar's vibrancy.
 */
export function AppShell() {
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const overview = useWorkspace((s) => s.mainView === 'overview')
  // The main window's own panes (F20 · 多窗口: the keyboard may be in another window).
  const mainActive = usePaneView().activeSessionId
  const hasSession = useWorkspace((s) => s.sessions.some((x) => x.id === mainActive))
  const isKey = useIsKeyWindow()
  // The panel follows the active session's worktree, so it shows beside a session (not the overview or welcome page).
  const savedPanel = useWorkspace((s) => s.rightPanel)
  const rightPanel = hasSession && !overview ? savedPanel : null
  const panelWidth = useWorkspace((s) => s.rightPanelWidth)
  const width = useSyncExternalStore(subscribeResize, windowWidth)
  const sidebarWidth = sidebarWidthFor(width, useWorkspace((s) => s.sidebarWidth))
  const mode = rightPanel ? panelMode(width, sidebarCollapsed ? 0 : sidebarWidth, panelWidth) : null
  // Every session id, so a new or removed session resubscribes. The string compares by value.
  const sessionPortKey = useWorkspace((s) => s.sessions.map((session) => session.id).join('\n'))
  useEffect(() => startActivityReporting(), [])
  useEffect(() => startSecondaryWindows(), [])
  useEffect(() => listenForBackgroundReview(), [])
  useEffect(() => startSessionMetaBridge(), [])
  useEffect(() => startLimitResumeBridge(), [])
  useEffect(() => startPullRequestBridge(), [])
  useEffect(() => startPrAutomation(), [])
  useEffect(() => startConflictRadarBridge(), [])
  // The scan runs for every live PTY. Subscribing here pushes the latest list to the sidebar and the overview,
  // including after a reload when nothing changed — the browser tab is just another watcher, not the scan itself.
  useEffect(() => {
    listenForBrowser()
    const ids = sessionPortKey.length === 0 ? [] : sessionPortKey.split('\n')
    for (const id of ids) window.tr.browser.watchPorts(id)
    return () => {
      for (const id of ids) window.tr.browser.unwatchPorts(id)
    }
  }, [sessionPortKey])

  return (
    <div className={styles.shell}>
      {!sidebarCollapsed && (
        <aside className={styles.sidebar} data-region="sidebar" style={{ width: `${sidebarWidth}px` }}>
          <Sidebar />
          <SidebarResizeHandle width={sidebarWidth} />
        </aside>
      )}
      <div className={styles.surface}>
        <main className={styles.main} data-region="main">
          {/* The overview (PRD F9) takes the main area; the terminals stay mounted (hidden) behind it. The panes have
              their own headers (F20); the welcome page keeps the bare one (drag region, sidebar button). */}
          {overview ? <Overview /> : !hasSession && <SessionHeader />}
          <section className={styles.terminal} data-region="split" data-hidden={overview}>
            <SplitArea />
            {!hasSession && <EmptyMain />}
          </section>
          <div className={styles.sessionOnly} data-hidden={overview}>
            <EngineRestartedCard />
            <SessionErrorBar />
            <SetupStrip />
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
      </div>
      {/* The palette and the new-session sheet open in the window with the keyboard (F20 · 多窗口). */}
      {isKey && <CommandPalette />}
      <StatusBridge />
      <AppearanceBridge />
      <SettingsDialog />
      {isKey && <NewSessionSheet />}
      <MergeSheet />
      <CreatePrSheet />
      <ArchiveSheet />
      <MenuHost />
      <SessionDragGhost />
    </div>
  )
}

/** The sidebar's right edge (where main's rounded corner starts): drag to resize (200–480, saved), double-click for 264. */
function SidebarResizeHandle({ width }: { width: number }) {
  const setWidth = useWorkspace((s) => s.setSidebarWidth)
  // Starts from the width as shown, which can be narrower than the saved one in a small window (layout.ts).
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => startColumnResize(e, 'right', width, setWidth)
  return (
    <div
      className={styles.sidebarResize}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(SIDEBAR_WIDTH_DEFAULT)}
    />
  )
}
