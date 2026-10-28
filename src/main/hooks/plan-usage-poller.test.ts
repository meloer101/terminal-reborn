import { describe, expect, it } from 'vitest'
import type { UsageAccount, VendorUsage } from '@shared/session-meta'
import { ACTIVE_MS, claudeInterval, codexInterval, PlanUsagePoller, UNSUPPORTED_RETRY_MS, type PollOutcome } from './plan-usage-poller'

const usage = (percent: number): VendorUsage => ({ vendor: 'codex', at: 0, complete: true, windows: [{ minutes: 300, percent }] })

/** A poller on a hand-driven clock: `advance` runs due timers in order and lets their fetches settle. */
function harness(answers: PollOutcome[]) {
  let now = 1_000_000
  let timers: { at: number; fn: () => void; id: number }[] = []
  let nextId = 1
  const applied: VendorUsage[] = []
  const shown: VendorUsage[] = []
  const accounts: UsageAccount[] = []
  let fetches = 0
  const poller = new PlanUsagePoller({
    vendor: 'codex',
    fetch: async () => {
      fetches++
      return answers.shift() ?? { kind: 'ok', usage: usage(10) }
    },
    apply: (u) => applied.push(u),
    show: (u) => shown.push(u),
    account: (a) => accounts.push(a),
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
  return { poller, applied, shown, accounts, advance, settle, fetches: () => fetches, pending: () => timers.map((t) => t.at - now) }
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
      { kind: 'unsupported', state: 'api-key', detail: 'API key' }
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

  it('says what each ask of the account said: the plan, no windows, why not, or a failure', async () => {
    const h = harness([
      { kind: 'ok', usage: usage(10), plan: 'plus' },
      { kind: 'ok', usage: null },
      { kind: 'error', detail: 'timeout' },
      { kind: 'unsupported', state: 'signed-out', detail: 'signed out' }
    ])
    h.poller.nudge()
    await h.advance(0)
    await h.advance(60_000)
    await h.advance(60_000)
    await h.advance(60_000)
    expect(h.accounts.map(({ state, plan }) => (plan ? `${state}:${plan}` : state))).toEqual(['ok:plus', 'no-plan', 'error', 'signed-out'])
  })

  it('on the 额度 page asks a vendor never used here once, without starting its cadence', async () => {
    const h = harness([{ kind: 'ok', usage: usage(30), plan: 'plus' }, { kind: 'error', detail: 'down' }])
    h.poller.refresh()
    await h.advance(0)
    expect(h.fetches()).toBe(0)
    h.poller.refresh(true)
    await h.settle()
    expect(h.fetches()).toBe(1)
    // Shown, not kept: kept usage would start the cadence on the next run.
    expect(h.shown).toHaveLength(1)
    expect(h.applied).toHaveLength(0)
    expect(h.pending()).toEqual([])
    // Again within the minimum gap: nothing; after it, one more ask — a failure does not start a backoff either.
    h.poller.refresh(true)
    await h.settle()
    expect(h.fetches()).toBe(1)
    await h.advance(15_000)
    h.poller.refresh(true)
    await h.settle()
    expect(h.fetches()).toBe(2)
    expect(h.pending()).toEqual([])
  })

  it('a failed one-off ask does not hold back the vendor’s first use', async () => {
    const h = harness([{ kind: 'error', detail: 'claude exited before answering' }, { kind: 'ok', usage: usage(20) }])
    h.poller.refresh(true)
    await h.settle()
    expect(h.accounts.map((a) => a.state)).toEqual(['error'])
    expect(h.pending()).toEqual([])
    h.poller.nudge()
    expect(h.pending()).toHaveLength(1)
    await h.advance(h.pending()[0] ?? 0)
    expect(h.applied.map((u) => u.windows[0]?.percent)).toEqual([20])
  })

  it('on the 额度 page asks again an account that said it has no plan figures, and resumes once it has', async () => {
    const h = harness([{ kind: 'unsupported', state: 'signed-out', detail: 'signed out' }, { kind: 'ok', usage: usage(20) }])
    h.poller.nudge()
    await h.advance(0)
    expect(h.pending()).toEqual([])
    h.poller.refresh()
    await h.settle()
    expect(h.fetches()).toBe(1)
    await h.advance(60_000)
    h.poller.refresh(true)
    await h.settle()
    expect(h.fetches()).toBe(2)
    expect(h.accounts.map((a) => a.state)).toEqual(['signed-out', 'ok'])
    expect(h.pending()).toHaveLength(1)
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
