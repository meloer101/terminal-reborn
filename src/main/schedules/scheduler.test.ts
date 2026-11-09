import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ScheduleDraft, ScheduleFire } from '@shared/schedule'
import { FIRE_TIMEOUT_MS, Scheduler, SchedulesFile, type SchedulerDeps } from './scheduler'

const at = (d: number, h: number, m = 0): number => new Date(2026, 10, d, h, m).getTime()
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  name: '每日依赖检查',
  enabled: true,
  action: { kind: 'new', projectId: 'p1', base: 'main', agent: 'claude', ui: 'cli', autoArchive: true },
  prompt: 'npm audit',
  timing: { kind: 'daily', time: '09:00' },
  missed: 'catch-up',
  ...over
})

function setup(precheck: SchedulerDeps['precheck'] = async () => ({ passed: true })) {
  const dir = mkdtempSync(join(tmpdir(), 'wavi-schedules-'))
  dirs.push(dir)
  const clock = { now: at(8, 12), paused: false }
  const fires: ScheduleFire[] = []
  let windowUp = true
  let n = 0
  const file = new SchedulesFile(join(dir, 'schedules.json'))
  const deps: SchedulerDeps = {
    now: () => clock.now,
    newId: () => `s${++n}`,
    precheck,
    fire: (f) => {
      if (!windowUp) return false
      fires.push(f)
      return true
    },
    changed: () => {},
    paused: () => clock.paused
  }
  const scheduler = new Scheduler(file, deps)
  return { scheduler, clock, fires, file, deps, setWindow: (up: boolean) => (windowUp = up) }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('Scheduler', () => {
  it('fires once at the time, records the outcome and keeps it on disk', async () => {
    const t = setup()
    const s = t.scheduler.create(draft())
    t.clock.now = at(9, 9)
    t.scheduler.tick()
    await settle()
    t.scheduler.tick()
    expect(t.fires).toHaveLength(1)
    expect(t.fires[0]).toMatchObject({ planned: at(9, 9), caughtUp: false, manual: false })
    t.scheduler.report(s.id, { planned: at(9, 9), at: at(9, 9), outcome: 'opened', sessionId: 'x1' })
    const again = new Scheduler(t.file, t.deps)
    expect(again.get(s.id)?.runs[0]).toMatchObject({ outcome: 'opened', sessionId: 'x1' })
    again.tick()
    expect(t.fires).toHaveLength(1)
  })

  it('a failing precheck skips the run without waking the window', async () => {
    const t = setup(async () => ({ passed: false }))
    const s = t.scheduler.create(draft({ action: { kind: 'new', projectId: 'p1', base: 'main', agent: 'claude', ui: 'cli', autoArchive: true, precheck: 'false' } }))
    t.clock.now = at(9, 9)
    t.scheduler.tick()
    await settle()
    expect(t.fires).toHaveLength(0)
    expect(t.scheduler.get(s.id)?.runs[0]).toMatchObject({ outcome: 'skipped', reason: '前置检查没过' })
  })

  it('waits for a window, and fails a fire nobody answers', async () => {
    const t = setup()
    const s = t.scheduler.create(draft({ action: { kind: 'send', sessionId: 'x1' } }))
    t.setWindow(false)
    t.clock.now = at(9, 9)
    t.scheduler.tick()
    await settle()
    expect(t.fires).toHaveLength(0)
    t.setWindow(true)
    t.scheduler.tick()
    expect(t.fires).toHaveLength(1)
    t.clock.now += FIRE_TIMEOUT_MS + 1
    t.scheduler.tick()
    expect(t.scheduler.get(s.id)?.runs[0]).toMatchObject({ outcome: 'failed', reason: '窗口没有响应' })
  })

  it('records a missed time under 跳过 and drops an expired agent task', () => {
    const t = setup()
    const skip = t.scheduler.create(draft({ missed: 'skip' }))
    const agentMade = t.scheduler.create(draft({ name: 'agent' }), { sessionId: 'x9' })
    t.clock.now = at(20, 12)
    t.scheduler.tick()
    expect(t.fires).toHaveLength(0)
    expect(t.scheduler.get(skip.id)?.runs[0]).toMatchObject({ outcome: 'skipped', reason: '错过了' })
    expect(t.scheduler.get(agentMade.id)).toBeUndefined()
  })

  it('全部暂停 passes over what comes due, and nothing of it runs after', () => {
    const t = setup()
    const s = t.scheduler.create(draft())
    t.clock.paused = true
    t.clock.now = at(9, 9)
    t.scheduler.tick()
    t.clock.paused = false
    t.clock.now = at(9, 9, 1)
    t.scheduler.tick()
    expect(t.fires).toHaveLength(0)
    expect(t.scheduler.get(s.id)?.runs).toEqual([])
  })

  it('a broken file is moved aside, not written over', () => {
    const t = setup()
    const path = join(dirs.at(-1)!, 'schedules.json')
    writeFileSync(path, '{ not json')
    expect(new SchedulesFile(path).load()).toEqual([])
    expect(existsSync(path)).toBe(false)
    expect(readdirSync(dirs.at(-1)!).some((f) => f.startsWith('schedules.json.bad-'))).toBe(true)
    expect(t.scheduler.list()).toEqual([])
  })

  it('a precheck that throws fails the run and frees the task for its next time', async () => {
    const t = setup(async () => {
      throw new Error('spawn ENOENT')
    })
    const s = t.scheduler.create(draft({ action: { kind: 'new', projectId: 'p1', base: 'main', agent: 'claude', ui: 'cli', autoArchive: true, precheck: 'x' } }))
    t.clock.now = at(9, 9)
    t.scheduler.tick()
    await settle()
    expect(t.scheduler.get(s.id)?.runs[0]).toMatchObject({ outcome: 'failed' })
    expect(t.scheduler.get(s.id)?.runs[0]?.reason).toContain('spawn ENOENT')
    t.clock.now = at(10, 9)
    t.scheduler.tick()
    await settle()
    expect(t.scheduler.get(s.id)?.runs).toHaveLength(2)
  })

  it('a send still waiting when the window reloads is recorded as not sent', () => {
    const t = setup()
    const s = t.scheduler.create(draft({ action: { kind: 'send', sessionId: 'x1' } }))
    t.clock.now = at(9, 9)
    t.scheduler.tick()
    t.scheduler.report(s.id, { planned: at(9, 9), at: at(9, 9), outcome: 'running', reason: '等这一轮结束再发' })
    t.scheduler.windowReloaded()
    expect(t.scheduler.get(s.id)?.runs[0]).toMatchObject({ outcome: 'skipped', reason: '窗口重新打开，没发出' })
  })

  it('立即运行 fires now without moving the schedule', () => {
    const t = setup()
    const s = t.scheduler.create(draft())
    t.scheduler.runNow(s.id)
    expect(t.fires[0]).toMatchObject({ manual: true, planned: at(8, 12) })
    expect(t.scheduler.wakeAt()).toBe(at(9, 9))
  })
})
