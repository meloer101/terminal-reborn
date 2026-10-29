import { describe, expect, it } from 'vitest'
import { ENTRANCE, entranceTimes, entranceTracks, greetingOffset, type EntranceTrack } from './mark-entrance'

const geometry = { dx: 140, dy: 0, size: 36, rest: 2 }
const markMotion = (tracks: EntranceTrack[]) => tracks.find((t) => t.target === 'mark' && 'rotate' in t.keyframes[0]!)!
const greeting = (tracks: EntranceTrack[]) => tracks.find((t) => t.target === 'greeting')!
const parsePx = (v: unknown) => Number(String(v).split('px')[0])

describe('entranceTimes', () => {
  it('weaves the four pieces before turning; the turn, the slide and the rest follow in order', () => {
    const t = entranceTimes({ kind: 'weave' }, 2)
    expect(t.turnStart).toBe(3 * ENTRANCE.weaveGap + ENTRANCE.weaveSegment)
    expect(t.turnEnd).toBe(t.turnStart + ENTRANCE.turn)
    expect(t.slideEnd).toBe(t.turnEnd + ENTRANCE.slide)
    expect(t.restStart).toBeGreaterThan(t.turnEnd)
    expect(t.restStart).toBeLessThan(t.slideEnd)
  })

  it('skips the weave after the boot screen', () => {
    expect(entranceTimes({ kind: 'boot', scale: 8 / 3 }, 2).turnStart).toBe(ENTRANCE.bootTurnDelay)
  })
})

describe('entranceTracks', () => {
  it('turns from −90° to upright and lands on the resting place at its resting size', () => {
    const k = markMotion(entranceTracks({ kind: 'weave' }, geometry)).keyframes
    expect(k[0]).toMatchObject({ rotate: '-90deg', translate: '140px 0px' })
    expect(k.at(-1)).toMatchObject({ rotate: '0deg', scale: '1', translate: '0px 0px' })
  })

  it('keeps the greeting against the mark: both move with the same easing, from offsets that keep the gap', () => {
    const tracks = entranceTracks({ kind: 'weave' }, geometry)
    const mark = markMotion(tracks).keyframes
    const text = greeting(tracks).keyframes
    // The slide is the last interval of both tracks, with the same easing and timing.
    expect(mark[2]!.offset).toBe(text[1]!.offset)
    expect(mark[2]!.easing).toBe(text[1]!.easing)
    // At the slide's start the mark is dx away and 4/3 its size; its right edge is greetingOffset away from rest.
    const markRight = parsePx(mark[2]!.translate) + (geometry.size / 2) * (Number(mark[2]!.scale) - 1)
    expect(parsePx(text[1]!.translate)).toBeCloseTo(markRight)
    // Both offsets shrink linearly with the same eased progress, so the gap holds all the way.
    expect(greetingOffset(geometry.dx, ENTRANCE.turnScale, geometry.size)).toBeCloseTo(markRight)
    expect(text[0]!.clipPath).toBe('inset(0 100% 0 0)')
    expect(text.at(-1)!.clipPath).toBe('inset(0 0% 0 0)')
  })

  it('weaves the four pieces clockwise, one after another', () => {
    const delays = entranceTracks({ kind: 'weave' }, geometry)
      .filter((t) => typeof t.target === 'object' && 'segment' in t.target)
      .map((t) => t.options.delay)
    expect(delays).toEqual([0, 100, 200, 300])
  })

  it('after the boot screen fades the formed mark in and shrinks it while turning', () => {
    const tracks = entranceTracks({ kind: 'boot', scale: 8 / 3 }, geometry)
    expect(tracks.some((t) => typeof t.target === 'object' && 'segment' in t.target)).toBe(false)
    const k = markMotion(tracks).keyframes
    expect(k[0]!.scale).toBe(`${8 / 3}`)
    expect(k[2]!.scale).toBe(`${ENTRANCE.turnScale}`)
    expect(tracks.some((t) => t.target === 'mark' && t.keyframes[0]!.opacity === 0)).toBe(true)
  })

  it('fades the rest in last, in order', () => {
    const t = entranceTimes({ kind: 'weave' }, 2)
    const rest = entranceTracks({ kind: 'weave' }, geometry).filter((x) => typeof x.target === 'object' && 'rest' in x.target)
    expect(rest.map((x) => x.options.delay)).toEqual([t.restStart, t.restStart + ENTRANCE.restStagger])
  })

  it('only fades everything in when motion is reduced', () => {
    const tracks = entranceTracks({ kind: 'reduced' }, geometry)
    expect(tracks).toHaveLength(2 + geometry.rest)
    for (const t of tracks) {
      expect(t.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }])
      expect(t.options.duration).toBe(ENTRANCE.reducedFade)
    }
  })
})
