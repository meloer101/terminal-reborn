import { describe, expect, it } from 'vitest'
import { indexAt, offsetsOf, visibleRange } from './virtual'

describe('windowing', () => {
  const offsets = offsetsOf([32, 32, 20, 20, 20, 28])

  it('accumulates heights', () => {
    expect(offsets).toEqual([0, 32, 64, 84, 104, 124, 152])
  })

  it('finds the item under a y position', () => {
    expect(indexAt(offsets, 0)).toBe(0)
    expect(indexAt(offsets, 31)).toBe(0)
    expect(indexAt(offsets, 32)).toBe(1)
    expect(indexAt(offsets, 100)).toBe(3)
    expect(indexAt(offsets, 10_000)).toBe(5)
    expect(indexAt([0], 5)).toBe(0)
  })

  it('returns the items a viewport touches, plus overscan', () => {
    expect(visibleRange(offsets, 40, 50, 0)).toEqual([1, 4])
    expect(visibleRange(offsets, 40, 50, 1)).toEqual([0, 5])
    expect(visibleRange(offsets, 0, 1000, 2)).toEqual([0, 6])
    expect(visibleRange([0], 0, 100, 2)).toEqual([0, 0])
  })

  it('scales to a 10 000-line diff', () => {
    const big = offsetsOf(Array.from({ length: 10_000 }, () => 20))
    expect(visibleRange(big, 100_000, 600, 10)).toEqual([4990, 5040])
  })
})
