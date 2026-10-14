// Answering Claude Code's AskUserQuestion menu with keystrokes (PRD F3).
// Pure: decides WHAT to type; the renderer runs the steps on the session's serial queue (runSteps).
//
// Every sequence below was verified against the real CLI (Claude Code 2.1.299) with
// scripts/spikes/22-ask-user-question.mjs; see docs/spikes/ask-user-question.md.
//
//   single           digit N selects AND submits that question. 1 question: done. 2+ questions: the TUI
//                    advances to the next question tab; after the last one it shows a "Review your answers"
//                    screen whose default row is "1. Submit answers" -> one more Enter.
//   other (single)   digit N+1 ("Type something.") opens a text field; type; Enter submits as above.
//   multi            digit N toggles option N (cursor does not move). `→` leaves the question (next tab, or the
//                    review screen after the last one); then Enter on "1. Submit answers" if it is the last.
//   other (multi)    the digit only ticks the row, it does NOT open the field. Move the cursor onto the
//                    "Type something" row with ↓, type (this ticks it), ↓ to the "Submit" row, Enter to leave.
//                    `→` / Enter inside the text field do not leave it (Enter would untick the row).
//
// Prior art: Orca's native-chat-ask.ts (MIT) sends the same digit keystrokes; the multi/other details above
// are our own measurements, no code is copied.
import type { AgentQuestion } from './agent-events'
import { normalizeSendText, pasteTimeoutMs, utf8ByteLength, type SendStep } from './send-protocol'

export type QuestionSelection =
  /** Single-select: option index (0-based). */
  | { kind: 'single'; index: number }
  /** Single-select, free text instead of an option. */
  | { kind: 'other'; text: string }
  /** Multi-select: ticked option indices (0-based) plus optional free text as the last, extra choice. */
  | { kind: 'multi'; indices: number[]; other?: string }

/** Position of the question in the AskUserQuestion call (the TUI shows one tab per question). */
export interface QuestionPosition {
  index: number
  total: number
}

export const KEY_ENTER = '\r'
export const KEY_DOWN = '\x1b[B'
export const KEY_UP = '\x1b[A'
export const KEY_RIGHT = '\x1b[C'

/** Pause between key groups: the TUI redraws (tab switch, text field) in well under this. */
export const GROUP_GAP_MS = 500
/** Pause between two keys of the same group (digit toggles). */
export const KEY_GAP_MS = 150
/** The digit shortcuts stop at 9. */
export const MAX_DIGIT = 9

/** Options the user can pick from the bar: every option plus "其他…". */
export function choiceCount(question: AgentQuestion): number {
  return question.options.length + 1
}

/** Free text as one line: the TUI field is single-line. */
export function cleanOtherText(text: string): string {
  return normalizeSendText(text).replace(/\s+/g, ' ').trim()
}

const repeat = (key: string, n: number): SendStep[] =>
  Array.from({ length: Math.max(0, n) }, () => ({ type: 'write', data: key }) as const)

/** Needle that proves the typed text reached the field: its first characters (one row, no wrapping issue). */
function echoNeedle(text: string): string {
  return [...text].slice(0, 12).join('').trimEnd()
}

/** Select the row at `row` (0-based) and press Enter / its digit. Returns steps; the cursor ends on that row. */
function pickRow(row: number): SendStep[] {
  return row < MAX_DIGIT ? [{ type: 'write', data: String(row + 1) }] : [...repeat(KEY_DOWN, row), { type: 'write', data: KEY_ENTER }]
}

function typeText(text: string): SendStep[] {
  return [
    { type: 'write', data: text },
    { type: 'waitForText', needles: [echoNeedle(text)], timeoutMs: pasteTimeoutMs(utf8ByteLength(text)) },
    { type: 'delay', ms: KEY_GAP_MS }
  ]
}

const gap = (): SendStep => ({ type: 'delay', ms: GROUP_GAP_MS })

/**
 * Keystrokes that answer `question` as shown in the TUI.
 * Throws when the selection does not fit the question (out-of-range index, wrong kind, empty free text):
 * the UI never produces those, so it is a programming error rather than something to guess around.
 */
export function planQuestionAnswer(
  question: AgentQuestion,
  selection: QuestionSelection,
  position: QuestionPosition = { index: 0, total: 1 }
): SendStep[] {
  const n = question.options.length
  const isLast = position.index === position.total - 1
  const steps: SendStep[] = []
  // The TUI is still switching tabs after the previous answer.
  if (position.index > 0) steps.push(gap())

  if (question.multiSelect) {
    if (selection.kind !== 'multi') throw new Error('multi-select question needs a multi selection')
    const indices = [...new Set(selection.indices)].sort((a, b) => a - b)
    for (const i of indices) if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`option index out of range: ${i}`)
    const other = selection.other === undefined ? '' : cleanOtherText(selection.other)
    if (selection.other !== undefined && other === '') throw new Error('empty free-text answer')

    // Ticks: digits toggle without moving the cursor (cursor stays on row 0). Rows past 9 need the arrows.
    let cursor = 0
    indices.forEach((row, k) => {
      if (k > 0) steps.push({ type: 'delay', ms: KEY_GAP_MS })
      if (row < MAX_DIGIT) {
        steps.push({ type: 'write', data: String(row + 1) })
      } else {
        steps.push(...repeat(row > cursor ? KEY_DOWN : KEY_UP, Math.abs(row - cursor)), { type: 'write', data: KEY_ENTER })
        cursor = row
      }
    })

    if (other !== '') {
      if (indices.length > 0) steps.push(gap())
      steps.push(...repeat(KEY_DOWN, n - cursor))
      steps.push(...typeText(other))
      // ↓ onto the "Submit" row, Enter leaves the question.
      steps.push({ type: 'write', data: KEY_DOWN }, { type: 'delay', ms: KEY_GAP_MS }, { type: 'write', data: KEY_ENTER })
    } else {
      if (indices.length > 0) steps.push(gap())
      steps.push({ type: 'write', data: KEY_RIGHT })
    }
    if (isLast) steps.push(gap(), { type: 'write', data: KEY_ENTER })
    return steps
  }

  if (selection.kind === 'single') {
    if (!Number.isInteger(selection.index) || selection.index < 0 || selection.index >= n) {
      throw new Error(`option index out of range: ${selection.index}`)
    }
    steps.push(...pickRow(selection.index))
  } else if (selection.kind === 'other') {
    const text = cleanOtherText(selection.text)
    if (text === '') throw new Error('empty free-text answer')
    steps.push(...pickRow(n), gap(), ...typeText(text), { type: 'write', data: KEY_ENTER })
  } else {
    throw new Error('single-select question needs a single or other selection')
  }
  // Several questions end on the review screen; one question submits by itself.
  if (isLast && position.total > 1) steps.push(gap(), { type: 'write', data: KEY_ENTER })
  return steps
}
