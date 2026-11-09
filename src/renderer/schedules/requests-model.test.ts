import { describe, expect, it } from 'vitest'
import { cronLabel } from '@shared/agent-events'
import { onceAt, scheduleRequestCounts } from './model'

const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime()

describe('wavi schedule (PRD F24)', () => {
  it('reads --at as its next time today or tomorrow, or as a moment; a past moment is refused', () => {
    expect(onceAt('14:30', at(9, 12))).toBe(at(9, 14, 30))
    expect(onceAt('09:00', at(9, 12))).toBe(at(10, 9))
    expect(onceAt('2026-11-12T09:00', at(9, 12))).toBe(at(12, 9))
    expect(onceAt('2026-11-01T09:00', at(9, 12))).toBeNull()
  })

  it('counts the requests waiting per session', () => {
    const r = (sessionId: string) => ({ callId: sessionId + Math.random(), sessionId, draft: {} as never, expiresAt: 0 })
    expect(scheduleRequestCounts([r('a'), r('a'), r('b')])).toEqual(new Map([['a', 2], ['b', 1]]))
  })

  it("reads Claude's crons as Figma 67I′ does", () => {
    expect(cronLabel('*/10 * * * *')).toBe('每 10 分钟')
    expect(cronLabel('0 */2 * * *')).toBe('每 2 小时')
    expect(cronLabel('0 17 * * *')).toBe('每天 17:00')
    expect(cronLabel('5 9 * * 1-5')).toBe('5 9 * * 1-5')
  })
})
