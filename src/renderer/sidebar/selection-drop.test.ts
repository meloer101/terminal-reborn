import { describe, expect, it } from 'vitest'
import { advance, aim, changes, dripOnto, evaporate, flowTo, frameOf, LEAD, restAt, settled, shape, spring, step, TRAIL, type DropState } from './selection-drop'

function run(upper = spring(0), lower = spring(66), to: [number, number] = [272, 338]) {
  aim(upper, lower, to[0], to[1])
  const frames: ReturnType<typeof shape>[] = []
  for (let i = 0; i < 240 && !(i > 0 && settled(upper, lower)); i++) {
    for (let j = 0; j < 4; j++) {
      step(upper, 1 / 240)
      step(lower, 1 / 240)
    }
    frames.push(shape(upper, lower))
  }
  return { frames, upper, lower }
}

describe('selection drop', () => {
  it('moving down, the bottom edge leads: stiff below, soft above', () => {
    const upper = spring(0)
    const lower = spring(66)
    aim(upper, lower, 272, 338)
    expect(lower).toMatchObject(LEAD)
    expect(upper).toMatchObject(TRAIL)
    // The same row again (the sidebar redrew mid-flight) leaves the springs alone.
    aim(upper, lower, 272, 338)
    expect(lower).toMatchObject(LEAD)
    aim(upper, lower, 0, 66)
    expect(upper).toMatchObject(LEAD)
  })

  it('stretches and thins on the way, lands squashed and wider, and settles on the row', () => {
    const { frames, upper, lower } = run()
    const tallest = Math.max(...frames.map((f) => f.height))
    expect(tallest).toBeGreaterThan(66 * 2)
    expect(frames.find((f) => f.height === tallest)!.inset).toBeGreaterThan(0)
    expect(Math.min(...frames.map((f) => f.inset))).toBeLessThan(0)
    expect(settled(upper, lower)).toBe(true)
    expect(Math.round(upper.x)).toBe(272)
    expect(Math.round(lower.x)).toBe(338)
  })

  it('takes about 0.6 s to settle', () => {
    const { frames } = run()
    // 60 frames a second
    expect(frames.length / 60).toBeGreaterThan(0.4)
    expect(frames.length / 60).toBeLessThan(1.2)
  })

  it('a resting block is the row itself, with the rest radius', () => {
    expect(shape(spring(10), spring(76))).toEqual({ top: 10, height: 66, inset: 0, radius: 10 })
  })
})

describe('pane drops (Figma 37B)', () => {
  const row = { top: 272, height: 66, left: 8, width: 248 }
  const play = (state: DropState, seconds: number) => {
    let s = state
    const frames: Array<ReturnType<typeof frameOf>> = []
    for (let t = 0; t < seconds; t += 1 / 60) {
      for (let j = 0; j < 4; j++) s = advance(s, 1 / 240)
      frames.push(frameOf(s))
    }
    return { s, frames }
  }

  it('a new pane: a small bead above the row falls, spreads past the row a little and rests on it', () => {
    const start = frameOf(dripOnto(row))!
    expect(start.width).toBe(12)
    expect(start.top + start.height / 2).toBe(row.top + row.height / 2 - 46)
    expect(start.opacity).toBe(0)
    const { s, frames } = play(dripOnto(row), 1.5)
    const widest = Math.max(...frames.map((f) => f!.width))
    expect(widest).toBeGreaterThan(row.width)
    expect(widest).toBeLessThanOrEqual(row.width + 8)
    expect(s.phase).toBe('rest')
    expect(frameOf(s)).toMatchObject({ left: 8, top: 272, width: 248, height: 66, opacity: 1 })
  })

  it('a closed pane: the block shrinks to a bead, fades and is gone', () => {
    const { s, frames } = play(evaporate(restAt(row)), 0.5)
    expect(s.phase).toBe('gone')
    expect(frameOf(s)).toBeNull()
    const last = frames.filter(Boolean).at(-1)!
    expect(last.width).toBeLessThan(40)
    expect(last.opacity).toBeLessThan(0.2)
  })

  it('a resting block flows to the pane\'s new session and rests there', () => {
    const { s } = play(flowTo(restAt({ ...row, top: 0 }), row), 1.5)
    expect(s.phase).toBe('rest')
    expect(frameOf(s)).toMatchObject({ top: 272, height: 66 })
  })

  it('pairs a session gone with one added as a pane that switched; the rest dripped in or closed', () => {
    expect(changes(['a'], ['b'])).toEqual({ flow: [{ from: 'a', to: 'b' }], drip: [], evaporate: [] })
    expect(changes(['a'], ['a', 'b'])).toEqual({ flow: [], drip: ['b'], evaporate: [] })
    expect(changes(['a', 'b'], ['a'])).toEqual({ flow: [], drip: [], evaporate: ['b'] })
    expect(changes(['a', 'b'], ['a', 'b'])).toEqual({ flow: [], drip: [], evaporate: [] })
    expect(changes(['a', 'b'], ['c'])).toEqual({ flow: [{ from: 'a', to: 'c' }], drip: [], evaporate: ['b'] })
  })
})
