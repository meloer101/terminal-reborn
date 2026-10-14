// Answering Codex's own TUI prompts with keystrokes (PRD F3), for when no hook can decide.
// Pure: decides WHAT to type; the renderer runs the steps on the session's serial queue (runSteps).
// Every sequence was observed on the real Codex CLI 0.142.5 (scripts/spikes/41-codex-hooks-lab.mjs, docs/spikes/codex.md §4).
//
// Approval dialog ("Would you like to run the following command?" / "…make the following edits?"):
//   1. Yes, proceed (y)                         `y` or `1`      runs the tool; the turn goes on
//   2. Yes, and don't ask again … (p) / (a)     `p` / `a`       persists a rule in ~/.codex -> never used by the app
//   3. No, and tell Codex what to do differently (esc)   `Esc` or `3`   cancels AND interrupts the turn
//                                                (so "deny" via keys ends the turn; deny via the hook does not)
//
// request_user_input (Plan mode only), one tab per question:
//   digit N     selects option N and submits that question; the TUI moves on to the next one by itself.
//               There is no review screen: the digit on the last question submits the whole call.
//   N+1         "None of the above" (notes need Tab and are not supported here).
import type { AgentQuestion, PermissionDecision } from './agent-events'
import { GROUP_GAP_MS, MAX_DIGIT, type QuestionPosition, type QuestionSelection } from './question-keys'
import type { SendStep } from './send-protocol'

export const CODEX_KEY_YES = 'y'
export const CODEX_KEY_CANCEL = '\x1b'

/**
 * Keys for an approval decision. `allow-always` is deliberately the same as `allow-once`: Codex's "don't ask
 * again" option writes a rule into `~/.codex`, which the app never does.
 */
export function planCodexApproval(decision: PermissionDecision): SendStep[] {
  return [{ type: 'write', data: decision === 'deny' ? CODEX_KEY_CANCEL : CODEX_KEY_YES }]
}

/** Whether Codex's own approval dialog is on screen (the prompt bar can use it when a hook did not announce the request). */
export function detectCodexApproval(screen: string): 'command' | 'edit' | null {
  if (!/Yes, proceed \(y\)/.test(screen)) return null
  if (/Would you like to run the following command\?/.test(screen)) return 'command'
  if (/Would you like to make the following edits\?/.test(screen)) return 'edit'
  return null
}

/**
 * Keys that answer question `position.index` of a `request_user_input` call. Same signature as
 * `planQuestionAnswer` so the prompt bar can pick the planner by agent. Only single-select questions exist in
 * Codex; the free-text selection picks "None of the above" (the text cannot be entered without the notes field).
 */
export function planCodexQuestionAnswer(
  question: AgentQuestion,
  selection: QuestionSelection,
  position: QuestionPosition = { index: 0, total: 1 }
): SendStep[] {
  const n = question.options.length
  let row: number
  if (selection.kind === 'single') {
    if (!Number.isInteger(selection.index) || selection.index < 0 || selection.index >= n) {
      throw new Error(`option index out of range: ${selection.index}`)
    }
    row = selection.index
  } else if (selection.kind === 'other') {
    row = n
  } else {
    throw new Error('codex questions are single-select')
  }
  if (row >= MAX_DIGIT) throw new Error(`option ${row + 1} has no digit shortcut`)
  const steps: SendStep[] = []
  // The TUI is still switching to the next question tab after the previous answer.
  if (position.index > 0) steps.push({ type: 'delay', ms: GROUP_GAP_MS })
  steps.push({ type: 'write', data: String(row + 1) })
  return steps
}
