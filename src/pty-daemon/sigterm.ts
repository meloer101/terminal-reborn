// What a SIGTERM means to the daemon (PRD §6.8). Most are not a logout: tools that stop a process tree SIGTERM
// whatever they find under it, and a `kill <pid>` sends one too. Only while main has reported a logout, restart or
// shutdown (Electron's powerMonitor `shutdown`) are the sessions ending anyway, so only then does the daemon end
// them and exit instead of keeping them running.

/** A logout can be cancelled (an app refuses to quit); a report older than this no longer counts. */
export const SYSTEM_SHUTDOWN_WINDOW_MS = 5 * 60_000

/** Remembers main's last `system-shutdown`, on a monotonic clock. */
export class SystemShutdown {
  private reportedAt: number | null = null

  report(now: number): void {
    this.reportedAt = now
  }

  /** A logout, restart or shutdown is under way. */
  inProgress(now: number): boolean {
    if (this.reportedAt === null) return false
    const age = now - this.reportedAt
    return age >= 0 && age <= SYSTEM_SHUTDOWN_WINDOW_MS
  }
}
