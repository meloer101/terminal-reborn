// Starting a session's agent (phase 2 · A2): the one place that decides *whether to resume* the agent's
// earlier conversation. Sessions restored from disk are `not-started` and nothing is spawned for them until
// they are viewed; `startSession` then spawns the terminal, resuming the saved conversation when asked to.
//
// UI track: call `startSession(id, { resume: true })` for "恢复对话" and `{ resume: false }` for "开始新对话"
// (also for the Exited card's "恢复上次对话" / "重新启动"). Until those buttons exist, a not-started session
// starts by itself, resuming, when it is first viewed; set AUTO_START_ON_VIEW to false when the buttons ship.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import { loadLiveSessions, useLiveSessions } from '../terminal/live-sessions'
import { disposeTerminal, isTerminalAlive } from '../terminal/registry'
import { agentSessionIdPatch, planStart, shouldAutoStart, type StartOptions } from './session-start-plan'
import { shownSessionIds, useWorkspace } from './workspace'

export { AUTO_START_ON_VIEW, hasStartChoice, type StartOptions } from './session-start-plan'

interface StartRequest {
  resumeAgentSessionId: string | undefined
  /** Bumped by every start, so an already-running terminal is replaced. */
  generation: number
}

/** How each session's terminal should be (re)created; read by TerminalArea. Not persisted. */
export const useStartRequests = create<{ requests: Record<SessionId, StartRequest | undefined> }>(() => ({ requests: {} }))

const STOP_WAIT_MS = 1000

/** Kills a session's running PTY and waits (briefly) for it to be gone, so a new one can take its id. */
async function stopTerminal(sessionId: SessionId): Promise<void> {
  if (!isTerminalAlive(sessionId)) {
    disposeTerminal(sessionId)
    return
  }
  const gone = new Promise<void>((resolve) => {
    const off = window.tr.pty.onExit(sessionId, () => {
      off()
      resolve()
    })
    setTimeout(() => {
      off()
      resolve()
    }, STOP_WAIT_MS)
  })
  disposeTerminal(sessionId) // kills the PTY
  await gone
}

/**
 * Starts (or restarts) the session's agent in a fresh terminal. Works for a not-started session and for
 * one whose agent has exited; a running terminal is stopped first. Shell sessions are ignored.
 */
export async function startSession(sessionId: SessionId, options: StartOptions = { resume: true }): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session || session.kind === 'shell') return
  const plan = planStart(session, options)
  await stopTerminal(sessionId)
  // The session may have been closed while the old terminal was shutting down.
  if (!useWorkspace.getState().sessions.some((s) => s.id === sessionId)) return
  useStartRequests.setState((state) => ({
    requests: {
      ...state.requests,
      [sessionId]: { resumeAgentSessionId: plan.resumeAgentSessionId, generation: (state.requests[sessionId]?.generation ?? 0) + 1 }
    }
  }))
  useWorkspace.getState().patchSession(sessionId, plan.patch)
}

/** Mounted once (by TerminalArea): records conversation ids and starts not-started sessions when they are viewed. */
export function useSessionStartup(): void {
  useEffect(
    () =>
      window.tr.agent.onEvent(({ sessionId, event }) => {
        const patch = agentSessionIdPatch(event)
        if (patch) useWorkspace.getState().patchSession(sessionId, patch)
      }),
    []
  )

  // Sessions still running in the pty daemon are reattached, never started again: wait for that answer first.
  const liveLoaded = useLiveSessions((s) => s.loaded)
  useEffect(() => {
    void loadLiveSessions().then(adoptLiveSessions)
  }, [])

  // Every session shown in the main area is viewed: the active one, and the others in a split (PRD F20).
  const due = useWorkspace((s) => {
    const live = useLiveSessions.getState().live
    return shownSessionIds(s)
      .filter((id) => shouldAutoStart(s.sessions.find((x) => x.id === id)) && !live[id])
      .join('\n')
  })
  useEffect(() => {
    if (!liveLoaded || due === '') return
    for (const id of due.split('\n')) {
      // Re-checked here: effects can run twice (StrictMode) and a start in between already moved the phase on.
      const current = useWorkspace.getState().sessions.find((s) => s.id === id)
      if (current?.phase === 'not-started' && !useLiveSessions.getState().live[id]) void startSession(id, { resume: true })
    }
  }, [liveLoaded, due])
}

/**
 * Agents that kept running while the app was closed are `ready` (or `exited`, when they ended meanwhile) instead of
 * `not-started`. A process whose session no longer exists in the workspace has no way to be seen or closed: end it.
 */
function adoptLiveSessions(): void {
  const { live } = useLiveSessions.getState()
  const workspace = useWorkspace.getState()
  for (const info of Object.values(live)) {
    const session = workspace.sessions.find((s) => s.id === info.sessionId)
    if (!session) {
      void window.tr.pty.attach(info.sessionId).then((attached) => {
        if (attached && !attached.exit) window.tr.pty.kill(info.sessionId)
      })
      continue
    }
    if (session.phase !== 'not-started') continue
    workspace.patchSession(session.id, info.exited ? { phase: 'exited', status: 'exited' } : { phase: 'ready' })
  }
}
