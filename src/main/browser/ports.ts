// Minimal port detection (PRD F14) for the 浏览器 view: which TCP ports a session's PTY process tree listens on.
// One `ps` + one `lsof` per poll, polled only while some window watches a session (the 浏览器 view is open).
// The rest of F14 (tags in the sidebar / overview, ⌥-click, ending the process) is not built yet.
import { execFile } from 'node:child_process'
import type { WebContents } from 'electron'
import { BROWSER_IPC, parseLsofListen, parsePs, processTree, serverLabel, type SessionPorts } from '@shared/browser'
import { sessionPid } from '../pty'
import { PortWatches, type PortWatch } from './port-watches'

const POLL_MS = 3_000
const RUN_TIMEOUT_MS = 5_000

const watches = new PortWatches<WebContents>()
let timer: ReturnType<typeof setTimeout> | null = null
let polling = false

/** stdout of a system tool; lsof exits 1 when it finds nothing, which is not an error here. */
function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }, (_error, stdout) => resolve(typeof stdout === 'string' ? stdout : ''))
  })
}

async function poll(): Promise<void> {
  const live = watches.all().filter((w) => !w.owner.isDestroyed())
  if (live.length === 0) return
  const processes = parsePs(await run('/bin/ps', ['-A', '-o', 'pid=,ppid=,args=']))
  const trees = new Map<PortWatch<WebContents>, Map<number, string>>()
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
    // A watch dropped while scanning (its window reloaded) must not report.
    if (!watches.all().includes(watch) || !watches.update(watch, ports)) continue
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

function stopIfIdle(): void {
  if (watches.size === 0 && timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** The window's watchers are gone (closed, crashed, or its page reloaded): stop scanning for them. */
function forget(owner: WebContents): void {
  watches.dropOwner(owner)
  stopIfIdle()
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
  // Scan soon rather than after a full interval.
  if (timer) clearTimeout(timer)
  timer = null
  schedule(50)
}

export function unwatchPorts(owner: WebContents, sessionId: string): void {
  watches.remove(owner, sessionId)
  stopIfIdle()
}
