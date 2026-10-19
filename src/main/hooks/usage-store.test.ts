import { describe, expect, it } from 'vitest'
import type { UsageAlert, VendorUsage } from '@shared/session-meta'
import { crossedAlert, parseStoredMarks, parseStoredUsage, UNCHANGED_REFRESH_MS, UsageStore, type AlertMark } from './usage-store'

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
