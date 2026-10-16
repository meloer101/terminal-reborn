// Keeps the cold-path disk snapshots (`<userData>/terminal-snapshots/<id>.json`, see src/main/terminal-snapshots.ts)
// current while no app is attached, so a reboot after hours of an agent running with the app closed still paints
// its latest screen (docs/spikes/pty-daemon.md §10). One writer at a time: the renderer saves while a client is
// attached to the session, this writes only for detached sessions, after their output has been quiet a while.
import type { TerminalSnapshot } from '@shared/ipc'

export interface DiskSnapshotDeps {
  /** The session's screen in the disk format (no modes); null when the host no longer has it. */
  capture(id: string): Promise<TerminalSnapshot | null>
  /** A client streams the session: its renderer is the writer. */
  isAttached(id: string): boolean
  save(id: string, snapshot: TerminalSnapshot): void
  log?(...args: unknown[]): void
}

export class DiskSnapshots {
  /** Detached sessions whose screen changed since it was last written, with their quiet timer. */
  private readonly dirty = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly quietMs: number,
    private readonly deps: DiskSnapshotDeps
  ) {}

  /** Output (or an exit) of a detached session: write its screen once it has been quiet for `quietMs`. */
  touch(id: string): void {
    const timer = this.dirty.get(id)
    if (timer !== undefined) clearTimeout(timer)
    this.dirty.set(
      id,
      setTimeout(() => void this.write(id), this.quietMs)
    )
  }

  /** A client attached: from now on the renderer saves this session. */
  cancel(id: string): void {
    const timer = this.dirty.get(id)
    if (timer !== undefined) clearTimeout(timer)
    this.dirty.delete(id)
  }

  cancelAll(): void {
    for (const id of [...this.dirty.keys()]) this.cancel(id)
  }

  get pending(): number {
    return this.dirty.size
  }

  /** Writes every pending screen now (the daemon is about to exit: logout, retirement, shutdown). */
  async flush(): Promise<void> {
    await Promise.all([...this.dirty.keys()].map((id) => this.write(id)))
  }

  private async write(id: string): Promise<void> {
    this.cancel(id)
    if (this.deps.isAttached(id)) return
    let snapshot: TerminalSnapshot | null
    try {
      snapshot = await this.deps.capture(id)
    } catch (error) {
      this.deps.log?.('snapshot capture failed', id, error)
      return
    }
    // Attached while the screen was being captured: the renderer owns the file now.
    if (!snapshot || this.deps.isAttached(id) || snapshot.data.length === 0) return
    try {
      this.deps.save(id, snapshot)
    } catch (error) {
      this.deps.log?.('snapshot save failed', id, error)
    }
  }
}
