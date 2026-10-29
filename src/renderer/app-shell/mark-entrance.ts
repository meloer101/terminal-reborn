// The welcome page's entrance (PRD F18 · Figma 39G/39H, "L4"): the mark weaves in turned −90° at the card's centre,
// turns upright, then slides left into its place beside the greeting, pulling the greeting out from behind its right
// edge; the rest of the page fades in last. After a cold start the boot screen (public/boot.js, Figma 39I) hands over
// a mark that is already formed, twice the size: the weave is skipped and the turn also shrinks it.
// Pure: it turns timings and geometry into Web Animations keyframes; EmptyMain plays them.

export const ENTRANCE = {
  /** Gap between the weave's pieces, and how long each takes. */
  weaveGap: 100,
  weaveSegment: 240,
  /** After a cold start: the handed-over mark fades in, and the turn starts a little after. */
  bootFade: 220,
  bootTurnDelay: 120,
  turn: 380,
  slide: 520,
  /** The rest of the page starts this far into the slide. */
  restAt: 0.7,
  restDuration: 240,
  restStagger: 40,
  /** Reduced motion: everything just fades in. */
  reducedFade: 160,
  /** The mark's size while it turns, relative to its resting size (48 over 36). */
  turnScale: 4 / 3
} as const

const EASE_OUT = 'cubic-bezier(0.33, 1, 0.68, 1)'
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)'
const SEGMENT_FROM = 'scale(0.86) rotate(-14deg)'

export type EntranceStart =
  /** The welcome page appears while the app is in use: the full sequence. */
  | { kind: 'weave' }
  /** After the boot screen: the mark is already formed, `scale` times its resting size. */
  | { kind: 'boot'; scale: number }
  | { kind: 'reduced' }

export type EntranceTarget = 'mark' | 'greeting' | { segment: number } | { rest: number }

export interface EntranceTrack {
  target: EntranceTarget
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
}

export interface EntranceGeometry {
  /** Where the mark starts, relative to its resting centre (px). */
  dx: number
  dy: number
  /** The mark's resting size (px). */
  size: number
  /** How many elements make up "the rest" (subtitle, shortcut row or open button, install block). */
  rest: number
}

export interface EntranceTimes {
  turnStart: number
  turnEnd: number
  slideEnd: number
  restStart: number
  end: number
}

export function entranceTimes(start: EntranceStart, rest: number): EntranceTimes {
  const turnStart = start.kind === 'boot' ? ENTRANCE.bootTurnDelay : 3 * ENTRANCE.weaveGap + ENTRANCE.weaveSegment
  const turnEnd = turnStart + ENTRANCE.turn
  const slideEnd = turnEnd + ENTRANCE.slide
  const restStart = turnEnd + ENTRANCE.restAt * ENTRANCE.slide
  const end = Math.max(slideEnd, restStart + Math.max(0, rest - 1) * ENTRANCE.restStagger + ENTRANCE.restDuration)
  return { turnStart, turnEnd, slideEnd, restStart, end }
}

/**
 * Where the greeting sits, horizontally, relative to its resting place when the mark is `dx` from its own and `scale`
 * times its size: its left edge stays the resting gap away from the mark's right edge.
 */
export function greetingOffset(dx: number, scale: number, size: number): number {
  return dx + (size / 2) * (scale - 1)
}

const px = (x: number, y: number): string => `${x}px ${y}px`

export function entranceTracks(start: EntranceStart, g: EntranceGeometry): EntranceTrack[] {
  if (start.kind === 'reduced') {
    const fade = (target: EntranceTarget): EntranceTrack => ({
      target,
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      options: { duration: ENTRANCE.reducedFade, easing: 'ease-out', fill: 'backwards' }
    })
    return [fade('mark'), fade('greeting'), ...Array.from({ length: g.rest }, (_, i) => fade({ rest: i }))]
  }
  const t = entranceTimes(start, g.rest)
  const k0 = start.kind === 'boot' ? start.scale : ENTRANCE.turnScale
  const at = (ms: number): number => ms / t.slideEnd
  const tracks: EntranceTrack[] = []
  // The mark: hold turned, turn upright (and shrink to 48 after a cold start), then slide home.
  tracks.push({
    target: 'mark',
    keyframes: [
      { offset: 0, rotate: '-90deg', scale: `${k0}`, translate: px(g.dx, g.dy) },
      { offset: at(t.turnStart), rotate: '-90deg', scale: `${k0}`, translate: px(g.dx, g.dy), easing: EASE_OUT },
      { offset: at(t.turnEnd), rotate: '0deg', scale: `${ENTRANCE.turnScale}`, translate: px(g.dx, g.dy), easing: EASE_IN_OUT },
      { offset: 1, rotate: '0deg', scale: '1', translate: px(0, 0) }
    ],
    options: { duration: t.slideEnd, fill: 'backwards' }
  })
  if (start.kind === 'boot') {
    tracks.push({ target: 'mark', keyframes: [{ opacity: 0 }, { opacity: 1 }], options: { duration: ENTRANCE.bootFade, easing: 'linear', fill: 'backwards' } })
  } else {
    for (let i = 0; i < 4; i++) {
      tracks.push({
        target: { segment: i },
        keyframes: [{ opacity: 0, transform: SEGMENT_FROM }, { opacity: 1, transform: 'none' }],
        options: { duration: ENTRANCE.weaveSegment, delay: i * ENTRANCE.weaveGap, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' }
      })
    }
  }
  // The greeting travels with the mark's right edge and is revealed from behind it, with the slide's own easing.
  const from = greetingOffset(g.dx, ENTRANCE.turnScale, g.size)
  tracks.push({
    target: 'greeting',
    keyframes: [
      { offset: 0, translate: px(from, 0), clipPath: 'inset(0 100% 0 0)' },
      { offset: at(t.turnEnd), translate: px(from, 0), clipPath: 'inset(0 100% 0 0)', easing: EASE_IN_OUT },
      { offset: 1, translate: px(0, 0), clipPath: 'inset(0 0% 0 0)' }
    ],
    options: { duration: t.slideEnd, fill: 'backwards' }
  })
  for (let i = 0; i < g.rest; i++) {
    tracks.push({
      target: { rest: i },
      keyframes: [{ opacity: 0, translate: px(0, 4) }, { opacity: 1, translate: px(0, 0) }],
      options: { duration: ENTRANCE.restDuration, delay: t.restStart + i * ENTRANCE.restStagger, easing: EASE_OUT, fill: 'backwards' }
    })
  }
  return tracks
}
