// Pipe sessions driven through SessionHost, as the pty daemon and the utilityProcess fallback drive them: real child
// processes (a login shell running `node -e`), never an agent CLI.
import { afterEach, describe, expect, it } from 'vitest'
import type { HostEvent, HostRequest } from './protocol'
import { SessionHost } from './session-host'

// Echoes each stdin line back as JSON; "bye" exits 3 after a word on stderr.
const ECHO = `process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',d=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);if(l==='bye'){process.stderr.write('done');process.exit(3)}process.stdout.write(JSON.stringify({echo:l})+'\\n')}})`

const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }
const spawnRequest = (id: string, script = ECHO): HostRequest => ({
  type: 'pipe-spawn',
  id,
  cwd: process.cwd(),
  agent: 'claude',
  command: process.execPath,
  args: ['-e', script],
  baseEnv
})

function harness() {
  const events: HostEvent[] = []
  let changes = 0
  const host = new SessionHost({ mirror: true, emit: (event) => events.push(event), onSessionsChanged: () => changes++, log: () => undefined })
  const until = async (check: () => boolean, ms = 15_000): Promise<void> => {
    const end = Date.now() + ms
    while (!check()) {
      if (Date.now() > end) throw new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  const of = <K extends HostEvent['type']>(type: K, id = 'g1') =>
    events.filter((e): e is Extract<HostEvent, { type: K }> => e.type === type && 'id' in e && e.id === id)
  const echoed = (word: string, id = 'g1') => of('pipe-line', id).some((e) => e.line === JSON.stringify({ echo: word }))
  return { host, events, until, of, echoed, changes: () => changes }
}

let current: SessionHost | null = null
afterEach(() => {
  current?.killAll()
  current = null
})

describe('SessionHost pipe sessions', () => {
  it('spawns, streams stdout lines to the client and lists the session as a pipe', async () => {
    const h = harness()
    current = h.host
    h.host.handle(spawnRequest('g1'))
    expect(h.of('pipe-spawned')).toHaveLength(1)
    expect(h.host.has('g1')).toBe(true)
    expect(h.host.isAttached('g1')).toBe(true)
    expect(h.host.liveCount).toBe(1)
    expect(h.host.list()).toEqual([{ id: 'g1', pid: h.of('pipe-spawned')[0]!.pid, agent: 'claude', pipe: true }])

    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'hello' })
    await h.until(() => h.echoed('hello'))
    // `list` answers with PTYs and pipes together.
    h.host.handle({ type: 'list' })
    const listed = h.events.find((e): e is Extract<HostEvent, { type: 'sessions' }> => e.type === 'sessions')
    expect(listed?.sessions.map((s) => [s.id, s.pipe])).toEqual([['g1', true]])
  }, 20_000)

  it('keeps lines while detached and hands them over on pipe-attach, then streams after seq', async () => {
    const h = harness()
    current = h.host
    h.host.handle(spawnRequest('g1'))
    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'one' })
    await h.until(() => h.echoed('one'))
    h.host.handle({ type: 'detach', id: 'g1' })
    expect(h.host.isAttached('g1')).toBe(false)
    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'two' })
    // Unseen: the line is kept, not sent.
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(h.echoed('two')).toBe(false)

    h.host.handle({ type: 'pipe-attach', id: 'g1' })
    const attached = h.of('pipe-attached')[0]!
    expect(attached.lines.filter((l) => l.startsWith('{'))).toEqual(['{"echo":"one"}', '{"echo":"two"}'])
    expect(attached).toMatchObject({ agent: 'claude', truncated: false })
    expect(attached.exit).toBeUndefined()
    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'three' })
    await h.until(() => h.echoed('three'))
    expect(h.of('pipe-line').find((e) => e.line.includes('three'))!.seq).toBe(attached.seq + 1)
  }, 20_000)

  it('stops streaming every pipe session when the client goes away (detachAll)', async () => {
    const h = harness()
    current = h.host
    h.host.handle(spawnRequest('g1'))
    h.host.detachAll()
    expect(h.host.isAttached('g1')).toBe(false)
    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'unseen' })
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(h.of('pipe-line')).toEqual([])
    expect(h.host.liveCount).toBe(1)
  }, 20_000)

  it('reports an exit while attached with its stderr and forgets the session', async () => {
    const h = harness()
    current = h.host
    h.host.handle(spawnRequest('g1'))
    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'bye' })
    await h.until(() => h.of('pipe-exit').length === 1)
    expect(h.of('pipe-exit')[0]).toMatchObject({ exitCode: 3, stderr: expect.stringContaining('done') })
    expect(h.host.has('g1')).toBe(false)
    expect(h.host.liveCount).toBe(0)
  }, 20_000)

  it('keeps a session that ended unseen for one attach, then answers attach-miss', async () => {
    const h = harness()
    current = h.host
    h.host.handle(spawnRequest('g1'))
    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'last' })
    await h.until(() => h.echoed('last'))
    h.host.handle({ type: 'detach', id: 'g1' })
    const before = h.changes()
    h.host.handle({ type: 'pipe-write', id: 'g1', line: 'bye' })
    await h.until(() => h.host.liveCount === 0)
    expect(h.changes()).toBeGreaterThan(before)
    expect(h.of('pipe-exit')).toEqual([])
    expect(h.host.list()).toEqual([expect.objectContaining({ id: 'g1', pipe: true, exit: { exitCode: 3 } })])

    h.host.handle({ type: 'pipe-attach', id: 'g1' })
    const attached = h.of('pipe-attached')[0]!
    expect(attached.exit).toMatchObject({ exitCode: 3, stderr: expect.stringContaining('done') })
    expect(attached.lines).toContain('{"echo":"last"}')
    expect(h.host.has('g1')).toBe(false)
    h.host.handle({ type: 'pipe-attach', id: 'g1' })
    expect(h.of('attach-miss')).toHaveLength(1)
  }, 20_000)

  it('kill ends the process without a pipe-exit; killAll ends every pipe session', async () => {
    const h = harness()
    current = h.host
    h.host.handle(spawnRequest('g1'))
    h.host.handle(spawnRequest('g2'))
    expect(h.host.liveCount).toBe(2)
    h.host.handle({ type: 'kill', id: 'g1' })
    expect(h.host.has('g1')).toBe(false)
    h.host.killAll()
    expect(h.host.list()).toEqual([])
    expect(h.host.liveCount).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(h.of('pipe-exit', 'g1')).toEqual([])
    expect(h.of('pipe-exit', 'g2')).toEqual([])
  }, 20_000)

  it('answers spawn-error for a malformed request or a live id, and attach-miss for an unknown one', () => {
    const h = harness()
    current = h.host
    h.host.handle({ type: 'pipe-spawn', id: 'bad', cwd: process.cwd(), command: process.execPath, args: 'nope' } as unknown as HostRequest)
    expect(h.of('spawn-error', 'bad')).toHaveLength(1)
    expect(h.host.has('bad')).toBe(false)
    h.host.handle(spawnRequest('g1'))
    h.host.handle(spawnRequest('g1'))
    expect(h.of('spawn-error')[0]?.message).toContain('already exists')
    expect(h.host.liveCount).toBe(1)
    h.host.handle({ type: 'pipe-attach', id: 'nobody' })
    expect(h.of('attach-miss', 'nobody')).toHaveLength(1)
    // A pipe-write to nobody is ignored.
    h.host.handle({ type: 'pipe-write', id: 'nobody', line: 'x' })
  })
})
