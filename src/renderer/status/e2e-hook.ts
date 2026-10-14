// End-to-end test seam, only created when the page opts in with `globalThis.__TR_E2E__`.
// Playwright drives synthetic agent signals through `window.__trStatus` and observes what the
// bridge would have sent to the OS (Dock badge, notifications) without touching either.
import type { AgentEvent } from '@shared/agent-events'
import type { SessionState } from '@shared/session-state-machine'
import type { SessionId } from '@shared/types'

export interface RecordedCalls {
  /** Every Dock badge value sent, in order. */
  badge: number[]
  notification: { title: string; body: string; tag: string }[]
}

/** What the test page sees on `globalThis.__trStatus`. */
export interface TrStatusHook {
  emit(sessionId: SessionId, event: AgentEvent): void
  ptyExit(sessionId: SessionId, code: number): void
  title(sessionId: SessionId, title: string): void
  /** Moves the bridge's clock forward and runs a self-heal tick. */
  advance(ms: number): void
  /** Overrides window focus (null = use the real one) and re-evaluates what is being viewed. */
  setFocused(focused: boolean | null): void
  state(sessionId: SessionId): SessionState | undefined
  calls: RecordedCalls
}

interface Controls {
  emit(sessionId: SessionId, event: AgentEvent): void
  ptyExit(sessionId: SessionId, code: number): void
  title(sessionId: SessionId, title: string): void
  tick(): void
  refreshViewing(): void
  stateOf(sessionId: SessionId): SessionState | undefined
}

export interface E2eHook {
  now(): number
  /** Overridden focus, or undefined to use the real window focus. */
  focused(): boolean | undefined
  record<K extends keyof RecordedCalls>(kind: K, value: RecordedCalls[K][number]): void
  attach(controls: Controls): void
  detach(): void
}

export function createE2eHook(): E2eHook {
  let offset = 0
  let focusOverride: boolean | null = null
  const calls: RecordedCalls = { badge: [], notification: [] }
  const target = globalThis as { __trStatus?: TrStatusHook }

  return {
    now: () => Date.now() + offset,
    focused: () => focusOverride ?? undefined,
    record(kind, value) {
      ;(calls[kind] as unknown[]).push(value)
    },
    attach(controls) {
      target.__trStatus = {
        emit: controls.emit,
        ptyExit: controls.ptyExit,
        title: controls.title,
        advance(ms) {
          offset += ms
          controls.tick()
        },
        setFocused(focused) {
          focusOverride = focused
          controls.refreshViewing()
        },
        state: controls.stateOf,
        calls
      }
    },
    detach() {
      delete target.__trStatus
    }
  }
}
