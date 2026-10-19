// The session header's Run button (PRD F4 · 脚本与端口): the worktree's `run` script in its own plain terminal session
// (titled `run`). Press: start it (asking first the first time the repository's scripts run) and show it; when it is
// running elsewhere, show it; when it is the session on screen, stop it. Its process ends with the script.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { RepoScriptsInfo } from '@shared/ipc'
import type { Session, SessionId, Worktree } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { useLiveSessions } from '../terminal/live-sessions'
import { getSurface, restartTerminal } from '../terminal/registry'

interface RunState {
  /** Bumped by every start; a run session without one waits (it never runs its script by itself after a restart). */
  started: Record<SessionId, number | undefined>
  /** Whether its process is running (from a start until its exit). */
  running: Record<SessionId, boolean | undefined>
}

export const useRunScripts = create<RunState>(() => ({ started: {}, running: {} }))

/** Starts whose spawn has not happened yet (the terminal takes one in spawnScriptFor). */
const pendingStarts = new Set<SessionId>()
const watchedExits = new Set<SessionId>()

function setRunning(sessionId: SessionId, running: boolean): void {
  useRunScripts.setState((s) => ({ running: { ...s.running, [sessionId]: running } }))
}

/** Marks the session not running when its process ends (once per session). */
function watchExit(sessionId: SessionId): void {
  if (watchedExits.has(sessionId)) return
  watchedExits.add(sessionId)
  window.tr.pty.onExit(sessionId, () => setRunning(sessionId, false))
}

/** Called by the session's terminal right before it spawns: whether this launch is the run script. */
export function takeRunStart(sessionId: SessionId): boolean {
  return pendingStarts.delete(sessionId)
}

/** A run session's terminal waits for the Run button unless its process is still alive in the pty daemon. */
export function runSessionWaits(session: Pick<Session, 'id' | 'script'>, started: RunState['started'], live: boolean): boolean {
  return session.script === 'run' && !live && started[session.id] === undefined
}

export function runSessionOf(sessions: readonly Session[], worktreeId: string): Session | undefined {
  return sessions.find((s) => s.script === 'run' && s.worktreeId === worktreeId)
}

/** Whether the run session's process is running now (a process reattached from the daemon counts until it exits). */
export function useRunRunning(sessionId: SessionId | undefined): boolean {
  const known = useRunScripts((s) => (sessionId ? s.running[sessionId] : undefined))
  const live = useLiveSessions((s) => (sessionId ? s.live[sessionId] : undefined))
  const running = known ?? (live !== undefined && !live.exited)
  useEffect(() => {
    if (sessionId && running) watchExit(sessionId)
  }, [sessionId, running])
  return running
}

export type RunAction = 'start' | 'show' | 'stop'

export function runAction(running: boolean, runIsActive: boolean): RunAction {
  if (!running) return 'start'
  return runIsActive ? 'stop' : 'show'
}

/** What the Run button does now, for the worktree the active session is in. */
export async function pressRun(worktree: Worktree, action: RunAction): Promise<void> {
  const workspace = useWorkspace.getState()
  const existing = runSessionOf(workspace.sessions, worktree.id)
  if (action === 'stop') {
    if (existing) window.tr.pty.kill(existing.id)
    return
  }
  if (action === 'show') {
    if (existing) workspace.setActiveSession(existing.id)
    return
  }
  if ((await window.tr.repoScripts.approve(worktree.path, 'run')) !== 'approved') return
  const id = existing?.id ?? useWorkspace.getState().addRunSession(worktree.id)
  if (!id) return
  if (existing) useWorkspace.getState().setActiveSession(id)
  pendingStarts.add(id)
  watchExit(id)
  setRunning(id, true)
  useRunScripts.setState((s) => ({ started: { ...s.started, [id]: (s.started[id] ?? 0) + 1 } }))
  // A terminal that ran the script before keeps its scrollback and starts it again in place; a new one spawns
  // when the pane mounts it.
  if (getSurface(id) && !(await restartTerminal(id))) {
    pendingStarts.delete(id)
    setRunning(id, false)
  }
}

/**
 * `.tr/settings.toml` of the folder (re-read when it changes, the window regains focus, the folder changes or
 * `refresh` does — e.g. once a new worktree's folder exists).
 */
export function useRepoScripts(path: string | undefined, refresh?: unknown): RepoScriptsInfo | null {
  const [info, setInfo] = useState<{ path: string; info: RepoScriptsInfo } | null>(null)
  useEffect(() => {
    if (!path) return
    let cancelled = false
    const load = (): void => {
      window.tr.repoScripts
        .get(path)
        .then((next) => {
          if (!cancelled) setInfo({ path, info: next })
        })
        .catch(() => {
          if (!cancelled) setInfo(null)
        })
    }
    load()
    window.addEventListener('focus', load)
    const off = window.tr.worktree.onChanged((change) => {
      if (change.root === path && change.dirs.some((dir) => dir === '' || dir === '.tr' || dir.startsWith('.tr/'))) load()
    })
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
      off()
    }
  }, [path, refresh])
  return info && info.path === path ? info.info : null
}
