// Claude Code: ~/.claude/projects/<project>/<session>.jsonl (and subagents/*.jsonl). An assistant message is written as
// several lines that repeat its usage (its output count can grow), and a resumed or forked conversation's file repeats
// earlier messages: each is counted once by message id (else request id), across files (./scanner.ts merge).
import { basename } from 'node:path'
import { claudeUsage, entryTime, isRec } from '@shared/usage-records'
import { forEachJsonLine } from '../accumulate'
import { jsonlFiles } from './files'
import type { UsageSource } from './source'

export const claudeSource: UsageSource = {
  agent: 'claude',
  list: async (dirs) => (await Promise.all(dirs.claudeProjects.map((d) => jsonlFiles(d, () => true)))).flat(),
  async read(path, acc) {
    await forEachJsonLine(path, (l) => l.includes('"usage"'), (entry) => {
      if (!isRec(entry)) return
      const u = claudeUsage(entry)
      if (!u) return
      acc.add(typeof entry.sessionId === 'string' ? entry.sessionId : basename(path, '.jsonl'), typeof entry.cwd === 'string' ? entry.cwd : '', {
        id: u.id,
        at: entryTime(entry, NaN),
        model: u.model,
        split: { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite }
      })
    }, acc)
  }
}
