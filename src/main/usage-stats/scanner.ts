// Scans every agent's logs into one UsageDataset (PRD F11 · 额度页). A file's result is kept in memory by its size +
// mtime signature, so a later scan reads only the files that changed; a file that is gone drops out. Nothing is written
// to disk. Runs in the usage-stats worker (./worker.ts), off the main thread.
import { Accumulator, type FileResult } from './accumulate'
import { SOURCES, type StatsDirs, type UsageSource } from './sources'
import type { SessionSpan, StatsAgent, UsageBucket, UsageDataset } from '@shared/usage-stats'

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
    const results: { agent: StatsAgent; result: FileResult }[] = []
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
        results.push({ agent: source.agent, result: cached.result })
      }
    }
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key)
    return merge(results, skipped, this.now())
  }
}

export function merge(results: readonly { agent: StatsAgent; result: FileResult }[], skippedFiles: number, now: number): UsageDataset {
  const buckets = new Map<string, UsageBucket>()
  const sessions = new Map<string, SessionSpan>()
  const firstAt: UsageDataset['firstAt'] = {}
  let skipped = skippedFiles
  for (const { agent, result } of results) {
    skipped += result.skipped
    if (result.firstAt !== null) firstAt[agent] = Math.min(firstAt[agent] ?? Infinity, result.firstAt)
    for (const b of result.buckets) {
      const key = `${b.hour}\0${b.agent}\0${b.model}\0${b.project}`
      const into = buckets.get(key)
      if (!into) buckets.set(key, { ...b })
      else {
        into.input += b.input
        into.output += b.output
        into.cacheRead += b.cacheRead
        into.cacheWrite += b.cacheWrite
        into.cost += b.cost
        into.unpriced += b.unpriced
      }
    }
    for (const [id, s] of result.sessions) {
      const key = `${agent}\0${id}`
      const into = sessions.get(key)
      if (!into) sessions.set(key, { ...s })
      else {
        into.start = Math.min(into.start, s.start)
        into.end = Math.max(into.end, s.end)
      }
    }
  }
  return { buckets: [...buckets.values()], sessions: [...sessions.values()], firstAt, skipped, scannedAt: now }
}
