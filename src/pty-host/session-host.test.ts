// Real PTYs (node-pty) driven through SessionHost: what the daemon relies on for reattaching.
import { afterEach, describe, expect, it } from 'vitest'
import type { HostEvent } from './protocol'
import { HIDDEN_HIGH_WATERMARK } from './flow-control'
import { SessionHost } from './session-host'

function harness(mirror = true, onDetachedOutput?: (id: string) => void) {
  const events: HostEvent[] = []
  const waiters: Array<() => void> = []
  const host = new SessionHost({
    mirror,
    emit: (event) => {
      events.push(event)
      for (const wake of waiters.splice(0)) wake()
    },
    ...(onDetachedOutput ? { onDetachedOutput } : {}),
    log: () => undefined
  })
  const waitFor = async <T extends HostEvent>(match: (event: HostEvent) => event is T, timeoutMs = 5000): Promise<T> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const found = events.find(match)
      if (found) return found
      if (Date.now() > deadline) throw new Error(`timed out; saw ${events.map((e) => e.type).join(',')}`)
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
        setTimeout(resolve, 50)
      })
    }
  }
  return { host, events, waitFor }
}

const is =
  <K extends HostEvent['type']>(type: K, id = 's1') =>
  (event: HostEvent): event is Extract<HostEvent, { type: K }> =>
    event.type === type && (!('id' in event) || event.id === id)

const output = (events: HostEvent[]) =>
  events
    .filter((e): e is Extract<HostEvent, { type: 'data' }> => e.type === 'data')
    .map((e) => e.data)
    .join('')

let cleanup: SessionHost | null = null
afterEach(() => {
  cleanup?.killAll()
  cleanup = null
})

describe('SessionHost', () => {
  it('keeps a detached session running and hands its screen to the next attach', async () => {
    const { host, events, waitFor } = harness()
    cleanup = host
    host.handle({ type: 'spawn', id: 's1', cwd: '/', command: '/bin/sh', args: ['-c', 'printf "before\\n"; read x; printf "after-$x\\n"; sleep 30'], cols: 40, rows: 6 })
    await waitFor(is('spawned'))
    await expect.poll(() => output(events), { timeout: 5000 }).toContain('before')

    host.handle({ type: 'detach', id: 's1' })
    events.length = 0
    host.handle({ type: 'write', id: 's1', data: 'X\r' })
    // Output while detached reaches nobody...
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(output(events)).toBe('')
    expect(host.list()).toEqual([expect.objectContaining({ id: 's1' })])

    // ...but it is on the screen the next client gets.
    host.handle({ type: 'attach', id: 's1' })
    const attached = await waitFor(is('attached'))
    expect(attached.screen.data).toContain('before')
    expect(attached.screen.data).toContain('after-X')
    expect(attached.seq).toBeGreaterThan(0)
    expect(attached.screen).toMatchObject({ cols: 40, rows: 6 })
  })

  it('numbers the stream so a client can drop what the screen already covers', async () => {
    const { host, events, waitFor } = harness()
    cleanup = host
    host.handle({ type: 'spawn', id: 's1', cwd: '/', command: '/bin/sh', args: ['-c', 'read x; printf "%s\\n" "$x"; sleep 30'], cols: 40, rows: 6 })
    await waitFor(is('spawned'))
    host.handle({ type: 'attach', id: 's1' })
    const attached = await waitFor(is('attached'))
    host.handle({ type: 'write', id: 's1', data: 'live\r' })
    await expect.poll(() => output(events.slice(events.indexOf(attached))), { timeout: 5000 }).toContain('live')
    const later = events.slice(events.indexOf(attached)).filter((e): e is Extract<HostEvent, { type: 'data' }> => e.type === 'data')
    expect(later.every((e) => e.seq > attached.seq)).toBe(true)
  })

  it('keeps the last screen of a process that ended while detached, for one attach', async () => {
    const { host, waitFor } = harness()
    cleanup = host
    host.handle({ type: 'spawn', id: 's1', cwd: '/', command: '/bin/sh', args: ['-c', 'read x; printf "bye\\n"; exit 3'], cols: 40, rows: 6 })
    await waitFor(is('spawned'))
    host.handle({ type: 'detach', id: 's1' })
    host.handle({ type: 'write', id: 's1', data: 'go\r' })
    await expect.poll(() => host.liveCount, { timeout: 5000 }).toBe(0)
    expect(host.list()).toEqual([expect.objectContaining({ id: 's1', exit: { exitCode: 3 } })])

    host.handle({ type: 'attach', id: 's1' })
    const attached = await waitFor(is('attached'))
    expect(attached.exit).toEqual({ exitCode: 3 })
    expect(attached.screen.data).toContain('bye')
    expect(host.list()).toEqual([])
  })

  it('reports output nobody sees, and serves the screen for the disk snapshot', async () => {
    const unseen: string[] = []
    const { host, events, waitFor } = harness(true, (id) => unseen.push(id))
    cleanup = host
    host.handle({ type: 'spawn', id: 's1', cwd: '/', command: '/bin/sh', args: ['-c', 'printf "seen\\n"; read x; printf "unseen-$x\\n"; sleep 30'], cols: 40, rows: 6 })
    await waitFor(is('spawned'))
    await expect.poll(() => output(events), { timeout: 5000 }).toContain('seen')
    expect(unseen).toEqual([])

    host.handle({ type: 'detach', id: 's1' })
    host.handle({ type: 'write', id: 's1', data: 'Y\r' })
    await expect.poll(() => unseen.length, { timeout: 5000 }).toBeGreaterThan(0)
    expect(new Set(unseen)).toEqual(new Set(['s1']))
    await expect.poll(async () => (await host.screen('s1'))?.data, { timeout: 5000 }).toContain('unseen-Y')
    expect(await host.screen('nope')).toBeNull()
  })

  it('holds a hidden session to the hidden watermark and lets it run on once it is shown', async () => {
    const { host, events, waitFor } = harness(false)
    cleanup = host
    // 400 000 characters once a line arrives; nobody acks, so only flow control decides how much comes out.
    host.handle({ type: 'spawn', id: 's1', cwd: '/', command: '/bin/sh', args: ['-c', 'read x; head -c 400000 /dev/zero | tr "\\0" a; printf "@@end@@"; sleep 30'], cols: 80, rows: 24 })
    await waitFor(is('spawned'))
    host.handle({ type: 'visible', id: 's1', visible: false })
    host.handle({ type: 'write', id: 's1', data: 'go\r' })
    await expect.poll(() => output(events).length, { timeout: 5000 }).toBeGreaterThan(HIDDEN_HIGH_WATERMARK)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(output(events)).not.toContain('@@end@@')
    host.handle({ type: 'visible', id: 's1', visible: true })
    await expect.poll(() => output(events), { timeout: 5000 }).toContain('@@end@@')
  })

  it('answers attach-miss without a mirror (the fallback host) or for an unknown id', async () => {
    const { host, waitFor } = harness(false)
    host.handle({ type: 'attach', id: 'nope' })
    await waitFor(is('attach-miss', 'nope'))
  })
})
