// Wires the StatusController to the real world: the workspace store, window.tr signals,
// terminal titles, window focus and one shared timer.
import { confirmLabels } from '@shared/dispatch'
import { PROGRAM_STATUS_REPLY, ProgramStatusScanner } from '@shared/program-status'
import type { SessionId } from '@shared/types'
import { applySessionHooksSignal, resetHooksHealth, setHooksSilent, startHooksHealthTracking } from '../lifecycle/hooks-health'
import { clearLaunchIssue, onAgentMarker, useLaunchIssues } from '../lifecycle/launch-issues'
import { getSurface, onTerminalRestarted, readViewport } from '../terminal/registry'
import type { TerminalSurface } from '../terminal/surface'
import { launchKind, shownSessionIds, useWorkspace } from '../state/workspace'
import { anyWindowFocused, everyWindow } from '../app-shell/windows-runtime'
import { titleFromAgent, titleFromFirstPrompt } from '../state/workspace-model'
import { StatusController, type StatusDeps } from './controller'
import { createE2eHook, type E2eHook } from './e2e-hook'
import { settleConfirm, useDispatch, type PendingStart } from '../dispatch/store'

const FAST_TICK_MS = 1_000
const SLOW_TICK_MS = 15_000
/** Output is parsed asynchronously: look at the screen a moment after it arrives. */
const SCREEN_CHECK_MS = 200

const e2e = (globalThis as { __TR_E2E__?: boolean }).__TR_E2E__ === true

/** Whether one of the app's windows is in front (F20 · 多窗口: the key window's panes are the ones being looked at). */
function windowFocused(): boolean {
  return anyWindowFocused()
}

/** Starts listening; returns a function that stops everything. */
export function startStatusBridge(): () => void {
  const hook: E2eHook | null = e2e ? createE2eHook() : null
  const ui = window.tr.ui

  const deps: StatusDeps = {
    now: () => hook?.now() ?? Date.now(),
    sessions: () => useWorkspace.getState().sessions,
    activeSessionId: () => useWorkspace.getState().activeSessionId,
    shownSessionIds: () => shownSessionIds(useWorkspace.getState()),
    windowFocused: () => hook?.focused() ?? windowFocused(),
    patch: (id, patch) => useWorkspace.getState().patchSession(id, patch),
    launchesAgent: (session) => launchKind(session) !== 'shell',
    readScreen: (id) => readViewport(id),
    setHooksSilent: (id, silent) => setHooksSilent(id, silent),
    onLaunched: (id) => {
      clearLaunchIssue(id)
      resetHooksHealth(id)
    },
    setActive: (id) => useWorkspace.getState().setActiveSession(id),
    projectName: (id) => {
      const { sessions, worktrees, projects } = useWorkspace.getState()
      const worktree = worktrees.find((w) => w.id === sessions.find((s) => s.id === id)?.worktreeId)
      return projects.find((p) => p.id === worktree?.projectId)?.name
    },
    openOverview: () => useWorkspace.getState().setMainView('overview'),
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
  const controller = new StatusController({
    ...deps,
    needsFastTicks: () => hurry(),
    // PRD F21: the dispatcher's agent is gone, so its requests to start sessions are answered no.
    onWaviAskAbandoned: (id) => {
      for (const c of useDispatch.getState().confirms) if (c.parentId === id) settleConfirm(c.callId, false)
    }
  })

  const exitSubscriptions = new Map<SessionId, () => void>()
  const titleSubscriptions = new Map<SessionId, { surface: TerminalSurface; dispose(): void }>()
  /** Debounced "look at the screen" after output, for sessions whose state the screen can change. */
  const outputSubscriptions = new Map<SessionId, { unsubscribe(): void; timer: ReturnType<typeof setTimeout> | null }>()

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
        if (!outputSubscriptions.has(session.id)) {
          // OSC 7501 (the CLIs beyond Claude and Codex, which have hooks): answer the query at once — before the
          // terminal's own DA1 reply, which xterm writes only once it parses the chunk — and feed the reports.
          const programStatus = session.kind === 'claude' || session.kind === 'codex' ? null : new ProgramStatusScanner()
          const sessionId = session.id
          const entry: { unsubscribe(): void; timer: ReturnType<typeof setTimeout> | null } = {
            timer: null,
            unsubscribe: window.tr.pty.onData(session.id, (data) => {
              if (programStatus) {
                for (const found of programStatus.feed(data)) {
                  if (found.type === 'query') window.tr.pty.write(sessionId, PROGRAM_STATUS_REPLY)
                  else controller.handleProgramStatus(sessionId, found.status)
                }
              }
              entry.timer ??= setTimeout(() => {
                entry.timer = null
                controller.handleOutput(session.id)
              }, SCREEN_CHECK_MS)
            })
          }
          outputSubscriptions.set(session.id, entry)
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
    for (const [id, entry] of [...outputSubscriptions]) {
      if (!live.has(id)) {
        entry.unsubscribe()
        if (entry.timer !== null) clearTimeout(entry.timer)
        outputSubscriptions.delete(id)
      }
    }
  }

  /** Fast while a turn is running or a terminal's title is not hooked up yet; otherwise relaxed. */
  function tickInterval(): number {
    if (controller.hasRunning() || controller.watchesScreens()) return FAST_TICK_MS
    const missingTitle = useWorkspace.getState().sessions.some((s) => s.kind !== 'shell' && !titleSubscriptions.has(s.id))
    return missingTitle ? FAST_TICK_MS : SLOW_TICK_MS
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let due = 0
  function schedule(ms = tickInterval()): void {
    due = Date.now() + ms
    timer = setTimeout(() => {
      reconcileSources()
      controller.tick()
      schedule()
    }, ms)
  }
  /** A session started running or waiting on a dialog: self-heal is on the 1 s tick from now, not after a 15 s one. */
  function hurry(): void {
    if (due - Date.now() <= FAST_TICK_MS) return
    clearTimeout(timer)
    schedule(FAST_TICK_MS)
  }

  const sync = (): void => {
    reconcileSources()
    controller.sync()
  }
  sync()
  schedule()

  const unsubscribeStore = useWorkspace.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions || state.activeSessionId !== prev.activeSessionId || state.split !== prev.split) sync()
  })
  // A plain terminal's hand-started agent reports metrics only (session-meta); its status stays a terminal's.
  const isShell = (sessionId: string) => useWorkspace.getState().sessions.find((s) => s.id === sessionId)?.kind === 'shell'
  const unsubscribeEvents = window.tr.agent.onEvent((envelope) => {
    const { sessionId, event } = envelope
    if (isShell(sessionId)) return
    if (event.type === 'agent-title') {
      // A name, not activity: it never touches status.
      const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
      const patch = session && titleFromAgent(session, event.title)
      if (patch) useWorkspace.getState().patchSession(sessionId, patch)
      return
    }
    // Metrics (session-meta/bridge.ts keeps them): the statusLine runs while idle too, so they say nothing about status.
    if (event.type === 'context' || event.type === 'todos' || event.type === 'checks' || event.type === 'agent-exit' || event.type === 'billing') return
    if (event.type === 'prompt-submit') {
      const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
      const title = session && titleFromFirstPrompt(session, event.prompt)
      if (title) useWorkspace.getState().patchSession(sessionId, { title, titleSource: 'prompt' })
    }
    controller.handleEvent(sessionId, event)
  })
  // "Needs you" comes with the events: PermissionRequest is a `permission-request` (it names the call, so two dialogs
  // up at once are two asks) and AskUserQuestion its `tool-start`; Notification(permission_prompt) lags ~6 s (PRD §6.6).
  const unsubscribeRestart = onTerminalRestarted((sessionId) => controller.handleRestart(sessionId))
  // Main's per-session hook signals: launched without hooks (chip), or silent after launch (maybe a dialog).
  const unsubscribeSessionHooks = window.tr.agent.onSessionHooks((signal) => {
    applySessionHooksSignal(signal)
    if (signal.kind === 'start-timeout') controller.handleHooksSilent(signal.sessionId)
  })
  const stopHooksHealth = startHooksHealthTracking()
  // A terminal that could not start (missing directory, spawn error) leaves the session exited.
  const unsubscribeIssues = useLaunchIssues.subscribe((state, prev) => {
    for (const [id, issue] of Object.entries(state.issues)) {
      if (issue === prev.issues[id] || !issue) continue
      if (issue.kind === 'cwd-missing' || issue.kind === 'spawn-failed') controller.handleLaunchFailed(id)
    }
  })
  // The agent's end / a missing CLI, reported by the terminal as soon as it sees the launch script's marker.
  const unsubscribeMarkers = onAgentMarker((id, marker) => controller.handleMarker(id, marker))
  const unsubscribeClick = ui.onNotificationClick((tag) => controller.handleNotificationClick(tag))

  // PRD F21: while an agent's request to start sessions waits for 开始, its session is the user's to answer.
  const applyConfirms = (confirms: readonly PendingStart[], prev: readonly PendingStart[]): void => {
    const labels = confirmLabels(confirms.map((c) => ({ parentId: c.parentId, count: c.plans.length })))
    for (const id of new Set([...prev.map((c) => c.parentId), ...labels.keys()])) controller.setWaviAsk(id, labels.get(id) ?? null)
  }
  applyConfirms(useDispatch.getState().confirms, [])
  const unsubscribeConfirms = useDispatch.subscribe((state, prev) => {
    if (state.confirms !== prev.confirms) applyConfirms(state.confirms, prev.confirms)
  })

  const onViewChange = (): void => controller.refreshViewing()
  const stopViewWatch = everyWindow((win) => {
    win.addEventListener('focus', onViewChange)
    win.addEventListener('blur', onViewChange)
    win.document.addEventListener('visibilitychange', onViewChange)
    return () => {
      win.removeEventListener('focus', onViewChange)
      win.removeEventListener('blur', onViewChange)
      win.document.removeEventListener('visibilitychange', onViewChange)
    }
  })

  hook?.attach({
    emit: (sessionId, event) => controller.handleEvent(sessionId, event),
    ptyExit: (sessionId, code) => controller.handlePtyExit(sessionId, code),
    title: (sessionId, title) => controller.handleTitle(sessionId, title),
    tick: () => controller.tick(),
    refreshViewing: () => controller.refreshViewing(),
    stateOf: (sessionId) => controller.stateOf(sessionId)
  })

  return () => {
    unsubscribeSessionHooks()
    stopHooksHealth()
    unsubscribeIssues()
    unsubscribeMarkers()
    unsubscribeConfirms()
    clearTimeout(timer)
    unsubscribeStore()
    unsubscribeEvents()
    unsubscribeClick()
    unsubscribeRestart()
    stopViewWatch()
    for (const unsubscribe of exitSubscriptions.values()) unsubscribe()
    for (const subscription of titleSubscriptions.values()) subscription.dispose()
    for (const entry of outputSubscriptions.values()) {
      entry.unsubscribe()
      if (entry.timer !== null) clearTimeout(entry.timer)
    }
    hook?.detach()
  }
}
