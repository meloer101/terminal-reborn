// Codex: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl (and archived_sessions). Each response's `last_token_usage`
// is counted when the running total grows (repeats are skipped); the model is the last `turn_context`'s, the project
// the `session_meta` cwd. Codex's input includes the cached part.
import { basename, join } from 'node:path'
import { codexTokenCount, entryTime, isRec } from '@shared/usage-records'
import { forEachJsonLine } from '../accumulate'
import { jsonlFiles } from './files'
import type { UsageSource } from './source'

const KEEP = (l: string): boolean => l.includes('"token_count"') || l.includes('"turn_context"') || l.includes('"session_meta"')

export const codexSource: UsageSource = {
  agent: 'codex',
  list: async (dirs) =>
    (await Promise.all(['sessions', 'archived_sessions'].map((d) => jsonlFiles(join(dirs.codexHome, d), (n) => n.startsWith('rollout-'))))).flat(),
  async read(path, acc) {
    let session = basename(path, '.jsonl')
    let cwd = ''
    let model = ''
    let running = 0
    await forEachJsonLine(path, KEEP, (entry) => {
      if (!isRec(entry) || !isRec(entry.payload)) return
      if (entry.type === 'session_meta') {
        if (typeof entry.payload.cwd === 'string') cwd = entry.payload.cwd
        if (typeof entry.payload.id === 'string') session = entry.payload.id
        return
      }
      if (entry.type === 'turn_context') {
        if (typeof entry.payload.model === 'string') model = entry.payload.model
        return
      }
      const tc = codexTokenCount(entry)
      if (!tc?.last || tc.runningTotal <= running) return
      running = tc.runningTotal
      const { input, cached, output } = tc.last
      acc.add(session, cwd, { at: entryTime(entry, NaN), model, split: { input: Math.max(0, input - cached), output, cacheRead: cached, cacheWrite: 0 } })
    }, acc)
  }
}
