// Per-session context window use and per-vendor plan usage (PRD F11, §6.6, §6.7). Pure.
// - Claude: the statusLine JSON our relay forwards (`context_window`, `rate_limits.five_hour / seven_day`), and the
//   account's full `/usage` answer that main polls (`get_usage` control request, ./plan-usage-poller.ts).
// - Codex: the last `token_count` event of its rollout JSONL (`info.last_token_usage`, `info.model_context_window`,
//   `rate_limits.primary / secondary` with `window_minutes`), and `codex app-server`'s `account/rateLimits/read`.
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
  /** Tokens at which the agent compacts the conversation by itself (its own rule, §6.6 / §6.7). */
  compactAt?: number
  /** Where `compactAt` sits on this reading's 0–100 scale (the bar's mark). */
  compactPercent?: number
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
  'cacheExpiresAt',
  'compactAt',
  'compactPercent'
] as const satisfies readonly (keyof ContextUsage)[]

/** One plan-usage window (5 h, 7 d / weekly, or a weekly limit of one model). */
export interface UsageWindow {
  /** Window length in minutes (300, 10080, …); with `scope`, identifies the window across readings. */
  minutes: number
  /** The model a scoped limit counts (`Sonnet`, `Fable`); absent for the account-wide windows. */
  scope?: string
  /** 0–100. */
  percent: number
  /** Epoch ms; absent when the agent did not say. */
  resetsAt?: number
  /** Percent per hour over the last readings of this period (main · usage-store.ts); absent until there are enough. */
  rate?: number
}

/** The account's plan usage as one vendor last reported it. Account-level: shared by every session of that vendor. */
export interface VendorUsage {
  vendor: UsageVendor
  windows: UsageWindow[]
  /** Epoch ms of the reading. */
  at: number
  /**
   * Every window the account has (the polled account answer). A session's reading only carries the windows its last
   * response named, so windows it leaves out are kept.
   */
  complete?: boolean
}

/** A window's identity across readings. */
export function windowKey(w: Pick<UsageWindow, 'minutes' | 'scope'>): string {
  return w.scope ? `${w.minutes}:${w.scope}` : String(w.minutes)
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

function window(minutes: number, percent: unknown, resetsAt: unknown, scope?: string): UsageWindow | undefined {
  const value = percentOf(percent)
  if (value === undefined) return undefined
  const reset = resetMs(resetsAt) ?? (typeof resetsAt === 'string' ? timeMs(resetsAt) : undefined)
  return { minutes, ...(scope ? { scope } : {}), percent: value, ...(reset !== undefined ? { resetsAt: reset } : {}) }
}

/** What the agent does by itself as the window fills; main resolves it from the launch environment (§6.6). */
export interface AutoCompactRule {
  /** False when the user turned auto-compaction off (`DISABLE_AUTO_COMPACT`, `DISABLE_COMPACT`). */
  enabled: boolean
  /** `CLAUDE_CODE_AUTO_COMPACT_WINDOW`: the window compaction is measured against, capped at the model's. */
  window?: number
  /** `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`: compact at this percent of the effective window instead, if lower. */
  percentOverride?: number
}

const truthy = (value: string | undefined) => value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'

/** `400000`, `400k`, `1m` (Claude's own forms); undefined otherwise. */
function tokenCount(value: string | undefined): number | undefined {
  const match = value?.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([km]?)$/)
  if (!match) return undefined
  const n = Number(match[1]) * (match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

/** The rule as the environment Claude is launched with sets it (Claude Code 2.1.304 reads the same variables). */
export function autoCompactRuleFromEnv(env: Readonly<Record<string, string | undefined>>): AutoCompactRule {
  if (truthy(env.DISABLE_AUTO_COMPACT) || truthy(env.DISABLE_COMPACT)) return { enabled: false }
  const window = tokenCount(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW)
  const pct = env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ? Number.parseFloat(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE) : NaN
  return { enabled: true, ...(window !== undefined ? { window } : {}), ...(Number.isFinite(pct) && pct > 0 && pct <= 100 ? { percentOverride: pct } : {}) }
}

/** Claude Code 2.1.304: room kept for the reply (`min(maxOutputTokens, 20000)`; every current model allows more). */
const CLAUDE_OUTPUT_RESERVE = 20_000
/** Claude Code 2.1.304: the summary buffer below the effective window. */
const CLAUDE_SUMMARY_BUFFER = 13_000

/**
 * Where Claude Code compacts by itself (2.1.304 `nQ` / `WY`, PRD §6.6): `window − 20k − 13k`, i.e. 167k of 200k and
 * 967k of 1M. Null when auto-compaction is off or the window is unknown.
 */
export function claudeCompactAt(contextWindow: number | undefined, rule: AutoCompactRule = { enabled: true }): number | null {
  if (!rule.enabled || contextWindow === undefined || contextWindow <= CLAUDE_OUTPUT_RESERVE + CLAUDE_SUMMARY_BUFFER) return null
  const window = rule.window !== undefined && rule.window > 0 ? Math.min(contextWindow, rule.window) : contextWindow
  const effective = window - CLAUDE_OUTPUT_RESERVE
  const threshold = effective - CLAUDE_SUMMARY_BUFFER
  const pct = rule.percentOverride
  if (pct !== undefined && pct > 0 && pct <= 100) return Math.min(Math.floor(effective * (pct / 100)), threshold)
  return threshold
}

export interface MetaReading {
  /** Null: the agent says it does not know right now (Claude after /compact, until its next response). */
  context?: ContextUsage | null
  usage?: VendorUsage
}

/**
 * Claude Code statusLine JSON (2.1.301–2.1.303, PRD §6.6). `used_percentage` is null before the first API response
 * and `rate_limits` is absent then (and for API-key logins). Never throws.
 */
export function parseClaudeStatusLine(payload: unknown, at: number, rule?: AutoCompactRule): MetaReading {
  if (!isRec(payload)) return {}
  const reading: MetaReading = {}
  const cw = payload.context_window
  if (isRec(cw)) {
    const percent = percentOf(cw.used_percentage)
    // After /compact Claude reports no usage until its next response: the figure from before is no longer true.
    if (percent === undefined && cw.used_percentage === null && cw.current_usage === null) reading.context = null
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
      const compactAt = claudeCompactAt(windowTokens, rule) ?? undefined
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
        cacheExpiresAt: cache?.warm === true ? expires : undefined,
        compactAt,
        compactPercent: compactAt !== undefined && windowTokens ? Math.round((compactAt / windowTokens) * 100) : undefined
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

/** Codex's default `effective_context_window_percent`: `model_context_window` is already this share of the model's. */
const CODEX_EFFECTIVE_PERCENT = 95
/** Codex compacts by itself at this share of the model's raw window (unless `model_auto_compact_token_limit` is lower). */
const CODEX_AUTO_COMPACT_PERCENT = 90

/** Where Codex compacts by itself for a `model_context_window` of `size` (272k model: 258.4k usable, compacts at 244.8k). */
export function codexCompactAt(size: number): number {
  return Math.floor(((size * 100) / CODEX_EFFECTIVE_PERCENT) * (CODEX_AUTO_COMPACT_PERCENT / 100))
}

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
      const compactAt = codexCompactAt(size)
      reading.context = compactContext({
        percent: codexContextPercent(used, size),
        usedTokens: used,
        windowTokens: size,
        cacheRead: cached,
        freshInput: input !== undefined ? Math.max(0, input - (cached ?? 0)) : undefined,
        outputTotal: total ? tokens(total.output_tokens) : undefined,
        compactAt,
        compactPercent: codexContextPercent(compactAt, size)
      })
    }
  }
  const limits = payload.rate_limits
  // A model-specific bucket (`codex_bengalfox`, Spark) can be the last one the headers named; only the plan's own counts.
  if (isRec(limits) && (limits.limit_id === undefined || limits.limit_id === null || limits.limit_id === 'codex')) {
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

/**
 * `codex app-server` · `account/rateLimits/read` (0.48+; 0.142.5 / 0.163 shapes, PRD §6.7):
 * `{ rateLimits, rateLimitsByLimitId: { codex: { primary: { usedPercent, windowDurationMins, resetsAt (s) }, secondary } } }`.
 * Only the plan's own `codex` bucket counts. Null when it names no window.
 */
export function parseCodexAccountRateLimits(result: unknown, at: number): VendorUsage | null {
  if (!isRec(result)) return null
  const byId = isRec(result.rateLimitsByLimitId) ? result.rateLimitsByLimitId : null
  const plain = isRec(result.rateLimits) && (result.rateLimits.limitId === undefined || result.rateLimits.limitId === null || result.rateLimits.limitId === 'codex') ? result.rateLimits : null
  const snapshot = byId && isRec(byId.codex) ? byId.codex : plain
  if (!snapshot) return null
  const windows: UsageWindow[] = []
  for (const raw of [snapshot.primary, snapshot.secondary]) {
    if (!isRec(raw)) continue
    const minutes = tokens(raw.windowDurationMins)
    if (minutes === undefined || minutes <= 0) continue
    const w = window(minutes, raw.usedPercent, raw.resetsAt)
    if (w && !windows.some((x) => x.minutes === w.minutes)) windows.push(w)
  }
  return windows.length > 0 ? { vendor: 'codex', windows: windows.sort((a, b) => a.minutes - b.minutes), at, complete: true } : null
}

const WINDOW_MINUTES: Record<string, number> = { session: 300, weekly: 7 * 24 * 60 }

/**
 * Claude Code's `get_usage` control request answer (2.1.304, experimental; PRD §6.6): `rate_limits.limits[]`
 * (`{ kind: session | weekly_all | weekly_scoped, group, percent, resets_at (ISO), scope: { model: { display_name } } }`),
 * else the older `five_hour` / `seven_day` / `seven_day_opus` / `seven_day_sonnet` (`utilization`, `resets_at`).
 * Scoped weekly limits at 0 % are left out (nothing to say yet). Null without plan limits (API key, gateway).
 */
export function parseClaudeAccountUsage(response: unknown, at: number): VendorUsage | null {
  if (!isRec(response) || !isRec(response.rate_limits)) return null
  const limits = response.rate_limits
  const windows: UsageWindow[] = []
  const add = (w: UsageWindow | undefined) => {
    if (w && !windows.some((x) => windowKey(x) === windowKey(w))) windows.push(w)
  }
  if (Array.isArray(limits.limits) && limits.limits.length > 0) {
    for (const raw of limits.limits) {
      if (!isRec(raw) || typeof raw.kind !== 'string') continue
      const minutes = typeof raw.group === 'string' ? WINDOW_MINUTES[raw.group] : undefined
      if (minutes === undefined) continue
      if (raw.kind === 'session' || raw.kind === 'weekly_all') add(window(minutes, raw.percent, raw.resets_at))
      else if (raw.kind === 'weekly_scoped') {
        const model = isRec(raw.scope) && isRec(raw.scope.model) && typeof raw.scope.model.display_name === 'string' ? raw.scope.model.display_name.trim().slice(0, 30) : ''
        const w = model ? window(minutes, raw.percent, raw.resets_at, model) : undefined
        if (w && w.percent > 0) add(w)
      }
    }
  } else {
    const named: [string, number, string?][] = [
      ['five_hour', 300],
      ['seven_day', 7 * 24 * 60],
      ['seven_day_opus', 7 * 24 * 60, 'Opus'],
      ['seven_day_sonnet', 7 * 24 * 60, 'Sonnet']
    ]
    for (const [key, minutes, scope] of named) {
      const raw = limits[key]
      if (!isRec(raw)) continue
      const w = window(minutes, raw.utilization, raw.resets_at, scope)
      if (w && (!scope || w.percent > 0)) add(w)
    }
  }
  return windows.length > 0 ? { vendor: 'claude', windows: windows.sort((a, b) => a.minutes - b.minutes || (a.scope ? 1 : 0) - (b.scope ? 1 : 0)), at, complete: true } : null
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
      return o !== undefined && o.minutes === w.minutes && o.scope === w.scope && o.percent === w.percent && o.resetsAt === w.resetsAt && o.rate === w.rate
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

/** Popover form: `5 小时`, `7 天`, `7 天 · Sonnet`; Codex calls its 7-day window 每周 (Figma 17 UsagePopover). */
export function windowLabel(vendor: UsageVendor, minutes: number, scope?: string): string {
  const base =
    minutes === 7 * 24 * 60 && vendor === 'codex'
      ? '每周'
      : minutes % (24 * 60) === 0
        ? `${minutes / (24 * 60)} 天`
        : minutes % 60 === 0
          ? `${minutes / 60} 小时`
          : `${minutes} 分钟`
  return scope ? `${base} · ${scope}` : base
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

/** How close to its own compaction an agent starts warning (Claude Code 2.1.304: 20k before the threshold). */
export const COMPACT_WARN_TOKENS = 20_000

/**
 * The context is "high" (heavier figure, /compact offered) where the agent itself starts warning: 20k tokens before
 * it compacts by itself; 80 % when that point is unknown.
 */
export function contextHigh(context: ContextUsage): boolean {
  if (context.compactAt !== undefined && context.usedTokens !== undefined) return context.usedTokens >= context.compactAt - COMPACT_WARN_TOKENS
  return isHigh(context.percent)
}

/** The bar's mark and the trend's target line: where the agent compacts by itself, else 80 %. */
export function contextMark(context: Pick<ContextUsage, 'compactPercent'>): number {
  return context.compactPercent ?? HIGH_PERCENT
}

// ---------------------------------------------------------------------------------------------
// Pace, history and shares (Figma 18)
// ---------------------------------------------------------------------------------------------

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** A projection from the average since the window opened needs at least this much of it behind us. */
export const PACE_MIN_ELAPSED_MS = 15 * MINUTE
/** Below this much used a projection is mostly noise (claude-hud's guard). */
export const PACE_MIN_PERCENT = 10

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

/** How a window is going: how much of its time has passed, and whether the current pace runs out before the reset. */
export interface WindowPace {
  /** 0–1 of the window's time behind us; absent when the reset time is unknown. */
  elapsed?: number
  exhausted: boolean
  /** When the current pace reaches 100 %, if that is before the reset. */
  runsOutAt?: number
  /** What the pace is: the last readings' slope (`recent`) or the average since the window opened. */
  basis?: 'recent' | 'average'
}

/**
 * The pace is the slope of the last readings (`w.rate`, main · usage-store.ts) when there is one — a burst in the last
 * half hour shows at once and a pause stops the alarm — else the average since the window opened. No projection below
 * 10 % used or in the window's first 15 minutes.
 */
export function windowPace(w: UsageWindow, now: number): WindowPace {
  const exhausted = w.percent >= 100
  if (w.resetsAt === undefined) return { exhausted }
  const length = w.minutes * MINUTE
  const start = w.resetsAt - length
  const elapsedMs = Math.min(length, Math.max(0, now - start))
  const pace: WindowPace = { exhausted, elapsed: elapsedMs / length }
  if (exhausted || w.percent < PACE_MIN_PERCENT) return pace
  if (w.rate !== undefined) {
    pace.basis = 'recent'
    if (w.rate > 0) {
      const at = now + ((100 - w.percent) / w.rate) * HOUR
      if (at < w.resetsAt) pace.runsOutAt = Math.round(at)
    }
  } else if (elapsedMs >= PACE_MIN_ELAPSED_MS) {
    pace.basis = 'average'
    const at = now + ((100 - w.percent) / w.percent) * elapsedMs
    if (at < w.resetsAt) pace.runsOutAt = Math.round(at)
  }
  return pace
}

/** UsageChip v2 text: `5h 62%`, `7d Sonnet 84%`, or `5h 用完 · 14:20 恢复` once the window is used up. */
export function usageChipText(w: UsageWindow, now: number): string {
  const name = w.scope ? `${windowShort(w.minutes)} ${w.scope}` : windowShort(w.minutes)
  if (w.percent >= 100) return w.resetsAt !== undefined ? `${name} 用完 · ${formatClock(w.resetsAt, now)} 恢复` : `${name} 用完`
  return `${name} ${w.percent}%`
}

/** UsageWindowBlock's last line. */
export function paceNote(w: UsageWindow, now: number): string {
  const pace = windowPace(w, now)
  if (pace.exhausted) return w.resetsAt !== undefined ? `已用完 · 还有 ${formatDuration(w.resetsAt - now)}恢复` : '已用完'
  if (pace.elapsed === undefined) return ''
  const elapsed = `时间过了 ${Math.round(pace.elapsed * 100)}%`
  const speed = pace.basis === 'recent' ? '按最近的速度' : '按这个速度'
  if (pace.runsOutAt !== undefined) return `${elapsed}，用得比时间快 · ${speed}约 ${formatClock(pace.runsOutAt, now)} 用完`
  if (pace.basis === undefined) return elapsed
  return `${elapsed} · ${speed}用得完`
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
  scope?: string
  percent: number
  level: UsageAlertLevel
  resetsAt?: number
}

/** The system notification for an alert. */
export function usageAlertText(alert: UsageAlert, now: number): { title: string; body: string } {
  // A model name ends in Latin letters, which take a space before the Chinese that follows.
  const name = `${VENDOR_LABEL[alert.vendor]} ${windowLabel(alert.vendor, alert.minutes, alert.scope)}${alert.scope ? ' ' : ''}额度`
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

/**
 * "大约 N 轮后…" from the average growth of the last few turns since the last compaction. With `compactPercent` the
 * target is where the agent compacts by itself, else 80 % and then 100 %.
 */
export function contextProjection(segment: readonly number[], options: { minTurns?: number; lookback?: number; compactPercent?: number } = {}): string | null {
  const minTurns = options.minTurns ?? 3
  const lookback = options.lookback ?? 5
  if (segment.length < minTurns) return null
  const recent = segment.slice(-(lookback + 1))
  const turns = recent.length - 1
  const growth = (recent[recent.length - 1]! - recent[0]!) / turns
  if (growth < 0.5) return null
  const current = recent[recent.length - 1]!
  const compact = options.compactPercent
  if (compact !== undefined && current >= compact) return null
  const target = compact ?? (current < HIGH_PERCENT ? HIGH_PERCENT : 100)
  const n = (target - current) / growth
  if (n > 30) return null
  const lo = Math.max(1, Math.floor(n))
  const hi = Math.max(1, Math.ceil(n))
  const span = lo === hi ? `${lo}` : `${lo}–${hi}`
  const what = compact !== undefined ? '自动压缩' : target === 100 ? '用满' : '超过 80%'
  return `按最近 ${turns} 轮的增速，大约 ${span} 轮后${what}`
}

/** SVG geometry for the ContextPopover sparkline: one path per segment, gaps marked where it was compacted. */
export function sparkline(
  segments: readonly (readonly number[])[],
  width: number,
  height: number,
  guidePercent: number = HIGH_PERCENT
): { paths: string[]; breaks: number[]; last: { x: number; y: number } | null; guideY: number } {
  const total = segments.reduce((n, s) => n + s.length, 0)
  const guideY = Math.round((height - (guidePercent / 100) * height) * 10) / 10
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

/** What one session spent in a window, in input-token equivalents at its vendor's API prices (main · transcript-meter.ts). */
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
  const live = liveWindows(usage, now).filter((w) => w.resetsAt !== undefined && !w.scope)
  return live.sort((a, b) => a.minutes - b.minutes)[0] ?? null
}

/** `$3.42`, `$0.08`, `$128`. */
export function formatUsd(value: number): string {
  return value >= 100 ? `$${Math.round(value)}` : `$${value.toFixed(2)}`
}
