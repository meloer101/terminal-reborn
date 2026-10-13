import { describe, expect, it } from 'vitest'
import {
  SendAbortedError,
  SendTimeoutError,
  createSendQueue,
  realClock,
  runSendPlan,
  sendQueued,
  type SendClock
} from './send-executor'
import { planSend, type SendIo, type SendStep } from './send-protocol'

/** Virtual time: sleep() advances the clock instantly and gives tests a hook per tick. */
class FakeClock implements SendClock {
  t = 0
  onSleep: ((nowMs: number) => void) | undefined
  now(): number {
    return this.t
  }
  async sleep(ms: number): Promise<void> {
    this.t += ms
    this.onSleep?.(this.t)
    await Promise.resolve()
  }
}

class FakeIo implements SendIo {
  writes: { at: number; data: string }[] = []
  screen = ''
  constructor(
    private readonly clock: FakeClock,
    private readonly onWrite?: (data: string, io: FakeIo) => void
  ) {}
  write(data: string): void {
    this.writes.push({ at: this.clock.t, data })
    this.onWrite?.(data, this)
  }
  readScreen(): string {
    return this.screen
  }
}

const w = (data: string): SendStep => ({ type: 'write', data })

describe('runSendPlan', () => {
  it('writes in order and honours delays', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    await runSendPlan([w('a'), { type: 'delay', ms: 100 }, w('b'), { type: 'delay', ms: 50 }, w('c')], io, clock)
    expect(io.writes).toEqual([
      { at: 0, data: 'a' },
      { at: 100, data: 'b' },
      { at: 150, data: 'c' }
    ])
  })

  it('does nothing for an empty plan', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    await runSendPlan([], io, clock)
    expect(io.writes).toEqual([])
    expect(clock.t).toBe(0)
  })

  it('does not read the screen when there is nothing to wait for', async () => {
    const clock = new FakeClock()
    let reads = 0
    const io: SendIo = { write: () => undefined, readScreen: () => (reads++, '') }
    await runSendPlan([w('x')], io, clock)
    expect(reads).toBe(0)
  })

  it('succeeds as soon as the echo appears and sends Enter afterwards, not before', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock, (data, self) => {
      // the TUI renders the pasted text 120 ms after it was written
      if (data.includes('\x1b[200~')) clock.onSleep = (now) => now >= 120 && (self.screen = '❯ reply with just OK')
    })
    await runSendPlan(planSend('reply with just OK', 'claude'), io, clock)
    const [paste, enter] = io.writes
    expect(paste?.data).toBe('\x1b[200~reply with just OK\x1b[201~')
    expect(enter?.data).toBe('\r')
    expect(enter!.at).toBeGreaterThanOrEqual(120 + 60) // echo + claude pre-Enter delay
    expect(io.writes).toHaveLength(2)
  })

  it('Codex waits at least 150 ms between echo and Enter', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock, (data, self) => {
      if (data.includes('\x1b[200~')) self.screen = '› hello'
    })
    await runSendPlan(planSend('hello', 'codex'), io, clock)
    expect(io.writes[1]!.at - io.writes[0]!.at).toBeGreaterThanOrEqual(150)
  })

  it('accepts any of several needles (placeholder instead of echo)', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock, (data, self) => {
      if (data.includes('\x1b[200~')) self.screen = '❯ [Pasted text #1 +4 lines]'
    })
    await runSendPlan(planSend('a\nb\nc\nd\ne', 'claude'), io, clock)
    expect(io.writes.at(-1)?.data).toBe('\r')
  })

  it('times out with a typed error, and does not press Enter', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    io.screen = 'Do you trust the contents of this directory?\nline two'
    const err = await runSendPlan(planSend('hello', 'codex'), io, clock).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SendTimeoutError)
    const te = err as SendTimeoutError
    expect(te.name).toBe('SendTimeoutError')
    expect(te.stepIndex).toBe(1)
    expect(te.needles).toEqual(['hello', '[Pasted Content'])
    expect(te.timeoutMs).toBe(2001)
    expect(te.screenTail).toContain('Do you trust')
    expect(te.message).toContain('Timed out after 2001 ms')
    expect(io.writes.map((x) => x.data)).toEqual(['\x1b[200~hello\x1b[201~']) // paste only, no \r
    expect(clock.t).toBeGreaterThanOrEqual(2001)
  })

  it('the timeout scales with UTF-8 bytes: a late echo within the CJK budget still succeeds', async () => {
    const text = '汉'.repeat(700) // 700 chars = 2100 bytes
    const steps = planSend(text, 'claude')
    const budget = (steps[1] as { timeoutMs: number }).timeoutMs
    const clock = new FakeClock()
    const io = new FakeIo(clock, (data, self) => {
      if (data.includes('\x1b[200~')) clock.onSleep = (now) => now >= budget - 50 && (self.screen = '❯ ' + text)
    })
    await runSendPlan(steps, io, clock)
    expect(io.writes.at(-1)?.data).toBe('\r')
  })

  it('ignores identical text that was already on screen when the plan started', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    io.screen = '❯ hello\n⏺ OK\n❯ '
    // Without a baseline this would pass immediately and press Enter before the paste is rendered.
    const err = await runSendPlan(planSend('hello', 'claude'), io, clock).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SendTimeoutError)
    expect(io.writes.some((x) => x.data === '\r')).toBe(false)
  })

  it('does count a NEW copy of the text next to the old one', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock, (data, self) => {
      if (data.includes('\x1b[200~')) self.screen += '\n❯ hello'
    })
    io.screen = '❯ hello\n⏺ OK'
    await runSendPlan(planSend('hello', 'claude'), io, clock)
    expect(io.writes.at(-1)?.data).toBe('\r')
  })

  it('treats an empty needle list as nothing to wait for', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    await runSendPlan([{ type: 'waitForText', needles: [], timeoutMs: 10 }, w('x')], io, clock)
    expect(io.writes).toHaveLength(1)
  })

  it('polls at the configured interval', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    const seenAt: number[] = []
    const origRead = io.readScreen.bind(io)
    io.readScreen = () => (seenAt.push(clock.t), origRead())
    await runSendPlan([{ type: 'waitForText', needles: ['zzz'], timeoutMs: 100 }], io, clock, { pollMs: 40 }).catch(
      () => undefined
    )
    // baseline read at 0, then polls at 0, 40, 80, 120
    expect(seenAt).toEqual([0, 0, 40, 80, 120])
  })

  it('aborts between steps with SendAbortedError', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    const ac = new AbortController()
    clock.onSleep = () => ac.abort()
    const err = await runSendPlan([w('a'), { type: 'delay', ms: 10 }, w('b')], io, clock, { signal: ac.signal }).catch(
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(SendAbortedError)
    expect((err as SendAbortedError).stepIndex).toBe(2)
    expect(io.writes.map((x) => x.data)).toEqual(['a'])
  })

  it('aborts while waiting for text', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    const ac = new AbortController()
    clock.onSleep = (now) => now >= 100 && ac.abort()
    const err = await runSendPlan([{ type: 'waitForText', needles: ['never'], timeoutMs: 10_000 }], io, clock, {
      signal: ac.signal
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SendAbortedError)
  })

  it('refuses to start when already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    await expect(runSendPlan([w('a')], io, clock, { signal: ac.signal })).rejects.toBeInstanceOf(SendAbortedError)
    expect(io.writes).toEqual([])
  })

  it('end to end through a typed slash plan (claude)', async () => {
    const clock = new FakeClock()
    let typed = ''
    const io = new FakeIo(clock, (data, self) => {
      if (data !== '\r') typed += data.split('\x1b\r').join('\n')
      self.screen = '❯ ' + typed.replace(/\n/g, '\n  ')
    })
    const text = '/plan ' + 'x'.repeat(900) + '\nlast line here'
    await runSendPlan(planSend(text, 'claude'), io, clock)
    expect(typed).toBe(text)
    expect(io.writes.at(-1)?.data).toBe('\r')
  })
})

describe('realClock', () => {
  it('sleeps for real and reports time', async () => {
    const t0 = realClock.now()
    await realClock.sleep(5)
    expect(realClock.now() - t0).toBeGreaterThanOrEqual(4)
  })
})

describe('createSendQueue', () => {
  const deferred = <T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } => {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
    return { promise, resolve, reject }
  }

  it('runs tasks for one key strictly in order, never overlapping', async () => {
    const q = createSendQueue()
    const log: string[] = []
    const gates = [deferred(), deferred(), deferred()]
    const run = (i: number) =>
      q.enqueue('s1', async () => {
        log.push(`start ${i}`)
        await gates[i]!.promise
        log.push(`end ${i}`)
        return i
      })
    const results = [run(0), run(1), run(2)]
    await Promise.resolve()
    expect(log).toEqual(['start 0'])
    expect(q.pending('s1')).toBe(3)
    gates[1]!.resolve() // finishing out of order must not start task 2 early
    await Promise.resolve()
    expect(log).toEqual(['start 0'])
    gates[0]!.resolve()
    await results[1]
    await new Promise((r) => setTimeout(r, 0))
    expect(log).toEqual(['start 0', 'end 0', 'start 1', 'end 1', 'start 2'])
    gates[2]!.resolve()
    expect(await Promise.all(results)).toEqual([0, 1, 2])
    expect(log.at(-1)).toBe('end 2')
  })

  it('different keys run concurrently', async () => {
    const q = createSendQueue()
    const log: string[] = []
    const gate = deferred()
    const a = q.enqueue('a', async () => {
      log.push('a start')
      await gate.promise
      log.push('a end')
    })
    const b = q.enqueue('b', async () => {
      log.push('b start')
    })
    await b
    expect(log).toEqual(['a start', 'b start'])
    gate.resolve()
    await a
  })

  it('a failing task rejects its own promise but does not block the next one', async () => {
    const q = createSendQueue()
    const first = q.enqueue('s', () => Promise.reject(new Error('boom')))
    const second = q.enqueue('s', async () => 'ok')
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
  })

  it('cleans up after itself', async () => {
    const q = createSendQueue()
    await q.enqueue('s', async () => 1)
    await Promise.resolve()
    await Promise.resolve()
    expect(q.pending('s')).toBe(0)
    expect(q.pending('never-used')).toBe(0)
  })

  it('two sends to the same session never interleave their writes', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock, (data, self) => {
      if (data.includes('\x1b[200~')) self.screen += `\n${data.split('\x1b[200~').join('').split('\x1b[201~').join('')}`
    })
    const q = createSendQueue()
    const p1 = sendQueued(q, 's', planSend('first message', 'claude'), io, clock)
    const p2 = sendQueued(q, 's', planSend('second message', 'claude'), io, clock)
    await Promise.all([p1, p2])
    expect(io.writes.map((x) => x.data)).toEqual([
      '\x1b[200~first message\x1b[201~',
      '\r',
      '\x1b[200~second message\x1b[201~',
      '\r'
    ])
  })

  it('a timed-out send does not stop the queue', async () => {
    const clock = new FakeClock()
    const io = new FakeIo(clock)
    const q = createSendQueue()
    const bad = sendQueued(q, 's', planSend('lost', 'codex'), io, clock)
    const good = sendQueued(q, 's', [w('still runs')], io, clock)
    await expect(bad).rejects.toBeInstanceOf(SendTimeoutError)
    await good
    expect(io.writes.at(-1)?.data).toBe('still runs')
  })
})
