// 定时任务 while the app is closed (PRD F24): the app tells the daemon when its next scheduled task is due and which
// app bundle it is; the daemon stays up for it and, if no app is connected by then, opens that app in the background
// (`open -g -j`: hidden, not focused). Waits in short steps, so a sleep that stalls the timers costs at most one step.
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

const STEP_MS = 60_000
/** A wake further out than this is still kept, checked again every step. */
const MAX_AHEAD_MS = 400 * 24 * 60 * 60 * 1000

export interface WakeRequest {
  at: number
  /** The `.app` bundle to open. */
  app: string
}

/** A `wake` message's fields; null clears the wake (no task due, or the setting is off). */
export function parseWake(raw: { at?: unknown; app?: unknown }, now: number): WakeRequest | null {
  const { at, app } = raw
  if (typeof at !== 'number' || !Number.isFinite(at) || at > now + MAX_AHEAD_MS) return null
  if (typeof app !== 'string' || !isAbsolute(app) || !app.endsWith('.app') || app.length > 1024) return null
  return { at, app }
}

export class WakeTimer {
  private wake: WakeRequest | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly deps: {
      now(): number
      /** Whether an app is connected (then it runs its own tasks). */
      appConnected(): boolean
      open(app: string): void
      /** The pending wake changed (the idle exit re-evaluates). */
      changed(): void
      log(...args: unknown[]): void
    }
  ) {}

  get pending(): boolean {
    return this.wake !== null
  }

  set(wake: WakeRequest | null): void {
    this.wake = wake && existsSync(wake.app) ? wake : null
    if (wake && !this.wake) this.deps.log('wake: no app at', wake.app)
    this.arm()
    this.deps.changed()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.wake = null
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.wake) return
    const wait = Math.max(0, Math.min(this.wake.at - this.deps.now(), STEP_MS))
    this.timer = setTimeout(() => this.check(), wait)
    this.timer.unref?.()
  }

  private check(): void {
    this.timer = null
    const wake = this.wake
    if (!wake) return
    if (wake.at > this.deps.now()) return this.arm()
    this.wake = null
    if (!this.deps.appConnected()) {
      this.deps.log('wake: opening', wake.app, 'for a scheduled task')
      try {
        this.deps.open(wake.app)
      } catch (error) {
        this.deps.log('wake: could not open the app', error)
      }
    }
    this.deps.changed()
  }
}
