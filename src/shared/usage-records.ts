// The token usage one line of an agent's own transcript reports (PRD F11). Shared by the per-session context meter
// (src/main/hooks/transcript-meter.ts) and the 额度 page's statistics (src/main/usage-stats), so both count the same way.
// - Claude (`~/.claude/projects/…/<id>.jsonl`): an assistant line carries `message.usage`; one message is written as
//   several lines (one per content block) that repeat its usage, and its output count can grow from line to line, so
//   callers count a message once by `id` and add only output growth.
// - Codex (rollout `event_msg / token_count`): `last_token_usage` is this response, `total_token_usage` the running
//   total; the same token_count is repeated (e.g. when rate limits update), so only a larger running total is new.
//   Codex's `input_tokens` includes the cached part.

export type JsonRec = Record<string, unknown>

export const isRec = (value: unknown): value is JsonRec => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A non-negative whole token count, 0 for anything else. */
export const tokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0

/** An ISO `timestamp` field in ms, or `fallback`. */
export function entryTime(entry: JsonRec, fallback: number): number {
  const parsed = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

export interface ClaudeUsage {
  /** `message.id`, else `requestId`; '' when neither is there (counted every time). */
  id: string
  model: string
  /** Uncached input. */
  input: number
  cacheWrite: number
  cacheRead: number
  output: number
  /** A subagent's line (its own context). */
  sidechain: boolean
}

/** The usage of a Claude assistant line, or null. */
export function claudeUsage(entry: JsonRec): ClaudeUsage | null {
  if (entry.type !== 'assistant' || !isRec(entry.message) || !isRec(entry.message.usage)) return null
  const message = entry.message
  const usage = message.usage as JsonRec
  return {
    id: typeof message.id === 'string' ? message.id : typeof entry.requestId === 'string' ? entry.requestId : '',
    model: typeof message.model === 'string' ? message.model : '',
    input: tokenCount(usage.input_tokens),
    cacheWrite: tokenCount(usage.cache_creation_input_tokens),
    cacheRead: tokenCount(usage.cache_read_input_tokens),
    output: tokenCount(usage.output_tokens),
    sidechain: entry.isSidechain === true
  }
}

export interface CodexTokenCount {
  /** `total_token_usage.total_tokens`: the running total, to tell a new response from a repeat. */
  runningTotal: number
  /** This response (`last_token_usage`); null when the event has none. */
  last: { input: number; cached: number; output: number; total: number } | null
  /** `model_context_window`, 0 when absent. */
  window: number
}

/** A Codex rollout `token_count` event, or null. */
export function codexTokenCount(entry: JsonRec): CodexTokenCount | null {
  if (entry.type !== 'event_msg' || !isRec(entry.payload) || entry.payload.type !== 'token_count') return null
  const info = entry.payload.info
  if (!isRec(info)) return null
  const last = isRec(info.last_token_usage) ? info.last_token_usage : null
  return {
    runningTotal: isRec(info.total_token_usage) ? tokenCount(info.total_token_usage.total_tokens) : 0,
    last: last
      ? {
          input: tokenCount(last.input_tokens),
          cached: tokenCount(last.cached_input_tokens),
          output: tokenCount(last.output_tokens),
          total: tokenCount(last.total_tokens)
        }
      : null,
    window: tokenCount(info.model_context_window)
  }
}
