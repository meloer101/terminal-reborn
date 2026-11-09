// Claude Code: ~/.claude/projects/<project>/<session>.jsonl (and subagents/*.jsonl). An assistant message is written as
// several lines that repeat its usage; it is counted once by message id, plus any later growth of its output.
import { basename } from 'node:path'
import { claudeUsage, entryTime, isRec } from '@shared/usage-records'
import { forEachJsonLine } from '../accumulate'
import { jsonlFiles } from './files'
import type { UsageSource } from './source'

export const claudeSource: UsageSource = {
  agent: 'claude',
  list: async (dirs) => (await Promise.all(dirs.claudeProjects.map((d) => jsonlFiles(d, () => true)))).flat(),
  async read(path, acc) {
    const counted = new Map<string, number>()
    await forEachJsonLine(path, (l) => l.includes('"usage"'), (entry) => {
      if (!isRec(entry)) return
      const u = claudeUsage(entry)
      if (!u) return
      const session = typeof entry.sessionId === 'string' ? entry.sessionId : basename(path, '.jsonl')
      const cwd = typeof entry.cwd === 'string' ? entry.cwd : ''
      const at = entryTime(entry, NaN)
      const seen = u.id ? counted.get(u.id) : undefined
      if (seen === undefined) {
        if (u.id) counted.set(u.id, u.output)
        acc.add(session, cwd, { at, model: u.model, split: { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite } })
      } else if (u.output > seen) {
        counted.set(u.id, u.output)
        acc.add(session, cwd, { at, model: u.model, split: { input: 0, output: u.output - seen, cacheRead: 0, cacheWrite: 0 } })
      }
    }, acc)
  }
}
