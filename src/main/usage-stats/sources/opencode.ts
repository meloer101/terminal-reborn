// OpenCode: its SQLite database (~/.local/share/opencode/opencode.db), opened read-only. Each assistant message's
// `data` JSON has tokens (input excludes cache; reasoning is separate output), the model, times, cwd and its own cost.
// node:sqlite is loaded only here, so a runtime without it costs OpenCode's figures alone; rows are read one at a time.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isRec, tokenCount } from '@shared/usage-records'
import type { UsageSource } from './source'

const DB = 'opencode.db'

async function signature(path: string): Promise<string | null> {
  try {
    const db = await stat(path)
    const wal = await stat(`${path}-wal`).catch(() => null)
    return `${db.size}:${db.mtimeMs}:${wal?.size ?? 0}:${wal?.mtimeMs ?? 0}`
  } catch {
    return null
  }
}

export const opencodeSource: UsageSource = {
  agent: 'opencode',
  async list(dirs) {
    const path = join(dirs.opencodeData, DB)
    const sig = await signature(path)
    return sig ? [{ path, signature: sig }] : []
  },
  async read(path, acc) {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      const rows = db.prepare('SELECT m.session_id AS session, m.data AS data, s.directory AS directory FROM message m LEFT JOIN session s ON s.id = m.session_id').iterate()
      for (const row of rows) {
        let data: unknown
        try {
          data = JSON.parse(String(row.data))
        } catch {
          acc.skip()
          continue
        }
        if (!isRec(data) || data.role !== 'assistant' || !isRec(data.tokens)) continue
        const t = data.tokens
        const cache = isRec(t.cache) ? t.cache : {}
        const time = isRec(data.time) && typeof data.time.created === 'number' ? data.time.created : NaN
        const cwd = isRec(data.path) && typeof data.path.cwd === 'string' ? data.path.cwd : typeof row.directory === 'string' ? row.directory : ''
        acc.add(String(row.session), cwd, {
          at: time,
          model: typeof data.modelID === 'string' ? data.modelID : '',
          split: { input: tokenCount(t.input), output: tokenCount(t.output) + tokenCount(t.reasoning), cacheRead: tokenCount(cache.read), cacheWrite: tokenCount(cache.write) },
          ...(typeof data.cost === 'number' ? { cost: data.cost } : {})
        })
      }
    } finally {
      db.close()
    }
  }
}
