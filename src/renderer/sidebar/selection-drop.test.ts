import { describe, expect, it } from 'vitest'
import { aim, LEAD, settled, shape, spring, step, TRAIL } from './selection-drop'

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
