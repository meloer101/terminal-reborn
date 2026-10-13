// How composer text gets into an agent's TUI. See docs/PRD.md §4 F1.
// Implementation is owned by the `spike-send` track (docs/tasks/m1-spike-send.md).

import type { AgentKind } from './types'

export type SendStep =
  /** Raw bytes to the PTY. */
  | { type: 'write'; data: string }
  /** Block until any needle is visible in the terminal buffer, or fail after timeoutMs. */
  | { type: 'waitForText'; needles: string[]; timeoutMs: number }
  | { type: 'delay'; ms: number }

/** Planner signature: pure, unit-testable. */
export type PlanSend = (text: string, agent: AgentKind) => SendStep[]

/** What the executor needs from a live session. */
export interface SendIo {
  write(data: string): void
  /** Visible screen text (and recent scrollback) of the session's terminal. */
  readScreen(): string
}
