// Keeps the hook server alive for the whole app run (phase 2a · A9). Agents already running hold the socket
// path and token in their environment, so a restart must come back on the *same* path with the *same* token.
// Failures are logged and reported through `onHealth`; nothing here throws into the app.
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HooksHealth } from '@shared/agent-events'
import { probeSocket, SOCKET_NAME, startHookServer, type HookHandler, type HookServer, type HookServerOptions } from './server'

export const CHECK_INTERVAL_MS = 30_000

export interface SupervisorOptions {
  /** Directory holding `hook.sock` and `claude-settings.json` (see hook-dir.ts). Recreated if it vanishes. */
  dir: string
  handler: HookHandler
  /** Contents of the Claude `--settings` file. Called on every (re)write. */
  settings: () => unknown
  onHealth?: (health: HooksHealth) => void
  intervalMs?: number
  /** Injection points for tests. */
  startServer?: (handler: HookHandler, options: HookServerOptions) => Promise<HookServer>
  probe?: (socketPath: string) => Promise<boolean>
  log?: (message: string, error?: unknown) => void
}

export class HookSupervisor {
  readonly token = randomBytes(24).toString('hex')
  readonly socketPath: string
  readonly settingsPath: string
  /** How many times the server had to be restarted by the self-check. */
  restarts = 0

  private server: HookServer | null = null
  private broken = false
  private stopped = false
  private timer: ReturnType<typeof setInterval> | null = null
  private inFlight: Promise<HooksHealth> | null = null
  private current: HooksHealth = { ok: false, reason: 'server-unavailable', detail: 'not started' }
  private readonly startServer: NonNullable<SupervisorOptions['startServer']>
  private readonly probe: NonNullable<SupervisorOptions['probe']>
  private readonly log: NonNullable<SupervisorOptions['log']>

  constructor(private readonly options: SupervisorOptions) {
    this.socketPath = join(options.dir, SOCKET_NAME)
    this.settingsPath = join(options.dir, 'claude-settings.json')
    this.startServer = options.startServer ?? startHookServer
    this.probe = options.probe ?? ((path) => probeSocket(path))
    this.log = options.log ?? ((message, error) => console.error(`[hooks] ${message}`, error ?? ''))
  }

  get health(): HooksHealth {
    return this.current
  }

  /** Starts the server and the periodic self-check. Resolves with the resulting health; never rejects. */
  async start(): Promise<HooksHealth> {
    const health = await this.check()
    if (!this.stopped) {
      this.timer = setInterval(() => void this.check(), this.options.intervalMs ?? CHECK_INTERVAL_MS)
      this.timer.unref()
    }
    return health
  }

  /**
   * One self-check: the server exists, did not report an error, and accepts a connection on its socket;
   * the settings file is intact. Anything off restarts the server and/or rewrites the file. Concurrent calls share a run.
   */
  check(): Promise<HooksHealth> {
    this.inFlight ??= this.runCheck().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const server = this.server
    this.server = null
    await server?.close().catch(() => undefined)
  }

  private setHealth(next: HooksHealth): void {
    const changed = next.ok !== this.current.ok || (!next.ok && !this.current.ok && next.detail !== this.current.detail)
    this.current = next
    if (changed) this.options.onHealth?.(next)
  }

  private async runCheck(): Promise<HooksHealth> {
    if (this.stopped) return this.current
    try {
      const reachable = this.server !== null && !this.broken && (await this.probe(this.socketPath))
      if (!reachable) {
        if (this.server) this.log('hook socket is not reachable; restarting the hook server')
        await this.restart()
      }
      this.ensureSettingsFile()
      this.setHealth({ ok: true })
    } catch (error) {
      this.log('hook server is unavailable', error)
      this.setHealth({ ok: false, reason: 'server-unavailable', detail: error instanceof Error ? error.message : String(error) })
    }
    return this.current
  }

  private async restart(): Promise<void> {
    const old = this.server
    this.server = null
    if (old) {
      this.restarts += 1
      await old.close().catch(() => undefined)
    }
    this.broken = false
    this.server = await this.startServer(this.options.handler, {
      socketDir: this.options.dir,
      token: this.token,
      keepDir: true,
      onError: (error) => {
        this.log('hook server error', error)
        this.broken = true
      }
    })
  }

  /** Writes the Claude settings file if it is missing or no longer matches (0600). */
  private ensureSettingsFile(): void {
    const content = JSON.stringify(this.options.settings(), null, 2)
    try {
      if (readFileSync(this.settingsPath, 'utf8') === content) return
    } catch {
      // Missing: written below.
    }
    mkdirSync(this.options.dir, { recursive: true, mode: 0o700 })
    writeFileSync(this.settingsPath, content, { mode: 0o600 })
    chmodSync(this.settingsPath, 0o600)
  }
}
