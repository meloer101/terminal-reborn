// Sessions whose terminal process died with the pty-host. Main restarts the host and reports who was
// lost (`pty:host-restarted`); the card offers to respawn them.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { onTerminalRestarted, restartTerminal } from '../terminal/registry'

interface HostRestartState {
  lost: SessionId[]
  markLost(ids: readonly SessionId[]): void
  forget(id: SessionId): void
}

export const useHostRestart = create<HostRestartState>()((set) => ({
  lost: [],
  markLost: (ids) => set((s) => ({ lost: [...new Set([...s.lost, ...ids])] })),
  forget: (id) => set((s) => (s.lost.includes(id) ? { lost: s.lost.filter((x) => x !== id) } : {}))
}))

/** Lost sessions that still exist in the workspace (closing one drops it from the card's count). */
export function lostSessionIds(lost: readonly SessionId[], existing: readonly { id: SessionId }[]): SessionId[] {
  const live = new Set(existing.map((s) => s.id))
  return lost.filter((id) => live.has(id))
}

/** Respawns every lost session; agents with a known conversation id resume it. */
export async function recoverLostSessions(): Promise<void> {
  const { sessions } = useWorkspace.getState()
  const ids = lostSessionIds(useHostRestart.getState().lost, sessions)
  await Promise.all(ids.map((id) => restartTerminal(id, sessions.find((s) => s.id === id)?.agentSessionId)))
}

/** Listens for host restarts; returns the unsubscribe function. */
export function startHostRestartTracking(): () => void {
  const offHost = window.tr.pty.onHostRestarted((ids) => useHostRestart.getState().markLost(ids))
  // Any restart of a terminal (this card's, or another feature's) settles that session.
  const offRestart = onTerminalRestarted((id) => useHostRestart.getState().forget(id))
  return () => {
    offHost()
    offRestart()
  }
}
