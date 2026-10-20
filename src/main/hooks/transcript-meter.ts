// Context history and token spend per session, read from the agents' own transcripts (PRD F11, Figma 18).
// - Claude: `transcript_path` of every hook → `~/.claude/projects/…/<id>.jsonl`. Each assistant message carries
//   `message.usage`; one message is written as several lines (one per content block), so it is counted once by
//   `message.id`. A real user prompt ends a turn; `system / compact_boundary` marks a compaction.
// - Codex: its rollout (`transcript_path` of its hooks). `event_msg / token_count` after each response (cumulative
//   `total_token_usage`, this response's `last_token_usage`), `event_msg / user_message` ends a turn, `compacted`
//   marks a compaction.
// The files are only read — incrementally, from where the last read stopped — and only inside the agents' own data
// directories. Nothing here is persisted: after an app restart a session's history is read again from its file.
import { open } from 'node:fs/promises'
import type { HookAgent } from '@shared/agent-events'
import type { ContextHistory, ContextPoint, SessionSpend, UsageVendor } from '@shared/session-meta'
import { claudeTranscriptPath, defaultAgentDataDirs, type AgentDataDirs } from './agent-title'
import { codexRolloutPath } from './codex-usage'
import type { Scheduler } from './permission-registry'

/** Kept per session; older turns scroll off the sparkline anyway. */
const MAX_TURNS = 200
/** Spend is kept for the longest plan window (7 days) and a little more. */
const SPEND_KEEP_MS = 8 * 24 * 60 * 60_000
/** Spend entries are merged per minute, which bounds them to ~11 k per session over 8 days. */
const SPEND_BUCKET_MS = 60_000
/** A first read of a long transcript starts this far from its end. */
const FIRST_READ_BYTES = 24 * 1024 * 1024
const CHUNK_BYTES = 4 * 1024 * 1024
/** Ids of recent assistant messages, to count each once. */
const MAX_IDS = 512
/** Read after these hooks, twice: the agent may still be appending the lines the hook follows. */
const READ_ON: ReadonlySet<string> = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'PreCompact', 'PostToolUse'])
const READ_AFTER_MS = [250, 1_500]

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0)

/** What the lines read so far say. Mutated by `parseLines`. */
export interface MeterState {
  turns: ContextPoint[]
  /** The newest reply's context, not yet closed by a prompt. */
  pending: ContextPoint | null
  compactions: number[]
  windowTokens?: number
  spend: { at: number; tokens: number }[]
  /** Claude: message id → output tokens already counted (a message's lines can grow its usage). */
  counted: Map<string, number>
  /** Codex: the cumulative total of the last token_count counted. */
  cumulative: number
}

export function emptyMeterState(): MeterState {
  return { turns: [], pending: null, compactions: [], spend: [], counted: new Map(), cumulative: 0 }
}

function timeOf(entry: Rec, fallback: number): number {
  const parsed = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function addSpend(state: MeterState, at: number, tokens: number): void {
  if (tokens <= 0) return
  const bucket = Math.floor(at / SPEND_BUCKET_MS) * SPEND_BUCKET_MS
  const last = state.spend[state.spend.length - 1]
  if (last && last.at === bucket) last.tokens += tokens
  else state.spend.push({ at: bucket, tokens })
}

function closeTurn(state: MeterState): void {
  if (!state.pending) return
  state.turns.push(state.pending)
  state.pending = null
  if (state.turns.length > MAX_TURNS) state.turns.splice(0, state.turns.length - MAX_TURNS)
}

/** A user line that is a prompt the person typed (not a tool result, a command echo or a compaction summary). */
function isClaudePrompt(entry: Rec): boolean {
  if (entry.isMeta === true || entry.isSidechain === true || entry.isCompactSummary === true) return false
  const message = isRec(entry.message) ? entry.message : null
  if (!message) return false
  const content = message.content
  if (typeof content === 'string') return content.trim() !== '' && !content.startsWith('<command-') && !content.startsWith('<local-command')
  return Array.isArray(content) && content.some((block) => isRec(block) && block.type === 'text') && !content.some((b) => isRec(b) && b.type === 'tool_result')
}

/**
 * Spend in input-token equivalents at the vendor's API prices, so sessions compare the way the plan meters them more
 * than raw counts do (a long cached prefix is cheap). Claude: cache write 1.25×, cache read 0.1×, output 5× input;
 * Codex (GPT-5 family): cached input 0.1×, output 8×. Within one vendor's own price list only; an estimate.
 */
export const CLAUDE_WEIGHT = { write: 1.25, read: 0.1, output: 5 } as const
export const CODEX_WEIGHT = { cached: 0.1, output: 8 } as const

function claudeLine(state: MeterState, entry: Rec, now: number): void {
  const at = timeOf(entry, now)
  if (entry.type === 'assistant' && isRec(entry.message) && isRec(entry.message.usage)) {
    const usage = entry.message.usage
    const id = typeof entry.message.id === 'string' ? entry.message.id : typeof entry.requestId === 'string' ? entry.requestId : ''
    const input = count(usage.input_tokens)
    const write = count(usage.cache_creation_input_tokens)
    const read = count(usage.cache_read_input_tokens)
    const output = count(usage.output_tokens)
    const seen = id ? state.counted.get(id) : undefined
    if (seen === undefined) {
      addSpend(state, at, Math.round(input + write * CLAUDE_WEIGHT.write + read * CLAUDE_WEIGHT.read + output * CLAUDE_WEIGHT.output))
      if (id) {
        state.counted.set(id, output)
        if (state.counted.size > MAX_IDS) state.counted.delete(state.counted.keys().next().value!)
      }
    } else if (output > seen) {
      addSpend(state, at, (output - seen) * CLAUDE_WEIGHT.output)
      state.counted.set(id, output)
    }
    // Subagents run in their own context; only the main conversation's fill counts.
    if (entry.isSidechain !== true && input + write + read > 0) state.pending = { at, tokens: input + write + read }
    return
  }
  if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
    closeTurn(state)
    state.compactions.push(at)
    return
  }
  if (entry.type === 'user' && isClaudePrompt(entry)) closeTurn(state)
}

function codexLine(state: MeterState, entry: Rec, now: number): void {
  const at = timeOf(entry, now)
  if (entry.type === 'compacted') {
    closeTurn(state)
    state.compactions.push(at)
    return
  }
  if (entry.type !== 'event_msg' || !isRec(entry.payload)) return
  const payload = entry.payload
  if (payload.type === 'user_message') {
    closeTurn(state)
    return
  }
  if (payload.type !== 'token_count' || !isRec(payload.info)) return
  const info = payload.info
  const window = count(info.model_context_window)
  if (window > 0) state.windowTokens = window
  const last = isRec(info.last_token_usage) ? info.last_token_usage : null
  const total = isRec(info.total_token_usage) ? count(info.total_token_usage.total_tokens) : 0
  // The same token_count is repeated (e.g. when rate limits update); only a larger running total is new spend.
  if (last && total > state.cumulative) {
    state.cumulative = total
    const cached = count(last.cached_input_tokens)
    const fresh = Math.max(0, count(last.input_tokens) - cached)
    addSpend(state, at, Math.round(fresh + cached * CODEX_WEIGHT.cached + count(last.output_tokens) * CODEX_WEIGHT.output))
  }
  if (last && count(last.total_tokens) > 0) state.pending = { at, tokens: count(last.total_tokens) }
}

/** Applies complete JSONL lines to the state. Unparseable lines are skipped. */
export function parseLines(agent: UsageVendor, state: MeterState, lines: readonly string[], now: number): void {
  for (const line of lines) {
    if (line === '') continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRec(entry)) continue
    if (agent === 'claude') claudeLine(state, entry, now)
    else codexLine(state, entry, now)
  }
}

export function historyOf(state: MeterState): ContextHistory {
  const turns = state.pending ? [...state.turns, state.pending] : [...state.turns]
  return { turns, compactions: [...state.compactions], ...(state.windowTokens ? { windowTokens: state.windowTokens } : {}) }
}

export function spendSince(state: MeterState, since: number): number {
  let total = 0
  for (const s of state.spend) if (s.at + SPEND_BUCKET_MS > since) total += s.tokens
  return total
}

/** Reads a file from `start` (at most a few MB); `size` is the file's length. A start past the end reads nothing. */
export type RangeReader = (path: string, start: number) => Promise<{ text: string; size: number; end: number }>

const readRange: RangeReader = async (path, start) => {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(CHUNK_BYTES, size - start)
    if (length <= 0) return { text: '', size, end: start }
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), size, end: start + bytesRead }
  } finally {
    await handle.close()
  }
}

interface Tracked {
  agent: UsageVendor
  path: string | null
  offset: number
  /** A line cut by the end of the last read. */
  carry: string
  state: MeterState
  timers: unknown[]
  reading: Promise<void> | null
  again: boolean
  /** Set when the session's PTY ended; its spend still counts in the windows it fell in. */
  detachedAt?: number
}

export class TranscriptMeter {
  private readonly sessions = new Map<string, Tracked>()
  /** Sessions off their vendor's plan (a third-party endpoint): their tokens are not the account's to share. */
  private readonly offPlan = new Set<string>()
  private readonly dirs: AgentDataDirs
  private readonly read: RangeReader
  private readonly scheduler: Scheduler
  private readonly now: () => number

  constructor(options: { dirs?: AgentDataDirs; read?: RangeReader; scheduler?: Scheduler; now?: () => number } = {}) {
    this.dirs = options.dirs ?? defaultAgentDataDirs()
    this.read = options.read ?? readRange
    this.scheduler = options.scheduler ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) }
    this.now = options.now ?? Date.now
  }

  observe(sessionId: string, agent: HookAgent, event: string, payload: unknown): void {
    if ((agent !== 'claude' && agent !== 'codex') || !isRec(payload)) return
    const raw = payload.transcript_path
    const path = agent === 'claude' ? claudeTranscriptPath(raw, this.dirs) : codexRolloutPath(raw, this.dirs)
    let tracked = this.sessions.get(sessionId)
    if (!tracked || tracked.agent !== agent || tracked.detachedAt !== undefined) {
      tracked = { agent, path: null, offset: 0, carry: '', state: emptyMeterState(), timers: [], reading: null, again: false }
      this.sessions.set(sessionId, tracked)
    }
    if (path && path !== tracked.path) {
      // /clear or /resume moved the conversation to another file: its history starts over, its spend stays.
      const spend = tracked.state.spend
      tracked.state = emptyMeterState()
      tracked.state.spend = spend
      tracked.path = path
      tracked.offset = 0
      tracked.carry = ''
    }
    if (!tracked.path || !READ_ON.has(event)) return
    for (const timer of tracked.timers) this.scheduler.clearTimeout(timer)
    const current = tracked
    tracked.timers = READ_AFTER_MS.map((ms) => this.scheduler.setTimeout(() => void this.pull(current), ms))
  }

  /** The session's PTY ended. Its history goes; its spend stays for the windows it was in. */
  forget(sessionId: string): void {
    const tracked = this.sessions.get(sessionId)
    if (!tracked) return
    for (const timer of tracked.timers) this.scheduler.clearTimeout(timer)
    tracked.timers = []
    tracked.detachedAt = this.now()
    tracked.state.turns = []
    tracked.state.pending = null
    this.prune()
  }

  /** Reads what was appended since the last read, then answers. */
  async history(sessionId: string): Promise<ContextHistory | null> {
    const tracked = this.sessions.get(sessionId)
    if (!tracked || tracked.detachedAt !== undefined) return null
    await this.pull(tracked)
    return historyOf(tracked.state)
  }

  /** The session's agent said whether it bills its vendor's plan (AgentEvent `billing`). */
  setPlan(sessionId: string, plan: boolean): void {
    if (plan) this.offPlan.delete(sessionId)
    else this.offPlan.add(sessionId)
  }

  /** Every session of `vendor` on its plan that spent tokens since `since` (closed ones too). */
  async spend(vendor: UsageVendor, since: number): Promise<SessionSpend[]> {
    const out: SessionSpend[] = []
    for (const [sessionId, tracked] of this.sessions) {
      if (tracked.agent !== vendor || this.offPlan.has(sessionId)) continue
      if (tracked.detachedAt === undefined) await this.pull(tracked)
      const tokens = spendSince(tracked.state, since)
      if (tokens > 0) out.push({ sessionId, tokens })
    }
    return out
  }

  private prune(): void {
    const cutoff = this.now() - SPEND_KEEP_MS
    for (const [id, tracked] of this.sessions) {
      if (tracked.detachedAt !== undefined && tracked.detachedAt < cutoff) {
        this.sessions.delete(id)
        this.offPlan.delete(id)
      } else {
        const spend = tracked.state.spend
        let drop = 0
        while (drop < spend.length && spend[drop]!.at < cutoff) drop++
        if (drop > 0) spend.splice(0, drop)
      }
    }
  }

  /** One read at a time per session; a request during a read runs once more after it. */
  private pull(tracked: Tracked): Promise<void> {
    if (tracked.reading) {
      tracked.again = true
      return tracked.reading
    }
    tracked.reading = (async () => {
      do {
        tracked.again = false
        await this.readOnce(tracked)
      } while (tracked.again)
    })().finally(() => {
      tracked.reading = null
    })
    return tracked.reading
  }

  private async readOnce(tracked: Tracked): Promise<void> {
    const path = tracked.path
    if (!path) return
    for (;;) {
      let chunk: Awaited<ReturnType<RangeReader>>
      let skipFirstLine = false
      try {
        chunk = await this.read(path, tracked.offset)
        if (chunk.size < tracked.offset) {
          // Replaced by a shorter file: start over from its top.
          tracked.state = { ...emptyMeterState(), spend: tracked.state.spend }
          tracked.offset = 0
          tracked.carry = ''
          continue
        }
        if (tracked.offset === 0 && chunk.size > FIRST_READ_BYTES) {
          // A long transcript: its last stretch is enough for the sparkline and the plan windows.
          tracked.offset = chunk.size - FIRST_READ_BYTES
          chunk = await this.read(path, tracked.offset)
          skipFirstLine = true
        }
      } catch {
        return
      }
      if (tracked.path !== path) return
      let text = tracked.carry + chunk.text
      if (skipFirstLine) {
        const newline = text.indexOf('\n')
        text = newline >= 0 ? text.slice(newline + 1) : ''
      }
      const cut = text.lastIndexOf('\n')
      tracked.carry = cut >= 0 ? text.slice(cut + 1) : text
      if (cut >= 0) parseLines(tracked.agent, tracked.state, text.slice(0, cut).split('\n'), this.now())
      tracked.offset = chunk.end
      if (chunk.end >= chunk.size || chunk.text === '') return
    }
  }
}
