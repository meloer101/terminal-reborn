// A host `spawned` event for an id main no longer tracks is an orphan: main gave up waiting (spawn timeout) or the
// owning window went away while the host was still starting the process. Nobody can ever see or close it, so main
// has to kill it when the news finally arrives (phase 2a · orphan guard).
export function isOrphanSpawn(tracked: ReadonlyMap<string, unknown>, id: string): boolean {
  return !tracked.has(id)
}

/**
 * Whether a late `spawned` report should kill the process. With the pty daemon a session whose window went away is
 * detached, not abandoned: it keeps running for the next attach (a reloaded page reattaches to it), so killing it
 * would hand that page a dead shell. A spawn main gave up on (timeout) is killed by the timeout itself.
 */
export function shouldKillLateSpawn(tracked: ReadonlyMap<string, unknown>, id: string, daemon: boolean): boolean {
  return !daemon && isOrphanSpawn(tracked, id)
}

export interface PendingStart<T> {
  resolve(result: T): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Records a start for `id`, taking over one still waiting for the same id (a second restart before the first one
 * answered): the earlier start's timer stops, so it cannot time out and kill the newer process, and both callers
 * get the first outcome the host reports (the host has no per-start token) instead of an error that would mark the
 * terminal as failed. The session's pid follows the later `spawned` report.
 */
export function replacePendingStart<T>(pending: Map<string, PendingStart<T>>, id: string, next: PendingStart<T>): void {
  const previous = pending.get(id)
  if (previous) clearTimeout(previous.timer)
  pending.set(
    id,
    previous
      ? {
          timer: next.timer,
          resolve: (result) => {
            previous.resolve(result)
            next.resolve(result)
          },
          reject: (error) => {
            previous.reject(error)
            next.reject(error)
          }
        }
      : next
  )
}
