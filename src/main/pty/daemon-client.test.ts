import { execFileSync, spawn } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { connect, createServer, type Server } from 'node:net'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { frame, PROTOCOL_VERSION } from '../../pty-daemon/wire'
import { DaemonConnection, daemonLocation, openDaemon, spawnOrphan } from './daemon-client'

function parentAndGroup(pid: number): { ppid: number; pgid: number } | null {
  try {
    const [ppid, pgid] = execFileSync('ps', ['-o', 'ppid=,pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/).map(Number)
    return ppid !== undefined && pgid !== undefined ? { ppid, pgid } : null
  } catch {
    return null
  }
}

async function until<T>(read: () => T | null, timeoutMs = 5000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = read()
    if (value !== null) return value
    if (Date.now() - started > timeoutMs) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('spawnOrphan', () => {
  let dir = ''
  let pid = 0

  afterEach(() => {
    if (pid) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it("starts the program orphaned in a process group of its own: no tree kill of the app's processes reaches it", async () => {
    dir = mkdtempSync(join(tmpdir(), 'tr-orphan-'))
    const script = join(dir, 'probe.js')
    const pidFile = join(dir, 'pid')
    writeFileSync(
      script,
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
console.log('args', JSON.stringify(process.argv.slice(2)))
setTimeout(() => undefined, 30_000)`
    )
    const logPath = join(dir, 'out.log')
    const out = openSync(logPath, 'a')
    try {
      spawnOrphan(process.execPath, [script, '--dir', 'a b', '--socket', 'c'], { cwd: dir, env: process.env, out })
    } finally {
      closeSync(out)
    }

    pid = await until(() => {
      try {
        return Number(readFileSync(pidFile, 'utf8')) || null
      } catch {
        return null
      }
    })
    // Once the launcher is gone, launchd is the parent: the probe is no longer anyone's descendant.
    const info = await until(() => {
      const current = parentAndGroup(pid)
      return current && current.ppid === 1 ? current : null
    })
    expect(info.ppid).toBe(1)
    expect(info.pgid).toBe(pid)
    expect(info.pgid).not.toBe(parentAndGroup(process.pid)?.pgid)
    await until(() => (readFileSync(logPath, 'utf8').includes('args') ? true : null))
    expect(readFileSync(logPath, 'utf8')).toContain('args ["--dir","a b","--socket","c"]')
  })
})

describe('DaemonConnection.handshake', () => {
  let server: Server | null = null
  let socketDir = ''
  afterEach(() => {
    server?.close()
    server = null
    if (socketDir) rmSync(socketDir, { recursive: true, force: true })
    socketDir = ''
  })

  /** A stand-in daemon that answers hello with a welcome carrying `extra`. */
  async function connectWith(extra: Record<string, unknown>): Promise<DaemonConnection> {
    socketDir = mkdtempSync(join(tmpdir(), 'tr-dc-'))
    const path = join(socketDir, 's.sock')
    const listening = createServer((socket) => {
      socket.once('data', () =>
        socket.write(frame({ type: 'welcome', protocol: PROTOCOL_VERSION, pid: 1, buildId: 'b', sessions: [{ id: 'g1', pid: 2, pipe: true }], hooks: null, ...extra }))
      )
    })
    server = listening
    await new Promise<void>((resolve) => listening.listen(path, resolve))
    const socket = connect(path)
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    const handlers = { onEvent: () => undefined, onHook: () => Promise.resolve({ status: 200, body: '' }), onLost: () => undefined }
    return DaemonConnection.handshake(socket, 'token', 'test', handlers)
  }

  it('reports that the daemon runs pipe sessions when its welcome says so', async () => {
    const connection = await connectWith({ pipes: true })
    expect(connection.pipes).toBe(true)
    expect(connection.sessions).toEqual([{ id: 'g1', pid: 2, pipe: true }])
    connection.close()
  })

  it('treats a welcome without `pipes` (an older daemon of the same protocol) as no pipe sessions', async () => {
    const connection = await connectWith({})
    expect(connection.pipes).toBe(false)
    connection.close()
  })
})

/** A stand-in daemon: answers `hello` with a welcome carrying its pid and exits on `shutdown`. */
const FAKE_DAEMON = `
const net = require('node:net')
const path = process.argv[process.argv.indexOf('--socket') + 1]
const server = net.createServer((socket) => {
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk
    for (let i = buffer.indexOf('\\n'); i >= 0; i = buffer.indexOf('\\n')) {
      const message = JSON.parse(buffer.slice(0, i))
      buffer = buffer.slice(i + 1)
      if (message.type === 'hello') socket.write(JSON.stringify({ type: 'welcome', protocol: ${PROTOCOL_VERSION}, pid: process.pid, buildId: 'fake', sessions: [], hooks: null }) + '\\n')
      if (message.type === 'shutdown') server.close(() => process.exit(0))
    }
  })
})
server.listen(path)
setTimeout(() => process.exit(0), 20_000)
`

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('openDaemon', () => {
  let userData = ''
  const pids: number[] = []
  const handlers = { onEvent: () => undefined, onHook: () => Promise.resolve({ status: 200, body: '' }), onLost: () => undefined }

  afterEach(() => {
    for (const pid of pids.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
    }
    if (userData) {
      rmSync(dirname(daemonLocation(userData).socketPath), { recursive: true, force: true })
      rmSync(userData, { recursive: true, force: true })
    }
    userData = ''
  })

  /** Runs the stand-in daemon from `program` on this profile's socket and waits until it listens. */
  async function startDaemon(program: string, script: string): Promise<number> {
    const location = daemonLocation(userData)
    mkdirSync(dirname(location.socketPath), { recursive: true, mode: 0o700 })
    const child = spawn(program, [script, '--dir', location.dir, '--socket', location.socketPath], { detached: true, stdio: 'ignore' })
    child.unref()
    const pid = child.pid ?? 0
    pids.push(pid)
    await until(() => (existsSync(location.socketPath) ? true : null))
    return pid
  }

  function setUp(): string {
    userData = mkdtempSync(join(tmpdir(), 'tr-od-'))
    const script = join(userData, 'fake-daemon.js')
    writeFileSync(script, FAKE_DAEMON)
    return script
  }

  it('adopts a running daemon whose program is still there', async () => {
    const script = setUp()
    const pid = await startDaemon(process.execPath, script)
    const connection = await openDaemon({ userData, script, appVersion: 'test', handlers, log: () => undefined })
    pids.push(connection.pid)
    expect(connection.pid).toBe(pid)
    connection.close()
  })

  it('replaces a daemon whose app was moved or deleted: it could start no new terminal (posix_spawnp failed)', async () => {
    const script = setUp()
    // The daemon runs from a copy of the program that is then deleted, as when the app bundle goes to the Trash.
    const program = join(userData, 'old-app')
    try {
      linkSync(process.execPath, program)
    } catch {
      copyFileSync(process.execPath, program)
    }
    const stale = await startDaemon(program, script)
    rmSync(program)
    const connection = await openDaemon({ userData, script, appVersion: 'test', handlers, log: () => undefined })
    pids.push(connection.pid)
    expect(connection.pid).not.toBe(stale)
    expect(alive(stale)).toBe(false)
    connection.close()
  }, 15_000)
})
