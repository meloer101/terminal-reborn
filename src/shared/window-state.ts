// Window bounds persistence (phase 2 · A12). Pure: main reads/writes the file and supplies the displays.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowState {
  /** Position and size of the normal (not maximized / full-screen) window. */
  bounds: Rect
  maximized: boolean
  fullScreen: boolean
}

/** What to restore: position is omitted when the saved one is no longer on a display. */
export interface RestoredWindowState {
  bounds: Pick<Rect, 'width' | 'height'> & Partial<Pick<Rect, 'x' | 'y'>>
  maximized: boolean
  fullScreen: boolean
}

export interface WindowLimits {
  minWidth: number
  minHeight: number
}

/** The part of the window that must stay on a display for it to count as reachable. */
const MIN_VISIBLE = { width: 120, height: 60 }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/**
 * Validates a saved window state against the displays that exist now. Returns null when nothing usable was
 * saved. A window that no longer lands on any display (a monitor was unplugged) keeps its size but loses its
 * position, so the caller lets the OS place it.
 */
export function sanitizeWindowState(
  raw: unknown,
  workAreas: readonly Rect[],
  limits: WindowLimits
): RestoredWindowState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const b = typeof v.bounds === 'object' && v.bounds !== null ? (v.bounds as Record<string, unknown>) : null
  if (!b || !isNum(b.width) || !isNum(b.height)) return null

  const largest = workAreas.reduce((max, a) => (a.width * a.height > max.width * max.height ? a : max), workAreas[0] ?? { x: 0, y: 0, width: 1e5, height: 1e5 })
  const width = Math.min(Math.max(Math.round(b.width), limits.minWidth), largest.width)
  const height = Math.min(Math.max(Math.round(b.height), limits.minHeight), largest.height)

  const maximized = v.maximized === true
  const fullScreen = v.fullScreen === true
  const base = { maximized, fullScreen }

  if (!isNum(b.x) || !isNum(b.y)) return { ...base, bounds: { width, height } }
  const placed: Rect = { x: Math.round(b.x), y: Math.round(b.y), width, height }
  const reachable = workAreas.some((area) => {
    const o = overlap(placed, area)
    return o.width >= Math.min(MIN_VISIBLE.width, width) && o.height >= Math.min(MIN_VISIBLE.height, height)
  })
  return { ...base, bounds: reachable ? placed : { width, height } }
}
