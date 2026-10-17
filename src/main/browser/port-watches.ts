// Who watches which session's ports (PRD F14, minimal): counted per window and session, so a view that mounts
// twice still unwatches cleanly, and a window that reloads or crashes drops all of its watches at once.
// No Electron imports, so it is unit-tested.
import { portsChanged, type ListeningPort } from '@shared/browser'

export interface PortWatch<Owner> {
  owner: Owner
  sessionId: string
  /** Watchers in this window. */
  count: number
  /** The last list sent; null = send the next scan whatever it finds. */
  last: ListeningPort[] | null
}

export class PortWatches<Owner> {
  private readonly byOwner = new Map<Owner, Map<string, PortWatch<Owner>>>()

  /** Returns true when this is the owner's first watch (the caller hooks its lifecycle then). */
  add(owner: Owner, sessionId: string): boolean {
    let sessions = this.byOwner.get(owner)
    const first = !sessions
    if (!sessions) {
      sessions = new Map()
      this.byOwner.set(owner, sessions)
    }
    const existing = sessions.get(sessionId)
    if (existing) {
      existing.count++
      // A new watcher needs the current list even if it has not changed.
      existing.last = null
    } else {
      sessions.set(sessionId, { owner, sessionId, count: 1, last: null })
    }
    return first
  }

  remove(owner: Owner, sessionId: string): void {
    const sessions = this.byOwner.get(owner)
    const watch = sessions?.get(sessionId)
    if (!sessions || !watch) return
    if (--watch.count > 0) return
    sessions.delete(sessionId)
    if (sessions.size === 0) this.byOwner.delete(owner)
  }

  /** The window reloaded, crashed or closed: none of its watchers exist any more. */
  dropOwner(owner: Owner): void {
    this.byOwner.delete(owner)
  }

  hasOwner(owner: Owner): boolean {
    return this.byOwner.has(owner)
  }

  get size(): number {
    let n = 0
    for (const sessions of this.byOwner.values()) n += sessions.size
    return n
  }

  all(): Array<PortWatch<Owner>> {
    return [...this.byOwner.values()].flatMap((sessions) => [...sessions.values()])
  }

  /** Records a scan result; true when it differs from what was last sent (so it should be sent). */
  update(watch: PortWatch<Owner>, ports: ListeningPort[]): boolean {
    if (watch.last !== null && !portsChanged(watch.last, ports)) return false
    watch.last = ports
    return true
  }
}
