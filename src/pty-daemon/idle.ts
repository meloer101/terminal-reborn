// When the daemon has nothing left to do (no app connected, no process running) it exits after a grace period;
// anything that makes it busy again in between cancels the exit.
export class IdleTimer {
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(
    private readonly graceMs: number,
    private readonly isIdle: () => boolean,
    private readonly onIdle: () => void
  ) {}

  /** Re-evaluates after any change to clients or sessions. */
  update(): void {
    if (this.stopped) return
    if (!this.isIdle()) {
      this.cancel()
      return
    }
    this.timer ??= setTimeout(() => {
      this.timer = null
      if (!this.stopped && this.isIdle()) this.onIdle()
    }, this.graceMs)
  }

  stop(): void {
    this.stopped = true
    this.cancel()
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
