import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIPE_MAX_LINE_CHARS, type PipeExit } from '../../pty-host/pipe-host'
import type { HostEvent, HostRequest } from '../../pty-host/protocol'
import { SessionHost } from '../../pty-host/session-host'
import { HostPipeLink, LocalPipeLink, PipeLinkRouter, pipeHosting, pipeSessionsOf, type PipeHandlers } from './pipes'

const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
// Echoes each stdin line back as JSON.
const ECHO = `process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);process.stdout.write(JSON.stringify({echo:l})+'\\n')}})`
const spawnOf = (id: string) => ({ id, cwd: process.cwd(), agent: 'claude', command: process.execPath, args: ['-e', ECHO], baseEnv })

function recorder() {
  const lines: [string, number][] = []
  const exits: PipeExit[] = []
  const handlers: PipeHandlers = { line: (line, seq) => lines.push([line, seq]), exit: (exit) => exits.push(exit) }
  return { lines, exits, handlers }
}

async function until(check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('pipeHosting', () => {
  it('runs GUI agents in the daemon only when its welcome announces pipes', () => {
    expect(pipeHosting({ kind: 'daemon', pipes: true })).toBe('daemon')
    // An older daemon of the same protocol: they run in main and end with the app.
    expect(pipeHosting({ kind: 'daemon' })).toBe('main')
    expect(pipeHosting({ kind: 'daemon', pipes: false })).toBe('main')
    expect(pipeHosting({ kind: 'utility' })).toBe('utility')
  })
})

describe('pipeSessionsOf', () => {
  it('keeps only pipe sessions of a host listing', () => {
    expect(
      pipeSessionsOf([
        { id: 't1', pid: 1, agent: 'claude' },
        { id: 'g1', pid: 2, agent: 'claude', pipe: true },
        { id: 'g2', pid: 3, pipe: true, exit: { exitCode: 1 } }
      ])
    ).toEqual([
      { id: 'g1', pid: 2, agent: 'claude' },
      { id: 'g2', pid: 3, exit: { exitCode: 1, stderr: '' } }
    ])
  })
})

describe('HostPipeLink', () => {
  afterEach(() => vi.useRealTimers())

  function fake(durable = true) {
    const posted: HostRequest[] = []
    const link = new HostPipeLink((message) => posted.push(message), durable, { spawnMs: 1000, attachMs: 1000, listMs: 1000 })
    return { link, posted }
  }

  it('resolves a spawn on pipe-spawned and routes each session’s lines and exit to its own handlers', async () => {
    const { link, posted } = fake()
    const a = recorder()
    const b = recorder()
    const spawnA = link.spawn(spawnOf('a'), a.handlers)
    const spawnB = link.spawn(spawnOf('b'), b.handlers)
    expect(posted[0]).toMatchObject({ type: 'pipe-spawn', id: 'a', agent: 'claude', command: process.execPath })
    expect(link.handleEvent({ type: 'pipe-spawned', id: 'a', pid: 11 })).toBe(true)
    expect(link.handleEvent({ type: 'pipe-spawned', id: 'b', pid: 12 })).toBe(true)
    await expect(spawnA).resolves.toEqual({ ok: true, pid: 11 })
    await expect(spawnB).resolves.toEqual({ ok: true, pid: 12 })

    link.handleEvent({ type: 'pipe-line', id: 'a', line: '{"n":1}', seq: 1 })
    link.handleEvent({ type: 'pipe-line', id: 'b', line: '{"n":2}', seq: 1 })
    expect(a.lines).toEqual([['{"n":1}', 1]])
    expect(b.lines).toEqual([['{"n":2}', 1]])

    expect(link.write('a', 'hi')).toBe(true)
    expect(link.write('a', 'two\nlines')).toBe(false)
    // One frame too big for the daemon's socket would end the connection, every terminal with it.
    expect(link.write('a', 'x'.repeat(PIPE_MAX_LINE_CHARS + 1))).toBe(false)
    expect(posted.at(-1)).toEqual({ type: 'pipe-write', id: 'a', line: 'hi' })

    expect(link.handleEvent({ type: 'pipe-exit', id: 'a', exitCode: 2, stderr: 'boom' })).toBe(true)
    expect(a.exits).toEqual([{ exitCode: 2, stderr: 'boom' }])
    expect(link.write('a', 'late')).toBe(false)
    expect(link.owns('a')).toBe(false)
    expect(link.owns('b')).toBe(true)
  })

  it('takes spawn-error and attach-miss only for its own pending ids (the terminals get the rest)', async () => {
    const { link } = fake()
    const spawn = link.spawn(spawnOf('a'), recorder().handlers)
    expect(link.handleEvent({ type: 'spawn-error', id: 'pty-1', message: 'x' })).toBe(false)
    expect(link.handleEvent({ type: 'spawn-error', id: 'a', message: 'no such command' })).toBe(true)
    await expect(spawn).resolves.toEqual({ ok: false, message: 'no such command' })
    expect(link.handleEvent({ type: 'attach-miss', id: 'pty-1' })).toBe(false)
    const attach = link.attach('g9', recorder().handlers)
    expect(link.handleEvent({ type: 'attach-miss', id: 'g9' })).toBe(true)
    await expect(attach).resolves.toBeNull()
    expect(link.handleEvent({ type: 'data', id: 'pty-1', data: 'x', seq: 1 })).toBe(false)
  })

  it('gives up on a spawn that does not answer, kills it, and still takes its late answers', async () => {
    vi.useFakeTimers()
    const { link, posted } = fake()
    const spawn = link.spawn(spawnOf('a'), recorder().handlers)
    vi.advanceTimersByTime(1000)
    await expect(spawn).resolves.toEqual({ ok: false, message: 'timed out starting the agent process' })
    expect(posted.at(-1)).toEqual({ type: 'kill', id: 'a' })
    expect(link.handleEvent({ type: 'spawn-error', id: 'a', message: 'late' })).toBe(true)

    const again = link.spawn(spawnOf('b'), recorder().handlers)
    vi.advanceTimersByTime(1000)
    await again
    posted.length = 0
    expect(link.handleEvent({ type: 'pipe-spawned', id: 'b', pid: 5 })).toBe(true)
    expect(posted).toEqual([{ type: 'kill', id: 'b' }])
  })

  it('reattaches with the kept lines and the journaled hooks, then streams to the new handlers', async () => {
    const { link, posted } = fake()
    const r = recorder()
    const attach = link.attach('g1', r.handlers)
    expect(posted).toEqual([{ type: 'pipe-attach', id: 'g1' }])
    const hooks = [{ event: 'Stop', agent: 'claude' as const, payload: null, at: 1 }]
    link.handleEvent({ type: 'pipe-attached', id: 'g1', pid: 7, agent: 'claude', seq: 2, lines: ['{"a":1}', '{"a":2}'], truncated: false, hooks })
    await expect(attach).resolves.toEqual({ pid: 7, seq: 2, lines: ['{"a":1}', '{"a":2}'], truncated: false, hooks })
    link.handleEvent({ type: 'pipe-line', id: 'g1', line: '{"a":3}', seq: 3 })
    expect(r.lines).toEqual([['{"a":3}', 3]])

    // Nobody waits for this one any more: it keeps running, unwatched.
    posted.length = 0
    link.handleEvent({ type: 'pipe-attached', id: 'g2', pid: 8, seq: 0, lines: [], truncated: false })
    expect(posted).toEqual([{ type: 'detach', id: 'g2' }])
  })

  it('lists the host’s pipe sessions from its `sessions` answer, leaving that answer to the terminals too', async () => {
    const { link, posted } = fake()
    const listed = link.list()
    expect(posted).toEqual([{ type: 'list' }])
    const event: HostEvent = { type: 'sessions', sessions: [{ id: 't1', pid: 1 }, { id: 'g1', pid: 2, agent: 'codex', pipe: true }] }
    expect(link.handleEvent(event)).toBe(false)
    await expect(listed).resolves.toEqual([{ id: 'g1', pid: 2, agent: 'codex' }])
  })

  it('answers everything when the host is lost: spawns fail, attaches miss, sessions end with -1', async () => {
    const { link, posted } = fake()
    const r = recorder()
    void link.spawn(spawnOf('a'), r.handlers)
    link.handleEvent({ type: 'pipe-spawned', id: 'a', pid: 1 })
    const pendingSpawn = link.spawn(spawnOf('b'), recorder().handlers)
    const pendingAttach = link.attach('c', recorder().handlers)
    const pendingList = link.list()
    link.lost()
    await expect(pendingSpawn).resolves.toEqual({ ok: false, message: 'the agent host exited' })
    await expect(pendingAttach).resolves.toBeNull()
    await expect(pendingList).resolves.toEqual([])
    expect(r.exits).toEqual([{ exitCode: -1, stderr: 'the agent host exited' }])
    posted.length = 0
    await expect(link.spawn(spawnOf('d'), recorder().handlers)).resolves.toMatchObject({ ok: false })
    expect(link.write('a', 'x')).toBe(false)
    expect(posted).toEqual([])
  })
})

describe('HostPipeLink over a SessionHost (the daemon’s request handling, in process)', () => {
  let host: SessionHost | null = null
  afterEach(() => {
    host?.killAll()
    host = null
  })

  it('spawns, streams, and lets a later app run list and reattach the session with its kept lines', async () => {
    let route: (event: HostEvent) => void = () => undefined
    host = new SessionHost({ mirror: true, emit: (event) => route(event), log: () => undefined })
    const target = host
    // Requests arrive asynchronously over the socket.
    const first = new HostPipeLink((message) => queueMicrotask(() => target.handle(message)), true)
    route = (event) => void first.handleEvent(event)
    const r = recorder()
    const started = await first.spawn(spawnOf('g1'), r.handlers)
    expect(started.ok).toBe(true)
    expect(first.write('g1', 'hello')).toBe(true)
    await until(() => r.lines.some(([line]) => line === '{"echo":"hello"}'))

    // The app quits: the daemon detaches every session and it keeps running.
    target.detachAll()
    const second = new HostPipeLink((message) => queueMicrotask(() => target.handle(message)), true)
    route = (event) => void second.handleEvent(event)
    expect(await second.list()).toEqual([{ id: 'g1', pid: started.ok ? started.pid : 0, agent: 'claude' }])
    const again = recorder()
    const attached = await second.attach('g1', again.handlers)
    expect(attached?.lines).toContain('{"echo":"hello"}')
    expect(second.write('g1', 'back')).toBe(true)
    await until(() => again.lines.some(([line]) => line === '{"echo":"back"}'))
    expect(again.lines.find(([line]) => line === '{"echo":"back"}')?.[1]).toBe((attached?.seq ?? 0) + 1)
    expect(r.lines.some(([line]) => line.includes('back'))).toBe(false)
  }, 20_000)
})

describe('PipeLinkRouter', () => {
  const local = new LocalPipeLink()
  afterEach(() => local.killAll())

  it('sends new sessions to the host when it runs them, and is durable only with the daemon', async () => {
    const posted: HostRequest[] = []
    const hostLink = new HostPipeLink((message) => posted.push(message), true)
    const router = new PipeLinkRouter({ ready: () => Promise.resolve(), host: () => hostLink, local })
    expect(router.durable).toBe(true)
    const spawn = router.spawn(spawnOf('g1'), recorder().handlers)
    await until(() => posted.length > 0)
    hostLink.handleEvent({ type: 'pipe-spawned', id: 'g1', pid: 3 })
    await expect(spawn).resolves.toEqual({ ok: true, pid: 3 })
    expect(router.write('g1', 'x')).toBe(true)
    router.kill('g1')
    expect(posted.map((m) => m.type)).toEqual(['pipe-spawn', 'pipe-write', 'kill'])
  })

  it('runs them in main when the host does not (an older daemon), even if the host connection failed', async () => {
    const router = new PipeLinkRouter({ ready: () => Promise.reject(new Error('no daemon')), host: () => null, local })
    expect(router.durable).toBe(false)
    const r = recorder()
    const started = await router.spawn(spawnOf('g1'), r.handlers)
    expect(started.ok).toBe(true)
    expect(router.write('g1', 'here')).toBe(true)
    await until(() => r.lines.some(([line]) => line === '{"echo":"here"}'))
    expect((await router.list()).map((s) => s.id)).toEqual(['g1'])
    router.kill('g1')
    expect(local.has('g1')).toBe(false)
  }, 20_000)
})
