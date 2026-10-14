// Per-session status state, notifications and Dock badge. Plain TypeScript with injected
// dependencies so it can be unit-tested; StatusBridge wires it to the store, window.tr and the DOM.
import type { AgentEvent } from '@shared/agent-events'
import { initialState, reduce, type SessionState, type Signal } from '@shared/session-state-machine'
import { needsAttention, STATUS_LABEL } from '@shared/session-status'
import type { Session, SessionId, SessionStatus } from '@shared/types'

export interface StatusPatch {
  status: SessionStatus
  currentAction: string | undefined
  lastActivityAt: number
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

  /** Reconciles with the store: tracks new sessions, forgets removed ones, refreshes the badge and "viewed". */
  sync(): void {
    const sessions = this.deps.sessions()
    const now = this.deps.now()
    const live = new Set<SessionId>()
    for (const session of sessions) {
      live.add(session.id)
      if (!this.states.has(session.id)) {
        this.states.set(
          session.id,
          initialState(session.kind, now, {
            status: session.status,
            currentAction: session.currentAction,
            lastActivityAt: session.lastActivityAt,
            viewing: false
          })
        )
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
    if (!session || !this.states.has(sessionId)) return
    const now = this.deps.now()
    this.states.set(sessionId, initialState(session.kind, now, { status: 'idle', viewing: false }))
    this.deps.patch(sessionId, { status: 'idle', currentAction: undefined, lastActivityAt: now })
    this.refreshViewing()
    this.updateBadge()
  }

  handleTitle(sessionId: SessionId, title: string): void {
    this.apply(sessionId, { type: 'title', title })
  }

  tick(): void {
    for (const id of [...this.states.keys()]) this.apply(id, { type: 'tick' })
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

    if (
      next.status !== prev.status ||
      next.currentAction !== prev.currentAction ||
      next.lastActivityAt !== prev.lastActivityAt
    ) {
      this.deps.patch(id, { status: next.status, currentAction: next.currentAction, lastActivityAt: next.lastActivityAt })
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
