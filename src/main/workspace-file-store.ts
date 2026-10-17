// File-backed workspace store: sanitized on read and on every save, debounced, written atomically
// (tmp + rename) so a crash never leaves a truncated file. No Electron imports, so it is unit-tested directly.
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { sanitizeWorkspaceFile, type WorkspaceFile } from '@shared/workspace-file'

export const SAVE_DEBOUNCE_MS = 300

export interface WorkspaceFileStoreOptions {
  debounceMs?: number
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

export class WorkspaceFileStore {
  private pending: WorkspaceFile | null = null
  /** The last workspace loaded or accepted for saving: what the renderer currently has. */
  private latest: WorkspaceFile | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly debounceMs: number
  private readonly now: () => number
  private readonly log: (message: string, error?: unknown) => void

  constructor(
    private readonly path: string,
    options: WorkspaceFileStoreOptions = {}
  ) {
    this.debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS
    this.now = options.now ?? Date.now
    this.log = options.log ?? ((message, error) => console.error(`[workspace] ${message}`, error ?? ''))
  }

  /** The stored workspace, or null when there is none (first run) or it cannot be used. */
  load(): WorkspaceFile | null {
    let text: string
    try {
      text = readFileSync(this.path, 'utf8')
    } catch {
      return null
    }
    let value: unknown = null
    try {
      value = JSON.parse(text)
    } catch {
      // Corrupt: handled below.
    }
    const file = sanitizeWorkspaceFile(value, this.now())
    // Unreadable or from an unknown version: keep a copy before the next save replaces it.
    if (!file) this.backup()
    this.latest = file
    return file
  }

  /**
   * Validates `raw` (untrusted renderer data) and schedules a write. Saves inside the window coalesce into one write of
   * the latest data, so continuous typing still reaches disk every `debounceMs`. Invalid payloads are ignored.
   */
  save(raw: unknown): void {
    const file = sanitizeWorkspaceFile(raw, this.now())
    if (!file) return
    this.latest = file
    this.pending = file
    this.timer ??= setTimeout(() => this.flush(), this.debounceMs)
  }

  /** Root folders of the workspace's projects (git IPC only acts on these). */
  projectRoots(): string[] {
    return this.latest?.projects.map((p) => p.rootPath) ?? []
  }

  /** Writes any pending data now (also used on quit). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const file = this.pending
    if (!file) return
    this.pending = null
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify(file))
      renameSync(tmp, this.path)
    } catch (error) {
      this.log('could not write workspace.json', error)
    }
  }

  private backup(): void {
    try {
      copyFileSync(this.path, `${this.path}.bad-${this.now()}`)
    } catch (error) {
      this.log('could not back up an unreadable workspace.json', error)
    }
  }
}
