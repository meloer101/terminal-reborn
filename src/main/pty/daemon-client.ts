// Finds, adopts or launches the pty daemon (src/pty-daemon, docs/spikes/pty-daemon.md §3.3) and speaks its socket
// protocol. Adopt-if-alive: a daemon answering on this profile's socket is reused with all its sessions; only a
// socket that provably has nobody behind it (ENOENT / ECONNREFUSED) leads to launching a new one.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { dirname, join } from 'node:path'
import type { HostEvent, HostRequest, HostSessionInfo } from '../../pty-host/protocol'
import {
  frame,
  LineReader,
  LOG_FILE,
  PROTOCOL_VERSION,
  socketName,
  socketPathFor,
  TOKEN_FILE,
  type ClientMessage,
  type DaemonMessage,
  type HookEndpointInfo
} from '../../pty-daemon/wire'

const CONNECT_TIMEOUT_MS = 1000
const HELLO_TIMEOUT_MS = 2000
const LAUNCH_TIMEOUT_MS = 5000
const LAUNCH_POLL_MS = 25
const LOG_ROTATE_BYTES = 5 * 1024 * 1024

export interface DaemonLocation {
  /** `<userData>/daemon` (0700): token, pid record, log. */
  dir: string
  socketPath: string
}

export function daemonLocation(userData: string, uid = process.getuid?.() ?? 0): DaemonLocation {
  const dir = join(userData, 'daemon')
  return { dir, socketPath: socketPathFor(dir, uid) }
}

/** Creates `dir` 0700, or refuses one that is not a plain directory owned by us (never repaired, never followed). */
function ensurePrivateDir(dir: string, uid = process.getuid?.() ?? 0): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stat = lstatSync(dir)
  if (!stat.isDirectory() || stat.uid !== uid) throw new Error(`${dir} is not a private directory of this user`)
  if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700)
}

function readOrCreateToken(dir: string): string {
  const path = join(dir, TOKEN_FILE)
  try {
    const token = readFileSync(path, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(token)) return token
  } catch {
    // Created below.
  }
  const token = randomBytes(32).toString('hex')
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, token, { mode: 0o600 })
  renameSync(tmp, path)
  return token
}

type ConnectResult = { ok: true; socket: Socket } | { ok: false; dead: boolean; error: Error }

/** `dead` only when the socket provably has nobody behind it; a timeout or EPERM proves nothing. */
function tryConnect(socketPath: string): Promise<ConnectResult> {
  return new Promise((resolve) => {
    const socket = connect(socketPath)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve({ ok: false, dead: false, error: new Error('connect timed out') })
    }, CONNECT_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.removeAllListeners('error')
      resolve({ ok: true, socket })
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      socket.destroy()
      resolve({ ok: false, dead: error.code === 'ENOENT' || error.code === 'ECONNREFUSED', error })
    })
  })
}

export interface DaemonConnectionHandlers {
  onEvent(event: HostEvent): void
  /** A hook from an agent of an attached session (the daemon serves the hook socket); resolves to the hook's answer. */
  onHook(hook: Extract<DaemonMessage, { type: 'hook' }>): Promise<{ status: number; body: string }>
  /** The connection ended without `close()` being called (the daemon died or dropped us). */
  onLost(): void
}

/** One live, authenticated connection to the daemon. */
export class DaemonConnection {
  readonly kind = 'daemon'
  private closed = false
  private readonly closeWaiters: Array<() => void> = []

  private constructor(
    private readonly socket: Socket,
    /** What the daemon held when we connected. */
    readonly sessions: HostSessionInfo[],
    readonly pid: number,
    readonly buildId: string,
    /** The daemon's hook socket (null when it could not start one). */
    readonly hooks: HookEndpointInfo | null,
    handlers: DaemonConnectionHandlers,
    reader: LineReader,
    buffered: DaemonMessage[]
  ) {
    const dispatch = (message: DaemonMessage): void => {
      if (message.type === 'hook') {
        void handlers
          .onHook(message)
          .catch(() => ({ status: 500, body: '' }))
          .then((reply) => this.write({ type: 'hook-reply', rid: message.rid, ...reply }))
        return
      }
      if (message.type === 'welcome' || message.type === 'refused') return
      handlers.onEvent(message)
    }
    reader.onMessage = (message) => dispatch(message as DaemonMessage)
    for (const message of buffered) dispatch(message)
    socket.on('close', () => {
      for (const resolve of this.closeWaiters.splice(0)) resolve()
      if (this.closed) return
      this.closed = true
      handlers.onLost()
    })
  }

  /** Sends `hello` on a connected socket and waits for `welcome`. */
  static handshake(socket: Socket, token: string, appVersion: string, handlers: DaemonConnectionHandlers): Promise<DaemonConnection> {
    return new Promise((resolve, reject) => {
      socket.setEncoding('utf8')
      socket.setNoDelay(true)
      let welcome: Extract<DaemonMessage, { type: 'welcome' }> | null = null
      const early: DaemonMessage[] = []
      const fail = (error: Error): void => {
        clearTimeout(timer)
        socket.destroy()
        reject(error)
      }
      const timer = setTimeout(() => fail(new Error('the pty daemon did not answer hello')), HELLO_TIMEOUT_MS)
      const reader = new LineReader(
        (raw) => {
          const message = raw as DaemonMessage
          if (welcome) {
            early.push(message)
            return
          }
          if (message.type === 'refused') return fail(new Error(`the pty daemon refused us: ${message.reason}`))
          if (message.type !== 'welcome') return fail(new Error('unexpected first frame from the pty daemon'))
          if (message.protocol !== PROTOCOL_VERSION) return fail(new Error(`pty daemon speaks protocol ${message.protocol}`))
          welcome = message
          clearTimeout(timer)
          // Hand over on the next turn so frames that arrived in the same chunk are kept in order.
          queueMicrotask(() => {
            const w = welcome as Extract<DaemonMessage, { type: 'welcome' }>
            resolve(new DaemonConnection(socket, w.sessions, w.pid, w.buildId, w.hooks ?? null, handlers, reader, early))
          })
        },
        (error) => fail(error)
      )
      socket.on('data', (chunk: string) => reader.push(chunk))
      socket.once('error', (error) => {
        if (!welcome) fail(error)
      })
      socket.on('error', () => undefined)
      socket.write(frame({ type: 'hello', token, protocol: PROTOCOL_VERSION, appVersion }))
    })
  }

  post(message: HostRequest): void {
    this.write(message)
  }

  private write(message: ClientMessage): void {
    if (!this.closed && !this.socket.destroyed) this.socket.write(frame(message))
  }

  /** Disconnects; the daemon keeps every session running (detached). */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.socket.end()
  }

  /** Asks the daemon to exit (ending its sessions when `killSessions`); resolves when it hung up, or after `timeoutMs`. */
  shutdown(killSessions: boolean, timeoutMs = 2000): Promise<void> {
    if (this.closed) return Promise.resolve()
    const gone = new Promise<void>((resolve) => {
      this.closeWaiters.push(resolve)
      setTimeout(resolve, timeoutMs).unref()
    })
    this.write({ type: 'shutdown', killSessions })
    this.closed = true
    return gone
  }
}

export interface OpenDaemonOptions {
  userData: string
  /** `out/main/pty-daemon.js`. */
  script: string
  appVersion: string
  handlers: DaemonConnectionHandlers
  log?: (message: string) => void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rotateLog(path: string): void {
  try {
    if (statSync(path).size > LOG_ROTATE_BYTES) renameSync(path, `${path}.1`)
  } catch {
    // No log yet.
  }
}

/** Starts a detached daemon: its own session and process group, so nothing that happens to the app reaches it. */
function launch(location: DaemonLocation, script: string): void {
  const logPath = join(location.dir, LOG_FILE)
  rotateLog(logPath)
  const out = openSync(logPath, 'a', 0o600)
  try {
    const child = spawn(process.execPath, [script, '--dir', location.dir, '--socket', location.socketPath], {
      detached: true,
      stdio: ['ignore', out, out],
      // A deleted worktree must never be the daemon's cwd.
      cwd: location.dir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    child.unref()
  } finally {
    closeSync(out)
  }
}

/**
 * Connects to this profile's daemon, launching it when nobody is there. Rejects when the daemon cannot be
 * reached for certain (the caller falls back to the in-app utilityProcess for this run).
 */
export async function openDaemon(options: OpenDaemonOptions): Promise<DaemonConnection> {
  const log = options.log ?? ((message: string) => console.log(`[pty] ${message}`))
  const location = daemonLocation(options.userData)
  ensurePrivateDir(location.dir)
  if (dirname(location.socketPath) !== location.dir) ensurePrivateDir(dirname(location.socketPath))
  const token = readOrCreateToken(location.dir)
  const handshake = (socket: Socket) => DaemonConnection.handshake(socket, token, options.appVersion, options.handlers)

  const first = await tryConnect(location.socketPath)
  if (first.ok) {
    const connection = await handshake(first.socket)
    log(`adopted pty daemon ${connection.pid} (${connection.sessions.length} sessions)`)
    return connection
  }
  if (!first.dead) throw first.error

  // Nobody is behind the socket: a leftover of a daemon that crashed. The daemon removes it itself too.
  rmSync(location.socketPath, { force: true })
  const started = Date.now()
  launch(location, options.script)
  for (;;) {
    await sleep(LAUNCH_POLL_MS)
    const attempt = await tryConnect(location.socketPath)
    if (attempt.ok) {
      const connection = await handshake(attempt.socket)
      log(`started pty daemon ${connection.pid} in ${Date.now() - started} ms`)
      void retireOtherProtocols(location, token, options.appVersion)
      return connection
    }
    if (Date.now() - started > LAUNCH_TIMEOUT_MS) throw new Error(`the pty daemon did not come up: ${attempt.error.message}`)
  }
}

/**
 * Daemons of another protocol version (left by an older or newer app) cannot be driven by this app: ask them to end
 * their sessions and exit, so those sessions come back through the cold path (saved screen + `--resume`).
 */
async function retireOtherProtocols(location: DaemonLocation, token: string, appVersion: string): Promise<void> {
  let names: string[]
  try {
    names = readdirSync(location.dir)
  } catch {
    return
  }
  const ours = socketName()
  for (const name of names) {
    if (name === ours || !/^ptyd-v\d+\.sock$/.test(name)) continue
    const result = await tryConnect(join(location.dir, name))
    if (!result.ok) continue
    // hello/shutdown are frozen across versions; the welcome's protocol does not matter here.
    result.socket.write(frame({ type: 'hello', token, protocol: PROTOCOL_VERSION, appVersion }))
    result.socket.end(frame({ type: 'shutdown', killSessions: true }))
  }
}
