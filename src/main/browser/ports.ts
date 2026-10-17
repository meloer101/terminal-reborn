// Minimal port detection (PRD F14) for the 浏览器 view: which TCP ports a session's PTY process tree listens on.
// One `ps` + one `lsof` per poll, polled only while some window watches a session (the 浏览器 view is open).
// The rest of F14 (tags in the sidebar / overview, ⌥-click, ending the process) is not built yet.
import { execFile } from 'node:child_process'
import type { WebContents } from 'electron'
import { BROWSER_IPC, parseLsofListen, parsePs, portsChanged, processTree, serverLabel, type ListeningPort, type SessionPorts } from '@shared/browser'
import { sessionPid } from '../pty'

const POLL_MS = 3_000
const RUN_TIMEOUT_MS = 5_000

interface Watch {
  owner: WebContents
  sessionId: string
  /** Watchers in this window (a view may mount twice). */
  count: number
  last: ListeningPort[] | null
}

const watches = new Map<string, Watch>()
let timer: ReturnType<typeof setTimeout> | null = null
let polling = false
const watchedOwners = new WeakSet<WebContents>()

/** stdout of a system tool; lsof exits 1 when it finds nothing, which is not an error here. */
function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''))
  })
}

async function poll(): Promise<void> {
  const live = [...watches.values()].filter((w) => !w.owner.isDestroyed())
  if (live.length === 0) return
  const processes = parsePs(await run('/bin/ps', ['-A', '-o', 'pid=,ppid=,args=']))
  const trees = new Map<Watch, Map<number, string>>()
  const allPids = new Set<number>()
  for (const watch of live) {
    const root = sessionPid(watch.owner, watch.sessionId)
    const tree = new Map(root ? processTree(processes, root).map((p) => [p.pid, p.args] as const) : [])
    trees.set(watch, tree)
    for (const pid of tree.keys()) allPids.add(pid)
  }
  const listening =
    allPids.size > 0 ? parseLsofListen(await run('/usr/sbin/lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', [...allPids].join(','), '-F', 'pn'])) : []
  for (const watch of live) {
    const tree = trees.get(watch) ?? new Map<number, string>()
    const ports = listening.filter((l) => tree.has(l.pid)).map((l) => ({ ...l, label: serverLabel(tree.get(l.pid) ?? '') }))
    if (watch.last !== null && !portsChanged(watch.last, ports)) continue
    watch.last = ports
    if (!watch.owner.isDestroyed()) watch.owner.send(BROWSER_IPC.ports, { sessionId: watch.sessionId, ports } satisfies SessionPorts)
  }
}

function schedule(delay: number): void {
  if (timer || polling || watches.size === 0) return
  timer = setTimeout(() => {
    timer = null
    polling = true
    poll()
      .catch((error: unknown) => console.error('[browser] port scan failed', error))
      .finally(() => {
        polling = false
        schedule(POLL_MS)
      })
  }, delay)
}

const keyOf = (owner: WebContents, sessionId: string) => `${owner.id}:${sessionId}`

export function watchPorts(owner: WebContents, sessionId: string): void {
  const key = keyOf(owner, sessionId)
  const existing = watches.get(key)
  if (existing) {
    existing.count++
    // A new watcher needs the current list even if it has not changed.
    existing.last = null
  } else {
    watches.set(key, { owner, sessionId, count: 1, last: null })
    if (!watchedOwners.has(owner)) {
      watchedOwners.add(owner)
      owner.once('destroyed', () => {
        for (const [k, w] of watches) if (w.owner === owner) watches.delete(k)
      })
    }
  }
  // Scan soon rather than after a full interval.
  if (timer) clearTimeout(timer)
  timer = null
  schedule(50)
}

export function unwatchPorts(owner: WebContents, sessionId: string): void {
  const key = keyOf(owner, sessionId)
  const watch = watches.get(key)
  if (!watch) return
  if (--watch.count <= 0) watches.delete(key)
  if (watches.size === 0 && timer) {
    clearTimeout(timer)
    timer = null
  }
}
