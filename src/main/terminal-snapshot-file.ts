// Pure-ish file logic behind terminal snapshots (see ./terminal-snapshots.ts): validation, paths, pruning.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TerminalSnapshot } from '@shared/ipc'
import { parseSessionId, parseSize } from './pty/validate'

/** A few thousand rows of styled text; anything bigger is dropped rather than slowing the next launch. */
export const MAX_SNAPSHOT_CHARS = 2 * 1024 * 1024
/** Snapshots of sessions that were not opened for this long are deleted at startup. */
export const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export function parseSnapshot(value: unknown): TerminalSnapshot {
  if (typeof value !== 'object' || value === null) throw new Error('invalid snapshot')
  const { cols, rows, data } = value as Record<string, unknown>
  if (typeof data !== 'string' || data.length > MAX_SNAPSHOT_CHARS) throw new Error('invalid snapshot data')
  return { ...parseSize(cols, rows), data }
}

export class TerminalSnapshotFiles {
  constructor(private readonly dir: string) {}

  private path(sessionId: unknown): string {
    // The id pattern has no '/', so the name stays inside dir.
    return join(this.dir, `${parseSessionId(sessionId)}.json`)
  }

  load(sessionId: unknown): TerminalSnapshot | null {
    try {
      return parseSnapshot(JSON.parse(readFileSync(this.path(sessionId), 'utf8')))
    } catch {
      return null
    }
  }

  /** Atomic write (tmp + rename), so a quit mid-write never leaves a torn file. */
  save(sessionId: unknown, snapshot: unknown): void {
    const path = this.path(sessionId)
    const valid = parseSnapshot(snapshot)
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    writeFileSync(`${path}.tmp`, JSON.stringify(valid), { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  }

  remove(sessionId: unknown): void {
    rmSync(this.path(sessionId), { force: true })
  }

  pruneOlderThan(maxAgeMs: number, now = Date.now()): void {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return
    }
    for (const name of names) {
      const path = join(this.dir, name)
      try {
        if (now - statSync(path).mtimeMs > maxAgeMs) rmSync(path, { force: true })
      } catch {
        // Gone already.
      }
    }
  }
}
