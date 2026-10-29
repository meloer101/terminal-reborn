// The sidebar's selection drops (Figma 37): one glass block per session the window shows. When a pane shows another
// session its block travels there, each edge on its own spring — the edge in front is stiff, the one behind soft — so it
// stretches on the way, lands a little squashed and settles (37A). A new pane's block drips onto its row and spreads; a
// closed pane's shrinks back to a bead and evaporates (37B). Pure maths; SelectionDrops draws it.

export interface Spring {
  x: number
  v: number
  target: number
  /** Stiffness and damping, per second. */
  k: number
  c: number
}

/** The edge in the direction of travel. */
export const LEAD = { k: 520, c: 34 } as const
/** The edge behind it. */
export const TRAIL = { k: 170, c: 20 } as const

const REST_RADIUS = 10

export function spring(x: number): Spring {
  return { x, v: 0, target: x, k: LEAD.k, c: LEAD.c }
}

/** Advances one spring by `dt` seconds (semi-implicit Euler; callers keep dt small). */
export function step(s: Spring, dt: number): void {
  const a = -s.k * (s.x - s.target) - s.c * s.v
  s.v += a * dt
  s.x += s.v * dt
}

/** Points both edges at a row; the leading edge gets the stiff spring. */
export function aim(upper: Spring, lower: Spring, top: number, bottom: number): void {
  // Re-aiming at the same row mid-flight keeps the springs as they are.
  if (top === upper.target && bottom === lower.target) return
  const down = top > upper.target
  Object.assign(upper, down ? TRAIL : LEAD, { target: top })
  Object.assign(lower, down ? LEAD : TRAIL, { target: bottom })
}

export function settled(upper: Spring, lower: Spring): boolean {
  const speed = Math.abs(upper.v) + Math.abs(lower.v)
  const off = Math.abs(upper.x - upper.target) + Math.abs(lower.x - lower.target)
  return speed < 2 && off < 0.3
}

export interface DropShape {
  top: number
  height: number
  /** Taken off each side: positive while stretched (thinner), negative while squashed (wider). */
  inset: number
  radius: number
}

/** The block's shape for its two edges; it keeps roughly its volume — longer is thinner, squashed is wider. */
export function shape(upper: Spring, lower: Spring): DropShape {
  const height = Math.max(8, lower.x - upper.x)
  const rest = Math.max(1, lower.target - upper.target)
  const stretch = height / rest
  const pinch = Math.min(10, Math.max(0, (stretch - 1) * 14))
  const bulge = Math.min(4, Math.max(0, (1 - stretch) * 30))
  return { top: upper.x, height, inset: pinch - bulge, radius: Math.min(height / 2, REST_RADIUS + pinch * 1.4) }
}

// ---------------------------------------------------------------------------------------------
// One block's life (Figma 37B): drip in, rest, flow, evaporate
// ---------------------------------------------------------------------------------------------

/** A row's box in the session list. */
export interface RowBox {
  top: number
  height: number
  left: number
  width: number
}

export interface DropFrame {
  left: number
  top: number
  width: number
  height: number
  radius: number
  opacity: number
}

/** The bead appears this far above the row's centre and falls onto it. */
export const FALL_FROM = 46
/** Seconds the fall takes (accelerating, as under gravity). */
export const FALL_TIME = 0.2
/** Seconds a closed pane's bead takes to fade. */
export const EVAPORATE_TIME = 0.32
/** How far past the row the spreading block may reach on each side. */
const SPREAD_OVERSHOOT = 4

export type DropState =
  | { phase: 'fall'; t: number; row: RowBox }
  | { phase: 'spread'; w: Spring; h: Spring; dip: Spring; row: RowBox }
  | { phase: 'flow'; upper: Spring; lower: Spring; row: RowBox }
  | { phase: 'rest'; row: RowBox }
  | { phase: 'evaporate'; t: number; w: Spring; h: Spring; row: RowBox }
  | { phase: 'gone'; row: RowBox }

const tuned = (x: number, k: number, c: number, target = x): Spring => ({ x, v: 0, target, k, c })

export const restAt = (row: RowBox): DropState => ({ phase: 'rest', row })
export const dripOnto = (row: RowBox): DropState => ({ phase: 'fall', t: 0, row })

/** The pane now shows the session at `row`: a resting or flowing block travels; one still dripping spreads there instead. */
export function flowTo(state: DropState, row: RowBox): DropState {
  if (state.phase === 'rest' || state.phase === 'flow') {
    const upper = state.phase === 'flow' ? state.upper : spring(state.row.top)
    const lower = state.phase === 'flow' ? state.lower : spring(state.row.top + state.row.height)
    aim(upper, lower, row.top, row.top + row.height)
    return { phase: 'flow', upper, lower, row }
  }
  if (state.phase === 'spread') {
    state.w.target = row.width
    state.h.target = row.height
  }
  return { ...state, row } as DropState
}

/** The block's row moved with the layout (a resize, a project folding above it). */
export function follow(state: DropState, row: RowBox): DropState {
  if (state.phase === 'rest') return { phase: 'rest', row }
  if (state.phase === 'flow') {
    aim(state.upper, state.lower, row.top, row.top + row.height)
    return { ...state, row }
  }
  return { ...state, row } as DropState
}

/** The pane closed: shrink to a bead from wherever the block is now, rise a little and fade. */
export function evaporate(state: DropState): DropState {
  const f = frameOf(state)
  if (!f) return { phase: 'gone', row: state.row }
  const row = { top: f.top, height: f.height, left: f.left, width: f.width }
  return { phase: 'evaporate', t: 0, w: tuned(f.width, 260, 22, 10), h: tuned(f.height, 300, 24, 10), row }
}

export const moving = (state: DropState): boolean => state.phase !== 'rest' && state.phase !== 'gone'

/** Advances a block by `dt` seconds (keep dt at a few ms; callers substep a frame). */
export function advance(state: DropState, dt: number): DropState {
  switch (state.phase) {
    case 'fall': {
      const t = state.t + dt
      if (t < FALL_TIME) return { ...state, t }
      // Landed: the bead, already a little long from falling, spreads into the row with a dip and an overshoot.
      const h = tuned(20, 380, 22, state.row.height)
      h.v = -40
      return { phase: 'spread', w: tuned(10, 300, 20, state.row.width), h, dip: tuned(4, 260, 18, 0), row: state.row }
    }
    case 'spread':
      step(state.w, dt)
      step(state.h, dt)
      step(state.dip, dt)
      return settled(state.w, state.h) && Math.abs(state.dip.x) + Math.abs(state.dip.v) < 0.3 ? restAt(state.row) : state
    case 'flow':
      step(state.upper, dt)
      step(state.lower, dt)
      return settled(state.upper, state.lower) ? restAt(state.row) : state
    case 'evaporate': {
      step(state.w, dt)
      step(state.h, dt)
      const t = state.t + dt
      return t >= EVAPORATE_TIME ? { phase: 'gone', row: state.row } : { ...state, t }
    }
    default:
      return state
  }
}

/** Where and how the block is drawn now; null once it has evaporated. */
export function frameOf(state: DropState): DropFrame | null {
  const { row } = state
  const cx = row.left + row.width / 2
  const cy = row.top + row.height / 2
  switch (state.phase) {
    case 'rest':
      return { left: row.left, top: row.top, width: row.width, height: row.height, radius: REST_RADIUS, opacity: 1 }
    case 'fall': {
      const p = Math.min(1, state.t / FALL_TIME)
      const width = 12 - 2 * p
      const height = 14 + 6 * p
      const y = cy - FALL_FROM + FALL_FROM * p * p
      return { left: cx - width / 2, top: y - height / 2, width, height, radius: width / 2, opacity: Math.min(1, state.t / 0.06) }
    }
    case 'spread': {
      const width = Math.min(row.width + 2 * SPREAD_OVERSHOOT, Math.max(8, state.w.x))
      const height = Math.max(8, state.h.x)
      // Round while it is a bead, the row's corner once it has spread out.
      const radius = Math.min(height / 2, width / 2, REST_RADIUS + Math.max(0, 40 - (width - 20)) * 0.4)
      return { left: cx - width / 2, top: cy - height / 2 + state.dip.x, width, height, radius, opacity: 1 }
    }
    case 'flow': {
      const f = shape(state.upper, state.lower)
      return { left: row.left + f.inset, top: f.top, width: row.width - 2 * f.inset, height: f.height, radius: f.radius, opacity: 1 }
    }
    case 'evaporate': {
      const width = Math.max(2, state.w.x)
      const height = Math.max(2, state.h.x)
      return { left: cx - width / 2, top: cy - height / 2 - state.t * 30, width, height, radius: Math.min(width, height) / 2, opacity: Math.max(0, 1 - state.t / EVAPORATE_TIME) }
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------------------------
// Which block does what when the window's panes change
// ---------------------------------------------------------------------------------------------

export interface DropChanges {
  /** A pane that now shows another session: its block flows from `from` to `to`. */
  flow: Array<{ from: string; to: string }>
  /** A new pane. */
  drip: string[]
  /** A closed pane. */
  evaporate: string[]
}

/**
 * Panes are known by the session they show (PRD F20), so a pane that switched sessions looks like one session gone
 * and one new: those pair up, in order, and flow; what is left over dripped in or evaporated.
 */
export function changes(before: readonly string[], after: readonly string[]): DropChanges {
  const gone = before.filter((id) => !after.includes(id))
  const added = after.filter((id) => !before.includes(id))
  const pairs = Math.min(gone.length, added.length)
  return {
    flow: gone.slice(0, pairs).map((from, i) => ({ from, to: added[i]! })),
    drip: added.slice(pairs),
    evaporate: gone.slice(pairs)
  }
}
