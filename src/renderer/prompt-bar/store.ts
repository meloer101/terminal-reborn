// Pending permission requests / questions, per session. Fed by window.tr.agent (see PromptBar's effect),
// read by the PromptBar and — via the exported selectors — by later features (sidebar inline reply, "1 of N").
import { create } from 'zustand'
import type { PendingPrompt } from '@shared/agent-events'
import type { SessionId } from '@shared/types'
import {
  addPrompt,
  keepSessions,
  NO_PROMPTS,
  removePrompt,
  removeSessionPrompts,
  type PromptsBySession
} from './model'

export interface PromptError {
  promptId: string
  message: string
}

interface PromptState {
  bySession: PromptsBySession
  /** AskUserQuestion with several questions: how many are answered already (the one on screen is this index). */
  questionProgress: Readonly<Record<string, number>>
  error: PromptError | null

  add(prompt: PendingPrompt): void
  /** Answered (here or in the TUI), timed out or the session ended. */
  resolve(id: string): void
  clearSession(sessionId: SessionId): void
  /** Drops queues of sessions that are gone. */
  keepSessions(live: ReadonlySet<SessionId>): void
  /** The current question of a multi-question prompt was answered; show the next one. */
  advanceQuestion(id: string): void
  /** Keystroke delivery failed: put the prompt back at the question that was being answered. */
  restore(prompt: PendingPrompt, questionIndex: number, message: string): void
  clearError(): void
}

function dropProgress(progress: Readonly<Record<string, number>>, id: string): Readonly<Record<string, number>> {
  if (!(id in progress)) return progress
  const copy = { ...progress }
  delete copy[id]
  return copy
}

export const usePromptStore = create<PromptState>()((set) => ({
  bySession: {},
  questionProgress: {},
  error: null,

  add: (prompt) => set((s) => ({ bySession: addPrompt(s.bySession, prompt), error: null })),
  resolve: (id) =>
    set((s) => ({
      bySession: removePrompt(s.bySession, id),
      questionProgress: dropProgress(s.questionProgress, id),
      error: s.error?.promptId === id ? null : s.error
    })),
  clearSession: (sessionId) =>
    set((s) => {
      const gone = s.bySession[sessionId] ?? NO_PROMPTS
      let progress = s.questionProgress
      for (const p of gone) progress = dropProgress(progress, p.id)
      return { bySession: removeSessionPrompts(s.bySession, sessionId), questionProgress: progress }
    }),
  keepSessions: (live) =>
    set((s) => {
      const next = keepSessions(s.bySession, live)
      return next === s.bySession ? {} : { bySession: next }
    }),
  advanceQuestion: (id) => set((s) => ({ questionProgress: { ...s.questionProgress, [id]: (s.questionProgress[id] ?? 0) + 1 } })),
  restore: (prompt, questionIndex, message) =>
    set((s) => ({
      bySession: addPrompt(s.bySession, prompt),
      questionProgress: { ...s.questionProgress, [prompt.id]: questionIndex },
      error: { promptId: prompt.id, message }
    })),
  clearError: () => set({ error: null })
}))

/** Pending prompts of a session, oldest first. Stable (same array) while nothing changed. */
export const selectPrompts =
  (sessionId: SessionId | null) =>
  (s: Pick<PromptState, 'bySession'>): readonly PendingPrompt[] =>
    (sessionId && s.bySession[sessionId]) || NO_PROMPTS

export function usePendingPrompts(sessionId: SessionId | null): readonly PendingPrompt[] {
  return usePromptStore(selectPrompts(sessionId))
}

/** How many prompts wait for the user in this session. */
export function usePendingCount(sessionId: SessionId | null): number {
  return usePromptStore((s) => selectPrompts(sessionId)(s).length)
}

export function getPendingPrompts(sessionId: SessionId): readonly PendingPrompt[] {
  return selectPrompts(sessionId)(usePromptStore.getState())
}
