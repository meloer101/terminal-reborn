// The account's plan usage per vendor (PRD F11). Any session's reading is the whole account's, so it goes to every
// window, and it is kept in `<userData>/plan-usage.json` so a header can show it before a new session's first turn
// (and after a restart). Electron-free: the glue supplies the broadcast and the file.
import { sameUsage, type UsageVendor, type UsageWindow, type VendorUsage } from '@shared/session-meta'

/** The same figures again are passed on at most this often (they refresh the popover's "N 分钟前更新"). */
export const UNCHANGED_REFRESH_MS = 60_000

const VENDORS: ReadonlySet<string> = new Set<UsageVendor>(['claude', 'codex'])

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

  constructor(
    private readonly io: {
      load(): unknown
      save(usage: VendorUsage[]): void
      broadcast(usage: VendorUsage): void
    }
  ) {
    try {
      for (const usage of parseStoredUsage(io.load())) this.byVendor.set(usage.vendor, usage)
    } catch {
      // Unreadable: start empty; the next reading rewrites it.
    }
  }

  list(): VendorUsage[] {
    return [...this.byVendor.values()]
  }

  /** A new reading from a session. Older readings than the one held are ignored (sessions report out of order). */
  update(usage: VendorUsage): void {
    const held = this.byVendor.get(usage.vendor)
    if (held && usage.at < held.at) return
    if (held && sameUsage(held, usage) && usage.at - held.at < UNCHANGED_REFRESH_MS) return
    this.byVendor.set(usage.vendor, usage)
    this.io.broadcast(usage)
    this.io.save(this.list())
  }
}
