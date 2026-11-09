// Scans every agent's logs into one UsageDataset (PRD F11 · 额度页). A file's result is kept in memory by its size +
// mtime signature, so a later scan reads only the files that changed; a file that is gone drops out. Nothing is written
// to disk. Runs in the usage-stats worker (./worker.ts), off the main thread.
import { Accumulator, type FileResult, type StoredRecord } from './accumulate'
import { SOURCES, type StatsDirs, type UsageSource } from './sources'
import { tokensOf, type SessionSpan, type StatsAgent, type UsageBucket, type UsageDataset } from '@shared/usage-stats'

interface Cached {
  signature: string
  result: FileResult
}

export class UsageScanner {
  private readonly cache = new Map<string, Cached>()

  constructor(
    private readonly dirs: StatsDirs,
    private readonly sources: readonly UsageSource[] = SOURCES,
    private readonly now: () => number = Date.now
  ) {}

  async scan(): Promise<UsageDataset> {
    const seen = new Set<string>()
    const results: FileResult[] = []
    let skipped = 0
    for (const source of this.sources) {
      const files = await source.list(this.dirs).catch(() => [])
      for (const { path, signature } of files) {
        const key = `${source.agent}\0${path}`
        seen.add(key)
        let cached = this.cache.get(key)
        if (!cached || cached.signature !== signature) {
          const acc = new Accumulator(source.agent, this.dirs.home)
          try {
            await source.read(path, acc)
          } catch {
            // Unreadable (permissions, a database being migrated, a file deleted mid-scan): counted, the rest goes on.
            skipped++
            continue
          }
          cached = { signature, result: acc.result() }
          this.cache.set(key, cached)
        }
        results.push(cached.result)
      }
    }
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key)
    return merge(results, skipped, this.now())
  }
}

/** A conversation idle this long is two stretches, so one resumed days later does not overlap everything between. */
export const SESSION_IDLE_MS = 30 * 60_000

const hourOf = (at: number): number => {
  const d = new Date(at)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

/** Every file's records → one dataset: a response repeated in several files counts once, then hour buckets and stretches. */
export function merge(results: readonly FileResult[], skippedFiles: number, now: number): UsageDataset {
  const unique = new Map<string, StoredRecord>()
  const records: StoredRecord[] = []
  let skipped = skippedFiles
  for (const result of results) {
    skipped += result.skipped
    for (const r of result.records) {
      if (!r.id) {
        records.push(r)
        continue
      }
      const key = `${r.agent}\0${r.id}`
      const seen = unique.get(key)
      if (!seen || r.split.output > seen.split.output) unique.set(key, r)
    }
  }
  records.push(...unique.values())
  const buckets = new Map<string, UsageBucket>()
  const times = new Map<string, { agent: StatsAgent; id: string; at: number[] }>()
  const firstAt: UsageDataset['firstAt'] = {}
  for (const r of records) {
    const hour = hourOf(r.at)
    const key = `${hour}\0${r.agent}\0${r.model}\0${r.project}`
    let b = buckets.get(key)
    if (!b) {
      b = { hour, agent: r.agent, model: r.model, project: r.project, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, unpriced: 0 }
      buckets.set(key, b)
    }
    b.input += r.split.input
    b.output += r.split.output
    b.cacheRead += r.split.cacheRead
    b.cacheWrite += r.split.cacheWrite
    if (r.cost === null) b.unpriced += tokensOf(r.split)
    else b.cost += r.cost
    firstAt[r.agent] = Math.min(firstAt[r.agent] ?? Infinity, r.at)
    const sk = `${r.agent}\0${r.session}`
    const t = times.get(sk)
    if (t) t.at.push(r.at)
    else times.set(sk, { agent: r.agent, id: r.session, at: [r.at] })
  }
  const sessions: SessionSpan[] = []
  for (const { agent, id, at } of times.values()) {
    at.sort((a, b) => a - b)
    let start = at[0]!
    let end = start
    for (const t of at) {
      if (t - end > SESSION_IDLE_MS) {
        sessions.push({ agent, id, start, end })
        start = t
      }
      end = t
    }
    sessions.push({ agent, id, start, end })
  }
  return { buckets: [...buckets.values()], sessions, firstAt, skipped, scannedAt: now }
}
