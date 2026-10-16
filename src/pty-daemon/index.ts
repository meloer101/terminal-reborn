// The pty daemon (docs/spikes/pty-daemon.md): a detached plain-Node process (the app binary with
// ELECTRON_RUN_AS_NODE=1) that owns every PTY, so agents keep running when the app quits and a relaunch
// reattaches to them. One app connects at a time over a token-checked Unix socket (./wire.ts).
//   usage: pty-daemon.js --dir <userData>/daemon --socket <path>   (userData is the parent of --dir)
import { createHash, timingSafeEqual } from 'node:crypto'
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { TerminalSnapshotFiles } from '../main/terminal-snapshot-file'
import { guarded } from '../pty-host/guard'
import type { HostEvent, HostRequest } from '../pty-host/protocol'
import { ensureSpawnHelperExecutable, SessionHost } from '../pty-host/session-host'
import { DiskSnapshots } from './disk-snapshots'
import { DaemonHooks, type RelayReply } from './hooks'
import { IdleTimer } from './idle'
import {
  frame,
  HOOK_TOKEN_FILE,
  hookDirFor,
  LineReader,
  PROTOCOL_VERSION,
  RECORD_FILE,
  TOKEN_FILE,
  type ClientMessage,
  type DaemonMessage,
  type DaemonRecord
} from './wire'

/** No app connected and no process running for this long: nothing left to keep alive. */
const IDLE_EXIT_MS = Number(process.env.TR_PTYD_IDLE_MS) >= 100 ? Number(process.env.TR_PTYD_IDLE_MS) : 10_000
/** A detached session's screen goes to disk once its output has been quiet this long (§10). */
const SNAPSHOT_QUIET_MS =
  Number(process.env.TR_PTYD_SNAPSHOT_QUIET_MS) >= 100 ? Number(process.env.TR_PTYD_SNAPSHOT_QUIET_MS) : 30_000
/** Exiting waits at most this long for pending screens to reach the disk. */
const SNAPSHOT_FLUSH_MS = 1_000
const HELLO_TIMEOUT_MS = 5_000
/** A relayed hook the app does not answer in time is answered empty (the agent must never hang on us). */
const HOOK_RELAY_TIMEOUT_MS = 10_000

function log(...args: unknown[]): void {
  console.log(new Date().toISOString(), '[ptyd]', ...args)
}

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value) throw new Error(`missing ${name}`)
  return value
}

const dir = argument('--dir')
const socketPath = argument('--socket')
const token = readFileSync(join(dir, TOKEN_FILE), 'utf8').trim()
const buildId = (() => {
  try {
    return createHash('sha1').update(readFileSync(__filename)).digest('hex').slice(0, 12)
  } catch {
    return 'unknown'
  }
})()

interface Client {
  socket: Socket
  /** Spoke a compatible protocol: may drive sessions. An older/newer app may only ask for `shutdown`. */
  compatible: boolean
}

let active: Client | null = null
let resolveHooksReady: (started: Promise<void>) => void = () => undefined
const hooksReady = new Promise<void>((resolve) => {
  resolveHooksReady = (started) => void started.then(resolve)
})
let server: Server | null = null
let shuttingDown = false

function send(client: Client, message: DaemonMessage): void {
  if (!client.socket.destroyed) client.socket.write(frame(message))
}

const host = new SessionHost({
  mirror: true,
  emit: (event: HostEvent) => {
    if (event.type === 'attached') snapshots.cancel(event.id)
    // A reattaching app gets the hook events it missed with the screen.
    const out: HostEvent = event.type === 'attached' ? { ...event, hooks: hooks.journal.take(event.id) } : event
    if (active) send(active, out)
  },
  onSessionsChanged: () => {
    hooks.journal.retain(new Set(host.list().map((s) => s.id)))
    idle.update()
  },
  onDetachedOutput: (id) => snapshots.touch(id),
  log: (message, error) => log(message, error)
})

// The same files the app's main process writes (src/main/terminal-snapshots.ts) while it is attached.
const snapshotFiles = new TerminalSnapshotFiles(join(dirname(dir), 'terminal-snapshots'))
const snapshots = new DiskSnapshots(SNAPSHOT_QUIET_MS, {
  capture: async (id) => {
    const screen = await host.screen(id)
    return screen ? { cols: screen.cols, rows: screen.rows, data: screen.data } : null
  },
  isAttached: (id) => host.isAttached(id),
  save: (id, snapshot) => snapshotFiles.save(id, snapshot),
  log: (...args) => log(...args)
})

let nextRid = 1
const relays = new Map<number, { resolve(reply: RelayReply): void; timer: ReturnType<typeof setTimeout> }>()

function settleRelay(rid: number, reply: RelayReply): void {
  const relay = relays.get(rid)
  if (!relay) return
  clearTimeout(relay.timer)
  relays.delete(rid)
  relay.resolve(reply)
}

const hooks = new DaemonHooks({
  socketDir: hookDirFor(dir, process.getuid?.() ?? 0),
  tokenPath: join(dir, HOOK_TOKEN_FILE),
  known: (sessionId) => host.list().some((s) => s.id === sessionId),
  relay: (request) => {
    const client = active
    if (!client?.compatible || !host.isAttached(request.sessionId)) return null
    const rid = nextRid++
    return new Promise<RelayReply>((resolve) => {
      const timer = setTimeout(() => settleRelay(rid, { status: 200, body: '' }), HOOK_RELAY_TIMEOUT_MS)
      relays.set(rid, { resolve, timer })
      send(client, { type: 'hook', rid, sessionId: request.sessionId, event: request.event, agent: request.agent, payload: request.payload ?? null })
    })
  },
  log: (...args) => log(...args)
})

const idle = new IdleTimer(IDLE_EXIT_MS, () => active === null && host.liveCount === 0, () => shutdown('idle', false))

function tokenMatches(given: unknown): boolean {
  if (typeof given !== 'string') return false
  const a = Buffer.from(token)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

const REQUEST_TYPES: ReadonlySet<string> = new Set<HostRequest['type']>(['spawn', 'write', 'resize', 'kill', 'ack', 'attach', 'detach', 'list', 'killAll'])

function isHostRequest(message: Record<string, unknown>): message is HostRequest & Record<string, unknown> {
  if (typeof message.type !== 'string' || !REQUEST_TYPES.has(message.type)) return false
  return message.type === 'killAll' || message.type === 'list' || (typeof message.id === 'string' && message.id.length > 0 && message.id.length <= 128)
}

function onConnection(socket: Socket): void {
  socket.setEncoding('utf8')
  let client: Client | null = null
  const helloTimer = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS)
  const reader = new LineReader(
    (raw) => {
      if (typeof raw !== 'object' || raw === null) return socket.destroy()
      const message = raw as Record<string, unknown>
      if (!client) {
        if (message.type !== 'hello' || !tokenMatches(message.token)) {
          socket.end(frame({ type: 'refused', reason: 'bad hello' }))
          return
        }
        clearTimeout(helloTimer)
        const hello: Client = { socket, compatible: message.protocol === PROTOCOL_VERSION }
        client = hello
        if (hello.compatible) adopt(hello)
        // The hook socket starts right after ours is published; a fast first client waits for it.
        void hooksReady.then(() =>
          send(hello, {
            type: 'welcome',
            protocol: PROTOCOL_VERSION,
            pid: process.pid,
            buildId,
            sessions: host.list(),
            hooks: hooks.running ? { socketPath: hooks.socketPath, token: hooks.token } : null
          })
        )
        return
      }
      handle(client, message as ClientMessage & Record<string, unknown>)
    },
    (error) => {
      log('dropping a connection:', error.message)
      socket.destroy()
    }
  )
  socket.on('data', (chunk: string) => reader.push(chunk))
  socket.on('error', () => socket.destroy())
  socket.on('close', () => {
    clearTimeout(helloTimer)
    if (client && active === client) {
      active = null
      for (const rid of [...relays.keys()]) settleRelay(rid, { status: 200, body: '' })
      host.detachAll()
      // The renderer saved on unload, unless the app crashed: write every screen once more from here.
      for (const session of host.list()) if (!session.exit) snapshots.touch(session.id)
      log('app disconnected; sessions keep running:', host.liveCount)
      idle.update()
    }
  })
}

/** A newly connected app takes over from any earlier one (e.g. one that hung while quitting). */
function adopt(client: Client): void {
  const previous = active
  active = client
  if (previous) {
    host.detachAll()
    previous.socket.destroy()
  }
  idle.update()
  log('app connected; sessions:', host.list().length)
}

function handle(client: Client, message: ClientMessage & Record<string, unknown>): void {
  if (message.type === 'shutdown') {
    shutdown('requested', message.killSessions === true)
    return
  }
  if (!client.compatible || active !== client) return
  if (message.type === 'hook-reply') {
    if (typeof message.rid === 'number' && typeof message.body === 'string' && typeof message.status === 'number') {
      settleRelay(message.rid, { status: message.status, body: message.body })
    }
    return
  }
  if (!isHostRequest(message)) {
    log('ignoring an invalid request', String(message.type))
    return
  }
  host.handle(message)
}

function shutdown(reason: string, killSessions: boolean): void {
  if (shuttingDown) return
  shuttingDown = true
  log('shutting down:', reason, killSessions ? '(ending sessions)' : '')
  idle.stop()
  // Screens changed since the app left go to disk first (logout's SIGTERM: the cold path after the reboot shows them).
  const flushed = Promise.race([snapshots.flush(), new Promise((resolve) => setTimeout(resolve, SNAPSHOT_FLUSH_MS))])
  void flushed.then(() => finishShutdown(killSessions))
}

function finishShutdown(killSessions: boolean): void {
  snapshots.cancelAll()
  if (killSessions) host.killAll()
  void hooks.stop()
  try {
    rmSync(join(dir, RECORD_FILE), { force: true })
  } catch {
    // Not ours to worry about any more.
  }
  // Only our own socket: never remove a name another daemon may have published meanwhile.
  const finish = (): void => process.exit(0)
  if (server) server.close(finish)
  else finish()
  active?.socket.end()
  setTimeout(finish, 1000).unref()
}

/** Something already answers on the socket: another daemon of this profile is alive. */
function probe(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path)
    const done = (alive: boolean): void => {
      socket.destroy()
      resolve(alive)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    setTimeout(() => done(false), 1000).unref()
  })
}

function listen(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const next = createServer(onConnection)
    next.once('error', reject)
    next.listen(socketPath, () => {
      next.off('error', reject)
      next.on('error', (error) => log('server error', error))
      resolve(next)
    })
  })
}

async function start(): Promise<void> {
  guarded('ensure spawn-helper', ensureSpawnHelperExecutable)
  try {
    server = await listen()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    if (await probe(socketPath)) {
      log('another daemon serves', socketPath, '- exiting')
      process.exit(0)
    }
    rmSync(socketPath, { force: true })
    server = await listen()
  }
  chmodSync(socketPath, 0o600)
  const record: DaemonRecord = { pid: process.pid, protocol: PROTOCOL_VERSION, buildId, socketPath, startedAt: Date.now() }
  writeFileSync(join(dir, RECORD_FILE), JSON.stringify(record), { mode: 0o600 })
  log('listening on', socketPath, 'build', buildId)
  // Only now, owning the endpoint: a second daemon that lost the race must not replace the first one's hook socket.
  // Agents work without hooks (status falls back to titles); never let the hook socket keep the daemon from serving.
  resolveHooksReady(hooks.start().catch((error: unknown) => log('hook socket unavailable', error)))
  idle.update()
}

// Last line of defence: log and keep serving the other terminals instead of dying with the first bug.
process.on('uncaughtException', (error) => log('uncaughtException', error))
process.on('unhandledRejection', (reason) => log('unhandledRejection', reason))
// Detached from the app's terminal session: a hang-up or the app's process group being signalled is not for us.
process.on('SIGHUP', () => undefined)
process.on('SIGTERM', () => shutdown('SIGTERM', true))

start().catch((error: unknown) => {
  log('could not start:', error)
  process.exit(1)
})
