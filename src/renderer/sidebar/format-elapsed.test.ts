import { describe, expect, it } from 'vitest'
import { formatElapsed, showsElapsed } from './format-elapsed'

const MIN = 60_000

describe('formatElapsed', () => {
  it.each([
    [0, '<1m'],
    [-5000, '<1m'],
    [59_999, '<1m'],
    [MIN, '1m'],
    [4 * MIN + 30_000, '4m'],
    [59 * MIN, '59m'],
    [60 * MIN, '1h'],
    [119 * MIN, '1h'],
    [23 * 60 * MIN, '23h'],
    [24 * 60 * MIN, '1d'],
    [50 * 60 * MIN, '2d']
  ])('%i ms -> %s', (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected)
  })
})

describe('showsElapsed', () => {
  it('hides idle and exited only', () => {
    expect(showsElapsed('idle')).toBe(false)
    expect(showsElapsed('exited')).toBe(false)
    expect(showsElapsed('running')).toBe(true)
    expect(showsElapsed('done_unread')).toBe(true)
  })
})
