// Pi: ~/.pi/agent/sessions/<cwd>/<time>_<id>.jsonl. A `session` line names the cwd; each assistant `message` carries
// usage (input excludes cache) and its own cost.
import { basename } from 'node:path'
import { entryTime, isRec, tokenCount } from '@shared/usage-records'
import { forEachJsonLine } from '../accumulate'
import { jsonlFiles } from './files'
import type { UsageSource } from './source'

export const piSource: UsageSource = {
  agent: 'pi',
  list: (dirs) => jsonlFiles(dirs.piSessions, () => true),
  async read(path, acc) {
    let session = basename(path, '.jsonl')
    let cwd = ''
    await forEachJsonLine(path, (l) => l.includes('"type":"session"') || l.includes('"usage"'), (entry) => {
      if (!isRec(entry)) return
      if (entry.type === 'session') {
        if (typeof entry.cwd === 'string') cwd = entry.cwd
        if (typeof entry.id === 'string') session = entry.id
        return
      }
      if (entry.type !== 'message' || !isRec(entry.message) || !isRec(entry.message.usage)) return
      const u = entry.message.usage
      const cost = isRec(u.cost) && typeof u.cost.total === 'number' ? u.cost.total : undefined
      acc.add(session, cwd, {
        at: entryTime(entry, NaN),
        model: typeof entry.message.model === 'string' ? entry.message.model : '',
        split: { input: tokenCount(u.input), output: tokenCount(u.output), cacheRead: tokenCount(u.cacheRead), cacheWrite: tokenCount(u.cacheWrite) },
        ...(cost !== undefined ? { cost } : {})
      })
    }, acc)
  }
}
