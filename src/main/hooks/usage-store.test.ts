import { describe, expect, it } from 'vitest'
import type { UsageAlert, VendorUsage } from '@shared/session-meta'
import { crossedAlert, mergeUsage, parseStoredMarks, parseStoredUsage, RATE_MIN_SPAN_MS, recentRate, UNCHANGED_REFRESH_MS, UsageStore, type AlertMark } from './usage-store'

const claude = (percent: number, at: number): VendorUsage => ({ vendor: 'claude', at, windows: [{ minutes: 300, percent, resetsAt: 1_800_000_000_000 }] })

function store(initial: unknown = null) {
  const broadcasts: VendorUsage[] = []
  const saves: VendorUsage[][] = []
  const usage = new UsageStore({ load: () => initial, save: (list) => saves.push(list), broadcast: (u) => broadcasts.push(u) })
  return { usage, broadcasts, saves }
}

describe('UsageStore', () => {
  it('passes on changes, holds back the same figures for a while, and ignores older readings', () => {
    const { usage, broadcasts, saves } = store()
    usage.update(claude(13, 1000))
    usage.update(claude(13, 2000))
    usage.update(claude(14, 3000))
    usage.update(claude(10, 2500))
    usage.update(claude(14, 3000 + UNCHANGED_REFRESH_MS))
    expect(broadcasts.map((u) => [u.windows[0]?.percent, u.at])).toEqual([
      [13, 1000],
      [14, 3000],
      [14, 3000 + UNCHANGED_REFRESH_MS]
    ])
    expect(saves).toHaveLength(3)
    expect(usage.list()).toEqual([claude(14, 3000 + UNCHANGED_REFRESH_MS)])
  })

  it('keeps vendors apart and starts from the stored file', () => {
    const codex: VendorUsage = { vendor: 'codex', at: 5, windows: [{ minutes: 10080, percent: 12 }] }
    const { usage } = store([claude(20, 1), codex])
    expect(usage.list().map((u) => u.vendor)).toEqual(['claude', 'codex'])
  })
})

describe('parseStoredUsage', () => {
  it('drops what does not look like a reading', () => {
    expect(parseStoredUsage('nope')).toEqual([])
    expect(
      parseStoredUsage([
        { vendor: 'gemini', at: 1, windows: [{ minutes: 300, percent: 1 }] },
        { vendor: 'claude', at: 1, windows: [{ minutes: 300, percent: 140 }, { minutes: 300, percent: 9, resetsAt: 'x' }] },
        { vendor: 'claude', at: 2, windows: [{ minutes: 300, percent: 5 }] }
      ])
    ).toEqual([{ vendor: 'claude', at: 1, windows: [{ minutes: 300, percent: 9 }] }])
  })
})

describe('UsageStore · alerts (Figma 18D)', () => {
  const NOW = 1_799_990_000_000
  const reading = (percent: number, resetsAt = 1_800_000_000_000, at = NOW) =>
    ({ vendor: 'claude', at, windows: [{ minutes: 300, percent, resetsAt }] }) satisfies VendorUsage

  function alerting(marks: unknown = null) {
    const alerts: UsageAlert[] = []
    const saved: AlertMark[][] = []
    const usage = new UsageStore({
      load: () => null,
      save: () => undefined,
      broadcast: () => undefined,
      loadMarks: () => marks,
      saveMarks: (list) => saved.push(list),
      alert: (a) => alerts.push(a),
      now: () => NOW
    })
    return { usage, alerts, saved }
  }

  it('announces 75, 90 and 100 once each per period, and again after the window resets', () => {
    const { usage, alerts, saved } = alerting()
    for (const p of [60, 76, 80, 91, 95, 100, 100]) usage.update(reading(p, undefined, NOW + p))
    expect(alerts.map((a) => a.level)).toEqual([75, 90, 100])
    usage.update(reading(77, 1_800_018_000_000, NOW + 200))
    expect(alerts.map((a) => a.level)).toEqual([75, 90, 100, 75])
    expect(saved.at(-1)).toEqual([{ vendor: 'claude', minutes: 300, level: 75, resetsAt: 1_800_018_000_000 }])
  })

  it('jumps straight to the highest level crossed, treats a few seconds of reset jitter as the same period', () => {
    const { usage, alerts } = alerting()
    usage.update(reading(92))
    usage.update(reading(93, 1_800_000_004_000, NOW + 1))
    expect(alerts).toEqual([{ vendor: 'claude', minutes: 300, percent: 92, level: 90, resetsAt: 1_800_000_000_000 }])
  })

  it('remembers what it announced across restarts and never alerts on an old reading', () => {
    const { usage, alerts } = alerting([{ vendor: 'claude', minutes: 300, level: 90, resetsAt: 1_800_000_000_000 }, { vendor: 'x', minutes: 1, level: 75 }])
    usage.update(reading(95))
    usage.update(reading(100, undefined, NOW - 11 * 60_000))
    expect(alerts).toEqual([])
    expect(parseStoredMarks('nope')).toEqual([])
  })

  it('names the crossing for a window', () => {
    expect(crossedAlert('codex', { minutes: 10080, percent: 74 }, undefined)).toBeNull()
    expect(crossedAlert('codex', { minutes: 10080, percent: 75 }, undefined)).toEqual({ vendor: 'codex', minutes: 10080, percent: 75, level: 75 })
  })
})

describe('mergeUsage · readings from sessions and from the account', () => {
  const RESET = 1_800_000_000_000
  const five = (percent: number, resetsAt = RESET) => ({ minutes: 300, percent, resetsAt })
  const sonnet = (percent: number) => ({ minutes: 10080, scope: 'Sonnet', percent, resetsAt: RESET + 86_400_000 })

  it('keeps the higher figure within a period: a session that has not heard of the latest use reports less', () => {
    const polled: VendorUsage = { vendor: 'claude', at: 2000, complete: true, windows: [five(20)] }
    const stale: VendorUsage = { vendor: 'claude', at: 3000, windows: [five(3)] }
    expect(mergeUsage(polled, stale)).toEqual({ vendor: 'claude', at: 3000, windows: [five(20)] })
    expect(mergeUsage(polled, { ...stale, windows: [five(25)] }).windows).toEqual([five(25)])
  })

  it('takes a later reset as a new period, and ignores a reading of an older one', () => {
    const held: VendorUsage = { vendor: 'codex', at: 1, windows: [five(90)] }
    expect(mergeUsage(held, { vendor: 'codex', at: 2, windows: [five(4, RESET + 5 * 3_600_000)] }).windows).toEqual([five(4, RESET + 5 * 3_600_000)])
    expect(mergeUsage(held, { vendor: 'codex', at: 2, windows: [five(1, RESET - 5 * 3_600_000)] }).windows).toEqual([five(90)])
  })

  it('keeps windows a session does not name, drops those a complete answer leaves out', () => {
    const polled: VendorUsage = { vendor: 'claude', at: 1, complete: true, windows: [five(20), sonnet(40)] }
    expect(mergeUsage(polled, { vendor: 'claude', at: 2, windows: [five(21)] }).windows).toEqual([five(21), sonnet(40)])
    expect(mergeUsage(polled, { vendor: 'claude', at: 2, complete: true, windows: [five(21)] }).windows).toEqual([five(21)])
  })
})

describe('UsageStore · recent pace', () => {
  const RESET = 1_800_000_000_000
  const MIN = 60_000
  const at = (minute: number, percent: number): VendorUsage => ({ vendor: 'claude', at: RESET - 4 * 3_600_000 + minute * MIN, windows: [{ minutes: 300, percent, resetsAt: RESET }] })

  it('measures the slope over the last hour once the readings span 15 minutes', () => {
    const { usage, broadcasts } = store()
    usage.update(at(0, 10))
    usage.update(at(10, 12))
    expect(broadcasts.at(-1)?.windows[0]?.rate).toBeUndefined()
    usage.update(at(20, 20))
    // 10 → 20 % in 20 minutes.
    expect(broadcasts.at(-1)?.windows[0]?.rate).toBe(30)
    // An hour later with no use in between: the slope since the last reading before the hour is 0.
    usage.update(at(90, 20))
    expect(broadcasts.at(-1)?.windows[0]?.rate).toBe(0)
  })

  it('weighs only readings that named the window, and starts over in a new period', () => {
    expect(recentRate([{ at: 0, percent: 5 }, { at: RATE_MIN_SPAN_MS - 1, percent: 9 }])).toBeUndefined()
    expect(recentRate([{ at: 0, percent: 5 }, { at: 30 * MIN, percent: 10 }])).toBe(10)
    const { usage, broadcasts } = store()
    usage.update(at(0, 50))
    usage.update(at(30, 80))
    usage.update({ vendor: 'claude', at: RESET + MIN, windows: [{ minutes: 300, percent: 2, resetsAt: RESET + 300 * MIN }] })
    expect(broadcasts.at(-1)?.windows[0]).toEqual({ minutes: 300, percent: 2, resetsAt: RESET + 300 * MIN })
  })
})
