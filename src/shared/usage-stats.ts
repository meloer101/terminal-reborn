// 设置 · 额度's token statistics (PRD F11 · 额度页, Figma 69″): what the agents' own logs on this Mac say about token
// use, by week / month / year / all. Wavi keeps nothing of its own: main (src/main/usage-stats) scans the logs into
// hourly buckets, and the views here are computed from them. Each agent counts from its own oldest log line (logs
// the CLI already deleted are gone), so every view says where each agent starts and never extrapolates.
import type { CliAgent } from './agents'
import { WAVI_WORKTREES_DIR } from './git-worktrees'

/** Agents whose logs carry per-message token counts and that Wavi reads (others show 暂不支持). */
export const STATS_AGENTS = ['claude', 'codex', 'opencode', 'pi', 'grok'] as const satisfies readonly CliAgent[]
export type StatsAgent = (typeof STATS_AGENTS)[number]
export const isStatsAgent = (id: string): id is StatsAgent => (STATS_AGENTS as readonly string[]).includes(id)

export interface TokenSplit {
  /** Uncached input. */
  input: number
  /** Output, reasoning included. */
  output: number
  cacheRead: number
  cacheWrite: number
}

export const tokensOf = (s: TokenSplit): number => s.input + s.output + s.cacheRead + s.cacheWrite

/** One agent's use in one local hour, for one model and project. */
export interface UsageBucket extends TokenSplit {
  /** Epoch ms of the local hour's start. */
  hour: number
  agent: StatsAgent
  model: string
  project: string
  /** USD at API prices (the log's own cost when it has one, else the price table) for the priced part. */
  cost: number
  /** Tokens of a model with no known price. */
  unpriced: number
}

/** One stretch of a conversation: its usage lines with no gap over half an hour. A conversation may have several. */
export interface SessionSpan {
  agent: StatsAgent
  /** The conversation's id: stretches with one id are one session. */
  id: string
  start: number
  end: number
}

export interface UsageDataset {
  buckets: UsageBucket[]
  sessions: SessionSpan[]
  /** Each agent's oldest usage line still on disk. */
  firstAt: Partial<Record<StatsAgent, number>>
  /** Lines that looked like usage but could not be read. */
  skipped: number
  scannedAt: number
}

export type StatsPeriod = 'week' | 'month' | 'year' | 'all'

export interface UsageBar {
  start: number
  end: number
  tokens: number
  perAgent: Partial<Record<StatsAgent, number>>
  /** Before the oldest log of any agent: drawn as an empty frame. */
  noRecord: boolean
}

export interface ShareRow {
  key: string
  tokens: number
  /** 0–1 of the period's tokens. */
  share: number
}

export interface UsageView {
  period: StatsPeriod
  start: number
  end: number
  /** Bars are days (week, month) or months (year, all). */
  unit: 'day' | 'month'
  tokens: number
  split: TokenSplit
  /** The same length right before; null when that stretch is not fully on record (or for year / all). */
  previousTokens: number | null
  cost: number
  previousCost: number | null
  /** Share of the period's tokens with no known price (0–1). */
  unpricedShare: number
  sessions: number
  maxConcurrent: number
  /** Days with use, of the days on record in the period. */
  activeDays: number
  recordedDays: number
  /** Consecutive days with use up to today (or yesterday when today has none yet). */
  currentStreak: number
  longestStreak: number
  /** Oldest log over all agents, null with no record at all. */
  firstAt: number | null
  /** Agents whose oldest log falls inside the period, oldest first. */
  startsInPeriod: { agent: StatsAgent; at: number }[]
  bars: UsageBar[]
  byAgent: (ShareRow & { agent: StatsAgent; firstAt: number })[]
  byModel: ShareRow[]
  byProject: ShareRow[]
  /** Tokens per hour of day, 0–23. */
  hours: number[]
}

export interface HeatDay {
  day: number
  tokens: number
  /** 0 none … 4 most; null: before any log. */
  level: 0 | 1 | 2 | 3 | 4 | null
}

export interface Heatmap {
  /** 53 columns × 7 rows (Monday first), oldest first; the last column ends on today's week (days after today omitted). */
  days: HeatDay[]
  longestStreak: number
  busiest: { day: number; tokens: number } | null
}

const DAY = 24 * 60 * 60_000

export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const addDays = (day: number, n: number): number => {
  const d = new Date(day)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

const monthStart = (t: number, offset = 0): number => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime()
}

/** The project a working directory belongs to: Wavi's and Claude's worktrees count as their repository. */
export function projectOf(cwd: string, home: string): string {
  const parts = cwd.replace(/\/+$/, '').split('/')
  const claudeAt = parts.lastIndexOf('worktrees')
  if (claudeAt > 1 && parts[claudeAt - 1] === '.claude') return parts[claudeAt - 2] ?? cwd
  const tr = `${home.replace(/\/+$/, '')}/${WAVI_WORKTREES_DIR.join('/')}/`
  if (cwd.startsWith(tr)) return cwd.slice(tr.length).split('/')[0] || cwd
  return parts[parts.length - 1] || cwd
}

function rangeOf(period: StatsPeriod, now: number, firstAt: number | null): { start: number; unit: 'day' | 'month'; count: number } {
  const today = startOfDay(now)
  if (period === 'week') return { start: addDays(today, -6), unit: 'day', count: 7 }
  if (period === 'month') return { start: addDays(today, -29), unit: 'day', count: 30 }
  if (period === 'year') return { start: monthStart(now, -11), unit: 'month', count: 12 }
  const first = monthStart(firstAt ?? now)
  const d0 = new Date(first)
  const d1 = new Date(now)
  return { start: first, unit: 'month', count: (d1.getFullYear() - d0.getFullYear()) * 12 + d1.getMonth() - d0.getMonth() + 1 }
}

function oldest(firstAt: UsageDataset['firstAt']): number | null {
  const all = Object.values(firstAt).filter((v): v is number => typeof v === 'number')
  return all.length ? Math.min(...all) : null
}

function dailyTotals(buckets: readonly UsageBucket[]): Map<number, number> {
  const days = new Map<number, number>()
  for (const b of buckets) {
    const day = startOfDay(b.hour)
    days.set(day, (days.get(day) ?? 0) + tokensOf(b))
  }
  return days
}

/** Longest run of consecutive used days from `from` to `to` (both day starts). */
function longestRun(days: Map<number, number>, from: number, to: number): number {
  let best = 0
  let run = 0
  for (let d = from; d <= to; d = addDays(d, 1)) {
    run = (days.get(d) ?? 0) > 0 ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

function shareRows(map: Map<string, number>, total: number): ShareRow[] {
  return [...map.entries()]
    .filter(([, tokens]) => tokens > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, tokens]) => ({ key, tokens, share: total > 0 ? tokens / total : 0 }))
}

/** The top `keep` rows, the rest folded into one row keyed `other:N` (N = how many were folded). */
export function foldRows(rows: readonly ShareRow[], keep = 4): ShareRow[] {
  if (rows.length <= keep + 1) return [...rows]
  const rest = rows.slice(keep)
  return [
    ...rows.slice(0, keep),
    { key: `other:${rest.length}`, tokens: rest.reduce((s, r) => s + r.tokens, 0), share: rest.reduce((s, r) => s + r.share, 0) }
  ]
}

function maxOverlap(sessions: readonly SessionSpan[], start: number, end: number): number {
  const events: [number, number][] = []
  for (const s of sessions) {
    if (s.end < start || s.start >= end) continue
    events.push([Math.max(s.start, start), 1], [Math.min(s.end, end), -1])
  }
  // Starts before ends at the same instant: two sessions touching at one moment overlap.
  events.sort((a, b) => a[0] - b[0] || b[1] - a[1])
  let now = 0
  let best = 0
  for (const [, delta] of events) {
    now += delta
    best = Math.max(best, now)
  }
  return best
}

export function usageView(data: UsageDataset, period: StatsPeriod, now: number): UsageView {
  const firstAt = oldest(data.firstAt)
  const { start, unit, count } = rangeOf(period, now, firstAt)
  const end = now
  const barStart = (i: number): number => (unit === 'day' ? addDays(start, i) : monthStart(start, i))
  const bars: UsageBar[] = Array.from({ length: count }, (_, i) => {
    const s = barStart(i)
    const e = barStart(i + 1)
    return { start: s, end: e, tokens: 0, perAgent: {}, noRecord: firstAt === null || e <= firstAt }
  })
  const barAt = new Map(bars.map((b) => [b.start, b]))
  const split: TokenSplit = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let cost = 0
  let unpriced = 0
  const agents = new Map<string, number>()
  const models = new Map<string, number>()
  const projects = new Map<string, number>()
  const hours = Array.from({ length: 24 }, () => 0)
  const span = start === end ? 1 : end - start
  const prevStart = start - span
  let previousTokens = 0
  let previousCost = 0
  for (const b of data.buckets) {
    const tokens = tokensOf(b)
    if (b.hour >= prevStart && b.hour < start) {
      previousTokens += tokens
      previousCost += b.cost
    }
    if (b.hour < start || b.hour > end) continue
    split.input += b.input
    split.output += b.output
    split.cacheRead += b.cacheRead
    split.cacheWrite += b.cacheWrite
    cost += b.cost
    unpriced += b.unpriced
    agents.set(b.agent, (agents.get(b.agent) ?? 0) + tokens)
    models.set(b.model || '?', (models.get(b.model || '?') ?? 0) + tokens)
    projects.set(b.project, (projects.get(b.project) ?? 0) + tokens)
    hours[new Date(b.hour).getHours()]! += tokens
    const bar = barAt.get(unit === 'day' ? startOfDay(b.hour) : monthStart(b.hour))
    if (bar) {
      bar.tokens += tokens
      bar.perAgent[b.agent] = (bar.perAgent[b.agent] ?? 0) + tokens
    }
  }
  const tokens = tokensOf(split)
  const comparable = (period === 'week' || period === 'month') && firstAt !== null && firstAt <= prevStart
  const days = dailyTotals(data.buckets)
  const today = startOfDay(now)
  const recordFrom = Math.max(startOfDay(start), firstAt === null ? today + DAY : startOfDay(firstAt))
  let activeDays = 0
  let recordedDays = 0
  for (let d = recordFrom; d <= today; d = addDays(d, 1)) {
    recordedDays++
    if ((days.get(d) ?? 0) > 0) activeDays++
  }
  let currentStreak = 0
  for (let d = (days.get(today) ?? 0) > 0 ? today : addDays(today, -1); (days.get(d) ?? 0) > 0; d = addDays(d, -1)) currentStreak++
  const startsInPeriod = STATS_AGENTS.flatMap((agent) => {
    const at = data.firstAt[agent]
    return at !== undefined && at >= start && at <= end ? [{ agent, at }] : []
  }).sort((a, b) => a.at - b.at)
  const byAgent = shareRows(agents, tokens).map((r) => ({ ...r, agent: r.key as StatsAgent, firstAt: data.firstAt[r.key as StatsAgent] ?? start }))
  const sessions = new Set(data.sessions.filter((s) => s.end >= start && s.start <= end).map((s) => `${s.agent}\0${s.id}`)).size
  return {
    period,
    start,
    end,
    unit,
    tokens,
    split,
    previousTokens: comparable ? previousTokens : null,
    cost,
    previousCost: comparable ? previousCost : null,
    unpricedShare: tokens > 0 ? unpriced / tokens : 0,
    sessions,
    maxConcurrent: maxOverlap(data.sessions, start, end),
    activeDays,
    recordedDays,
    currentStreak,
    longestStreak: longestRun(days, recordFrom, today),
    firstAt,
    startsInPeriod,
    bars,
    byAgent,
    byModel: foldRows(shareRows(models, tokens)),
    byProject: foldRows(shareRows(projects, tokens)),
    hours
  }
}

/** The past year by day, GitHub-style: 53 Monday-first weeks ending with today's. */
export function heatmap(data: UsageDataset, now: number): Heatmap {
  const today = startOfDay(now)
  const weekday = (new Date(today).getDay() + 6) % 7
  const first = addDays(today, -(52 * 7 + weekday))
  const firstAt = oldest(data.firstAt)
  const recordFrom = firstAt === null ? Infinity : startOfDay(firstAt)
  const totals = dailyTotals(data.buckets)
  const used: number[] = []
  const days: HeatDay[] = []
  for (let d = first; d <= today; d = addDays(d, 1)) {
    const tokens = totals.get(d) ?? 0
    if (tokens > 0 && d >= recordFrom) used.push(tokens)
    days.push({ day: d, tokens, level: d < recordFrom ? null : 0 })
  }
  // Levels by rank among the used days (quartiles), so one huge day does not wash out the rest; the busiest is 4.
  const sorted = [...used].sort((a, b) => a - b)
  const atOrBelow = (v: number): number => {
    let lo = 0
    let hi = sorted.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid]! <= v) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  let busiest: Heatmap['busiest'] = null
  for (const h of days) {
    if (h.level === null || h.tokens <= 0) continue
    h.level = Math.max(1, Math.ceil((atOrBelow(h.tokens) / sorted.length) * 4)) as 1 | 2 | 3 | 4
    if (!busiest || h.tokens > busiest.tokens) busiest = { day: h.day, tokens: h.tokens }
  }
  return { days, longestStreak: longestRun(totals, Math.max(first, recordFrom === Infinity ? today + DAY : recordFrom), today), busiest }
}

/** `4.82 亿` / `3,650 万` / `8,200`, split so the number and the unit can be set apart. */
export function tokenParts(n: number): { num: string; unit: string } {
  if (n >= 1e8) return { num: (n / 1e8).toFixed(n >= 1e10 ? 0 : n >= 1e9 ? 1 : 2), unit: '亿' }
  if (n >= 1e4) return { num: Math.round(n / 1e4).toLocaleString('en-US'), unit: '万' }
  return { num: Math.round(n).toLocaleString('en-US'), unit: '' }
}

export const formatTokens = (n: number): string => {
  const { num, unit } = tokenParts(n)
  return unit ? `${num} ${unit}` : num
}

export const formatUsd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`

/** `+23%` / `-8%`, or null when there is nothing to compare with. */
export function changeText(now: number, before: number | null): string | null {
  if (before === null || before <= 0) return null
  const pct = Math.round(((now - before) / before) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}
