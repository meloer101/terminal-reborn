// 定时任务's clock (PRD F24): main is the only writer of `<userData>/schedules.json`; it looks at the tasks every tick
// (and on wake and at launch), runs a task's 前置检查, and hands what is due to the window, which opens the session or
// sends the message and reports back. No Electron imports, so the whole loop is unit-tested with a fake clock.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  createSchedule,
  dueNow,
  expired,
  keepSchedule,
  nextWake,
  parseSchedules,
  recordRun,
  setEnabled,
  updateSchedule,
  type Schedule,
  type ScheduleDraft,
  type ScheduleFire,
  type ScheduleRun
} from '@shared/schedule'

/** A window that took a fire answers within this, or the run fails. */
export const FIRE_TIMEOUT_MS = 2 * 60 * 1000
export const PRECHECK_TIMEOUT_MS = 60 * 1000

export interface SchedulerDeps {
  now(): number
  newId(): string
  /** Runs the precheck in the project's root; resolves to whether it passed, or why it could not run. */
  precheck(projectId: string, command: string, key: string): Promise<{ passed: boolean } | { error: string }>
  /** Hands a due run to the window; false when no window can take it yet (it is tried again next tick). */
  fire(fire: ScheduleFire): boolean
  /** Every change, for the windows' lists and the daemon's wake time. */
  changed(schedules: Schedule[]): void
  /** 全部暂停: what comes due is passed over, never caught up later. */
  paused(): boolean
}

export class SchedulesFile {
  constructor(private readonly path: string) {}

  load(): Schedule[] {
    try {
      return parseSchedules(JSON.parse(readFileSync(this.path, 'utf8')))
    } catch {
      return []
    }
  }

  save(schedules: readonly Schedule[]): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, schedules }, null, 1))
      renameSync(tmp, this.path)
    } catch (error) {
      console.error('[schedules] could not save schedules.json', error)
    }
  }
}

interface InFlight {
  planned: number
  manual: boolean
  /** Handed to a window at; undefined while its precheck runs or no window took it. */
  firedAt?: number
}

export class Scheduler {
  private schedules: Schedule[]
  /** Runs started and not reported yet, by task id (one at a time per task). */
  private readonly inFlight = new Map<string, InFlight>()

  constructor(
    private readonly file: SchedulesFile,
    private readonly deps: SchedulerDeps
  ) {
    this.schedules = file.load()
  }

  list(): Schedule[] {
    return this.schedules
  }

  get(id: string): Schedule | undefined {
    return this.schedules.find((s) => s.id === id)
  }

  /** When the pty daemon should open the app if it is not running then. */
  wakeAt(): number | null {
    return nextWake(this.schedules, this.deps.now())
  }

  create(draft: ScheduleDraft, createdBy?: { sessionId: string }): Schedule {
    const schedule = createSchedule(draft, this.deps.newId(), this.deps.now(), createdBy)
    this.commit([...this.schedules, schedule])
    return schedule
  }

  update(id: string, draft: ScheduleDraft): Schedule | null {
    const current = this.get(id)
    if (!current) return null
    const next = updateSchedule(current, draft, this.deps.now())
    this.replace(next)
    return next
  }

  setEnabled(id: string, enabled: boolean): void {
    const current = this.get(id)
    if (current) this.replace(setEnabled(current, enabled, this.deps.now()))
  }

  keep(id: string): void {
    const current = this.get(id)
    if (current) this.replace(keepSchedule(current))
  }

  remove(id: string): void {
    this.inFlight.delete(id)
    this.commit(this.schedules.filter((s) => s.id !== id))
  }

  /** 立即运行: skips the precheck and leaves the schedule as it is. */
  runNow(id: string): void {
    const schedule = this.get(id)
    if (!schedule || this.inFlight.has(id)) return
    const now = this.deps.now()
    this.inFlight.set(id, { planned: now, manual: true })
    this.hand(schedule, { planned: now, caughtUp: false, manual: true })
  }

  /** The window's outcome of a run, or a later change to it (opened → archived). */
  report(id: string, run: ScheduleRun): void {
    const current = this.get(id)
    if (!current) return
    const flight = this.inFlight.get(id)
    // The window has it from here (a send waiting for a turn reports `running`, then its outcome).
    if (flight && flight.planned === run.planned) this.inFlight.delete(id)
    this.replace(recordRun(current, run))
  }

  /** Looks at every task: expired ones go, due ones start, fires no window answered fail. */
  tick(): void {
    const now = this.deps.now()
    const live = this.schedules.filter((s) => !expired(s, now))
    if (live.length !== this.schedules.length) this.commit(live)
    for (const schedule of this.schedules) {
      const flight = this.inFlight.get(schedule.id)
      if (flight) {
        if (flight.firedAt === undefined && !flight.manual && this.pendingPrecheck.has(schedule.id)) continue
        if (flight.firedAt === undefined) this.hand(schedule, { planned: flight.planned, caughtUp: false, manual: flight.manual })
        else if (now - flight.firedAt > FIRE_TIMEOUT_MS) {
          this.inFlight.delete(schedule.id)
          this.replace(recordRun(schedule, { planned: flight.planned, at: now, outcome: 'failed', reason: '窗口没有响应', ...(flight.manual ? { manual: true } : {}) }))
        }
        continue
      }
      const due = dueNow(schedule, now)
      if (!due) continue
      if (this.deps.paused()) {
        this.replace({ ...schedule, handledThrough: due.planned })
        continue
      }
      if (due.type === 'missed') {
        this.replace(recordRun(schedule, { planned: due.planned, at: now, outcome: 'skipped', reason: '错过了' }))
        continue
      }
      this.inFlight.set(schedule.id, { planned: due.planned, manual: false })
      void this.start(schedule, due.planned, due.caughtUp)
    }
  }

  private readonly pendingPrecheck = new Set<string>()

  private async start(schedule: Schedule, planned: number, caughtUp: boolean): Promise<void> {
    const action = schedule.action
    if (action.kind === 'new' && action.precheck) {
      this.pendingPrecheck.add(schedule.id)
      const result = await this.deps.precheck(action.projectId, action.precheck, `schedule:${schedule.id}`)
      this.pendingPrecheck.delete(schedule.id)
      const current = this.get(schedule.id)
      if (!current || this.inFlight.get(schedule.id)?.planned !== planned) return
      if ('error' in result || !result.passed) {
        this.inFlight.delete(schedule.id)
        const run: ScheduleRun =
          'error' in result
            ? { planned, at: this.deps.now(), outcome: 'failed', reason: result.error }
            : { planned, at: this.deps.now(), outcome: 'skipped', reason: '前置检查没过' }
        this.replace(recordRun(current, caughtUp ? { ...run, caughtUp: true } : run))
        return
      }
      this.hand(current, { planned, caughtUp, manual: false })
      return
    }
    this.hand(schedule, { planned, caughtUp, manual: false })
  }

  private hand(schedule: Schedule, at: { planned: number; caughtUp: boolean; manual: boolean }): void {
    if (!this.deps.fire({ schedule, ...at })) return
    const flight = this.inFlight.get(schedule.id)
    if (flight && flight.planned === at.planned) flight.firedAt = this.deps.now()
  }

  private replace(next: Schedule): void {
    this.commit(this.schedules.map((s) => (s.id === next.id ? next : s)))
  }

  private commit(schedules: Schedule[]): void {
    this.schedules = schedules
    this.file.save(schedules)
    this.deps.changed(schedules)
  }
}
