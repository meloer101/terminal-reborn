// 自动打开 (PRD F17): a port that starts listening in the worktree the main window shows opens in its right panel's
// browser, like Claude's desktop app showing the dev server its agent starts. It follows F14's port scan
// (src/main/browser/ports.ts), not tool calls, so it covers every PTY session: each TUI agent and plain shells. GUI
// sessions (F23) run outside the PTY map and are not scanned yet. The rules are autoOpenStep in @shared/browser;
// this file only subscribes and acts.
import { autoOpenStep, portUrl } from '@shared/browser'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { SessionId } from '@shared/types'
import { MAIN_WINDOW } from '@shared/window-layout'
import { openInBrowser, worktreeOf } from '../../state/link-actions'
import { paneViewOf, useWorkspace } from '../../state/workspace'
import { useBrowser } from './store'

/** The session in the main window: the right panel lives only there (F20 · 多窗口). */
const mainSession = (state: ReturnType<typeof useWorkspace.getState>): SessionId | null => paneViewOf(state, MAIN_WINDOW).activeSessionId

function worktreeOnScreen(): string | undefined {
  const state = useWorkspace.getState()
  const sessionId = mainSession(state)
  return state.mainView === 'session' && sessionId ? worktreeOf(sessionId) : undefined
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

  const runningAtStart = new Set(useWorkspace.getState().sessions.map((s) => s.id))
  /** Per session, the ports that already opened by themselves. */
  const opened = new Map<SessionId, Set<number>>()

  const offPorts = useBrowser.subscribe((state, prev) => {
    if (state.ports === prev.ports) return
    const onScreen = worktreeOnScreen()
    for (const [sessionId, next] of Object.entries(state.ports)) {
      if (prev.ports[sessionId] === next) continue
      const worktree = worktreeOf(sessionId)
      if (!worktree) continue
      const seen = opened.get(sessionId) ?? new Set<number>()
      const step = autoOpenStep({
        prev: prev.ports[sessionId],
        next,
        runningAtStart: runningAtStart.has(sessionId),
        opened: seen,
        onScreen: onScreen === worktree,
        shown: state.pages[worktree]?.url ?? '',
        pending: state.pendingPorts[sessionId]
      })
      if (step.dropPending) setPending(sessionId, null)
      if (!enabled) continue
      for (const port of step.opened) seen.add(port)
      opened.set(sessionId, seen)
      if (!step.port) continue
      if (step.action === 'open') openInBrowser(worktree, portUrl(step.port))
      else if (step.action === 'wait') setPending(sessionId, step.port.port)
      else if (step.action === 'reload') window.tr.browser.reload(worktree)
    }
  })

  const offView = useWorkspace.subscribe((state, prev) => {
    if (mainSession(state) === mainSession(prev) && state.mainView === prev.mainView) return
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
