import { describe, expect, it } from 'vitest'
import type { VendorUsage } from '@shared/session-meta'
import { parseStoredUsage, UNCHANGED_REFRESH_MS, UsageStore } from './usage-store'

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
