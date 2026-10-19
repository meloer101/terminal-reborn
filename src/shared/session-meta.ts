// Per-session context window use and per-vendor plan usage (PRD F11, §6.6, §6.7). Pure.
// - Claude: the statusLine JSON our relay forwards (`context_window`, `rate_limits.five_hour / seven_day`).
// - Codex: the last `token_count` event of its rollout JSONL (`info.last_token_usage`, `info.model_context_window`,
//   `rate_limits.primary / secondary` with `window_minutes`).
// Main parses with these; the renderer selects and formats with the helpers further down.

export type UsageVendor = 'claude' | 'codex'

/** How full the session's context window is, and what the CLI says about it (Figma 18 ContextPopover). */
export interface ContextUsage {
  /** 0–100. */
  percent: number
  /** Tokens in the window and its size, when the agent reports them. */
  usedTokens?: number
  windowTokens?: number
  /** What the window holds now: cached prefix read, cache written this call (Claude), and fresh input. */
  cacheRead?: number
  cacheWrite?: number
  freshInput?: number
  /** Output tokens over the whole session. */
  outputTotal?: number
  /** Claude's own list-price estimate for the session (`cost.total_cost_usd`); not what a subscription pays. */
  costUsd?: number
  /** Claude's `model.display_name`. */
  model?: string
  /** Claude's prompt cache: warm or cold, and when a warm cache expires (epoch ms). */
  cacheWarm?: boolean
  cacheExpiresAt?: number
}

/** Every optional figure, in the order the popover lists them; also what `sameContext` compares. */
const CONTEXT_KEYS = [
  'percent',
  'usedTokens',
  'windowTokens',
  'cacheRead',
  'cacheWrite',
  'freshInput',
  'outputTotal',
  'costUsd',
  'model',
  'cacheWarm',
  'cacheExpiresAt'
] as const satisfies readonly (keyof ContextUsage)[]

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

/** Epoch seconds, epoch ms or an ISO string -> ms. */
function timeMs(value: unknown): number | undefined {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (value > 1e9 && value < 1e11) return Math.round(value * 1000)
  if (value > 1e12 && value < 1e14) return Math.round(value)
  return undefined
}

/** Drops the figures a CLI did not give, so readings compare and serialize the same. */
function compactContext(raw: { [K in keyof ContextUsage]: ContextUsage[K] | undefined } & { percent: number }): ContextUsage {
  const out: Record<string, unknown> = {}
  for (const key of CONTEXT_KEYS) if (raw[key] !== undefined) out[key] = raw[key]
  return out as unknown as ContextUsage
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
      const cost = isRec(payload.cost) ? payload.cost : null
      const model = isRec(payload.model) && typeof payload.model.display_name === 'string' ? payload.model.display_name.trim().slice(0, 60) : ''
      const cache = isRec(payload.prompt_cache) ? payload.prompt_cache : null
      const costUsd = cost && typeof cost.total_cost_usd === 'number' && Number.isFinite(cost.total_cost_usd) && cost.total_cost_usd >= 0 ? cost.total_cost_usd : undefined
      const expires = cache ? timeMs(cache.expires_at) : undefined
      reading.context = compactContext({
        percent,
        usedTokens,
        windowTokens,
        cacheRead: usage ? tokens(usage.cache_read_input_tokens) : undefined,
        cacheWrite: usage ? tokens(usage.cache_creation_input_tokens) : undefined,
        freshInput: usage ? tokens(usage.input_tokens) : undefined,
        outputTotal: tokens(cw.total_output_tokens),
        costUsd,
        model: model || undefined,
        cacheWarm: cache && typeof cache.warm === 'boolean' ? cache.warm : undefined,
        cacheExpiresAt: cache?.warm === true ? expires : undefined
      })
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
    const last = isRec(info.last_token_usage) ? info.last_token_usage : null
    const used = last ? tokens(last.total_tokens) : undefined
    if (size !== undefined && size > 0 && used !== undefined) {
      // Codex counts cached input inside input_tokens.
      const input = last ? tokens(last.input_tokens) : undefined
      const cached = last ? tokens(last.cached_input_tokens) : undefined
      const total = isRec(info.total_token_usage) ? info.total_token_usage : null
      reading.context = compactContext({
        percent: codexContextPercent(used, size),
        usedTokens: used,
        windowTokens: size,
        cacheRead: cached,
        freshInput: input !== undefined ? Math.max(0, input - (cached ?? 0)) : undefined,
        outputTotal: total ? tokens(total.output_tokens) : undefined
      })
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
  if (!a || !b) return a === b
  return CONTEXT_KEYS.every((key) => a[key] === b[key])
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

// ---------------------------------------------------------------------------------------------
// Pace, history and shares (Figma 18)
// ---------------------------------------------------------------------------------------------

const MINUTE = 60_000
/** A projection from the average since the window opened needs at least this much of it behind us. */
export const PACE_MIN_ELAPSED_MS = 15 * MINUTE

const pad2 = (n: number) => String(n).padStart(2, '0')

function sameDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

/** `17:10` today, `10 月 20 日 17:10` on another day. */
export function formatClock(at: number, now: number): string {
  const d = new Date(at)
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  return sameDay(at, now) ? time : `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${time}`
}

/** `38 分钟`, `2 小时 5 分钟`, `3 天 4 小时`. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes % 60} 分钟`
  const days = Math.floor(hours / 24)
  return hours % 24 === 0 ? `${days} 天` : `${days} 天 ${hours % 24} 小时`
}

/** How a window is going: how much of its time has passed, and whether the average so far runs out before the reset. */
export interface WindowPace {
  /** 0–1 of the window's time behind us; absent when the reset time is unknown. */
  elapsed?: number
  exhausted: boolean
  /** When the average since the window opened reaches 100 %, if that is before the reset. */
  runsOutAt?: number
}

export function windowPace(w: UsageWindow, now: number): WindowPace {
  const exhausted = w.percent >= 100
  if (w.resetsAt === undefined) return { exhausted }
  const length = w.minutes * MINUTE
  const start = w.resetsAt - length
  const elapsedMs = Math.min(length, Math.max(0, now - start))
  const pace: WindowPace = { exhausted, elapsed: elapsedMs / length }
  if (!exhausted && w.percent > 0 && elapsedMs >= PACE_MIN_ELAPSED_MS) {
    const at = now + ((100 - w.percent) / w.percent) * elapsedMs
    if (at < w.resetsAt) pace.runsOutAt = Math.round(at)
  }
  return pace
}

/** UsageChip v2 text: `5h 62%`, or `5h 用完 · 14:20 恢复` once the window is used up. */
export function usageChipText(w: UsageWindow, now: number): string {
  if (w.percent >= 100) return w.resetsAt !== undefined ? `${windowShort(w.minutes)} 用完 · ${formatClock(w.resetsAt, now)} 恢复` : `${windowShort(w.minutes)} 用完`
  return `${windowShort(w.minutes)} ${w.percent}%`
}

/** UsageWindowBlock's last line. */
export function paceNote(w: UsageWindow, now: number): string {
  const pace = windowPace(w, now)
  if (pace.exhausted) return w.resetsAt !== undefined ? `已用完 · 还有 ${formatDuration(w.resetsAt - now)}恢复` : '已用完'
  if (pace.elapsed === undefined) return ''
  const elapsed = `时间过了 ${Math.round(pace.elapsed * 100)}%`
  if (pace.runsOutAt !== undefined) return `${elapsed}，用得比时间快 · 按这个速度约 ${formatClock(pace.runsOutAt, now)} 用完`
  if (now - (w.resetsAt! - w.minutes * MINUTE) < PACE_MIN_ELAPSED_MS) return elapsed
  return `${elapsed} · 按这个速度用得完`
}

/** A Wavi usage alert: one per window per period at each of these levels. */
export const USAGE_ALERT_LEVELS = [75, 90, 100] as const
export type UsageAlertLevel = (typeof USAGE_ALERT_LEVELS)[number]

export function usageAlertLevel(percent: number): UsageAlertLevel | 0 {
  let level: UsageAlertLevel | 0 = 0
  for (const l of USAGE_ALERT_LEVELS) if (percent >= l) level = l
  return level
}

export interface UsageAlert {
  vendor: UsageVendor
  minutes: number
  percent: number
  level: UsageAlertLevel
  resetsAt?: number
}

/** The system notification for an alert. */
export function usageAlertText(alert: UsageAlert, now: number): { title: string; body: string } {
  const name = `${VENDOR_LABEL[alert.vendor]} ${windowLabel(alert.vendor, alert.minutes)}额度`
  const reset = alert.resetsAt
  if (alert.level === 100) return { title: `${name}已用完`, body: reset !== undefined ? `${formatClock(reset, now)} 恢复` : '等它重置后再继续' }
  const w: UsageWindow = { minutes: alert.minutes, percent: alert.percent, ...(reset !== undefined ? { resetsAt: reset } : {}) }
  const pace = windowPace(w, now)
  const parts = [reset !== undefined ? formatReset(reset, now) : '']
  if (pace.runsOutAt !== undefined) parts.push(`按这个速度约 ${formatClock(pace.runsOutAt, now)} 用完`)
  return { title: `${name}已用 ${alert.percent}%`, body: parts.filter(Boolean).join(' · ') }
}

/** A reading is old when nothing has refreshed it for this long (the popover says it may be out of date). */
export const STALE_MS = 30 * MINUTE

/** `1 分钟前更新`, or `35 分钟前更新 · 可能不是最新`. */
export function formatUpdatedNote(at: number, now: number): string {
  const base = formatUpdated(at, now)
  return now - at >= STALE_MS ? `${base} · 可能不是最新` : base
}

/** One finished turn: the tokens in the context window when the agent's last reply of the turn came back. */
export interface ContextPoint {
  at: number
  tokens: number
}

/** A session's context over its turns, read from the agent's transcript (main · transcript-meter.ts). */
export interface ContextHistory {
  /** Finished turns, oldest first, and the turn in progress (or just finished) last. */
  turns: ContextPoint[]
  /** When the conversation was compacted. */
  compactions: number[]
  /** The window size the transcript states (Codex), for when no statusLine said it. */
  windowTokens?: number
}

/** The history as percentages, split where the conversation was compacted. */
export function contextSegments(history: ContextHistory, windowTokens: number): number[][] {
  if (windowTokens <= 0) return []
  const segments: number[][] = [[]]
  let next = 0
  const compactions = [...history.compactions].sort((a, b) => a - b)
  for (const point of history.turns) {
    while (next < compactions.length && compactions[next]! <= point.at) {
      next++
      if (segments[segments.length - 1]!.length > 0) segments.push([])
    }
    segments[segments.length - 1]!.push(Math.min(100, Math.max(0, Math.round((point.tokens / windowTokens) * 100))))
  }
  return segments.filter((s) => s.length > 0)
}

/** "大约 N 轮后…" from the average growth of the last few turns since the last compaction. */
export function contextProjection(segment: readonly number[], options: { minTurns?: number; lookback?: number } = {}): string | null {
  const minTurns = options.minTurns ?? 3
  const lookback = options.lookback ?? 5
  if (segment.length < minTurns) return null
  const recent = segment.slice(-(lookback + 1))
  const turns = recent.length - 1
  const growth = (recent[recent.length - 1]! - recent[0]!) / turns
  if (growth < 0.5) return null
  const current = recent[recent.length - 1]!
  const target = current < HIGH_PERCENT ? HIGH_PERCENT : 100
  const n = (target - current) / growth
  if (n > 30) return null
  const lo = Math.max(1, Math.floor(n))
  const hi = Math.max(1, Math.ceil(n))
  const span = lo === hi ? `${lo}` : `${lo}–${hi}`
  return `按最近 ${turns} 轮的增速，大约 ${span} 轮后${target === 100 ? '用满' : '超过 80%'}`
}

/** SVG geometry for the ContextPopover sparkline: one path per segment, gaps marked where it was compacted. */
export function sparkline(
  segments: readonly (readonly number[])[],
  width: number,
  height: number
): { paths: string[]; breaks: number[]; last: { x: number; y: number } | null; guideY: number } {
  const total = segments.reduce((n, s) => n + s.length, 0)
  const guideY = Math.round((height - (HIGH_PERCENT / 100) * height) * 10) / 10
  if (total === 0) return { paths: [], breaks: [], last: null, guideY }
  const step = total > 1 ? width / (total - 1) : 0
  const y = (p: number) => Math.round((height - (p / 100) * height) * 10) / 10
  const x = (i: number) => Math.round((total > 1 ? i * step : width) * 10) / 10
  const paths: string[] = []
  const breaks: number[] = []
  let i = 0
  let last: { x: number; y: number } | null = null
  for (const [s, segment] of segments.entries()) {
    if (s > 0) breaks.push(Math.round((x(i) - step / 2) * 10) / 10)
    paths.push(segment.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(i + k)} ${y(p)}`).join(' '))
    last = { x: x(i + segment.length - 1), y: y(segment[segment.length - 1]!) }
    i += segment.length
  }
  return { paths, breaks, last, guideY }
}

/** Tokens one session spent in a window: fresh input + cache writes + output (cache reads are left out). */
export interface SessionSpend {
  sessionId: string
  tokens: number
}

export interface ShareRow {
  /** Null for the "其他" and "已关闭" lines. */
  sessionId: string | null
  title: string
  project: string
  percent: number
}

/**
 * Who used a vendor's window (Figma 18 SessionShareRow): the top `max` open sessions, then the rest as one line.
 * Nothing when fewer than two sessions spent anything — a single row says nothing a share could add.
 */
export function shareRows(
  spend: readonly SessionSpend[],
  labelOf: (sessionId: string) => { title: string; project: string } | null,
  max = 4
): ShareRow[] {
  const used = spend.filter((s) => s.tokens > 0)
  if (used.length < 2) return []
  const total = used.reduce((n, s) => n + s.tokens, 0)
  const open: (SessionSpend & { title: string; project: string })[] = []
  let closed = 0
  for (const s of used) {
    const label = labelOf(s.sessionId)
    if (label) open.push({ ...s, ...label })
    else closed += s.tokens
  }
  open.sort((a, b) => b.tokens - a.tokens)
  const shown = open.slice(0, max)
  const rest = open.slice(max)
  const rows: ShareRow[] = shown.map((s) => ({ sessionId: s.sessionId, title: s.title, project: s.project, percent: (s.tokens / total) * 100 }))
  const restTokens = rest.reduce((n, s) => n + s.tokens, 0)
  if (restTokens > 0) rows.push({ sessionId: null, title: `其他 ${rest.length} 个会话`, project: '', percent: (restTokens / total) * 100 })
  if (closed > 0) rows.push({ sessionId: null, title: '已关闭的会话', project: '', percent: (closed / total) * 100 })
  // Whole percents that still add up to 100 (largest remainders get the leftover points).
  const floors = rows.map((r) => Math.floor(r.percent))
  let left = 100 - floors.reduce((n, f) => n + f, 0)
  const order = rows.map((r, i) => ({ i, rest: r.percent - floors[i]! })).sort((a, b) => b.rest - a.rest)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i]!++
    left--
  }
  return rows.map((r, i) => ({ ...r, percent: floors[i]! }))
}

/** The window the shares are for: the vendor's shortest live one (5 h), where sessions compete. */
export function shareWindow(usage: VendorUsage, now: number): UsageWindow | null {
  const live = liveWindows(usage, now).filter((w) => w.resetsAt !== undefined)
  return live.sort((a, b) => a.minutes - b.minutes)[0] ?? null
}

/** `$3.42`, `$0.08`, `$128`. */
export function formatUsd(value: number): string {
  return value >= 100 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`
}
