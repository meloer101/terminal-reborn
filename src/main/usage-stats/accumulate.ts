// One log file's usage, summed into local-hour buckets per model and project (PRD F11 · 额度页). The sources push one
// record per model response; nothing of the transcript but token counts, model, time and project is kept.
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { apiCost } from '@shared/model-prices'
import { projectOf, tokensOf, type SessionSpan, type StatsAgent, type TokenSplit, type UsageBucket } from '@shared/usage-stats'

export interface UsageRecord {
  at: number
  model: string
  split: TokenSplit
  /** USD the log itself reports for this response; the price table is used when absent. */
  cost?: number
}

export interface FileResult {
  buckets: UsageBucket[]
  /** Keyed by conversation id, so a subagent's file joins its parent conversation. */
  sessions: Map<string, SessionSpan>
  firstAt: number | null
  skipped: number
}

const hourOf = (at: number): number => {
  const d = new Date(at)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

export class Accumulator {
  private readonly buckets = new Map<string, UsageBucket>()
  private readonly sessions = new Map<string, SessionSpan>()
  private firstAt: number | null = null
  private skipped = 0

  constructor(
    readonly agent: StatsAgent,
    private readonly home: string
  ) {}

  add(session: string, cwd: string, r: UsageRecord): void {
    const tokens = tokensOf(r.split)
    if (!Number.isFinite(r.at) || tokens <= 0) return
    const project = cwd ? projectOf(cwd, this.home) : '?'
    const hour = hourOf(r.at)
    const key = `${hour}\0${r.model}\0${project}`
    let b = this.buckets.get(key)
    if (!b) {
      b = { hour, agent: this.agent, model: r.model, project, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 }
      this.buckets.set(key, b)
    }
    b.input += r.split.input
    b.output += r.split.output
    b.cacheRead += r.split.cacheRead
    b.cacheWrite += r.split.cacheWrite
    const cost = typeof r.cost === 'number' && r.cost > 0 ? r.cost : apiCost(r.model, r.split)
    if (cost === null) b.unpriced += tokens
    else b.cost += cost
    const s = this.sessions.get(session)
    if (s) {
      s.start = Math.min(s.start, r.at)
      s.end = Math.max(s.end, r.at)
    } else this.sessions.set(session, { agent: this.agent, start: r.at, end: r.at })
    this.firstAt = this.firstAt === null ? r.at : Math.min(this.firstAt, r.at)
  }

  skip(): void {
    this.skipped++
  }

  result(): FileResult {
    return { buckets: [...this.buckets.values()], sessions: this.sessions, firstAt: this.firstAt, skipped: this.skipped }
  }
}

/** Calls `fn` with each parsed JSON line that `keep` lets through (a cheap substring test before parsing). */
export async function forEachJsonLine(path: string, keep: (line: string) => boolean, fn: (entry: unknown) => void, acc: Accumulator): Promise<void> {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!keep(line)) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      acc.skip()
      continue
    }
    fn(entry)
  }
}
