// What the daemon (./index.ts) builds on for GUI sessions: its SessionHost's pipe sessions count towards the idle
// exit, and its hook socket knows them, relays their hooks while the app is attached and journals them otherwise.
import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostEvent } from '../pty-host/protocol'
import { SessionHost } from '../pty-host/session-host'
import { DaemonHooks } from './hooks'
import { IdleTimer } from './idle'
import { hookDirFor } from './wire'

const LONG_RUNNING = 'setInterval(() => {}, 1000)'
const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }

let host: SessionHost | null = null
let hooks: DaemonHooks | null = null
let dir = ''
afterEach(async () => {
  host?.killAll()
  host = null
  await hooks?.stop()
  hooks = null
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

function startPipe(target: SessionHost, id: string): void {
  target.handle({ type: 'pipe-spawn', id, cwd: process.cwd(), agent: 'claude', command: process.execPath, args: ['-e', LONG_RUNNING], baseEnv })
}

function post(daemonHooks: DaemonHooks, sessionId: string, event: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath: daemonHooks.socketPath,
        path: `/hook/${event}?session=${encodeURIComponent(sessionId)}&agent=claude`,
        method: 'POST',
        headers: { 'x-tr-token': daemonHooks.token }
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      }
    )
    req.on('error', reject)
    req.end(JSON.stringify({ hook_event_name: event }))
  })
}

describe('pty daemon · pipe sessions', () => {
  it('a running pipe session keeps the daemon from its idle exit; its end lets it go', async () => {
    const events: HostEvent[] = []
    host = new SessionHost({ mirror: true, emit: (event) => events.push(event), log: () => undefined })
    const target = host
    const onIdle = vi.fn()
    // The daemon's predicate, with no app connected.
    const idle = new IdleTimer(200, () => target.liveCount === 0, onIdle)
    startPipe(target, 'g1')
    expect(target.liveCount).toBe(1)
    idle.update()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onIdle).not.toHaveBeenCalled()
    target.handle({ type: 'kill', id: 'g1' })
    idle.update()
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onIdle).toHaveBeenCalledTimes(1)
    idle.stop()
  }, 20_000)

  it("knows pipe session ids on the hook socket: relayed while attached, journaled while detached, 404 for strangers", async () => {
    dir = mkdtempSync(join(tmpdir(), 'tr-ptyd-pipes-'))
    const events: HostEvent[] = []
    host = new SessionHost({ mirror: true, emit: (event) => events.push(event), log: () => undefined })
    const target = host
    const relayed: string[] = []
    // As in ./index.ts: `known` is host.has, and a relay needs the session attached.
    hooks = new DaemonHooks({
      socketDir: hookDirFor(dir, process.getuid?.() ?? 0),
      tokenPath: join(dir, 'hook-token'),
      known: (sessionId) => target.has(sessionId),
      relay: (request) => {
        if (!target.isAttached(request.sessionId)) return null
        relayed.push(`${request.sessionId}:${request.event}`)
        return Promise.resolve({ status: 200, body: 'relayed' })
      },
      log: () => undefined
    })
    await hooks.start()
    startPipe(target, 'g1')

    expect(await post(hooks, 'g1', 'UserPromptSubmit')).toEqual({ status: 200, body: 'relayed' })
    expect(relayed).toEqual(['g1:UserPromptSubmit'])

    target.handle({ type: 'detach', id: 'g1' })
    expect(await post(hooks, 'g1', 'Stop')).toEqual({ status: 200, body: '' })
    expect(relayed).toHaveLength(1)
    expect(hooks.journal.take('g1').map((e) => e.event)).toEqual(['Stop'])

    expect((await post(hooks, 'stranger', 'Stop')).status).toBe(404)
  }, 20_000)
})
