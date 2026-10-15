// Per-session status state, notifications and Dock badge. Plain TypeScript with injected
// dependencies so it can be unit-tested; StatusBridge wires it to the store, window.tr and the DOM.
import type { AgentEvent } from '@shared/agent-events'
import type { AgentMarker } from '@shared/agent-launch'
import { initialState, reduce, type SessionState, type Signal } from '@shared/session-state-machine'
import { needsAttention, STATUS_LABEL } from '@shared/session-status'
import type { AgentPhase, Session, SessionId, SessionStatus } from '@shared/types'

export interface StatusPatch {
  status: SessionStatus
  currentAction: string | undefined
  lastActivityAt: number
  /** Only present for agent sessions that track a phase. */
  phase?: AgentPhase
}

export interface StatusDeps {
  now(): number
  /** Current sessions from the workspace store. */
  sessions(): readonly Session[]
  activeSessionId(): SessionId | null
  /** Whether the app window is focused and visible. */
  windowFocused(): boolean
  patch(id: SessionId, patch: StatusPatch): void
  setActive(id: SessionId): void
  setBadge(count: number): void
  notify(notification: { title: string; body: string; tag: string }): void
  /** Whether the session runs a real agent in its terminal (default: every non-shell session). Only those have a phase. */
  launchesAgent?(session: Session): boolean
  /** The session's visible terminal text (empty before its terminal exists). */
  readScreen?(id: SessionId): string
  /** The agent is up but its hooks never reported (or reported again). */
  setHooksSilent?(id: SessionId, silent: boolean): void
  /** The session was (re)launched: stale launch problems from the previous run no longer apply. */
  onLaunched?(id: SessionId): void
}

/** Statuses that interrupt the user when they are not already looking. */
const NOTIFY_BODY: Partial<Record<SessionStatus, string>> = {
  needs_you: STATUS_LABEL.needs_you,
  error: STATUS_LABEL.error,
  done_unread: STATUS_LABEL.done_unread
}

export class StatusController {
  private readonly states = new Map<SessionId, SessionState>()
  private lastBadge = -1

  constructor(private readonly deps: StatusDeps) {}

  stateOf(id: SessionId): SessionState | undefined {
    return this.states.get(id)
  }

  /** True while some session could change by itself soon (a running turn that may need self-healing). */
  hasRunning(): boolean {
    for (const state of this.states.values()) if (state.status === 'running') return true
    return false
  }

  /** True while some session's screen can change its state (starting up, blocked, waiting on a dialog). */
  watchesScreens(): boolean {
    for (const state of this.states.values()) if (needsScreen(state)) return true
    return false
  }

  /** Reconciles with the store: tracks new sessions, forgets removed ones, refreshes the badge and "viewed". */
  sync(): void {
    const sessions = this.deps.sessions()
    const now = this.deps.now()
    const live = new Set<SessionId>()
    for (const session of sessions) {
      live.add(session.id)
      const known = this.states.get(session.id)
      if (!known) {
        const tracked = this.launchesAgent(session)
        const phase: AgentPhase | undefined = tracked ? (session.phase ?? 'starting') : undefined
        this.states.set(
          session.id,
          initialState(session.kind, now, {
            status: session.status,
            currentAction: session.currentAction,
            lastActivityAt: session.lastActivityAt,
            viewing: false,
            ...(phase ? { phase } : {})
          })
        )
        // A new session carries no phase yet: it is starting now.
        if (phase && session.phase !== phase) this.deps.patch(session.id, { status: session.status, currentAction: session.currentAction, lastActivityAt: session.lastActivityAt, phase })
      } else if (session.phase === 'starting' && (known.phase === 'not-started' || known.phase === 'exited')) {
        // The user (or the host-restart recovery) started the agent: startSession() patched the store's phase.
        this.relaunch(session.id)
      }
    }
    for (const id of [...this.states.keys()]) if (!live.has(id)) this.states.delete(id)
    this.refreshViewing()
    this.updateBadge()
  }

  handleEvent(sessionId: SessionId, event: AgentEvent): void {
    this.apply(sessionId, { type: 'event', event })
  }

  handlePtyExit(sessionId: SessionId, code: number): void {
    this.apply(sessionId, { type: 'pty-exit', code })
  }

  /** The session's process was started again in place (pty-host recovery): forget that it ended. */
  handleRestart(sessionId: SessionId): void {
    const session = this.deps.sessions().find((s) => s.id === sessionId)
    const state = this.states.get(sessionId)
    if (!session || !state) return
    if (state.phase) {
      this.relaunch(sessionId)
      return
    }
    const now = this.deps.now()
    this.states.set(sessionId, initialState(session.kind, now, { status: 'idle', viewing: false }))
    this.deps.patch(sessionId, { status: 'idle', currentAction: undefined, lastActivityAt: now })
    this.refreshViewing()
    this.updateBadge()
  }

  /** The agent process in this session ended (launch script marker) or was never there (CLI missing). */
  handleMarker(sessionId: SessionId, marker: AgentMarker): void {
    this.apply(sessionId, { type: 'agent-marker', marker })
  }

  /** The PTY could not be started (missing directory, spawn error). */
  handleLaunchFailed(sessionId: SessionId): void {
    this.apply(sessionId, { type: 'launch-failed' })
  }

  /** The hook watchdog heard nothing from a launched agent. */
  handleHooksSilent(sessionId: SessionId): void {
    this.apply(sessionId, { type: 'hooks-silent' })
  }

  /** Terminal output arrived for a session: look at its screen again if that can matter. */
  handleOutput(sessionId: SessionId): void {
    const state = this.states.get(sessionId)
    if (state && needsScreen(state)) this.checkScreen(sessionId)
  }

  handleTitle(sessionId: SessionId, title: string): void {
    this.apply(sessionId, { type: 'title', title })
  }

  tick(): void {
    for (const id of [...this.states.keys()]) {
      this.apply(id, { type: 'tick' })
      const state = this.states.get(id)
      if (state && needsScreen(state)) this.checkScreen(id)
    }
  }

  private launchesAgent(session: Session): boolean {
    return this.deps.launchesAgent ? this.deps.launchesAgent(session) : session.kind !== 'shell'
  }

  private checkScreen(id: SessionId): void {
    if (!this.deps.readScreen) return
    this.apply(id, { type: 'screen', text: this.deps.readScreen(id) })
  }

  private relaunch(id: SessionId): void {
    this.apply(id, { type: 'launch' })
    this.deps.onLaunched?.(id)
    this.refreshViewing()
  }

  /** Re-evaluates which session is being looked at (selection, window focus or visibility changed). */
  refreshViewing(): void {
    const active = this.deps.windowFocused() ? this.deps.activeSessionId() : null
    for (const [id, state] of [...this.states]) {
      const viewing = id === active
      if (viewing !== state.viewing) this.apply(id, { type: viewing ? 'viewed' : 'unviewed' })
    }
  }

  /** A system notification was clicked: jump to its session. */
  handleNotificationClick(tag: string): void {
    if (this.states.has(tag)) this.deps.setActive(tag)
  }

  private apply(id: SessionId, signal: Signal): void {
    const prev = this.states.get(id)
    if (!prev) return
    const next = reduce(prev, signal, this.deps.now())
    if (next === prev) return
    this.states.set(id, next)

    if (next.hooksSilent !== prev.hooksSilent) this.deps.setHooksSilent?.(id, next.hooksSilent)

    if (
      next.status !== prev.status ||
      next.currentAction !== prev.currentAction ||
      next.lastActivityAt !== prev.lastActivityAt ||
      next.phase !== prev.phase
    ) {
      this.deps.patch(id, {
        status: next.status,
        currentAction: next.currentAction,
        lastActivityAt: next.lastActivityAt,
        ...(next.phase ? { phase: next.phase } : {})
      })
      if (next.status !== prev.status) this.maybeNotify(id, next)
      this.updateBadge()
    }
  }

  private maybeNotify(id: SessionId, state: SessionState): void {
    const label = NOTIFY_BODY[state.status]
    if (!label) return
    // Never interrupt for the session the user is looking at.
    if (this.deps.windowFocused() && this.deps.activeSessionId() === id) return
    const title = this.deps.sessions().find((s) => s.id === id)?.title ?? ''
    this.deps.notify({ title, body: state.currentAction ? `${label} · ${state.currentAction}` : label, tag: id })
  }

  private updateBadge(): void {
    const count = this.deps.sessions().filter((s) => needsAttention(s.status)).length
    if (count === this.lastBadge) return
    this.lastBadge = count
    this.deps.setBadge(count)
  }
}

/** Whether the session's terminal screen can change its state right now. */
function needsScreen(state: SessionState): boolean {
  if (state.phase === 'starting' || state.phase === 'blocked') return true
  if (state.kind !== 'claude') return false
  if (state.phase === 'ready' && !state.hooksSeen && !state.hooksSilent) return true
  return state.status === 'needs_you' && state.titleIdle
}
