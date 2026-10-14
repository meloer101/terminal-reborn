import { describe, expect, it } from 'vitest'
import { isOrphanSpawn } from './late-spawn'

describe('isOrphanSpawn', () => {
  it('flags a spawn report for an id main no longer tracks (timed out / owner gone)', () => {
    const tracked = new Map([['live', {}]])
    expect(isOrphanSpawn(tracked, 'timed-out')).toBe(true)
  })

  it('does not flag a tracked session', () => {
    expect(isOrphanSpawn(new Map([['live', {}]]), 'live')).toBe(false)
  })
})
