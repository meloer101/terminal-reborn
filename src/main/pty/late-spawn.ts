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
