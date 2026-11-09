import { describe, expect, it } from 'vitest'
import {
  changeText,
  foldRows,
  formatTokens,
  heatmap,
  projectOf,
  startOfDay,
  tokenParts,
  usageView,
  type StatsAgent,
  type UsageBucket,
  type UsageDataset
} from './usage-stats'

// Monday 2026-11-09 15:00 local.
const NOW = new Date(2026, 10, 9, 15, 0).getTime()
const at = (m: number, d: number, h = 10): number => new Date(2026, m - 1, d, h).getTime()

const bucket = (agent: StatsAgent, hour: number, tokens: number, extra: Partial<UsageBucket> = {}): UsageBucket => ({
  hour,
  agent,
  model: agent === 'claude' ? 'claude-opus-5-5' : 'gpt-6-sol',
  project: 'wavi',
  input: 0,
  output: 0,
  cacheRead: tokens,
  cacheWrite: 0,
  cost: tokens / 1e6,
  unpriced: 0,
  ...extra
})

const dataset = (buckets: UsageBucket[], firstAt: UsageDataset['firstAt'], sessions: UsageDataset['sessions'] = []): UsageDataset => ({
  buckets,
  sessions,
  firstAt,
  skipped: 0,
  scannedAt: NOW
})

describe('usageView', () => {
  it('week: 7 daily bars ending today, compared with the 7 days before when they are on record', () => {
    const data = dataset([bucket('claude', at(11, 9), 100), bucket('codex', at(11, 3), 50), bucket('claude', at(10, 30), 75)], { claude: at(9, 13), codex: at(5, 7) })
    const v = usageView(data, 'week', NOW)
    expect(v.bars).toHaveLength(7)
    expect(v.bars[0]!.start).toBe(startOfDay(at(11, 3)))
    expect(v.tokens).toBe(150)
    expect(v.bars[6]!.perAgent).toEqual({ claude: 100 })
    expect(v.previousTokens).toBe(75)
    expect(changeText(v.tokens, v.previousTokens)).toBe('+100%')
  })

  it('does not compare with a stretch that is only partly on record', () => {
    const data = dataset([bucket('claude', at(11, 9), 100)], { claude: at(11, 5) })
    expect(usageView(data, 'week', NOW).previousTokens).toBeNull()
  })

  it('year: 12 monthly bars; months before any log are frames, later ones only hold agents already logging', () => {
    const data = dataset(
      [bucket('codex', at(6, 1), 10), bucket('codex', at(9, 20), 20), bucket('claude', at(9, 20), 30)],
      { codex: at(5, 7), claude: at(9, 13) }
    )
    const v = usageView(data, 'year', NOW)
    expect(v.unit).toBe('month')
    expect(v.bars).toHaveLength(12)
    expect(v.bars.slice(0, 5).every((b) => b.noRecord)).toBe(true)
    expect(v.bars[5]!.noRecord).toBe(false)
    expect(v.bars[9]!.perAgent).toEqual({ codex: 20, claude: 30 })
    expect(v.previousTokens).toBeNull()
    expect(v.startsInPeriod.map((s) => s.agent)).toEqual(['codex', 'claude'])
  })

  it('counts active days only over the days on record, and the current streak up to today', () => {
    const data = dataset([bucket('claude', at(11, 9), 1), bucket('claude', at(11, 8), 1), bucket('claude', at(11, 6), 1)], { claude: at(11, 5) })
    const v = usageView(data, 'month', NOW)
    expect(v.recordedDays).toBe(5)
    expect(v.activeDays).toBe(3)
    expect(v.currentStreak).toBe(2)
    expect(v.longestStreak).toBe(2)
  })

  it('finds the most sessions at once and the unpriced share', () => {
    const data = dataset([bucket('claude', at(11, 9), 30, { unpriced: 10 })], { claude: at(11, 1) }, [
      { agent: 'claude', id: 'a', start: at(11, 9, 9), end: at(11, 9, 12) },
      { agent: 'codex', id: 'b', start: at(11, 9, 11), end: at(11, 9, 13) },
      { agent: 'claude', id: 'c', start: at(11, 9, 12), end: at(11, 9, 14) },
      { agent: 'claude', id: 'd', start: at(11, 9, 14), end: at(11, 9, 14) },
      // A second stretch of `a`: one more stretch, not one more session.
      { agent: 'claude', id: 'a', start: at(11, 9, 20), end: at(11, 9, 21) }
    ])
    const v = usageView(data, 'week', NOW)
    expect(v.maxConcurrent).toBe(3)
    expect(v.sessions).toBe(4)
    expect(v.unpricedShare).toBeCloseTo(1 / 3)
  })

  it('folds rows past the top four', () => {
    const rows = [5, 4, 3, 2, 1, 1].map((t, i) => ({ key: `m${i}`, tokens: t, share: t / 16 }))
    const folded = foldRows(rows)
    expect(folded.map((r) => r.key)).toEqual(['m0', 'm1', 'm2', 'm3', 'other:2'])
    expect(folded[4]!.tokens).toBe(2)
    expect(foldRows(rows.slice(0, 5))).toHaveLength(5)
  })
})

describe('heatmap', () => {
  it('is 53 Monday-first weeks ending today; days before the first log have no level', () => {
    const data = dataset([bucket('claude', at(11, 9), 10), bucket('claude', at(11, 8), 40), bucket('codex', at(9, 1), 5)], { codex: at(8, 1), claude: at(11, 2) })
    const h = heatmap(data, NOW)
    expect(h.days).toHaveLength(52 * 7 + 1)
    expect(new Date(h.days[0]!.day).getDay()).toBe(1)
    expect(h.days.at(-1)!.day).toBe(startOfDay(NOW))
    expect(h.days.find((d) => d.day === startOfDay(at(7, 1)))!.level).toBeNull()
    expect(h.days.find((d) => d.day === startOfDay(at(8, 2)))!.level).toBe(0)
    expect(h.busiest).toEqual({ day: startOfDay(at(11, 8)), tokens: 40 })
    expect(h.days.find((d) => d.day === startOfDay(at(11, 8)))!.level).toBe(4)
    expect(h.starts.map((s) => s.agent)).toEqual(['codex', 'claude'])
    expect(h.longestStreak).toBe(2)
  })

  it('has no levels at all when nothing is on record', () => {
    const h = heatmap(dataset([], {}), NOW)
    expect(h.days.every((d) => d.level === null)).toBe(true)
    expect(h.busiest).toBeNull()
    expect(h.longestStreak).toBe(0)
  })
})

describe('format', () => {
  it('writes 亿 / 万 like the design', () => {
    expect(tokenParts(482_000_000)).toEqual({ num: '4.82', unit: '亿' })
    expect(formatTokens(36_500_000)).toBe('3,650 万')
    expect(formatTokens(8_200)).toBe('8,200')
    expect(formatTokens(3_120_000_000)).toBe('31.2 亿')
  })
})

describe('projectOf', () => {
  it('folds worktrees into their repository', () => {
    expect(projectOf('/Users/m/code/terminal-reborn/.claude/worktrees/x-1', '/Users/m')).toBe('terminal-reborn')
    expect(projectOf('/Users/m/.tr/worktrees/acme-web/fix-login', '/Users/m')).toBe('acme-web')
    expect(projectOf('/Users/m/code/ios/', '/Users/m')).toBe('ios')
  })
})
