// How many mouse-wheel reports a wheel event becomes while a full-screen program (Claude Code, vim, less)
// has mouse tracking on.
//
// Adapted from Orca (https://github.com/stablyai/orca, src/renderer/src/lib/pane-manager/
// pane-terminal-tui-wheel-reports.ts), MIT License, Copyright (c) 2026 Lovecast Inc.
//
// xterm 6.0 turns one wheel event into at most one report, and damps small trackpad deltas by 0.3 first, so a
// full-screen agent scrolls a fraction of the distance the fingers moved and feels sticky. Here a trackpad
// sends reports in proportion to the rows of physical distance (remainder carried), and a notched mouse wheel gets
// log-compressed distance plus a bonus for fast bursts.

const DOM_DELTA_PIXEL = 0
const DOM_DELTA_LINE = 1
const DOM_DELTA_PAGE = 2
/** Pixel deltas this large come from a notched wheel, not a trackpad. */
const DISCRETE_PIXEL_DELTA_MIN = 50
const LEGACY_WHEEL_DELTA_MIN = 100
const LEGACY_WHEEL_DELTA_UNIT = 120
const DEFAULT_CELL_HEIGHT = 16
const DISTANCE_GAIN = 1.6
const MAX_COMPRESSED_ROWS = 6
const BURST_FULL_INTERVAL_MS = 16
const BURST_MAX_INTERVAL_MS = 45
const BURST_MAX_BONUS_ROWS = 2
const BURST_RAMP_EVENTS = 4
const MOMENTUM_TAIL_RATIO = 0.85
const MAX_BURST_ROWS = 9
/**
 * Reports per row of trackpad distance. Below 1 because Claude Code roughly doubles the lines per report when
 * reports arrive densely (measured: 10 reports in one burst → ~19 lines), which felt a little too fast at 1.
 */
const TRACKPAD_GAIN = 0.7

export interface WheelInput {
  deltaY: number
  deltaMode?: number
  timeStamp?: number
  /** Chromium's legacy wheelDeltaY: ±120 per notch for a mouse wheel. */
  wheelDeltaY?: number
}

export interface WheelMetrics {
  cellHeight?: number
  rows?: number
}

export interface WheelState {
  direction: -1 | 0 | 1
  pendingRows: number
  fastStreak: number
  lastRows: number | null
  lastAt: number | null
}

export function createWheelState(): WheelState {
  return { direction: 0, pendingRows: 0, fastStreak: 0, lastRows: null, lastAt: null }
}

function legacyDelta(event: WheelInput): number | null {
  return typeof event.wheelDeltaY === 'number' && Number.isFinite(event.wheelDeltaY) ? event.wheelDeltaY : null
}

function hasNotchedLegacyDelta(event: WheelInput): boolean {
  const legacy = legacyDelta(event)
  return legacy !== null && Math.abs(legacy) >= LEGACY_WHEEL_DELTA_MIN
}

function isPixel(event: WheelInput): boolean {
  return (event.deltaMode ?? DOM_DELTA_PIXEL) === DOM_DELTA_PIXEL
}

/** A notched mouse wheel (as opposed to a trackpad's continuous pixel stream). */
export function isDiscreteWheel(event: WheelInput): boolean {
  return !isPixel(event) || Math.abs(event.deltaY) >= DISCRETE_PIXEL_DELTA_MIN || hasNotchedLegacyDelta(event)
}

function distanceRows(event: WheelInput, metrics: WheelMetrics): number {
  const deltaY = Math.abs(event.deltaY)
  const mode = event.deltaMode ?? DOM_DELTA_PIXEL
  const cellHeight = metrics.cellHeight && Number.isFinite(metrics.cellHeight) && metrics.cellHeight > 0 ? metrics.cellHeight : DEFAULT_CELL_HEIGHT
  const fromDelta =
    mode === DOM_DELTA_LINE ? deltaY : mode === DOM_DELTA_PAGE ? deltaY * Math.max(1, metrics.rows ?? 1) : deltaY / cellHeight
  const legacy = legacyDelta(event)
  const rows = Math.max(fromDelta, legacy === null ? 0 : Math.abs(legacy) / LEGACY_WHEEL_DELTA_UNIT)
  return isDiscreteWheel(event) ? Math.max(1, rows) : rows
}

function compress(rows: number): number {
  return rows <= 1 ? rows : Math.min(MAX_COMPRESSED_ROWS, 1 + Math.log2(rows) * DISTANCE_GAIN)
}

function resetBurst(state: WheelState): void {
  state.fastStreak = 0
  state.lastRows = null
  state.lastAt = null
}

/** Extra rows for wheel notches that arrive in quick succession (a flick), fading out as they slow. */
function burstBonus(event: WheelInput, state: WheelState, rows: number): number {
  const at = typeof event.timeStamp === 'number' && Number.isFinite(event.timeStamp) ? event.timeStamp : null
  if ((isPixel(event) && !hasNotchedLegacyDelta(event)) || at === null) {
    resetBurst(state)
    return 0
  }
  const elapsed = state.lastAt === null ? null : at - state.lastAt
  const momentumTail = state.lastRows !== null && rows < state.lastRows * MOMENTUM_TAIL_RATIO
  state.lastRows = rows
  state.lastAt = at
  if (momentumTail || elapsed === null || elapsed < 0 || elapsed > BURST_MAX_INTERVAL_MS) {
    state.fastStreak = 0
    return 0
  }
  const cadence =
    elapsed <= BURST_FULL_INTERVAL_MS ? 1 : (BURST_MAX_INTERVAL_MS - elapsed) / (BURST_MAX_INTERVAL_MS - BURST_FULL_INTERVAL_MS)
  state.fastStreak = Math.min(BURST_RAMP_EVENTS, state.fastStreak + 1)
  return BURST_MAX_BONUS_ROWS * cadence * (state.fastStreak / BURST_RAMP_EVENTS)
}

/** Number of wheel reports (each one row in the program) this event should send. Mutates `state`. */
export function wheelReportCount(event: WheelInput, state: WheelState, metrics: WheelMetrics = {}): number {
  if (event.deltaY === 0) return 0
  const direction = event.deltaY < 0 ? -1 : 1
  if (state.direction !== 0 && state.direction !== direction) {
    resetBurst(state)
    state.pendingRows = 0
  }
  state.direction = direction

  const rows = distanceRows(event, metrics)
  // Trackpad: proportional to physical distance, no cap, so momentum scrolling stays real-time.
  const scaled = isDiscreteWheel(event) ? Math.min(MAX_BURST_ROWS, compress(rows) + burstBonus(event, state, rows)) : rows * TRACKPAD_GAIN
  const total = state.pendingRows + scaled
  const reports = Math.trunc(total)
  state.pendingRows = total - reports
  return reports
}
