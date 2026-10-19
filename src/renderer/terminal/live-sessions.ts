// Sessions whose processes kept running in the pty daemon while this window was not there (the app was quit, or
// the window reloaded). Asked once at startup; each such session's terminal reattaches instead of spawning, and
// nothing is resumed or restarted on top of a process that is still alive (PRD §6.8).
import { create } from 'zustand'
import type { LivePtySession } from '@shared/ipc'
import type { SessionId } from '@shared/types'

interface LiveSessionsState {
  loaded: boolean
  live: Record<SessionId, LivePtySession>
}

export const useLiveSessions = create<LiveSessionsState>(() => ({ loaded: false, live: {} }))

/** Live sessions no terminal has reattached yet; a terminal takes its id once (a later restart spawns fresh). */
const reattachable = new Set<SessionId>()
let loading: Promise<void> | null = null

/** Starts the one-time query (idempotent); resolves once the answer is in (an empty answer on failure). */
export function loadLiveSessions(): Promise<void> {
  loading ??= window.tr.pty
    .live()
    .catch(() => [] as LivePtySession[])
    .then((list) => {
      const live: Record<SessionId, LivePtySession> = {}
      for (const session of list) {
        live[session.sessionId] = session
        reattachable.add(session.sessionId)
      }
      useLiveSessions.setState({ loaded: true, live })
    })
  return loading
}

/** Whether this terminal should reattach to a running process (true at most once per id). */
export function takeReattach(sessionId: SessionId): boolean {
  return reattachable.delete(sessionId)
}

/** Archived sessions (PRD F15): their processes are gone, so a later restore must start them, not wait to reattach. */
export function forgetLiveSessions(sessionIds: readonly SessionId[]): void {
  for (const id of sessionIds) reattachable.delete(id)
  const live = useLiveSessions.getState().live
  if (!sessionIds.some((id) => live[id])) return
  const next = { ...live }
  for (const id of sessionIds) delete next[id]
  useLiveSessions.setState({ live: next })
}
