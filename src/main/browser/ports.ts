// Listening ports of each session's PTY process tree (PRD F14).
// One `ps` + one `lsof` per pass, about every 3s, whenever a session is alive — the sidebar and the overview show
// the tags, so this does not wait for the 浏览器 view to open. Ending a process is allowed only for a pid this
// session's latest scan found listening (`sessionListener`); there is no IPC that signals an arbitrary pid.
import { execFile } from 'node:child_process'
import type { WebContents } from 'electron'
import { BROWSER_IPC, parseLsofListen, parsePs, portsChanged, processTree, serverLabel, type ListeningPort, type SessionPorts } from '@shared/browser'
import { onSessionRootsChanged, sessionRoots, type SessionRoot } from '../pty'
import { PortWatches } from './port-watches'

const POLL_MS = 3_000
const RUN_TIMEOUT_MS = 5_000

const watches = new PortWatches<WebContents>()
/** Last list published per session, with the window that owns the PTY. */
const latest = new Map<string, { owner: WebContents; ports: ListeningPort[] }>()
let timer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null
/** A session appeared while a pass was running: scan again as soon as it finishes. */
let soon = false
let started = false

/** stdout of a system tool; lsof exits 1 when it finds nothing, which is not an error here. */
function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''))
  })
}

/** This session's latest scan (empty when it has not been scanned, or it listens on nothing). */
export function portsOf(sessionId: string): readonly ListeningPort[] {
  return latest.get(sessionId)?.ports ?? []
}

function send(owner: WebContents, sessionId: string, ports: ListeningPort[]): void {
  if (!owner.isDestroyed()) owner.send(BROWSER_IPC.ports, { sessionId, ports } satisfies SessionPorts)
}

function publish(root: SessionRoot, ports: ListeningPort[]): void {
  const watch = watches.all().find((w) => w.owner === root.owner && w.sessionId === root.sessionId)
  if (watch) {
    // A new watcher has last = null, so it is sent the list even when the scan did not change.
    if (!watches.update(watch, ports)) {
      latest.set(root.sessionId, { owner: root.owner, ports })
      return
    }
  } else {
    const prev = latest.get(root.sessionId)?.ports
    if (prev && !portsChanged(prev, ports)) return
  }
  latest.set(root.sessionId, { owner: root.owner, ports })
  send(root.owner, root.sessionId, ports)
}

/** Sessions that ended: drop the cache and clear tags that were showing. */
function clearMissing(live: ReadonlySet<string>): void {
  for (const [sessionId, cached] of latest) {
    if (live.has(sessionId)) continue
    latest.delete(sessionId)
    const watch = watches.all().find((w) => w.sessionId === sessionId && w.owner === cached.owner)
    if (watch) watches.update(watch, [])
    if (cached.ports.length > 0) send(cached.owner, sessionId, [])
  }
}

async function poll(): Promise<void> {
  const roots = sessionRoots()
  if (roots.length === 0) {
    clearMissing(new Set())
    return
  }
  const processes = parsePs(await run('/bin/ps', ['-A', '-o', 'pid=,ppid=,args=']))
  // The set of sessions can change while `ps` runs; only report ones that are still alive.
  const current = sessionRoots()
  const trees = new Map<string, Map<number, string>>()
  const allPids = new Set<number>()
  for (const root of current) {
    const tree = new Map(processTree(processes, root.pid).map((p) => [p.pid, p.args] as const))
    trees.set(root.sessionId, tree)
    for (const pid of tree.keys()) allPids.add(pid)
  }
  const listening =
    allPids.size > 0 ? parseLsofListen(await run('/usr/sbin/lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', [...allPids].join(','), '-F', 'pn'])) : []
  const still = new Set(sessionRoots().map((r) => r.sessionId))
  for (const root of current) {
    if (!still.has(root.sessionId)) continue
    const tree = trees.get(root.sessionId) ?? new Map<number, string>()
    const ports = listening.filter((l) => tree.has(l.pid)).map((l) => ({ ...l, label: serverLabel(tree.get(l.pid) ?? '') }))
    publish(root, ports)
  }
  clearMissing(still)
}

function schedule(delay: number): void {
  if (timer || inflight || sessionRoots().length === 0) return
  timer = setTimeout(() => {
    timer = null
    const job = poll()
      .catch((error: unknown) => console.error('[browser] port scan failed', error))
      .finally(() => {
        inflight = null
        const delayNext = soon ? 50 : POLL_MS
        soon = false
        schedule(delayNext)
      })
    inflight = job
  }, delay)
}

/** One pass that is not the one already in flight (so a confirm sheet sees a fresh scan). */
export function scanPortsFresh(): Promise<void> {
  const pending = inflight ?? Promise.resolve()
  return pending.then(() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    soon = false
    const job = poll()
      .catch((error: unknown) => console.error('[browser] port scan failed', error))
      .finally(() => {
        inflight = null
        schedule(POLL_MS)
      })
    inflight = job
    return job
  })
}

function kick(): void {
  if (sessionRoots().length === 0) {
    if (!inflight) clearMissing(new Set())
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    return
  }
  if (inflight) {
    soon = true
    return
  }
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  schedule(50)
}

/** Starts the low-frequency scan. Sessions that appear later are picked up through `onSessionRootsChanged`. */
export function startPortScanning(): void {
  if (started) return
  started = true
  onSessionRootsChanged(kick)
  kick()
}

/** The window's watchers are gone (closed, crashed, or its page reloaded): stop scanning for them. */
function forget(owner: WebContents): void {
  watches.dropOwner(owner)
}

const hooked = new WeakSet<WebContents>()

export function watchPorts(owner: WebContents, sessionId: string): void {
  watches.add(owner, sessionId)
  if (!hooked.has(owner)) {
    hooked.add(owner)
    owner.on('destroyed', () => forget(owner))
    owner.on('render-process-gone', () => forget(owner))
    owner.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) forget(owner)
    })
  }
  const cached = latest.get(sessionId)
  if (cached && cached.owner === owner) {
    send(owner, sessionId, cached.ports)
    const watch = watches.all().find((w) => w.owner === owner && w.sessionId === sessionId)
    if (watch) watch.last = cached.ports
  }
  kick()
}

export function unwatchPorts(owner: WebContents, sessionId: string): void {
  watches.remove(owner, sessionId)
}
