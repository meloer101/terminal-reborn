// Grok CLI: ~/.grok/sessions/<url-encoded cwd>/<session>/updates.jsonl. Each `turn_completed` update carries the
// turn's usage per model; `inputTokens` includes the cached part, cost is in ticks of 1e-10 USD (as tokscale reads it,
// tokscale@82613d2 crates/tokscale-core/src/sessions/grok.rs:586). A turn reported twice (same event id) counts once,
// the later report winning.
import { basename, dirname } from 'node:path'
import { isRec, tokenCount, type JsonRec } from '@shared/usage-records'
import type { UsageRecord } from '../accumulate'
import { forEachJsonLine } from '../accumulate'
import { jsonlFiles } from './files'
import type { UsageSource } from './source'

function decodeCwd(dir: string): string {
  try {
    return decodeURIComponent(basename(dir))
  } catch {
    return ''
  }
}

function timeOf(entry: JsonRec): number {
  const meta = isRec(entry._meta) ? entry._meta : null
  if (meta && typeof meta.agentTimestampMs === 'number') return meta.agentTimestampMs
  return typeof entry.timestamp === 'number' ? entry.timestamp * 1000 : NaN
}

const split = (u: JsonRec): UsageRecord['split'] => {
  const cached = tokenCount(u.cachedReadTokens)
  return { input: Math.max(0, tokenCount(u.inputTokens) - cached), output: tokenCount(u.outputTokens), cacheRead: cached, cacheWrite: tokenCount(u.cacheCreationTokens) }
}

const ticks = (u: JsonRec): number | undefined => (typeof u.costUsdTicks === 'number' ? u.costUsdTicks * 1e-10 : undefined)

export const grokSource: UsageSource = {
  agent: 'grok',
  list: (dirs) => jsonlFiles(dirs.grokSessions, (n) => n === 'updates.jsonl'),
  async read(path, acc) {
    const session = basename(dirname(path))
    const cwd = decodeCwd(dirname(dirname(path)))
    const turns = new Map<string, UsageRecord[]>()
    let n = 0
    await forEachJsonLine(path, (l) => l.includes('turn_completed'), (entry) => {
      if (!isRec(entry) || !isRec(entry.params) || !isRec(entry.params.update)) return
      const update = entry.params.update
      if (update.sessionUpdate !== 'turn_completed' || !isRec(update.usage)) return
      const usage = update.usage
      const meta = isRec(entry._meta) ? entry._meta : {}
      const id = typeof meta.eventId === 'string' ? meta.eventId : typeof update.prompt_id === 'string' ? update.prompt_id : `#${n++}`
      const at = timeOf(entry)
      const perModel = isRec(usage.modelUsage) ? Object.entries(usage.modelUsage).filter((e): e is [string, JsonRec] => isRec(e[1])) : []
      const records: UsageRecord[] =
        perModel.length > 0
          ? perModel.map(([model, u]) => {
              const cost = ticks(u) ?? (perModel.length === 1 ? ticks(usage) : undefined)
              return { at, model, split: split(u), ...(cost !== undefined ? { cost } : {}) }
            })
          : [{ at, model: '', split: split(usage), ...(ticks(usage) !== undefined ? { cost: ticks(usage)! } : {}) }]
      turns.set(id, records)
    }, acc)
    for (const records of turns.values()) for (const r of records) acc.add(session, cwd, r)
  }
}
