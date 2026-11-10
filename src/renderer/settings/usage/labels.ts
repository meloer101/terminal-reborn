// Words and numbers on 设置 · 额度's statistics (Figma 69″): KPI lines, axis and bar labels, start dates.
import { changeText, formatUsd, tokenParts, type StatsPeriod, type UsageBar, type UsageView } from '@shared/usage-stats'

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

export const monthDay = (t: number): string => {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export const monthDayCn = (t: number): string => {
  const d = new Date(t)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** `9/13 起`: where an agent's logs start. */
export const startLabel = (t: number): string => `${monthDay(t)} 起`

/** Under each bar: every day in a week, every 7th day in 30 days, every month (or every Nth when there are many). */
export function barLabel(view: UsageView, i: number): string {
  const bar = view.bars[i]!
  const last = i === view.bars.length - 1
  const d = new Date(bar.start)
  if (view.unit === 'month') {
    const every = Math.ceil(view.bars.length / 12)
    return last || i % every === 0 ? `${d.getMonth() + 1} 月` : ''
  }
  if (last) return '今天'
  if (view.bars.length <= 7) return `${monthDay(bar.start)} ${WEEKDAY[d.getDay()]}`
  // Every 7th day, but none right before 今天 (they would run into each other).
  return i % 7 === 0 && i < view.bars.length - 3 ? monthDay(bar.start) : ''
}

export function tooltipTitle(bar: UsageBar, unit: UsageView['unit']): string {
  const d = new Date(bar.start)
  if (unit === 'month') return `${d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()} 年 `}${d.getMonth() + 1} 月`
  return `${monthDayCn(bar.start)} 周${WEEKDAY[d.getDay()]}`
}

/** The top of the chart: 1, 2, 2.5, 4 or 5 × 10ⁿ at or above the largest bar. */
export function niceMax(n: number): number {
  if (n <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 2.5, 4, 5, 10].map((m) => m * p).find((v) => v >= n) ?? 10 * p)
}

const trim = (n: number): string => String(Math.round(n * 100) / 100)

/** An axis tick in the unit of the axis's top (`max`), so one axis never mixes 亿 and M. */
export function axisLabel(n: number, max = n): string {
  if (n === 0) return '0'
  if (max >= 1e8) return `${trim(n / 1e8)} 亿`
  if (max >= 1e6) return `${trim(n / 1e6)}M`
  if (max >= 1e3) return `${trim(n / 1e3)}K`
  return String(Math.round(n))
}

export function shareText(share: number): string {
  if (share > 0 && share < 0.01) return '<1%'
  return `${Math.round(share * 100)}%`
}

export interface Kpi {
  label: string
  num: string
  unit: string
  sub: string
  /** The sub line is a rise or fall (drawn in text/primary). */
  change: boolean
}

const PREVIOUS: Partial<Record<StatsPeriod, string>> = { week: '比上周', month: '比上月' }

export function kpis(view: UsageView): Kpi[] {
  const long = view.period === 'year' || view.period === 'all'
  const tokens = tokenParts(view.tokens)
  const tokenChange = changeText(view.tokens, view.previousTokens)
  const costChange = changeText(view.cost, view.previousCost)
  const startsInside = view.firstAt !== null && view.firstAt > view.start
  const months = Math.max(1, view.bars.filter((b) => !b.noRecord).length)
  const tokenSub = tokenChange ? `${PREVIOUS[view.period]} ${tokenChange}` : startsInside ? `${monthDayCn(view.firstAt!)}起` : ''
  const costSub =
    view.unpricedShare >= 0.01
      ? `未定价 ${shareText(view.unpricedShare)}`
      : costChange
        ? `${PREVIOUS[view.period]} ${costChange}`
        : long && view.cost > 0
          ? `月均 ${formatUsd(view.cost / months)}`
          : ''
  return [
    { label: 'Token', num: tokens.num, unit: tokens.unit, sub: tokenSub, change: tokenChange !== null },
    { label: 'API 等价', num: formatUsd(view.cost), unit: '', sub: costSub, change: false },
    { label: '会话', num: view.sessions.toLocaleString('en-US'), unit: '', sub: view.maxConcurrent > 1 ? `最多同时 ${view.maxConcurrent} 个` : '', change: false },
    long
      ? { label: '最长连续', num: String(view.longestStreak), unit: '天', sub: view.recordedDays > 0 ? `有记录的 ${view.recordedDays} 天里用了 ${view.activeDays} 天` : '', change: false }
      : { label: '连续使用', num: String(view.currentStreak), unit: '天', sub: view.recordedDays > 0 ? `${view.recordedDays} 天里用了 ${view.activeDays} 天` : '', change: false }
  ]
}
