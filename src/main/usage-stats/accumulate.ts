// One log file's usage records (PRD F11 · 额度页). The sources push one record per model response; nothing of the
// transcript but token counts, model, time, project and conversation id is kept. Records stay per file (so a changed
// file is reread alone) and are summed in ./scanner.ts `merge`, where a response that several files repeat (Claude
// copies history into a resumed or forked conversation's file) is counted once.
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { apiCost } from '@shared/model-prices'
import { projectOf, tokensOf, type StatsAgent, type TokenSplit } from '@shared/usage-stats'

export interface UsageRecord {
  at: number
  model: string
  split: TokenSplit
  /** USD the log itself reports for this response; the price table is used when absent. */
  cost?: number
  /** The response's own id (Claude's message id), to count it once across files; '' when there is none. */
  id?: string
}

export interface StoredRecord {
  agent: StatsAgent
  session: string
  id: string
  at: number
  model: string
  project: string
  split: TokenSplit
  /** USD at API prices, null when the model has no known price. */
  cost: number | null
}

export interface FileResult {
  records: StoredRecord[]
  skipped: number
}

export class Accumulator {
  private readonly records: StoredRecord[] = []
  /** Within a file, a response written as several lines keeps its fullest line (its output count can grow). */
  private readonly byId = new Map<string, StoredRecord>()
  private skipped = 0

  constructor(
    readonly agent: StatsAgent,
    private readonly home: string
  ) {}

  add(session: string, cwd: string, r: UsageRecord): void {
    if (!Number.isFinite(r.at) || tokensOf(r.split) <= 0) return
    const record: StoredRecord = {
      agent: this.agent,
      session,
      id: r.id ?? '',
      at: r.at,
      model: r.model,
      project: cwd ? projectOf(cwd, this.home) : '?',
      split: r.split,
      cost: typeof r.cost === 'number' && r.cost > 0 ? r.cost : apiCost(r.model, r.split)
    }
    if (!record.id) {
      this.records.push(record)
      return
    }
    const seen = this.byId.get(record.id)
    if (!seen || record.split.output > seen.split.output) this.byId.set(record.id, seen ? { ...record, at: seen.at } : record)
  }

  skip(): void {
    this.skipped++
  }

  result(): FileResult {
    return { records: [...this.records, ...this.byId.values()], skipped: this.skipped }
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
