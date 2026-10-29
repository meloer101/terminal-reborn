// The sidebar's selection drop (Figma 37): one glass block that travels between session rows. Each edge rides its own
// spring — the edge in front is stiff, the one behind is soft — so the block stretches on the way, lands a little
// squashed and settles. Pure maths; SelectionDrop draws it.

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
