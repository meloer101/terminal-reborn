import { describe, expect, it } from 'vitest'
import {
  AGENT_SCHEDULE_TTL_MS,
  createSchedule,
  dueNow,
  lastOccurrence,
  nextOccurrence,
  nextRun,
  nextWake,
  parseDraft,
  parseSchedules,
  recordRun,
  runBranch,
  runLabel,
  setEnabled,
  timingLabel,
  updateSchedule,
  whenLabel,
  type Schedule,
  type ScheduleDraft
} from './schedule'

// Local time on purpose: the schedule follows the Mac's clock. 2026-11-09 is a Monday.
const at = (d: number, h: number, m = 0, month = 10): number => new Date(2026, month, d, h, m).getTime()

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  name: '每日依赖检查',
  enabled: true,
  action: { kind: 'new', projectId: 'p1', base: 'main', agent: 'codex', ui: 'gui', autoArchive: true },
  prompt: 'npm audit',
  timing: { kind: 'daily', time: '09:00' },
  missed: 'catch-up',
  ...over
})
const make = (over: Partial<ScheduleDraft> = {}, now = at(8, 12)): Schedule => createSchedule(draft(over), 's1', now)

describe('next and last occurrence', () => {
  it('daily, weekdays and weekly land on the next matching day', () => {
    expect(nextOccurrence({ kind: 'daily', time: '09:00' }, 0, at(9, 8))).toBe(at(9, 9))
    expect(nextOccurrence({ kind: 'daily', time: '09:00' }, 0, at(9, 9))).toBe(at(10, 9))
    // Friday 13th after 08:30 → Monday 16th.
    expect(nextOccurrence({ kind: 'weekdays', time: '08:30' }, 0, at(13, 9))).toBe(at(16, 8, 30))
    // Mondays and Wednesdays, asked on Tuesday the 10th.
    expect(nextOccurrence({ kind: 'weekly', days: [1, 3], time: '10:00' }, 0, at(10, 11))).toBe(at(11, 10))
    expect(lastOccurrence({ kind: 'weekly', days: [1, 3], time: '10:00' }, 0, at(10, 11))).toBe(at(9, 10))
  })

  it('interval counts from its anchor; once runs once', () => {
    const anchor = at(9, 10)
    expect(nextOccurrence({ kind: 'interval', minutes: 30 }, anchor, at(9, 10, 5))).toBe(at(9, 10, 30))
    expect(lastOccurrence({ kind: 'interval', minutes: 30 }, anchor, at(9, 11, 5))).toBe(at(9, 11))
    expect(nextOccurrence({ kind: 'once', at: at(9, 15) }, 0, at(9, 16))).toBeNull()
  })

  it('stops after the until day', () => {
    expect(nextOccurrence({ kind: 'daily', time: '09:00' }, 0, at(9, 10), '2026-11-09')).toBeNull()
    expect(nextOccurrence({ kind: 'daily', time: '09:00' }, 0, at(9, 8), '2026-11-09')).toBe(at(9, 9))
  })

  it('crosses a month and a year', () => {
    expect(nextOccurrence({ kind: 'daily', time: '00:05' }, 0, new Date(2026, 11, 31, 23, 0).getTime())).toBe(new Date(2027, 0, 1, 0, 5).getTime())
  })
})

describe('what is due', () => {
  it('runs on time, then not again for the same time', () => {
    let s = make()
    const due = dueNow(s, at(9, 9, 0))
    expect(due).toEqual({ type: 'run', planned: at(9, 9), caughtUp: false })
    s = recordRun(s, { planned: at(9, 9), at: at(9, 9), outcome: 'opened' })
    expect(dueNow(s, at(9, 9, 1))).toBeNull()
  })

  it('catches up only the latest missed time, once', () => {
    const s = make()
    // Asleep from Monday morning to Wednesday noon: Monday's, Tuesday's and Wednesday's 09:00 were missed.
    expect(dueNow(s, at(11, 12))).toEqual({ type: 'run', planned: at(11, 9), caughtUp: true })
    const ran = recordRun(s, { planned: at(11, 9), at: at(11, 12), outcome: 'opened', caughtUp: true })
    expect(dueNow(ran, at(11, 12, 1))).toBeNull()
  })

  it('records a missed time without running under 跳过', () => {
    expect(dueNow(make({ missed: 'skip' }), at(11, 12))).toEqual({ type: 'missed', planned: at(11, 9) })
  })

  it('does not run a time from before the task existed, a task that is off, or one that expired', () => {
    expect(dueNow(make({}, at(9, 10)), at(9, 11))).toBeNull()
    expect(dueNow(make({ enabled: false }), at(9, 9))).toBeNull()
    const agentMade = createSchedule(draft(), 's2', at(1, 12), { sessionId: 'x' })
    expect(agentMade.expiresAt).toBe(at(1, 12) + AGENT_SCHEDULE_TTL_MS)
    expect(dueNow(agentMade, at(9, 9))).toBeNull()
  })
})

describe('recording runs', () => {
  it('pauses after three failures in a row, and a success resets the count', () => {
    let s = make()
    s = recordRun(s, { planned: at(9, 9), at: at(9, 9), outcome: 'failed', reason: 'x' })
    s = recordRun(s, { planned: at(10, 9), at: at(10, 9), outcome: 'opened' })
    expect(s.failures).toBe(0)
    for (const d of [11, 12, 13]) s = recordRun(s, { planned: at(d, 9), at: at(d, 9), outcome: 'failed', reason: 'x' })
    expect(s).toMatchObject({ enabled: false, paused: 'failures' })
    const back = setEnabled(s, true, at(14, 12))
    expect(back.paused).toBeUndefined()
    // What it missed while off does not run.
    expect(dueNow(back, at(14, 12))).toBeNull()
  })

  it('keeps the newest 20 and replaces a run reported again', () => {
    let s = make({ timing: { kind: 'interval', minutes: 10 } })
    for (let i = 0; i < 25; i++) s = recordRun(s, { planned: at(9, 13) + i * 600_000, at: at(9, 13) + i * 600_000, outcome: 'sent' })
    expect(s.runs).toHaveLength(20)
    const last = s.runs[0]!
    s = recordRun(s, { ...last, outcome: 'archived' })
    expect(s.runs).toHaveLength(20)
    expect(s.runs[0]!.outcome).toBe('archived')
  })

  it('a manual run does not move the schedule; a once task turns off after its time', () => {
    const s = recordRun(make(), { planned: at(8, 13), at: at(8, 13), outcome: 'opened', manual: true })
    expect(s.handledThrough).toBe(at(8, 12))
    const once = recordRun(make({ timing: { kind: 'once', at: at(9, 9) } }), { planned: at(9, 9), at: at(9, 9), outcome: 'skipped', reason: '前置检查没过' })
    expect(once.enabled).toBe(false)
  })

  it('an edit to the time starts again from now', () => {
    const s = updateSchedule(make(), draft({ timing: { kind: 'daily', time: '08:00' } }), at(11, 12))
    expect(nextRun(s, at(11, 12))).toBe(at(12, 8))
    expect(dueNow(s, at(11, 12))).toBeNull()
  })
})

describe('waking and labels', () => {
  it('wakes at the earliest due time or expiry', () => {
    const a = make()
    const b = createSchedule(draft({ timing: { kind: 'interval', minutes: 10 } }), 's2', at(8, 12, 55), { sessionId: 'x' })
    expect(nextWake([a, b], at(8, 13))).toBe(at(8, 13, 5))
    expect(nextWake([make({ enabled: false })], at(8, 13))).toBeNull()
  })

  it('reads as Figma 67′', () => {
    expect(timingLabel({ kind: 'weekly', days: [0, 1, 3], time: '10:00' })).toBe('每周一、三、日 10:00')
    expect(timingLabel({ kind: 'interval', minutes: 120 })).toBe('每隔 2 小时')
    const now = at(9, 12) // Monday
    expect(whenLabel(at(9, 14, 30), now)).toBe('14:30')
    expect(whenLabel(at(10, 9), now)).toBe('明天 09:00')
    expect(whenLabel(at(13, 17), now)).toBe('本周五 17:00')
    expect(whenLabel(at(16, 10), now)).toBe('下周一 10:00')
    expect(runLabel({ planned: 0, at: 0, outcome: 'skipped', reason: '前置检查没过', caughtUp: true })).toBe('补跑 · 跳过：前置检查没过')
    expect(runBranch('jacob/', '每日 deps check', at(9, 9))).toBe('jacob/deps-check-1109-0900')
    expect(runBranch('', '周报', at(9, 9))).toBe('schedule-1109-0900')
  })
})

describe('validation', () => {
  it('refuses intervals under 10 minutes, bad clocks and control characters', () => {
    expect(parseDraft(draft())).not.toBeNull()
    expect(parseDraft(draft({ timing: { kind: 'interval', minutes: 5 } }))).toBeNull()
    expect(parseDraft(draft({ timing: { kind: 'daily', time: '24:00' } }))).toBeNull()
    expect(parseDraft(draft({ name: 'a\u0007b' }))).toBeNull()
    expect(parseDraft({ ...draft(), action: { kind: 'new', projectId: 'p1', base: 'main', agent: 'nope', ui: 'gui', autoArchive: true } })).toBeNull()
  })

  it('drops broken and duplicate tasks from the file', () => {
    const good = make()
    expect(parseSchedules({ schedules: [good, { ...good }, { id: 'bad' }] })).toEqual([good])
  })
})
