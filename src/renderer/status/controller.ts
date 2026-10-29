// Per-session status state, notifications and Dock badge. Plain TypeScript with injected
// dependencies so it can be unit-tested; StatusBridge wires it to the store, window.tr and the DOM.
import type { ProgramStatus } from '@shared/program-status'
import type { AgentEvent } from '@shared/agent-events'
import type { AgentMarker } from '@shared/agent-launch'
import { healsOnTick, initialState, reduce, ticksFast, watchesScreen, type SessionState, type Signal } from '@shared/session-state-machine'
import { needsAttention, STATUS_LABEL } from '@shared/session-status'
import type { AgentPhase, Session, SessionId, SessionStatus } from '@shared/types'

export interface StatusPatch {
  status: SessionStatus
  currentAction: string | undefined
  lastActivityAt: number
  /** Only present for agent sessions that track a phase. */
  phase?: AgentPhase
  lastReply?: string
  finishedAt?: number
  statusSince?: number
  turnStartedAt?: number
}

export interface StatusDeps {
  now(): number
  /** Current sessions from the workspace store. */
  sessions(): readonly Session[]
  activeSessionId(): SessionId | null
  /** Every session the main area shows (PRD F20: the panes of a split); default: the active one. */
  shownSessionIds?(): readonly SessionId[]
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
  /** Name of the project the session belongs to, for notification titles ("项目 · 会话"). */
  projectName?(id: SessionId): string | undefined
  /** A merged notification (OVERVIEW_TAG) was clicked. */
  openOverview?(): void
  /** Runs `fn` after `ms` (default setTimeout); injected so tests control time. */
  later?(fn: () => void, ms: number): void
  /** A session now needs the fast tick (it runs, or its screen is watched): self-heal must not wait for a slow one. */
  needsFastTicks?(): void
  /** The agent behind a session with an open Wavi ask has gone (see `setWaviAsk`): drop what it asked. */
  onWaviAskAbandoned?(id: SessionId): void
}

/** Tag of a notification that stands for several sessions: clicking it opens the overview. */
export const OVERVIEW_TAG = 'overview'
/** Turns that finish within this window share one notification (PRD F10). */
export const DONE_COALESCE_MS = 1_000

/** Statuses that interrupt the user when they are not already looking. */
const NOTIFY_BODY: Partial<Record<SessionStatus, string>> = {
  needs_you: STATUS_LABEL.needs_you,
  error: STATUS_LABEL.error,
  done_unread: STATUS_LABEL.done_unread
}

export class StatusController {
  private readonly states = new Map<SessionId, SessionState>()
  private lastBadge = -1
  /** Finished turns waiting to be announced together. */
  private pendingDone: SessionId[] = []
  /**
   * Wavi's own questions about a session, not its agent's (PRD F21: the agent asked to start sessions). The session
   * shows `needs_you` with this label while one is open. The state machine never sees them: the agent's busy title
   * and its input footer on screen would heal an ask of its own away.
   */
  private readonly waviAsks = new Map<SessionId, { label: string; since: number }>()

  constructor(private readonly deps: StatusDeps) {}

  stateOf(id: SessionId): SessionState | undefined {
    return this.states.get(id)
  }

  /** True while some session could change by itself soon (a running turn or a wait that may need self-healing). */
  hasRunning(): boolean {
    for (const state of this.states.values()) if (healsOnTick(state)) return true
    return false
  }

  /** True while some session's screen can change its state (starting up, blocked, waiting on a dialog). */
  watchesScreens(): boolean {
    for (const state of this.states.values()) if (watchesScreen(state)) return true
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
            ...(phase ? { phase } : {}),
            lastReply: session.lastReply,
            finishedAt: session.finishedAt,
            statusSince: session.statusSince
          })
        )
        // A new session carries no phase yet: it is starting now.
        if (phase && session.phase !== phase) this.deps.patch(session.id, { status: session.status, currentAction: session.currentAction, lastActivityAt: session.lastActivityAt, phase })
      } else if (session.phase === 'starting' && (known.phase === 'not-started' || known.phase === 'exited')) {
        // The user (or the host-restart recovery) started the agent: startSession() patched the store's phase.
        this.relaunch(session.id)
      } else if (known.phase === 'not-started' && (session.phase === 'ready' || session.phase === 'exited')) {
        // Still in the pty daemon after an app restart (session-start.ts adopted it): its hooks and title count again.
        this.apply(session.id, { type: 'reattached', exited: session.phase === 'exited' })
      }
    }
    for (const id of [...this.states.keys()]) if (!live.has(id)) this.states.delete(id)
    for (const id of [...this.waviAsks.keys()]) if (!live.has(id)) this.waviAsks.delete(id)
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
    if (state && watchesScreen(state)) this.checkScreen(sessionId)
  }

  handleTitle(sessionId: SessionId, title: string): void {
    this.apply(sessionId, { type: 'title', title })
  }

  /** An OSC 7501 report from the session's CLI (src/shared/program-status.ts). */
  handleProgramStatus(sessionId: SessionId, status: ProgramStatus): void {
    this.apply(sessionId, { type: 'program-status', status })
  }

  tick(): void {
    for (const id of [...this.states.keys()]) {
      // The screen first: a dialog up mid-turn is needs_you, not the idle a time-based heal would make of it.
      const before = this.states.get(id)
      if (before && watchesScreen(before)) this.checkScreen(id)
      this.apply(id, { type: 'tick' })
      const after = this.states.get(id)
      if (after && after !== before && watchesScreen(after)) this.checkScreen(id)
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
    const shown = this.deps.windowFocused() ? this.shown() : []
    for (const [id, state] of [...this.states]) {
      const viewing = shown.includes(id)
      if (viewing !== state.viewing) this.apply(id, { type: viewing ? 'viewed' : 'unviewed' })
    }
  }

  /** "Visible" = shown in any pane of the main area (PRD F20), with the window focused (checked by the caller). */
  private shown(): readonly SessionId[] {
    if (this.deps.shownSessionIds) return this.deps.shownSessionIds()
    const active = this.deps.activeSessionId()
    return active ? [active] : []
  }

  /** Opens (`label`) or closes (null) Wavi's own question about a session; see `waviAsks`. */
  setWaviAsk(id: SessionId, label: string | null): void {
    const open = this.waviAsks.get(id)
    if (label === null) {
      if (!open) return
      this.waviAsks.delete(id)
    } else {
      if (open?.label === label) return
      this.waviAsks.set(id, { label, since: open?.since ?? this.deps.now() })
    }
    const state = this.states.get(id)
    if (!state) return
    this.deps.patch(id, this.patchOf(id, state))
    this.updateBadge()
  }

  /** A system notification was clicked: jump to its session, or to the overview for a merged one. */
  handleNotificationClick(tag: string): void {
    if (tag === OVERVIEW_TAG) this.deps.openOverview?.()
    else if (this.states.has(tag)) this.deps.setActive(tag)
  }

  private apply(id: SessionId, signal: Signal): void {
    const prev = this.states.get(id)
    if (!prev) return
    const next = reduce(prev, signal, this.deps.now())
    if (next === prev) return
    this.states.set(id, next)
    if (ticksFast(next)) this.deps.needsFastTicks?.()

    if (next.hooksSilent !== prev.hooksSilent) this.deps.setHooksSilent?.(id, next.hooksSilent)

    if (
      next.status !== prev.status ||
      next.currentAction !== prev.currentAction ||
      next.lastActivityAt !== prev.lastActivityAt ||
      next.phase !== prev.phase ||
      next.lastReply !== prev.lastReply ||
      next.finishedAt !== prev.finishedAt ||
      next.statusSince !== prev.statusSince ||
      next.turnStartedAt !== prev.turnStartedAt
    ) {
      this.deps.patch(id, this.patchOf(id, next))
      // Wavi notified when it asked; what the agent does underneath is not news while that question is open.
      if (next.status !== prev.status && !this.waviAsks.has(id)) this.maybeNotify(id, next)
      this.updateBadge()
    }

    // The agent that asked is gone (its process ended, or the terminal did): nobody waits for the answer any more.
    // A turn that merely ends is no sign of that: Claude moves an MCP call that runs over 2 minutes to the background
    // and still takes its result (PRD §6.14).
    const gone = (s: SessionState): boolean => s.ended || s.phase === 'exited'
    if (this.waviAsks.has(id) && gone(next) && !gone(prev)) this.deps.onWaviAskAbandoned?.(id)
  }

  /** The store's view of a session: its agent's state, unless Wavi has a question of its own open about it. */
  private patchOf(id: SessionId, state: SessionState): StatusPatch {
    const ask = this.waviAsks.get(id)
    return {
      status: ask ? 'needs_you' : state.status,
      currentAction: ask ? ask.label : state.currentAction,
      lastActivityAt: state.lastActivityAt,
      ...(state.phase ? { phase: state.phase } : {}),
      lastReply: state.lastReply,
      finishedAt: state.finishedAt,
      statusSince: ask ? ask.since : state.statusSince,
      turnStartedAt: state.turnStartedAt
    }
  }

  private maybeNotify(id: SessionId, state: SessionState): void {
    if (!NOTIFY_BODY[state.status]) return
    // Never interrupt for the session the user is looking at.
    if (this.isLookedAt(id)) return
    if (state.status !== 'done_unread') {
      this.deps.notify(this.single(id, state))
      return
    }
    // Several agents often finish together: wait a moment and announce them in one notification.
    if (!this.pendingDone.includes(id)) this.pendingDone.push(id)
    if (this.pendingDone.length === 1) (this.deps.later ?? defaultLater)(() => this.flushDone(), DONE_COALESCE_MS)
  }

  private flushDone(): void {
    const ids = this.pendingDone.filter((id) => this.states.get(id)?.status === 'done_unread' && !this.isLookedAt(id))
    this.pendingDone = []
    const [first] = ids
    if (!first) return
    const state = this.states.get(first)
    if (ids.length === 1 && state) {
      this.deps.notify(this.single(first, state))
      return
    }
    const titles = ids.map((id) => this.titleOf(id))
    this.deps.notify({ title: `${ids.length} 个会话已完成`, body: titles.join('、'), tag: OVERVIEW_TAG })
  }

  private isLookedAt(id: SessionId): boolean {
    return this.deps.windowFocused() && this.shown().includes(id)
  }

  /** "项目 · 会话" (PRD F10). */
  private titleOf(id: SessionId): string {
    const title = this.deps.sessions().find((s) => s.id === id)?.title ?? ''
    const project = this.deps.projectName?.(id)
    return project ? `${project} · ${title}` : title
  }

  /** Body: the question or command being asked, the error, or the last reply. */
  private single(id: SessionId, state: SessionState): { title: string; body: string; tag: string } {
    const label = NOTIFY_BODY[state.status] ?? ''
    const detail = state.status === 'done_unread' ? state.lastReply : state.currentAction
    return { title: this.titleOf(id), body: detail ? `${label} · ${detail}` : label, tag: id }
  }

  private updateBadge(): void {
    const count = this.deps.sessions().filter((s) => needsAttention(s.status)).length
    if (count === this.lastBadge) return
    this.lastBadge = count
    this.deps.setBadge(count)
  }
}

function defaultLater(fn: () => void, ms: number): void {
  setTimeout(fn, ms)
}

