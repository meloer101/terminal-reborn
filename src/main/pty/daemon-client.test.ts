import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { connect, createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { frame, PROTOCOL_VERSION } from '../../pty-daemon/wire'
import { DaemonConnection, spawnOrphan } from './daemon-client'

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
