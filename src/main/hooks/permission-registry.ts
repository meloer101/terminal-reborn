// Pending PermissionRequest holds (PRD §4 F3). A PermissionRequest hook is an open HTTP request that
// Claude waits on; the registry owns the response body and decides when it is released:
//   answered in our UI   -> a decision JSON         (resolution 'gui')
//   nobody answers       -> empty body after 120 s  (resolution 'timeout'; the TUI prompt takes over)
//   answered in the TUI  -> empty body              (resolution 'terminal', see `resolve`)
//   newer request        -> the old one is stale    (resolution 'terminal')
//   session went away    -> empty body              (resolution 'session-ended')
// An empty body is always safe: spike §4 showed Claude keeps its own dialog open while a hook is
// pending and falls back to it when the hook says nothing.
import type { PendingPrompt, PermissionDecision, PromptResolution } from '@shared/agent-events'

export const PERMISSION_TIMEOUT_MS = 120_000

export type PermissionPrompt = Extract<PendingPrompt, { kind: 'permission' }>

export interface PermissionHold {
  prompt: PermissionPrompt
  /** `permission_suggestions` from the request, returned as `updatedPermissions` on "allow always". */
  suggestions: unknown[]
  /** Completes the held HTTP response with this body ('' = no opinion). */
  release(body: string): void
}

export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realScheduler: Scheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

/** The hook's stdout for a decision (Claude Code hooks reference, PermissionRequest output). */
export function decisionBody(decision: PermissionDecision, suggestions: unknown[]): string {
  const behavior =
    decision === 'deny'
      ? { behavior: 'deny', message: 'The user denied this request in Terminal Reborn.', interrupt: false }
      : decision === 'allow-always' && suggestions.length > 0
        ? { behavior: 'allow', updatedPermissions: suggestions }
        : { behavior: 'allow' }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: behavior } })
}

interface Entry extends PermissionHold {
  timer: unknown
  /** Identifies the tool call, to match its PostToolUse. */
  toolKey: string
}

/** Same tool + same input = same call (PostToolUse repeats the PreToolUse / PermissionRequest input). */
export function toolKey(tool: string, input: Record<string, unknown>): string {
  return `${tool}\u0000${stableStringify(input)}`
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export class PermissionRegistry {
  private readonly entries = new Map<string, Entry>()

  constructor(
    private readonly emit: (resolution: PromptResolution) => void,
    private readonly scheduler: Scheduler = realScheduler,
    private readonly timeoutMs: number = PERMISSION_TIMEOUT_MS
  ) {}

  /** Registers a hold. A still-pending older request of the same session is superseded. */
  add(hold: PermissionHold): void {
    this.resolveSession(hold.prompt.sessionId, 'terminal')
    const id = hold.prompt.id
    const timer = this.scheduler.setTimeout(() => this.finish(id, '', 'timeout'), this.timeoutMs)
    this.entries.set(id, { ...hold, timer, toolKey: toolKey(hold.prompt.tool, hold.prompt.input) })
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  get size(): number {
    return this.entries.size
  }

  sessionOf(id: string): string | undefined {
    return this.entries.get(id)?.prompt.sessionId
  }

  /** Answers from the UI. Unknown / already-resolved ids are ignored. */
  respond(id: string, decision: PermissionDecision): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    this.finish(id, decisionBody(decision, entry.suggestions), 'gui')
    return true
  }

  /** The hook connection went away on its own. */
  cancel(id: string, by: 'terminal' | 'session-ended'): void {
    this.finish(id, '', by)
  }

  /**
   * The agent's own UI answered or moved on. With `tool`, only the hold for that exact tool call
   * is resolved (parallel tool calls must not release each other); otherwise every hold of the session.
   */
  resolveSession(sessionId: string, by: 'terminal' | 'session-ended', tool?: { name: string; input: Record<string, unknown> }): void {
    const key = tool ? toolKey(tool.name, tool.input) : undefined
    for (const [id, entry] of [...this.entries]) {
      if (entry.prompt.sessionId !== sessionId) continue
      if (key !== undefined && entry.toolKey !== key) continue
      this.finish(id, '', by)
    }
  }

  private finish(id: string, body: string, by: PromptResolution['by']): void {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.scheduler.clearTimeout(entry.timer)
    try {
      entry.release(body)
    } finally {
      this.emit({ id, sessionId: entry.prompt.sessionId, by })
    }
  }
}
