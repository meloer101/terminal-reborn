// Delivers the user's answer: permission decisions go to main (which releases the blocked hook), question
// answers become keystrokes on the session's serial send queue. Both remove the prompt optimistically.
import type { PendingPrompt, PermissionDecision } from '@shared/agent-events'
import { planQuestionAnswer, type QuestionSelection } from '@shared/question-keys'
import { runSteps } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { usePromptStore } from './store'

type Permission = Extract<PendingPrompt, { kind: 'permission' }>
type Question = Extract<PendingPrompt, { kind: 'question' }>

export type AnswerLogEntry =
  | { kind: 'permission'; id: string; decision: PermissionDecision }
  | { kind: 'question'; id: string; questionIndex: number; selection: QuestionSelection }

/** End-to-end tests read this (and inject prompts) through `__trPrompts`; it only exists when they opt in. */
interface E2eGlobal {
  __TR_E2E__?: boolean
  __trPrompts?: { inject(prompt: PendingPrompt): void; log: AnswerLogEntry[] }
}
const e2e = globalThis as unknown as E2eGlobal
const answerLog: AnswerLogEntry[] = []
if (e2e.__TR_E2E__) {
  e2e.__trPrompts = { inject: (prompt) => usePromptStore.getState().add(prompt), log: answerLog }
}
const record = (entry: AnswerLogEntry): void => {
  if (e2e.__TR_E2E__) answerLog.push(entry)
}

export function answerPermission(prompt: Permission, decision: PermissionDecision): void {
  record({ kind: 'permission', id: prompt.id, decision })
  usePromptStore.getState().resolve(prompt.id)
  window.tr.agent.respondPermission(prompt.id, decision)
}

/**
 * Answers question `questionIndex` of an AskUserQuestion prompt. The TUI advances by itself after each answer,
 * so the keys go out immediately; the prompt disappears after the last one. A failed delivery puts the
 * prompt back (at that question) with an error.
 */
export async function answerQuestion(prompt: Question, questionIndex: number, selection: QuestionSelection): Promise<void> {
  const question = prompt.questions[questionIndex]
  if (!question) return
  const store = usePromptStore.getState()
  record({ kind: 'question', id: prompt.id, questionIndex, selection })
  try {
    const steps = planQuestionAnswer(question, selection, { index: questionIndex, total: prompt.questions.length })
    if (questionIndex >= prompt.questions.length - 1) store.resolve(prompt.id)
    else store.advanceQuestion(prompt.id)
    await runSteps(prompt.sessionId, steps)
  } catch (error) {
    // The session was closed meanwhile: nothing left to answer.
    if (!useWorkspace.getState().sessions.some((s) => s.id === prompt.sessionId)) return
    store.restore(prompt, questionIndex, error instanceof Error ? error.message : String(error))
  }
}
