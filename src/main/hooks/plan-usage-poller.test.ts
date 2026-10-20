import { describe, expect, it } from 'vitest'
import type { VendorUsage } from '@shared/session-meta'
import { ACTIVE_MS, claudeInterval, codexInterval, PlanUsagePoller, UNSUPPORTED_RETRY_MS, type PollOutcome } from './plan-usage-poller'

const usage = (percent: number): VendorUsage => ({ vendor: 'codex', at: 0, complete: true, windows: [{ minutes: 300, percent }] })

/** A poller on a hand-driven clock: `advance` runs due timers in order and lets their fetches settle. */
function harness(answers: PollOutcome[]) {
  let now = 1_000_000
  let timers: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const applied: VendorUsage[] = []
  let fetches = 0
  const poller = new PlanUsagePoller({
    vendor: 'codex',
    fetch: async () => {
      fetches++
      return answers.shift() ?? { kind: 'ok', usage: usage(10) }
    },
    apply: (u) => applied.push(u),
    interval: codexInterval,
    minRefreshGapMs: 15_000,
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++
      timers.push({ at: now + ms, fn, id })
      return id
    },
    clearTimer: (id) => {
      timers = timers.filter((t) => t.id !== id)
    }
  })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  async function advance(ms: number) {
    const end = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const due = timers[0]
      if (!due || due.at > end) break
      timers.shift()
      now = due.at
      due.fn()
      await settle()
    }
    now = end
  }
  return { poller, applied, advance, settle, fetches: () => fetches, pending: () => timers.map((t) => t.at - now) }
}

describe('PlanUsagePoller', () => {
  it('does nothing until the vendor is used or was used before', async () => {
    const h = harness([])
    await h.advance(60 * 60_000)
    expect(h.fetches()).toBe(0)
    h.poller.start()
    await h.advance(0)
    expect(h.fetches()).toBe(1)
    // Idle: the next poll in 10 minutes.
    expect(h.pending()).toEqual([10 * 60_000])
  })

  it('polls at the active cadence while the vendor is in use, faster near the limit, slower once idle', async () => {
    const h = harness([{ kind: 'ok', usage: usage(10) }, { kind: 'ok', usage: usage(80) }, { kind: 'ok', usage: usage(95) }])
    h.poller.nudge()
    await h.advance(0)
    expect(h.pending()).toEqual([60_000])
    await h.advance(60_000)
    expect(h.pending()).toEqual([30_000])
    await h.advance(30_000)
    expect(h.pending()).toEqual([15_000])
    expect(h.applied.map((u) => u.windows[0]?.percent)).toEqual([10, 80, 95])
    // No use for 10 minutes: the first poll after that schedules the next at the idle pace.
    await h.advance(ACTIVE_MS)
    expect(h.pending()).toHaveLength(1)
    expect(h.pending()[0]).toBeGreaterThan(9 * 60_000)
    // In use again: the next poll comes at the active pace from the last one.
    h.poller.nudge()
    expect(h.pending()[0]).toBeLessThanOrEqual(60_000)
  })

  it('backs off after failures (honouring Retry-After) and gives up on an unsupported account until it is used again much later', async () => {
    const h = harness([
      { kind: 'error', detail: 'boom' },
      { kind: 'error', detail: '429', retryAfterMs: 20 * 60_000 },
      { kind: 'unsupported', detail: 'API key' }
    ])
    h.poller.nudge()
    await h.advance(0)
    expect(h.pending()).toEqual([60_000])
    await h.advance(60_000)
    expect(h.pending()).toEqual([20 * 60_000])
    await h.advance(20 * 60_000)
    expect(h.pending()).toEqual([])
    h.poller.nudge()
    h.poller.refresh()
    expect(h.pending()).toEqual([])
    await h.advance(UNSUPPORTED_RETRY_MS)
    h.poller.nudge()
    expect(h.pending()).toEqual([0])
  })

  it('refreshes on demand, but not right after a poll', async () => {
    const h = harness([])
    h.poller.start()
    await h.advance(0)
    h.poller.refresh()
    expect(h.pending()).toEqual([10 * 60_000])
    await h.advance(20_000)
    h.poller.refresh()
    expect(h.pending()).toEqual([0])
    await h.advance(0)
    expect(h.fetches()).toBe(2)
  })

  it('stops for good', async () => {
    const h = harness([])
    h.poller.start()
    h.poller.stop()
    h.poller.nudge()
    await h.advance(60 * 60_000)
    expect(h.fetches()).toBe(0)
  })

  it('paces Claude more gently than Codex', () => {
    expect([codexInterval(true, 10), codexInterval(true, 75), codexInterval(true, 90), codexInterval(false, 99)]).toEqual([60_000, 30_000, 15_000, 600_000])
    expect([claudeInterval(true, 10), claudeInterval(true, 90), claudeInterval(false, 90)]).toEqual([300_000, 120_000, 900_000])
  })
})
