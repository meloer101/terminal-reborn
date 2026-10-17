import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { formatElapsed, sessionTime, showsTime } from './format-elapsed'

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

const NOW = 100 * MIN

function timed(extra: Partial<Session> = {}): Session {
  return { id: 's', worktreeId: 'w', kind: 'claude', title: 't', status: 'idle', startedAt: 0, lastActivityAt: NOW - MIN, ...extra }
}

describe('sessionTime', () => {
  it('running counts this turn, not the session', () => {
    expect(sessionTime(timed({ turnStartedAt: NOW - 3 * MIN }), 'running', NOW).text).toBe('3m')
    expect(sessionTime(timed(), 'running', NOW).text).toBe('1h')
  })

  it('needs_you counts from when the wait began and gets heavier after five minutes', () => {
    expect(sessionTime(timed({ statusSince: NOW - 3 * MIN }), 'needs_you', NOW)).toEqual({ text: '已等 3m', emphasis: false })
    expect(sessionTime(timed({ statusSince: NOW - 5 * MIN }), 'needs_you', NOW)).toEqual({ text: '已等 5m', emphasis: true })
  })

  it('idle and done_unread count from the finish, not from later activity', () => {
    const session = timed({ finishedAt: NOW - 7 * MIN, statusSince: NOW - 2 * MIN })
    expect(sessionTime(session, 'idle', NOW).text).toBe('7m 前')
    expect(sessionTime(session, 'done_unread', NOW).text).toBe('7m 前')
    expect(sessionTime(timed({ statusSince: NOW - 4 * MIN }), 'error', NOW).text).toBe('4m 前')
  })
})

describe('showsTime', () => {
  it('hides exited, and idle sessions that never finished a turn', () => {
    expect(showsTime({}, 'exited')).toBe(false)
    expect(showsTime({}, 'idle')).toBe(false)
    expect(showsTime({ finishedAt: 1 }, 'idle')).toBe(true)
    expect(showsTime({}, 'running')).toBe(true)
    expect(showsTime({}, 'done_unread')).toBe(true)
  })
})
