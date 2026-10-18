// The repository's setup script in a new worktree (PRD F4 · L1): after the worktree is created, the sheet's 准备
// switch asks main to approve the script (a confirmation sheet the first time), and the session's first terminal
// process then runs it before the agent. A failure is said under the session; the agent starts once the user goes on.
import { create } from 'zustand'
import type { ScriptMarker } from '@shared/script-launch'
import type { SessionId } from '@shared/types'

export type SetupRun =
  /** Approved; the next spawn of the session's terminal runs it. */
  | { state: 'queued' }
  | { state: 'running' }
  /** Ended with a non-zero code; the runner waits for ↵ before the agent starts. */
  | { state: 'failed'; code: number }
  /** Not run because `.tr/settings.toml` has a problem (UI copy). */
  | { state: 'skipped'; reason: string }

/** Not persisted: a setup belongs to the one launch right after its worktree was created. */
export const useSetupRuns = create<{ runs: Record<SessionId, SetupRun | undefined> }>(() => ({ runs: {} }))

function set(sessionId: SessionId, run: SetupRun | undefined): void {
  useSetupRuns.setState((s) => ({ runs: { ...s.runs, [sessionId]: run } }))
}

/**
 * Decides what the new worktree's first launch does before the agent: run the approved setup script, or say why
 * not. Resolves once that is settled (the session's terminal waits for it); never rejects.
 */
export async function prepareSetup(sessionId: SessionId, worktreePath: string): Promise<void> {
  try {
    const info = await window.tr.repoScripts.get(worktreePath)
    if (info.problems.length > 0 && info.scripts.setup === undefined) {
      set(sessionId, { state: 'skipped', reason: info.problems[0]! })
      return
    }
    if (info.scripts.setup === undefined) return
    if ((await window.tr.repoScripts.approve(worktreePath, 'setup')) === 'approved') set(sessionId, { state: 'queued' })
  } catch (error) {
    console.error('[setup] could not prepare the setup script', error)
  }
}

/** Called by the session's terminal right before it spawns: whether this launch runs the setup script first. */
export function takeSetup(sessionId: SessionId): boolean {
  if (useSetupRuns.getState().runs[sessionId]?.state !== 'queued') return false
  set(sessionId, { state: 'running' })
  return true
}

/** The setup runner's markers, as the terminal parses them. */
export function handleScriptMarker(sessionId: SessionId, marker: ScriptMarker): void {
  if (marker.type === 'setup-exit' && marker.code !== 0) set(sessionId, { state: 'failed', code: marker.code })
  else set(sessionId, undefined)
}

/** The failure strip's button: the runner is waiting for ↵ (pressing ↵ in the terminal does the same). */
export function continueAfterSetup(sessionId: SessionId): void {
  window.tr.pty.write(sessionId, '\r')
}

export function dismissSetupNote(sessionId: SessionId): void {
  set(sessionId, undefined)
}

/** The spawn failed or the session is gone: nothing is waiting any more. */
export function forgetSetup(sessionId: SessionId): void {
  if (useSetupRuns.getState().runs[sessionId]) set(sessionId, undefined)
}
