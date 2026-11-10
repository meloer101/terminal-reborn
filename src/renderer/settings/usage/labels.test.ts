import { describe, expect, it } from 'vitest'
import { usageView, type UsageDataset } from '@shared/usage-stats'
import { axisLabel, barLabel, kpis, niceMax, shareText } from './labels'

const NOW = new Date(2026, 10, 9, 15).getTime()
const day = (m: number, d: number): number => new Date(2026, m - 1, d, 10).getTime()
const data = (firstAt: UsageDataset['firstAt']): UsageDataset => ({
  buckets: [
    { hour: day(11, 9), agent: 'claude', model: 'claude-opus-5-5', project: 'w', input: 0, output: 0, cacheRead: 482_000_000, cacheWrite: 0, cost: 1284, unpriced: 0 },
    { hour: day(10, 1), agent: 'claude', model: 'claude-opus-5-5', project: 'w', input: 0, output: 0, cacheRead: 100, cacheWrite: 0, cost: 1, unpriced: 0 }
  ],
  sessions: [],
  firstAt,
  skipped: 0,
  scannedAt: NOW
})

describe('usage labels', () => {
  it('writes the KPI lines of a month', () => {
    const [tokens, cost, sessions, streak] = kpis(usageView(data({ claude: day(5, 7) }), 'month', NOW))
    expect(tokens).toMatchObject({ num: '4.82', unit: '亿' })
    expect(cost!.num).toBe('$1,284')
    expect(sessions!.sub).toBe('')
    expect(streak).toMatchObject({ label: '连续使用', num: '1', sub: '30 天里用了 1 天' })
  })

  it('says where the record starts instead of a comparison it cannot make', () => {
    const [tokens] = kpis(usageView(data({ claude: day(10, 20) }), 'month', NOW))
    expect(tokens!.sub).toBe('10 月 20 日起')
    const year = kpis(usageView(data({ claude: day(5, 7) }), 'year', NOW))
    expect(year[3]!.label).toBe('最长连续')
    expect(year[1]!.sub).toMatch(/^月均 \$/)
  })

  it('labels bars, axis and shares', () => {
    const week = usageView(data({ claude: day(5, 7) }), 'week', NOW)
    expect(barLabel(week, 0)).toBe('11/3 二')
    expect(barLabel(week, 6)).toBe('今天')
    const month = usageView(data({ claude: day(5, 7) }), 'month', NOW)
    expect([0, 1, 7, 29].map((i) => barLabel(month, i))).toEqual(['10/11', '', '10/18', '今天'])
    expect(niceMax(36_500_000)).toBe(40_000_000)
    expect(niceMax(4.51e8)).toBe(5e8)
    expect(axisLabel(4e7)).toBe('40M')
    expect(axisLabel(2.5e8)).toBe('2.5 亿')
    expect(axisLabel(5e7, 1e8)).toBe('0.5 亿')
    expect(axisLabel(1.25e6, 2.5e6)).toBe('1.25M')
    expect(barLabel(month, 28)).toBe('')
    expect(shareText(0.004)).toBe('<1%')
  })
})
