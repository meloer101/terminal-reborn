// A host `spawned` event for an id main no longer tracks is an orphan: main gave up waiting (spawn timeout) or the
// owning window went away while the host was still starting the process. Nobody can ever see or close it, so main
// has to kill it when the news finally arrives (phase 2a · orphan guard).
export function isOrphanSpawn(tracked: ReadonlyMap<string, unknown>, id: string): boolean {
  return !tracked.has(id)
}
