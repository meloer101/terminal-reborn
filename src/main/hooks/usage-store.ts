// The account's plan usage per vendor (PRD F11). Any session's reading is the whole account's, so it goes to every
// window, and it is kept in `<userData>/plan-usage.json` so a header can show it before a new session's first turn
// (and after a restart). Electron-free: the glue supplies the broadcast and the file.
import { sameUsage, usageAlertLevel, type UsageAlert, type UsageAlertLevel, type UsageVendor, type UsageWindow, type VendorUsage } from '@shared/session-meta'

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
  resetsAt?: number
  level: UsageAlertLevel
}

export function parseStoredMarks(raw: unknown): AlertMark[] {
  if (!Array.isArray(raw)) return []
  const out: AlertMark[] = []
  for (const m of raw) {
    if (!isRec(m) || typeof m.vendor !== 'string' || !VENDORS.has(m.vendor) || !finite(m.minutes) || ![75, 90, 100].includes(m.level as number)) continue
    out.push({ vendor: m.vendor as UsageVendor, minutes: m.minutes, level: m.level as UsageAlertLevel, ...(finite(m.resetsAt) ? { resetsAt: m.resetsAt } : {}) })
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
  return { vendor, minutes: w.minutes, percent: w.percent, level, ...(w.resetsAt !== undefined ? { resetsAt: w.resetsAt } : {}) }
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
      windows.push({ minutes: w.minutes, percent: w.percent, ...(finite(w.resetsAt) ? { resetsAt: w.resetsAt } : {}) })
    }
    if (windows.length > 0 && !out.some((u) => u.vendor === item.vendor)) out.push({ vendor: item.vendor as UsageVendor, at: item.at, windows })
  }
  return out
}

export class UsageStore {
  private readonly byVendor = new Map<UsageVendor, VendorUsage>()
  private readonly marks = new Map<string, AlertMark>()

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
      for (const mark of parseStoredMarks(io.loadMarks?.())) this.marks.set(`${mark.vendor}:${mark.minutes}`, mark)
    } catch {
      // Unreadable: at worst one level is announced again.
    }
  }

  list(): VendorUsage[] {
    return [...this.byVendor.values()]
  }

  /** A new reading from a session. Older readings than the one held are ignored (sessions report out of order). */
  update(usage: VendorUsage): void {
    const held = this.byVendor.get(usage.vendor)
    if (held && usage.at < held.at) return
    this.checkAlerts(usage)
    if (held && sameUsage(held, usage) && usage.at - held.at < UNCHANGED_REFRESH_MS) return
    this.byVendor.set(usage.vendor, usage)
    this.io.broadcast(usage)
    this.io.save(this.list())
  }

  private checkAlerts(usage: VendorUsage): void {
    if (!this.io.alert) return
    const now = this.io.now?.() ?? Date.now()
    if (now - usage.at > ALERT_FRESH_MS) return
    let changed = false
    for (const w of usage.windows) {
      if (w.resetsAt !== undefined && w.resetsAt <= now) continue
      const key = `${usage.vendor}:${w.minutes}`
      const alert = crossedAlert(usage.vendor, w, this.marks.get(key))
      if (!alert) continue
      this.marks.set(key, { vendor: usage.vendor, minutes: w.minutes, level: alert.level, ...(w.resetsAt !== undefined ? { resetsAt: w.resetsAt } : {}) })
      changed = true
      this.io.alert(alert)
    }
    if (changed) this.io.saveMarks?.([...this.marks.values()])
  }
}
