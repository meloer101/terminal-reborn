import { describe, expect, it, vi } from 'vitest'
import { isOrphanSpawn, replacePendingStart, shouldKillLateSpawn, type PendingStart } from './late-spawn'

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

describe('replacePendingStart', () => {
  const start = (timeout: () => void) => {
    const entry = { resolve: vi.fn(), reject: vi.fn(), timer: setTimeout(timeout, 50) }
    return entry
  }

  it('stops the earlier start’s timer, so it cannot time out and kill the newer process', async () => {
    const pending = new Map<string, PendingStart<{ pid: number }>>()
    const firstTimedOut = vi.fn()
    replacePendingStart(pending, 's1', start(firstTimedOut))
    replacePendingStart(pending, 's1', start(() => {}))
    await new Promise((r) => setTimeout(r, 80))
    expect(firstTimedOut).not.toHaveBeenCalled()
  })

  it('gives both callers the newer start’s outcome', () => {
    const pending = new Map<string, PendingStart<{ pid: number }>>()
    const first = start(() => {})
    const second = start(() => {})
    replacePendingStart(pending, 's1', first)
    replacePendingStart(pending, 's1', second)
    pending.get('s1')!.resolve({ pid: 42 })
    expect(first.resolve).toHaveBeenCalledWith({ pid: 42 })
    expect(second.resolve).toHaveBeenCalledWith({ pid: 42 })
    const error = new Error('boom')
    pending.get('s1')!.reject(error)
    expect(first.reject).toHaveBeenCalledWith(error)
    clearTimeout(second.timer)
  })
})
