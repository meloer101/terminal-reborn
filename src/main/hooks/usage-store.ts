// The account's plan usage per vendor (PRD F11). Any session's reading is the whole account's, so it goes to every
// window, and it is kept in `<userData>/plan-usage.json` so a header can show it before a new session's first turn
// (and after a restart). Electron-free: the glue supplies the broadcast and the file.
// Readings come from several places that see the account at different moments — every session's statusLine or rollout
// (whatever its last response said) and the polled account answer (./plan-usage-poller.ts) — so they are merged per
// window: within one period usage only grows, so the higher figure is the newer one; a later reset time is a new period.
import {
  sameUsage,
  usageAlertLevel,
  windowKey,
  type UsageAlert,
  type UsageAlertLevel,
  type UsageVendor,
  type UsageWindow,
  type VendorUsage
} from '@shared/session-meta'

/** The same figures again are passed on at most this often (they refresh the popover's "N 分钟前更新"). */
export const UNCHANGED_REFRESH_MS = 60_000

const VENDORS: ReadonlySet<string> = new Set<UsageVendor>(['claude', 'codex'])

/** Readings older than this (a replayed log, a stale file) never raise an alert. */
export const ALERT_FRESH_MS = 10 * 60_000
/** Two readings of one window whose reset times differ by less than this are the same period. */
const SAME_PERIOD_MS = 10 * 60_000

/** The highest level already announced for a window's current period. */
export interface AlertMark {
  vendor: UsageVendor
  minutes: number
  scope?: string
  resetsAt?: number
  level: UsageAlertLevel
}

const scopeOf = (value: unknown): { scope?: string } => (typeof value === 'string' && value.length > 0 && value.length <= 30 ? { scope: value } : {})

export function parseStoredMarks(raw: unknown): AlertMark[] {
  if (!Array.isArray(raw)) return []
  const out: AlertMark[] = []
  for (const m of raw) {
    if (!isRec(m) || typeof m.vendor !== 'string' || !VENDORS.has(m.vendor) || !finite(m.minutes) || ![75, 90, 100].includes(m.level as number)) continue
    out.push({
      vendor: m.vendor as UsageVendor,
      minutes: m.minutes,
      ...scopeOf(m.scope),
      level: m.level as UsageAlertLevel,
      ...(finite(m.resetsAt) ? { resetsAt: m.resetsAt } : {})
    })
  }
  return out
}

const samePeriod = (a: number | undefined, b: number | undefined) => a === b || (a !== undefined && b !== undefined && Math.abs(a - b) < SAME_PERIOD_MS)

/** The alert a window's new reading raises, if it crossed a level not yet announced this period. */
export function crossedAlert(vendor: UsageVendor, w: UsageWindow, mark: AlertMark | undefined): UsageAlert | null {
  const level = usageAlertLevel(w.percent)
  if (level === 0) return null
  const announced = mark && samePeriod(mark.resetsAt, w.resetsAt) ? mark.level : 0
  if (level <= announced) return null
  return { vendor, minutes: w.minutes, ...(w.scope ? { scope: w.scope } : {}), percent: w.percent, level, ...(w.resetsAt !== undefined ? { resetsAt: w.resetsAt } : {}) }
}

/** One window from two readings of it. */
function mergeWindow(held: UsageWindow, next: UsageWindow, nextIsNewer: boolean): UsageWindow {
  if (held.resetsAt === undefined || next.resetsAt === undefined) return nextIsNewer ? next : held
  if (samePeriod(held.resetsAt, next.resetsAt)) {
    // A reader that has not heard of the latest use (an idle session, a cached answer) reports less, never more.
    const top = next.percent >= held.percent ? next : held
    return { ...top, resetsAt: Math.max(held.resetsAt, next.resetsAt) }
  }
  // A later reset is a newer period (also when the provider resets a window early); an earlier one is an old reading.
  return next.resetsAt > held.resetsAt ? next : held
}

/**
 * The account as it stands after `next`. A complete reading (the polled account answer) names every window there is,
 * so windows it leaves out are gone; a session's reading only names some, so the others are kept.
 */
export function mergeUsage(held: VendorUsage | undefined, next: VendorUsage): VendorUsage {
  if (!held) return { vendor: next.vendor, at: next.at, windows: next.windows.map(stripRate) }
  const nextIsNewer = next.at >= held.at
  const heldByKey = new Map(held.windows.map((w) => [windowKey(w), w]))
  const windows: UsageWindow[] = []
  for (const w of next.windows) {
    const h = heldByKey.get(windowKey(w))
    windows.push(stripRate(h ? mergeWindow(h, w, nextIsNewer) : w))
    heldByKey.delete(windowKey(w))
  }
  if (!next.complete) for (const h of heldByKey.values()) windows.push(stripRate(h))
  windows.sort((a, b) => a.minutes - b.minutes || (a.scope ?? '').localeCompare(b.scope ?? ''))
  return { vendor: next.vendor, at: Math.max(held.at, next.at), windows }
}

function stripRate(w: UsageWindow): UsageWindow {
  if (w.rate === undefined) return w
  const { rate: _rate, ...rest } = w
  return rest
}

/** The pace is the slope over this much of the latest readings… */
export const RATE_LOOKBACK_MS = 60 * 60_000
/** …and needs readings at least this far apart (a 5-minute poll gives three). */
export const RATE_MIN_SPAN_MS = 15 * 60_000

interface Sample {
  at: number
  percent: number
}

/** Percent per hour from one period's samples, measured back from the newest; undefined when they span too little. */
export function recentRate(samples: readonly Sample[]): number | undefined {
  const newest = samples[samples.length - 1]
  if (!newest) return undefined
  // The last sample before the lookback anchors its start, so a quiet hour still counts as a slope of 0.
  let first = samples.findIndex((x) => x.at >= newest.at - RATE_LOOKBACK_MS)
  if (first > 0) first--
  const oldest = samples[Math.max(0, first)]!
  const span = newest.at - oldest.at
  if (span < RATE_MIN_SPAN_MS) return undefined
  return Math.round(((Math.max(0, newest.percent - oldest.percent) / span) * 3_600_000) * 10) / 10
}

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** What a stored file may say; anything else is dropped. */
export function parseStoredUsage(raw: unknown): VendorUsage[] {
  if (!Array.isArray(raw)) return []
  const out: VendorUsage[] = []
  for (const item of raw) {
    if (!isRec(item) || typeof item.vendor !== 'string' || !VENDORS.has(item.vendor) || !finite(item.at) || !Array.isArray(item.windows)) continue
    const windows: UsageWindow[] = []
    for (const w of item.windows) {
      if (!isRec(w) || !finite(w.minutes) || w.minutes <= 0 || !finite(w.percent) || w.percent < 0 || w.percent > 100) continue
      windows.push({ minutes: w.minutes, ...scopeOf(w.scope), percent: w.percent, ...(finite(w.resetsAt) ? { resetsAt: w.resetsAt } : {}) })
    }
    if (windows.length > 0 && !out.some((u) => u.vendor === item.vendor)) out.push({ vendor: item.vendor as UsageVendor, at: item.at, windows })
  }
  return out
}

export class UsageStore {
  private readonly byVendor = new Map<UsageVendor, VendorUsage>()
  private readonly marks = new Map<string, AlertMark>()
  /** Per vendor and window: the current period's readings, for the pace (memory only; a restart starts over). */
  private readonly samples = new Map<string, { period: number | undefined; points: Sample[] }>()

  constructor(
    private readonly io: {
      load(): unknown
      save(usage: VendorUsage[]): void
      broadcast(usage: VendorUsage): void
      /** Alert bookkeeping (so a restart does not announce the same level again). */
      loadMarks?(): unknown
      saveMarks?(marks: AlertMark[]): void
      alert?(alert: UsageAlert): void
      now?(): number
    }
  ) {
    try {
      for (const usage of parseStoredUsage(io.load())) this.byVendor.set(usage.vendor, usage)
    } catch {
      // Unreadable: start empty; the next reading rewrites it.
    }
    try {
      for (const mark of parseStoredMarks(io.loadMarks?.())) this.marks.set(`${mark.vendor}:${windowKey(mark)}`, mark)
    } catch {
      // Unreadable: at worst one level is announced again.
    }
  }

  list(): VendorUsage[] {
    return [...this.byVendor.values()]
  }

  /** A new reading from a session or the poller, merged into what is held (sessions report out of order). */
  update(usage: VendorUsage): void {
    const held = this.byVendor.get(usage.vendor)
    const merged = this.withRates(mergeUsage(held, usage), usage)
    this.checkAlerts(merged, usage.at)
    if (held && sameUsage(held, merged) && merged.at - held.at < UNCHANGED_REFRESH_MS) return
    this.byVendor.set(usage.vendor, merged)
    this.io.broadcast(merged)
    this.io.save(this.list().map((u) => ({ ...u, windows: u.windows.map(stripRate) })))
  }

  /** Records the windows the reading named (at the reading's time) and attaches each window's recent pace. */
  private withRates(merged: VendorUsage, reading: VendorUsage): VendorUsage {
    const named = new Set(reading.windows.map(windowKey))
    const windows = merged.windows.map((w) => {
      const key = `${merged.vendor}:${windowKey(w)}`
      let list = this.samples.get(key)
      // A new period starts its own samples.
      if (!list || (w.resetsAt !== undefined && list.period !== undefined && !samePeriod(list.period, w.resetsAt))) list = { period: w.resetsAt, points: [] }
      if (named.has(windowKey(w))) {
        const prev = list.points[list.points.length - 1]
        const at = Math.max(reading.at, prev?.at ?? 0)
        if (!prev || prev.percent !== w.percent || at - prev.at >= 60_000) list.points.push({ at, percent: w.percent })
        list.points = list.points.filter((x) => x.at >= at - 2 * RATE_LOOKBACK_MS)
      }
      this.samples.set(key, list)
      const rate = recentRate(list.points)
      return rate === undefined ? w : { ...w, rate }
    })
    return { ...merged, windows }
  }

  private checkAlerts(usage: VendorUsage, readAt: number): void {
    if (!this.io.alert) return
    const now = this.io.now?.() ?? Date.now()
    if (now - readAt > ALERT_FRESH_MS) return
    let changed = false
    for (const w of usage.windows) {
      if (w.resetsAt !== undefined && w.resetsAt <= now) continue
      const key = `${usage.vendor}:${windowKey(w)}`
      const alert = crossedAlert(usage.vendor, w, this.marks.get(key))
      if (!alert) continue
      this.marks.set(key, {
        vendor: usage.vendor,
        minutes: w.minutes,
        ...(w.scope ? { scope: w.scope } : {}),
        level: alert.level,
        ...(w.resetsAt !== undefined ? { resetsAt: w.resetsAt } : {})
      })
      changed = true
      this.io.alert(alert)
    }
    if (changed) this.io.saveMarks?.([...this.marks.values()])
  }
}
