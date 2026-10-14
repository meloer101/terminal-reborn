// Pure queue logic for pending agent prompts, keyed by session (FIFO per session).
import type { PendingPrompt } from '@shared/agent-events'
import type { SessionId } from '@shared/types'

export type PromptsBySession = Readonly<Record<SessionId, readonly PendingPrompt[]>>

export const NO_PROMPTS: readonly PendingPrompt[] = Object.freeze([])

function without(state: PromptsBySession, sessionId: SessionId): Record<SessionId, readonly PendingPrompt[]> {
  const copy = { ...state }
  delete copy[sessionId]
  return copy
}

/**
 * Adds a prompt to its session's queue.
 *  - same id again: replaced in place (hook retry);
 *  - a question replaces any question still queued for that session — an agent asks one at a time, so an older
 *    one is stale (it was answered in the TUI, or the agent re-asked) — keeping the queue position;
 *  - a permission request is appended: parallel tool calls can legitimately queue several.
 */
export function addPrompt(state: PromptsBySession, prompt: PendingPrompt): PromptsBySession {
  const queue = state[prompt.sessionId] ?? NO_PROMPTS
  const sameId = queue.findIndex((p) => p.id === prompt.id)
  if (sameId >= 0) return { ...state, [prompt.sessionId]: queue.map((p, i) => (i === sameId ? prompt : p)) }
  if (prompt.kind === 'question') {
    const first = queue.findIndex((p) => p.kind === 'question')
    if (first >= 0) {
      const next: PendingPrompt[] = []
      queue.forEach((p, i) => {
        if (i === first) next.push(prompt)
        else if (p.kind !== 'question') next.push(p)
      })
      return { ...state, [prompt.sessionId]: next }
    }
  }
  return { ...state, [prompt.sessionId]: [...queue, prompt] }
}

/** Removes a prompt by id; the same state object when it is not there. */
export function removePrompt(state: PromptsBySession, id: string): PromptsBySession {
  for (const [sessionId, queue] of Object.entries(state)) {
    if (!queue.some((p) => p.id === id)) continue
    const rest = queue.filter((p) => p.id !== id)
    return rest.length === 0 ? without(state, sessionId) : { ...state, [sessionId]: rest }
  }
  return state
}

export function removeSessionPrompts(state: PromptsBySession, sessionId: SessionId): PromptsBySession {
  return sessionId in state ? without(state, sessionId) : state
}

/** Drops the queues of sessions that no longer exist. */
export function keepSessions(state: PromptsBySession, live: ReadonlySet<SessionId>): PromptsBySession {
  let next = state
  for (const sessionId of Object.keys(state)) {
    if (!live.has(sessionId)) next = removeSessionPrompts(next, sessionId)
  }
  return next
}
