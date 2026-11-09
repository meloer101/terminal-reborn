// 自动打开 (PRD F17): a port that starts listening in the worktree on screen opens in the right panel's browser,
// like Claude's desktop app showing the dev server its agent starts. Works for every agent: it follows the port
// scan (src/main/browser/ports.ts), not the agent's tool calls.
// - Sessions that were already running when Wavi started: their first report is the baseline, so a restart opens nothing.
// - Each port of a session opens by itself once. When it comes back (a restarted dev server) the page reloads if it
//   still shows that port.
// - A port in a worktree that is not on screen does not switch sessions: its tag is marked, and it opens when the
//   user goes to that worktree.
import { freshPort, portUrl, type ListeningPort } from '@shared/browser'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { SessionId } from '@shared/types'
import { openInBrowser, worktreeOf } from '../../state/link-actions'
import { useWorkspace } from '../../state/workspace'
import { useBrowser } from './store'

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function worktreeOnScreen(): string | undefined {
  const state = useWorkspace.getState()
  return state.mainView === 'session' && state.activeSessionId ? worktreeOf(state.activeSessionId) : undefined
}

function setPending(sessionId: SessionId, port: number | null): void {
  useBrowser.setState((s) => {
    if ((s.pendingPorts[sessionId] ?? null) === port) return s
    const pendingPorts = { ...s.pendingPorts }
    if (port === null) delete pendingPorts[sessionId]
    else pendingPorts[sessionId] = port
    return { pendingPorts }
  })
}

/** Starts watching; returns the stop function. Called once by the main window's AppShell. */
export function startPortAutoOpen(): () => void {
  let enabled = DEFAULT_SETTINGS.ports.autoOpen
  const apply = (on: boolean): void => {
    enabled = on
    if (!on) useBrowser.setState({ pendingPorts: {} })
  }
  void window.tr.settings.get().then((s) => apply(s.ports.autoOpen))
  const offSettings = window.tr.settings.onChange((s) => apply(s.ports.autoOpen))

  // A session started after this point has no ports before its first report.
  const running = new Set(useWorkspace.getState().sessions.map((s) => s.id))
  /** `${sessionId} ${port}` already opened by itself. */
  const opened = new Set<string>()

  const arrive = (sessionId: SessionId, port: ListeningPort): void => {
    const worktree = worktreeOf(sessionId)
    if (!worktree) return
    const url = portUrl(port)
    const key = `${sessionId} ${port.port}`
    if (opened.has(key)) {
      const shown = useBrowser.getState().pages[worktree]?.url ?? ''
      if (sameOrigin(shown, url)) window.tr.browser.reload(worktree)
      return
    }
    opened.add(key)
    if (worktreeOnScreen() === worktree) openInBrowser(worktree, url)
    else setPending(sessionId, port.port)
  }

  const offPorts = useBrowser.subscribe((state, prev) => {
    if (state.ports === prev.ports) return
    for (const [sessionId, ports] of Object.entries(state.ports)) {
      const before = prev.ports[sessionId] ?? (running.has(sessionId) ? undefined : [])
      if (before === ports) continue
      // A waiting port that stopped listening no longer opens.
      const pending = state.pendingPorts[sessionId]
      if (pending !== undefined && !ports.some((p) => p.port === pending)) setPending(sessionId, null)
      const port = freshPort(before, ports)
      if (port && enabled) arrive(sessionId, port)
    }
  })

  const offView = useWorkspace.subscribe((state, prev) => {
    if (state.activeSessionId === prev.activeSessionId && state.mainView === prev.mainView) return
    const worktree = worktreeOnScreen()
    if (!worktree) return
    const { pendingPorts, ports } = useBrowser.getState()
    const waiting = Object.entries(pendingPorts)
      .filter(([sessionId]) => worktreeOf(sessionId) === worktree)
      .sort((a, b) => a[1] - b[1])
    const first = waiting[0]
    if (!first) return
    for (const [sessionId] of waiting) setPending(sessionId, null)
    const [sessionId, port] = first
    const listening = ports[sessionId]?.find((p) => p.port === port)
    if (listening) openInBrowser(worktree, portUrl(listening))
  })

  return () => {
    offSettings()
    offPorts()
    offView()
  }
}
