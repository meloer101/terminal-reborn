// Runs the sends the user asked for with 恢复后发送“继续” (PRD F11): remembers each Claude StopFailure, calls a request
// off the moment the session leaves the limit stop or the user types into it, and at the due time checks the usage
// and the screen (shared/limit-resume.ts) before typing 继续 with the send protocol. One timer for every session.
import {
  decideResume,
  holdText,
  isTypedInput,
  RESUME_PROMPT,
  RESUME_TIMING,
  resumeDueAt,
  resumeScreen,
  stoppedLikeLimit,
  type HoldReason,
  type ResumePlan,
  type ResumeTiming
} from '@shared/limit-resume'
import type { SessionId } from '@shared/types'
import { submitPrompt } from '../session-io'
import { useSessionMeta } from '../session-meta/store'
import { useWorkspace } from '../state/workspace'
import { getSurface, readViewport } from '../terminal/registry'
import type { TerminalSurface } from '../terminal/surface'
import { useLimitResume } from './store'

/** e2e runs shorten the margin and waits (`globalThis.__TR_LIMIT_RESUME_TIMING__`); everyone else gets the defaults. */
export function timing(): ResumeTiming {
  const override = (globalThis as { __TR_LIMIT_RESUME_TIMING__?: Partial<ResumeTiming> }).__TR_LIMIT_RESUME_TIMING__
  return override ? { ...RESUME_TIMING, ...override } : RESUME_TIMING
}

/** Events that mean the turn the StopFailure ended is behind us. */
const NEW_TURN = new Set(['prompt-submit', 'session-start', 'stop', 'session-end', 'tool-start'])

function isStopped(sessionId: SessionId): boolean {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  return session !== undefined && stoppedLikeLimit(session, useLimitResume.getState().failures[sessionId])
}

function notify(sessionId: SessionId, body: string): void {
  const { sessions, worktrees, projects } = useWorkspace.getState()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session) return
  const project = projects.find((p) => p.id === worktrees.find((w) => w.id === session.worktreeId)?.projectId)
  // The session id as tag: clicking the notification opens the session (status/bridge.ts).
  window.tr.ui.notify({ title: project ? `${project.name} · ${session.title}` : session.title, body, tag: sessionId })
}

/** Starts listening; returns a function that stops everything. */
export function startLimitResumeBridge(): () => void {
  /** When to look at each armed session next (default: its due time). */
  const nextCheck = new Map<SessionId, number>()
  /** The user's keys in each armed session's terminal. */
  const typing = new Map<SessionId, { surface: TerminalSurface; dispose(): void }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  /** Whether main was asked to keep this hidden window's timers at full speed (app.keepTimers). */
  let keeping = false

  const cancel = (sessionId: SessionId): void => {
    nextCheck.delete(sessionId)
    useLimitResume.getState().cancel(sessionId)
  }

  /** Every armed session's typing is watched; requests whose session left the stop (or is gone) are dropped. */
  function reconcile(): void {
    const { plans } = useLimitResume.getState()
    for (const sessionId of Object.keys(plans)) {
      if (!isStopped(sessionId)) {
        cancel(sessionId)
        continue
      }
      const surface = getSurface(sessionId)
      if (surface && typing.get(sessionId)?.surface !== surface) {
        typing.get(sessionId)?.dispose()
        const subscription = surface.onInput((data) => {
          if (isTypedInput(data)) cancel(sessionId)
        })
        typing.set(sessionId, { surface, dispose: () => subscription.dispose() })
      }
    }
    const armed = useLimitResume.getState().plans
    for (const [sessionId, subscription] of [...typing]) {
      if (armed[sessionId]) continue
      subscription.dispose()
      typing.delete(sessionId)
    }
    for (const sessionId of [...nextCheck.keys()]) if (!armed[sessionId]) nextCheck.delete(sessionId)
    schedule()
  }

  function schedule(): void {
    clearTimeout(timer)
    const { plans } = useLimitResume.getState()
    let soonest = Infinity
    for (const [sessionId, plan] of Object.entries(plans)) soonest = Math.min(soonest, nextCheck.get(sessionId) ?? resumeDueAt(plan, timing()))
    if (keeping !== (soonest !== Infinity)) {
      keeping = soonest !== Infinity
      window.tr.app.keepTimers(keeping)
    }
    if (soonest === Infinity) return
    // Timers drift while the Mac sleeps: never wait more than a minute before looking at the clock again.
    timer = setTimeout(run, Math.min(60_000, Math.max(0, soonest - Date.now())))
  }

  function hold(sessionId: SessionId, plan: ResumePlan, reason: HoldReason): void {
    cancel(sessionId)
    notify(sessionId, holdText(reason, plan.vendor))
  }

  function send(sessionId: SessionId): void {
    // Off the list first: the prompt it submits must not look like the user taking over.
    cancel(sessionId)
    submitPrompt(sessionId, RESUME_PROMPT).catch((error: unknown) => {
      const why = error instanceof Error ? error.message : String(error)
      notify(sessionId, `额度已恢复，但没能发送“${RESUME_PROMPT}”：${why}`)
    })
  }

  function run(): void {
    const now = Date.now()
    const { plans, failures } = useLimitResume.getState()
    let refresh = false
    for (const [sessionId, plan] of Object.entries(plans)) {
      if ((nextCheck.get(sessionId) ?? resumeDueAt(plan, timing())) > now) continue
      const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
      const decision = decideResume(
        plan,
        {
          now,
          stopped: isStopped(sessionId),
          usage: useSessionMeta.getState().usage[plan.vendor],
          message: failures[sessionId]?.message,
          screen: session ? resumeScreen(session.kind, readViewport(sessionId)) : 'unknown'
        },
        timing()
      )
      switch (decision.kind) {
        case 'wait':
          nextCheck.set(sessionId, decision.at)
          refresh ||= decision.refresh
          break
        case 'postpone':
          nextCheck.delete(sessionId)
          useLimitResume.getState().postpone(sessionId, decision.resetsAt)
          break
        case 'cancel':
          cancel(sessionId)
          break
        case 'hold':
          hold(sessionId, plan, decision.reason)
          break
        case 'send':
          send(sessionId)
          break
      }
    }
    // Main asks the account within its own minimum gaps (Claude 60 s, Codex 15 s).
    if (refresh) window.tr.agent.refreshUsage()
    schedule()
  }

  const offEvents = window.tr.agent.onEvent(({ sessionId, event }) => {
    const store = useLimitResume.getState()
    if (event.type === 'stop-failure') store.setFailure(sessionId, { ...(event.reason ? { reason: event.reason } : {}), ...(event.message ? { message: event.message } : {}) })
    else if (NEW_TURN.has(event.type)) store.setFailure(sessionId, null)
  })
  const offPlans = useLimitResume.subscribe((state, prev) => {
    if (state.plans !== prev.plans || state.failures !== prev.failures) reconcile()
  })
  const offSessions = useWorkspace.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions) reconcile()
  })
  // A wake from sleep or a window shown again: look at the clock now.
  const onWake = (): void => schedule()
  document.addEventListener('visibilitychange', onWake)
  reconcile()

  return () => {
    clearTimeout(timer)
    offEvents()
    offPlans()
    offSessions()
    document.removeEventListener('visibilitychange', onWake)
    for (const subscription of typing.values()) subscription.dispose()
    if (keeping) window.tr.app.keepTimers(false)
  }
}

/** The button's click: ask for the send, or call it off. */
export function toggleLimitResume(sessionId: SessionId, stop: { vendor: ResumePlan['vendor']; resetsAt: number } | null): void {
  const store = useLimitResume.getState()
  if (store.plans[sessionId]) {
    store.cancel(sessionId)
    return
  }
  if (!stop) return
  store.arm(sessionId, { vendor: stop.vendor, resetsAt: stop.resetsAt, armedAt: Date.now() })
}
