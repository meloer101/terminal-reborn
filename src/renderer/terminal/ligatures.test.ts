import { describe, expect, it } from 'vitest'
import { findLigatureRanges } from './ligatures'

describe('findLigatureRanges', () => {
  it('finds common sequences and prefers the longest match', () => {
    expect(findLigatureRanges('a => b')).toEqual([[2, 4]])
    expect(findLigatureRanges('x === y')).toEqual([[2, 5]])
    expect(findLigatureRanges('<-->')).toEqual([[0, 4]])
  })
  it('returns several non-overlapping ranges', () => {
    expect(findLigatureRanges('a != b && c')).toEqual([
      [2, 4],
      [7, 9]
    ])
  })
  it('ignores plain text', () => {
    expect(findLigatureRanges('hello world')).toEqual([])
  })
})
