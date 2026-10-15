// What the lifecycle cards (and later the command palette) can do to a session's agent. The UI goes through
// here so it does not need to know how an agent is relaunched (state/session-start.ts) or where a terminal lives.
import type { SessionId } from '@shared/types'
import { startSession } from '../state/session-start'
import { getSurface } from '../terminal/registry'

/**
 * Starts the session's agent again in a fresh terminal: after it exited, or for a session restored from disk.
 * `resume` continues the saved conversation when the session has one; otherwise a new conversation starts.
 */
export function restartAgent(sessionId: SessionId, options: { resume: boolean }): Promise<void> {
  return startSession(sessionId, options)
}

/** Gives the keyboard to the session's terminal (a dialog there waits for keys). False if it does not exist yet. */
export function focusTerminal(sessionId: SessionId): boolean {
  const surface = getSurface(sessionId)
  if (!surface) return false
  surface.focus()
  return true
}

/** Gives the keyboard to the composer. False if it is missing or disabled. */
export function focusComposer(): boolean {
  const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入框"]')
  if (!input || input.disabled) return false
  input.focus()
  return true
}
