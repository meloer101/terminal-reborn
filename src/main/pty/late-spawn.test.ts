import { describe, expect, it } from 'vitest'
import { isOrphanSpawn, shouldKillLateSpawn } from './late-spawn'

describe('isOrphanSpawn', () => {
  it('flags a spawn report for an id main no longer tracks (timed out / owner gone)', () => {
    const tracked = new Map([['live', {}]])
    expect(isOrphanSpawn(tracked, 'timed-out')).toBe(true)
  })

  it('does not flag a tracked session', () => {
    expect(isOrphanSpawn(new Map([['live', {}]]), 'live')).toBe(false)
  })
})

describe('shouldKillLateSpawn', () => {
  it('kills an untracked late spawn on the in-app host', () => {
    expect(shouldKillLateSpawn(new Map(), 'gone', false)).toBe(true)
  })

  it('keeps it with the daemon: the session was detached for the next attach (renderer reload)', () => {
    expect(shouldKillLateSpawn(new Map(), 'reloaded', true)).toBe(false)
  })

  it('never kills a tracked session', () => {
    expect(shouldKillLateSpawn(new Map([['live', {}]]), 'live', false)).toBe(false)
  })
})
