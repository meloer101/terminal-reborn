// The hook endpoint when the pty daemon serves the hook socket (PRD §6.8): the socket and its
// token belong to the daemon and outlive app runs; the app only keeps the Claude `--settings` file next to them
// (a stable path, so agents launched by an earlier run keep finding it) and checks that the socket answers.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HooksHealth } from '@shared/agent-events'
import { probeSocket } from './server'

export interface DaemonHookTarget {
  socketPath: string
  token: string
  /** Where the settings file goes (`<userData>/daemon`). */
  settingsDir: string
}

export interface DaemonHookEndpointOptions {
  target: DaemonHookTarget
  settings: () => unknown
  onHealth?: (health: HooksHealth) => void
  probe?: (socketPath: string) => Promise<boolean>
  intervalMs?: number
}

export class DaemonHookEndpoint {
  readonly socketPath: string
  readonly token: string
  readonly settingsPath: string
  private current: HooksHealth = { ok: false, reason: 'server-unavailable', detail: 'not checked yet' }
  private readonly probe: (socketPath: string) => Promise<boolean>
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: DaemonHookEndpointOptions) {
    this.socketPath = options.target.socketPath
    this.token = options.target.token
    this.settingsPath = join(options.target.settingsDir, 'claude-settings.json')
    this.probe = options.probe ?? ((path) => probeSocket(path))
  }

  get health(): HooksHealth {
    return this.current
  }

  /** The daemon's socket answers and the settings file is intact. The daemon restarts its own server. */
  async check(): Promise<HooksHealth> {
    let next: HooksHealth
    try {
      this.ensureSettingsFile()
      next = (await this.probe(this.socketPath)) ? { ok: true } : { ok: false, reason: 'server-unavailable', detail: 'the pty daemon hook socket does not answer' }
    } catch (error) {
      next = { ok: false, reason: 'server-unavailable', detail: error instanceof Error ? error.message : String(error) }
    }
    const changed = next.ok !== this.current.ok || (!next.ok && !this.current.ok && next.detail !== this.current.detail)
    this.current = next
    if (changed) this.options.onHealth?.(next)
    return next
  }

  /** First check, then one every interval (the settings file is rewritten if it went missing). */
  async start(): Promise<HooksHealth> {
    const health = await this.check()
    this.timer ??= setInterval(() => void this.check(), this.options.intervalMs ?? 30_000)
    this.timer.unref()
    return health
  }

  /** Stops the self-check only: the socket is the daemon's and must outlive the app. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private ensureSettingsFile(): void {
    const content = JSON.stringify(this.options.settings(), null, 2)
    try {
      if (readFileSync(this.settingsPath, 'utf8') === content) return
    } catch {
      // Missing: written below.
    }
    mkdirSync(this.options.target.settingsDir, { recursive: true, mode: 0o700 })
    writeFileSync(this.settingsPath, content, { mode: 0o600 })
    chmodSync(this.settingsPath, 0o600)
  }
}
