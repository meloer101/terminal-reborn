import { useEffect, useRef, useSyncExternalStore } from 'react'
import { listenForBrowser } from '../panels/browser/store'
import { listenForBackgroundReview } from '../review/background'
import { startPullRequestBridge } from '../pull-requests/store'
import { startConflictRadarBridge } from '../conflict-radar/store'
import { startSessionMetaBridge } from '../session-meta/store'
import { startLimitResumeBridge } from '../limit-resume/bridge'
import { useWorkspace, type PanelView } from '../state/workspace'
import { useIsKeyWindow, usePaneView } from '../state/window-scope'
import { startSecondaryWindows } from './secondary-windows'
import { startActivityReporting } from '../state/activity'
import { EngineRestartedCard } from '../lifecycle/EngineRestartedCard'
import { SessionErrorBar } from '../lifecycle/SessionErrorBar'
import { SetupStrip } from '../scripts/SetupStrip'
import { SessionHeader } from '../session-header/SessionHeader'
import { SessionDragGhost, SplitArea } from '../split/SplitArea'
import { CommandPalette } from '../command-palette/CommandPalette'
import { StatusBridge } from '../status/StatusBridge'
import { AppearanceBridge } from '../appearance/AppearanceBridge'
import { SettingsDialog } from '../settings/SettingsDialog'
import { NewSessionSheet } from '../new-session/NewSessionSheet'
import { MergeSheet } from '../panels/merge/MergeSheet'
import { startPrAutomation } from '../pull-requests/auto-fix'
import { startDispatchBridge } from '../dispatch/bridge'
import { DispatchStrip } from '../dispatch/DispatchStrip'
import { HeldReportsStrip } from '../dispatch/HeldReportsStrip'
import { HeldAttemptReportStrip } from '../attempts/HeldAttemptReportStrip'
import { PlanStrip } from '../attempts/PlanStrip'
import { SameTaskSheet } from '../attempts/SameTaskSheet'
import { startTaskSources } from '../attempts/sources'
import { ArchiveSheet } from '../archive/ArchiveSheet'
import { RightPanel } from '../panels/RightPanel'
import { Overview } from '../overview/Overview'
import { MenuHost } from '../ui/MenuHost'
import { EmptyMain } from './EmptyMain'
import { claimBoot } from './boot'
import './menu-commands'
import { panelMode, panelWidthFor, sidebarWidthFor } from './layout'
import { drawerIsWide, useDrawer } from './drawer-motion'
import { SidebarDrawer } from './SidebarDrawer'
import { useMainFullScreen } from './full-screen'
import styles from './AppShell.module.css'

const subscribeResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const windowWidth = () => window.innerWidth

/**
 * Window layout (Figma Screens 01–08, glass shell Figma 28):
 *   sidebar (264 by default, user-sized) │ main: header 44 / terminal — or the overview │ right panel (F17, 480 by default, user-sized)
 * The whole window is fixed glass — native vibrancy under a per-theme tint (--glass-shell) — and only content sits in
 * opaque cards on it: each pane's terminal, the right panel's body, the overview. Headers and the sidebar are on the
 * glass. The terminal is the whole input and output surface: keys go straight to the PTY, as in any terminal. The
 * terminal area can hold two to four sessions side by side, each with its own header (PRD F20, split/SplitArea).
 * Each region is owned by one feature directory; this file only arranges them.
 * Main never gets narrower than --main-min-width: the panel narrows to fit, and floats over main's right edge only
 * when not even its minimum width fits (B13, layout.ts). The sidebar and the panel open and close as drawers (drawer-motion).
 */
export function AppShell() {
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const fullScreen = useMainFullScreen()
  const overview = useWorkspace((s) => s.mainView === 'overview')
  // The main window's own panes (F20 · 多窗口: the keyboard may be in another window).
  const mainActive = usePaneView().activeSessionId
  const hasSession = useWorkspace((s) => s.sessions.some((x) => x.id === mainActive))
  const isKey = useIsKeyWindow()
  // The panel follows the active session's worktree, so it shows beside a session (not the overview or welcome page).
  const savedPanel = useWorkspace((s) => s.rightPanel)
  const rightPanel = hasSession && !overview ? savedPanel : null
  const savedPanelWidth = useWorkspace((s) => s.rightPanelWidth)
  const width = useSyncExternalStore(subscribeResize, windowWidth)
  const sidebarWidth = sidebarWidthFor(width, useWorkspace((s) => s.sidebarWidth))
  // Also while the panel closes (rightPanel is null by then), so it leaves the way it sat.
  // Narrowed so the session keeps its minimum width; it floats over main only when even its minimum does not fit.
  const panelWidth = panelWidthFor(width, sidebarCollapsed ? 0 : sidebarWidth, savedPanelWidth)
  const mode = panelMode(width, sidebarCollapsed ? 0 : sidebarWidth, panelWidth)
  // Every session id, so a new or removed session resubscribes. The string compares by value.
  const sessionPortKey = useWorkspace((s) => s.sessions.map((session) => session.id).join('\n'))
  const panelRef = useRef<HTMLElement>(null)
  const panel = useDrawer<PanelView>(rightPanel, panelRef)
  // The boot screen (public/boot.js): with a session on screen its dots scatter; the welcome page takes its mark itself.
  const sessionAtStart = useRef(hasSession)
  useEffect(() => {
    if (sessionAtStart.current) void claimBoot('away')
  }, [])
  useEffect(() => startActivityReporting(), [])
  useEffect(() => startSecondaryWindows(), [])
  useEffect(() => listenForBackgroundReview(), [])
  useEffect(() => startSessionMetaBridge(), [])
  useEffect(() => startLimitResumeBridge(), [])
  useEffect(() => startPullRequestBridge(), [])
  useEffect(() => startPrAutomation(), [])
  useEffect(() => startDispatchBridge(), [])
  useEffect(() => startTaskSources(), [])
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
    <div className={styles.shell} data-sidebar={sidebarCollapsed ? 'closed' : 'open'} data-fullscreen={fullScreen}>
      <SidebarDrawer collapsed={sidebarCollapsed} width={sidebarWidth} resizable />
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
            <DispatchStrip />
            <HeldReportsStrip />
            <HeldAttemptReportStrip />
            <PlanStrip />
          </div>
        </main>
        {panel.shown && (
          <aside
            ref={panelRef}
            className={styles.panel}
            data-region="panel"
            data-mode={mode}
            data-phase={panel.phase}
            inert={panel.phase === 'closing'}
            style={{ width: drawerIsWide(panel.phase) ? `calc(${panelWidth}px + var(--card-gap))` : 0 }}
          >
            {/* Full width the whole time: the aside's width reveals it from the right edge as it springs open. */}
            <div className={styles.panelInner} style={{ width: `calc(${panelWidth}px + var(--card-gap))` }}>
              <RightPanel view={panel.shown} />
            </div>
          </aside>
        )}
      </div>
      {/* The palette and the new-session sheet open in the window with the keyboard (F20 · 多窗口). */}
      {isKey && <CommandPalette />}
      <StatusBridge />
      <AppearanceBridge />
      <SettingsDialog />
      {isKey && <NewSessionSheet />}
      {isKey && <SameTaskSheet />}
      <MergeSheet />
      <ArchiveSheet />
      <MenuHost />
      <SessionDragGhost />
    </div>
  )
}
