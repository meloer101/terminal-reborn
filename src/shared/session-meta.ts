// Per-session context window use and per-vendor plan usage (PRD F11, §6.6, §6.7). Pure.
// - Claude: the statusLine JSON our relay forwards (`context_window`, `rate_limits.five_hour / seven_day`).
// - Codex: the last `token_count` event of its rollout JSONL (`info.last_token_usage`, `info.model_context_window`,
//   `rate_limits.primary / secondary` with `window_minutes`).
// Main parses with these; the renderer selects and formats with the helpers further down.

export type UsageVendor = 'claude' | 'codex'

/** How full the session's context window is. */
export interface ContextUsage {
  /** 0–100. */
  percent: number
  /** Tokens in the window and its size, when the agent reports them (for the tooltip). */
  usedTokens?: number
  windowTokens?: number
}

/** One plan-usage window (5 h, 7 d / weekly). */
export interface UsageWindow {
  /** Window length in minutes (300, 10080, …): identifies the window across readings. */
  minutes: number
  /** 0–100. */
  percent: number
  /** Epoch ms; absent when the agent did not say. */
  resetsAt?: number
}

/** The account's plan usage as one vendor's CLI last reported it. Account-level: shared by every session of that vendor. */
export interface VendorUsage {
  vendor: UsageVendor
  windows: UsageWindow[]
  /** Epoch ms of the reading. */
  at: number
}

/** At or above this a context or usage figure is drawn heavier (and the header offers /compact). */
export const HIGH_PERCENT = 80

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)

function percentOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(100, Math.max(0, Math.round(value)))
}

function tokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
}

/** Epoch seconds (both CLIs) -> ms; implausible values are dropped rather than shown as a wrong time. */
function resetMs(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 1e9 && value < 1e11 ? Math.round(value * 1000) : undefined
}

function window(minutes: number, percent: unknown, resetsAt: unknown): UsageWindow | undefined {
  const value = percentOf(percent)
  if (value === undefined) return undefined
  const reset = resetMs(resetsAt)
  return { minutes, percent: value, ...(reset !== undefined ? { resetsAt: reset } : {}) }
}

export interface MetaReading {
  context?: ContextUsage
  usage?: VendorUsage
}

/**
 * Claude Code statusLine JSON (2.1.301–2.1.303, PRD §6.6). `used_percentage` is null before the first API response
 * and `rate_limits` is absent then (and for API-key logins). Never throws.
 */
export function parseClaudeStatusLine(payload: unknown, at: number): MetaReading {
  if (!isRec(payload)) return {}
  const reading: MetaReading = {}
  const cw = payload.context_window
  if (isRec(cw)) {
    const percent = percentOf(cw.used_percentage)
    if (percent !== undefined) {
      const windowTokens = tokens(cw.context_window_size)
      const usage = isRec(cw.current_usage) ? cw.current_usage : null
      const used = usage
        ? (tokens(usage.input_tokens) ?? 0) + (tokens(usage.cache_creation_input_tokens) ?? 0) + (tokens(usage.cache_read_input_tokens) ?? 0)
        : undefined
      const usedTokens = used !== undefined && used > 0 ? used : windowTokens !== undefined ? Math.round((percent / 100) * windowTokens) : undefined
      reading.context = {
        percent,
        ...(usedTokens !== undefined ? { usedTokens } : {}),
        ...(windowTokens !== undefined ? { windowTokens } : {})
      }
    }
  }
  const limits = payload.rate_limits
  if (isRec(limits)) {
    const windows = [
      isRec(limits.five_hour) ? window(300, limits.five_hour.used_percentage, limits.five_hour.resets_at) : undefined,
      isRec(limits.seven_day) ? window(7 * 24 * 60, limits.seven_day.used_percentage, limits.seven_day.resets_at) : undefined
    ].filter((w): w is UsageWindow => w !== undefined)
    if (windows.length > 0) reading.usage = { vendor: 'claude', windows, at }
  }
  return reading
}

/**
 * Tokens Codex keeps out of its "% context left" (its TUI's BASELINE_TOKENS: system prompt and tools), so our number
 * matches the one the user sees in Codex.
 */
const CODEX_BASELINE_TOKENS = 12_000

/** Codex's own "context used" figure for `used` tokens in a `size` window (100 − its "% left"). */
export function codexContextPercent(used: number, size: number): number {
  if (size <= CODEX_BASELINE_TOKENS) return 100
  const effective = size - CODEX_BASELINE_TOKENS
  const inWindow = Math.max(0, used - CODEX_BASELINE_TOKENS)
  const left = Math.min(100, Math.max(0, ((effective - inWindow) / effective) * 100))
  return Math.round(100 - left)
}

/**
 * One rollout line's `event_msg` / `token_count` payload (Codex 0.142.5, PRD §6.7):
 * `{ info: { last_token_usage: { total_tokens }, model_context_window }, rate_limits: { primary, secondary } }`.
 * `info` is null before the first response; `primary` / `secondary` are null without plan headers (API keys,
 * third-party providers). Never throws.
 */
export function parseCodexTokenCount(payload: unknown, at: number): MetaReading {
  if (!isRec(payload) || payload.type !== 'token_count') return {}
  const reading: MetaReading = {}
  const info = payload.info
  if (isRec(info)) {
    const size = tokens(info.model_context_window)
    const used = isRec(info.last_token_usage) ? tokens(info.last_token_usage.total_tokens) : undefined
    if (size !== undefined && size > 0 && used !== undefined) {
      reading.context = { percent: codexContextPercent(used, size), usedTokens: used, windowTokens: size }
    }
  }
  const limits = payload.rate_limits
  if (isRec(limits)) {
    const windows: UsageWindow[] = []
    for (const raw of [limits.primary, limits.secondary]) {
      if (!isRec(raw)) continue
      const minutes = tokens(raw.window_minutes)
      if (minutes === undefined || minutes <= 0) continue
      const w = window(minutes, raw.used_percent, raw.resets_at)
      if (w && !windows.some((x) => x.minutes === w.minutes)) windows.push(w)
    }
    if (windows.length > 0) reading.usage = { vendor: 'codex', windows: windows.sort((a, b) => a.minutes - b.minutes), at }
  }
  return reading
}

/** The newest `token_count` reading in a chunk of rollout JSONL (only the tail is read). */
export function lastCodexTokenCount(text: string, at: number): MetaReading {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.includes('"token_count"')) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!isRec(entry) || entry.type !== 'event_msg') continue
    const reading = parseCodexTokenCount(entry.payload, at)
    if (reading.context || reading.usage) return reading
  }
  return {}
}

export function sameContext(a: ContextUsage | undefined, b: ContextUsage | undefined): boolean {
  return a?.percent === b?.percent && a?.usedTokens === b?.usedTokens && a?.windowTokens === b?.windowTokens
}

/** Same figures (the reading time aside). */
export function sameUsage(a: VendorUsage | undefined, b: VendorUsage | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.vendor === b.vendor &&
    a.windows.length === b.windows.length &&
    a.windows.every((w, i) => {
      const o = b.windows[i]
      return o !== undefined && o.minutes === w.minutes && o.percent === w.percent && o.resetsAt === w.resetsAt
    })
  )
}

// ---------------------------------------------------------------------------------------------
// Selection and formatting (renderer)
// ---------------------------------------------------------------------------------------------

/** A window whose reset time has passed no longer says anything true about now. */
export function liveWindows(usage: VendorUsage, now: number): UsageWindow[] {
  return usage.windows.filter((w) => w.resetsAt === undefined || w.resetsAt > now)
}

/** The window the header chip shows: the most used one (ties: the shorter window). */
export function topWindow(usage: VendorUsage, now: number): UsageWindow | null {
  let best: UsageWindow | null = null
  for (const w of liveWindows(usage, now)) if (!best || w.percent > best.percent) best = w
  return best
}

/** Vendors with something to show, the current session's vendor first, then Claude before Codex. */
export function orderVendors(all: readonly VendorUsage[], current: UsageVendor | null, now: number): VendorUsage[] {
  const rank = (v: UsageVendor) => (v === current ? 0 : v === 'claude' ? 1 : 2)
  return all.filter((u) => liveWindows(u, now).length > 0).sort((a, b) => rank(a.vendor) - rank(b.vendor))
}

export const VENDOR_LABEL: Record<UsageVendor, string> = { claude: 'Claude', codex: 'Codex' }

/** Chip form: `5h`, `7d`. */
export function windowShort(minutes: number): string {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

/** Popover form: `5 小时`, `7 天`; Codex calls its 7-day window 每周 (Figma 17 UsagePopover). */
export function windowLabel(vendor: UsageVendor, minutes: number): string {
  if (minutes === 7 * 24 * 60 && vendor === 'codex') return '每周'
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} 天`
  if (minutes % 60 === 0) return `${minutes / 60} 小时`
  return `${minutes} 分钟`
}

/** `18:30 重置` today, `10 月 20 日重置` later. */
export function formatReset(resetsAt: number, now: number): string {
  const at = new Date(resetsAt)
  const today = new Date(now)
  const sameDay = at.getFullYear() === today.getFullYear() && at.getMonth() === today.getMonth() && at.getDate() === today.getDate()
  if (sameDay) return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} 重置`
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日重置`
}

/** `刚刚更新`, `1 分钟前更新`, `3 小时前更新`. */
export function formatUpdated(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000)
  if (minutes < 1) return '刚刚更新'
  if (minutes < 60) return `${minutes} 分钟前更新`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前更新`
  return `${Math.floor(hours / 24)} 天前更新`
}

/** `172k`, `1.2M`, `850`. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${Number((count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1))}M`
  if (count >= 1_000) return `${Math.round(count / 1_000)}k`
  return String(count)
}

/** ContextTooltip's first line: `context 172k / 200k · 86%`, or `context 86%` without token counts. */
export function contextDetail(context: ContextUsage): string {
  if (context.usedTokens !== undefined && context.windowTokens !== undefined) {
    return `context ${formatTokens(context.usedTokens)} / ${formatTokens(context.windowTokens)} · ${context.percent}%`
  }
  return `context ${context.percent}%`
}

export function isHigh(percent: number): boolean {
  return percent >= HIGH_PERCENT
}
