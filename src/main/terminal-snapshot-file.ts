// Pure-ish file logic behind terminal snapshots (see ./terminal-snapshots.ts): validation, paths, pruning.
// All I/O is async: main relays every terminal's output, and a 2 MB synchronous write stalled all of them.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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
  /** Per session: the newest snapshot not yet being written (older queued ones are superseded, never written). */
  private readonly queued = new Map<string, TerminalSnapshot>()
  /** Per session: the write loop in flight. One per session, so two writes of one file never interleave. */
  private readonly writers = new Map<string, Promise<void>>()

  constructor(private readonly dir: string) {}

  private path(id: string): string {
    // The id pattern has no '/', so the name stays inside dir.
    return join(this.dir, `${id}.json`)
  }

  /** Null when there is none or it is unreadable. Waits for a write of the same session in flight. */
  async load(sessionId: unknown): Promise<TerminalSnapshot | null> {
    try {
      const id = parseSessionId(sessionId)
      await this.writers.get(id)?.catch(() => undefined)
      return parseSnapshot(JSON.parse(await readFile(this.path(id), 'utf8')))
    } catch {
      return null
    }
  }

  /**
   * Resolves once this snapshot, or a newer one of the same session, is on disk; rejects on an invalid payload or
   * when the last write failed.
   */
  async save(sessionId: unknown, snapshot: unknown): Promise<void> {
    const id = parseSessionId(sessionId)
    this.queued.set(id, parseSnapshot(snapshot))
    let writer = this.writers.get(id)
    if (!writer) {
      writer = this.drain(id)
      this.writers.set(id, writer)
    }
    return writer
  }

  private async drain(id: string): Promise<void> {
    let failure: unknown = null
    for (let next = this.queued.get(id); next; next = this.queued.get(id)) {
      this.queued.delete(id)
      try {
        await this.write(id, next)
        failure = null
      } catch (error) {
        failure = error
      }
    }
    // Synchronously after the last check of `queued`: a save from here on starts a new loop.
    this.writers.delete(id)
    if (failure !== null) throw failure
  }

  /** Atomic write (tmp + rename), so a quit mid-write never leaves a torn file. */
  private async write(id: string, snapshot: TerminalSnapshot): Promise<void> {
    const path = this.path(id)
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    await writeFile(`${path}.tmp`, JSON.stringify(snapshot), { mode: 0o600 })
    await rename(`${path}.tmp`, path)
  }

  /** Drops queued writes, waits for the one in flight, then deletes the file. */
  async remove(sessionId: unknown): Promise<void> {
    const id = parseSessionId(sessionId)
    this.queued.delete(id)
    await this.writers.get(id)?.catch(() => undefined)
    await rm(this.path(id), { force: true })
  }

  /** Writes still in flight (main holds the quit for them). */
  get writing(): number {
    return this.writers.size
  }

  /** Resolves when no write is in flight, whatever their outcome. */
  async idle(): Promise<void> {
    while (this.writers.size > 0) await Promise.allSettled([...this.writers.values()])
  }

  async pruneOlderThan(maxAgeMs: number, now = Date.now()): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return
    }
    for (const name of names) {
      const path = join(this.dir, name)
      try {
        if (now - (await stat(path)).mtimeMs > maxAgeMs) await rm(path, { force: true })
      } catch {
        // Gone already.
      }
    }
  }
}
