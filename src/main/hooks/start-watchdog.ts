// "Hooks attached but silent": an agent that was launched with our hooks should send SessionStart within
// seconds. Silence usually means a blocking prompt in the TUI (workspace trust, an update notice) or hooks
// that cannot reach us. The watchdog turns that into a one-shot signal the UI can show.
export const SESSION_START_TIMEOUT_MS = 15_000

export interface WatchdogTimers {
  set(callback: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const realTimers: WatchdogTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

export class StartWatchdog {
  private readonly pending = new Map<string, unknown>()

  constructor(
    private readonly onTimeout: (sessionId: string, afterMs: number) => void,
    private readonly timeoutMs = SESSION_START_TIMEOUT_MS,
    private readonly timers: WatchdogTimers = realTimers
  ) {}

  /** (Re)starts the countdown for a freshly launched session. */
  arm(sessionId: string): void {
    this.disarm(sessionId)
    this.pending.set(
      sessionId,
      this.timers.set(() => {
        this.pending.delete(sessionId)
        this.onTimeout(sessionId, this.timeoutMs)
      }, this.timeoutMs)
    )
  }

  /** The session reported something (or ended): no timeout signal. Safe to call for unknown ids. */
  disarm(sessionId: string): void {
    const handle = this.pending.get(sessionId)
    if (handle === undefined) return
    this.timers.clear(handle)
    this.pending.delete(sessionId)
  }

  /** Drops every countdown (app quit). */
  clear(): void {
    for (const sessionId of [...this.pending.keys()]) this.disarm(sessionId)
  }

  get size(): number {
    return this.pending.size
  }
}
