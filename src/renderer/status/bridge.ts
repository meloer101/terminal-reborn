// Wires the StatusController to the real world: the workspace store, window.tr signals,
// terminal titles, window focus and one shared timer.
import type { SessionId } from '@shared/types'
import { getSurface } from '../terminal/registry'
import type { TerminalSurface } from '../terminal/surface'
import { useWorkspace } from '../state/workspace'
import { StatusController, type StatusDeps } from './controller'
import { createE2eHook, type E2eHook } from './e2e-hook'

const FAST_TICK_MS = 1_000
const SLOW_TICK_MS = 15_000

const e2e = (globalThis as { __TR_E2E__?: boolean }).__TR_E2E__ === true

function windowFocused(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus()
}

/** Starts listening; returns a function that stops everything. */
export function startStatusBridge(): () => void {
  const hook: E2eHook | null = e2e ? createE2eHook() : null
  const ui = window.tr.ui

  const deps: StatusDeps = {
    now: () => hook?.now() ?? Date.now(),
    sessions: () => useWorkspace.getState().sessions,
    activeSessionId: () => useWorkspace.getState().activeSessionId,
    windowFocused: () => hook?.focused() ?? windowFocused(),
    patch: (id, patch) => useWorkspace.getState().patchSession(id, patch),
    setActive: (id) => useWorkspace.getState().setActiveSession(id),
    setBadge: (count) => {
      hook?.record('badge', count)
      ui.setBadge(count)
    },
    notify: (notification) => {
      // Tests observe notifications instead of popping real ones on the developer's desktop.
      if (hook) hook.record('notification', notification)
      else ui.notify(notification)
    }
  }
  const controller = new StatusController(deps)

  const exitSubscriptions = new Map<SessionId, () => void>()
  const titleSubscriptions = new Map<SessionId, { surface: TerminalSurface; dispose(): void }>()

  /** Subscribes per-session sources for new sessions and drops them for closed ones. */
  function reconcileSources(): void {
    const sessions = useWorkspace.getState().sessions
    const live = new Set(sessions.map((s) => s.id))
    for (const session of sessions) {
      if (!exitSubscriptions.has(session.id)) {
        exitSubscriptions.set(
          session.id,
          window.tr.pty.onExit(session.id, ({ exitCode }) => controller.handlePtyExit(session.id, exitCode))
        )
      }
      // The terminal (and its title source) appears when the session is first viewed, and again if it is recreated.
      if (session.kind !== 'shell') {
        const surface = getSurface(session.id)
        const attached = titleSubscriptions.get(session.id)
        if (surface && attached?.surface !== surface) {
          attached?.dispose()
          const subscription = surface.onTitleChange((title) => controller.handleTitle(session.id, title))
          titleSubscriptions.set(session.id, { surface, dispose: () => subscription.dispose() })
        }
      }
    }
    for (const [id, unsubscribe] of [...exitSubscriptions]) {
      if (!live.has(id)) {
        unsubscribe()
        exitSubscriptions.delete(id)
      }
    }
    for (const [id, subscription] of [...titleSubscriptions]) {
      if (!live.has(id)) {
        subscription.dispose()
        titleSubscriptions.delete(id)
      }
    }
  }

  /** Fast while a turn is running or a terminal's title is not hooked up yet; otherwise relaxed. */
  function tickInterval(): number {
    if (controller.hasRunning()) return FAST_TICK_MS
    const missingTitle = useWorkspace.getState().sessions.some((s) => s.kind !== 'shell' && !titleSubscriptions.has(s.id))
    return missingTitle ? FAST_TICK_MS : SLOW_TICK_MS
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  function schedule(): void {
    timer = setTimeout(() => {
      reconcileSources()
      controller.tick()
      schedule()
    }, tickInterval())
  }

  const sync = (): void => {
    reconcileSources()
    controller.sync()
  }
  sync()
  schedule()

  const unsubscribeStore = useWorkspace.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions || state.activeSessionId !== prev.activeSessionId) sync()
  })
  const unsubscribeEvents = window.tr.agent.onEvent((envelope) => controller.handleEvent(envelope.sessionId, envelope.event))
  const unsubscribeClick = ui.onNotificationClick((tag) => controller.handleNotificationClick(tag))

  const onViewChange = (): void => controller.refreshViewing()
  window.addEventListener('focus', onViewChange)
  window.addEventListener('blur', onViewChange)
  document.addEventListener('visibilitychange', onViewChange)

  hook?.attach({
    emit: (sessionId, event) => controller.handleEvent(sessionId, event),
    ptyExit: (sessionId, code) => controller.handlePtyExit(sessionId, code),
    title: (sessionId, title) => controller.handleTitle(sessionId, title),
    tick: () => controller.tick(),
    refreshViewing: () => controller.refreshViewing(),
    stateOf: (sessionId) => controller.stateOf(sessionId)
  })

  return () => {
    clearTimeout(timer)
    unsubscribeStore()
    unsubscribeEvents()
    unsubscribeClick()
    window.removeEventListener('focus', onViewChange)
    window.removeEventListener('blur', onViewChange)
    document.removeEventListener('visibilitychange', onViewChange)
    for (const unsubscribe of exitSubscriptions.values()) unsubscribe()
    for (const subscription of titleSubscriptions.values()) subscription.dispose()
    hook?.detach()
  }
}
