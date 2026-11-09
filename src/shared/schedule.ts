// 定时任务 (PRD F24): what a scheduled task is, when it runs next, what a missed run turns into, and how a run is
// recorded. Pure and local-time based (Date's own calendar, so daylight saving moves with the clock); main owns the
// file (src/main/schedules), the renderer runs what comes due (src/renderer/schedules). schedule.test.ts.
import { isCliAgent, type CliAgent } from './agents'
import { isGuiPermission, type GuiPermission } from './gui-chat'
import type { SessionUi } from './types'

export const MIN_INTERVAL_MINUTES = 10
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60
/** Runs kept per task, newest first (Figma 67B′). */
export const MAX_RUNS = 20
/** Failures in a row before a task pauses itself. */
export const MAX_FAILURES = 3
/** A task an agent made lives this long unless the user keeps it (PRD F24, as Claude's own `/loop`). */
export const AGENT_SCHEDULE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Within this of its time a run counts as on time; later it is a catch-up (补跑). */
export const ON_TIME_MS = 2 * 60 * 1000
export const MAX_SCHEDULES = 100
export const MAX_PROMPT = 8000
export const MAX_NAME = 60
export const MAX_PRECHECK = 2000

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export type ScheduleTiming =
  | { kind: 'interval'; minutes: number }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; days: Weekday[]; time: string }
  | { kind: 'once'; at: number }

export type ScheduleAction =
  | {
      kind: 'new'
      projectId: string
      /** Branch the run's worktree starts from. */
      base: string
      agent: CliAgent
      ui: SessionUi
      model?: string
      /** Absent = the agent's default. A CLI session only takes it where the agent has a launch flag (Claude). */
      permission?: GuiPermission
      /** Archive the run's worktree when its turn ends with nothing changed. */
      autoArchive: boolean
      /** A shell command run in the project first; a non-zero exit skips the run. */
      precheck?: string
    }
  | { kind: 'send'; sessionId: string }

export type RunOutcome = 'running' | 'opened' | 'sent' | 'archived' | 'skipped' | 'failed'

export interface ScheduleRun {
  /** The time it was due (dedupe key with the task id). */
  planned: number
  /** When it actually ran. */
  at: number
  outcome: RunOutcome
  /** Why it was skipped or failed, or what came of it (short, shown as is). */
  reason?: string
  /** The session it opened or wrote to. */
  sessionId?: string
  /** Ran late: the Mac slept or Wavi was not running at its time. */
  caughtUp?: boolean
  /** 立即运行: by hand, not on the schedule. */
  manual?: boolean
}

export interface Schedule {
  id: string
  name: string
  enabled: boolean
  action: ScheduleAction
  prompt: string
  timing: ScheduleTiming
  /** Last day it may run (local YYYY-MM-DD, inclusive). */
  until?: string
  missed: 'catch-up' | 'skip'
  createdAt: number
  /** Interval tasks count from here. */
  anchor: number
  /** Made by an agent through `wavi schedule` (its session); such a task expires unless kept. */
  createdBy?: { sessionId: string }
  expiresAt?: number
  /** Failures in a row; MAX_FAILURES pauses the task. */
  failures: number
  /** Why it turned itself off. */
  paused?: 'failures'
  /** The newest planned time handled (run, skipped or dropped); nothing at or before it runs again. */
  handledThrough: number
  runs: ScheduleRun[]
}

/** What the sheet sends: everything the user sets. */
export type ScheduleDraft = Pick<Schedule, 'name' | 'enabled' | 'action' | 'prompt' | 'timing' | 'until' | 'missed'>

// ── time ──────────────────────────────────────────────────────────────────────

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const MINUTE = 60_000

export const isClockTime = (raw: unknown): raw is string => typeof raw === 'string' && TIME.test(raw)

function atClock(day: Date, time: string): number {
  const m = TIME.exec(time)
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(m?.[1] ?? 0), Number(m?.[2] ?? 0), 0, 0)
  return d.getTime()
}

const startOfDay = (t: number): Date => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

/** End of the `until` day (local), or Infinity. */
function untilEnd(until: string | undefined): number {
  const m = until ? DAY.exec(until) : null
  if (!m) return Infinity
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1).getTime() - 1
}

const daysOf = (timing: ScheduleTiming): readonly number[] | null =>
  timing.kind === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : timing.kind === 'weekdays' ? [1, 2, 3, 4, 5] : timing.kind === 'weekly' ? timing.days : null

/** The first time the task is due strictly after `after`, or null when it never is again. */
export function nextOccurrence(timing: ScheduleTiming, anchor: number, after: number, until?: string): number | null {
  const end = untilEnd(until)
  let next: number | null
  if (timing.kind === 'once') next = timing.at > after ? timing.at : null
  else if (timing.kind === 'interval') {
    const step = timing.minutes * MINUTE
    next = after < anchor ? anchor : anchor + (Math.floor((after - anchor) / step) + 1) * step
  } else {
    next = null
    const days = daysOf(timing) ?? []
    for (let i = 0; i < 8 && next === null; i++) {
      const day = addDays(startOfDay(after), i)
      if (!days.includes(day.getDay())) continue
      const t = atClock(day, timing.time)
      if (t > after) next = t
    }
  }
  return next !== null && next <= end ? next : null
}

/** The latest time the task was due at or before `at`, or null when it never was. */
export function lastOccurrence(timing: ScheduleTiming, anchor: number, at: number, until?: string): number | null {
  const capped = Math.min(at, untilEnd(until))
  if (timing.kind === 'once') return timing.at <= capped ? timing.at : null
  if (timing.kind === 'interval') {
    if (capped < anchor) return null
    const step = timing.minutes * MINUTE
    return anchor + Math.floor((capped - anchor) / step) * step
  }
  const days = daysOf(timing) ?? []
  for (let i = 0; i < 8; i++) {
    const day = addDays(startOfDay(capped), -i)
    if (!days.includes(day.getDay())) continue
    const t = atClock(day, timing.time)
    if (t <= capped) return t
  }
  return null
}

/** When the task runs next, as the list shows it; null when it is off or done. */
export function nextRun(schedule: Schedule, now: number): number | null {
  if (!schedule.enabled || expired(schedule, now)) return null
  return nextOccurrence(schedule.timing, schedule.anchor, Math.max(now, schedule.handledThrough), schedule.until)
}

export const expired = (schedule: Schedule, now: number): boolean => schedule.expiresAt !== undefined && schedule.expiresAt <= now

export type Due =
  /** Run it; `caughtUp` when it is late (the Mac slept, Wavi was not running). */
  | { type: 'run'; planned: number; caughtUp: boolean }
  /** Its time passed while nothing could run it and the task says 跳过: record it, do not run. */
  | { type: 'missed'; planned: number }

/**
 * What is due now. Only the latest time not yet handled counts: earlier ones that were missed are dropped, never
 * run in a row (Codex #24327). A late one runs only under 补跑一次 — and it is necessarily before the next time,
 * since it is the latest one at or before now.
 */
export function dueNow(schedule: Schedule, now: number): Due | null {
  if (!schedule.enabled || expired(schedule, now)) return null
  const planned = lastOccurrence(schedule.timing, schedule.anchor, now, schedule.until)
  if (planned === null || planned <= schedule.handledThrough || planned < schedule.createdAt) return null
  const late = now - planned > ON_TIME_MS
  if (late && schedule.missed === 'skip') return { type: 'missed', planned }
  return { type: 'run', planned, caughtUp: late }
}

/** The earliest moment any of these tasks needs a look (due or expiring): the pty daemon wakes the app then. */
export function nextWake(schedules: readonly Schedule[], now: number): number | null {
  let wake: number | null = null
  for (const s of schedules) {
    const candidates = [nextRun(s, now), s.enabled && s.expiresAt !== undefined && s.expiresAt > now ? s.expiresAt : null]
    for (const t of candidates) if (t !== null && (wake === null || t < wake)) wake = t
  }
  return wake
}

// ── records ───────────────────────────────────────────────────────────────────

/** The task after a run's outcome (new or updated): newest first, MAX_RUNS kept, failures counted, paused at MAX_FAILURES. */
export function recordRun(schedule: Schedule, run: ScheduleRun): Schedule {
  const rest = schedule.runs.filter((r) => !(r.planned === run.planned && !!r.manual === !!run.manual))
  const runs = [run, ...rest].sort((a, b) => b.at - a.at).slice(0, MAX_RUNS)
  const handledThrough = run.manual ? schedule.handledThrough : Math.max(schedule.handledThrough, run.planned)
  let failures = schedule.failures
  if (run.outcome === 'failed') failures += 1
  else if (run.outcome !== 'skipped' && run.outcome !== 'running') failures = 0
  const pause = failures >= MAX_FAILURES
  // 一次 runs once: whatever happened to its time, it is done.
  const doneOnce = schedule.timing.kind === 'once' && !run.manual && run.outcome !== 'running'
  return {
    ...schedule,
    runs,
    handledThrough,
    failures: pause ? 0 : failures,
    ...(pause ? { enabled: false, paused: 'failures' as const } : {}),
    ...(doneOnce ? { enabled: false } : {})
  }
}

/** Turning a task on again clears its pause and starts from now (nothing it missed while off runs). */
export function setEnabled(schedule: Schedule, enabled: boolean, now: number): Schedule {
  const { paused: _paused, ...rest } = schedule
  return { ...rest, enabled, failures: 0, ...(enabled ? { handledThrough: Math.max(schedule.handledThrough, now) } : {}) }
}

/** A new task from the sheet. */
export function createSchedule(draft: ScheduleDraft, id: string, now: number, createdBy?: { sessionId: string }): Schedule {
  return {
    ...draft,
    id,
    createdAt: now,
    anchor: now,
    failures: 0,
    handledThrough: now,
    runs: [],
    ...(createdBy ? { createdBy, expiresAt: now + AGENT_SCHEDULE_TTL_MS } : {})
  }
}

/** An edit from the sheet: the history stays; a changed time starts counting again from now. */
export function updateSchedule(schedule: Schedule, draft: ScheduleDraft, now: number): Schedule {
  const retimed = JSON.stringify(schedule.timing) !== JSON.stringify(draft.timing) || schedule.until !== draft.until
  const next: Schedule = { ...schedule, ...draft, ...(retimed ? { anchor: now, handledThrough: Math.max(schedule.handledThrough, now) } : {}) }
  return draft.enabled && !schedule.enabled ? setEnabled(next, true, now) : next
}

/** 保留: an agent's task stops expiring. */
export function keepSchedule(schedule: Schedule): Schedule {
  const { expiresAt: _expiresAt, ...rest } = schedule
  return rest
}

// ── labels (Figma 67′) ────────────────────────────────────────────────────────

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'] as const
export const pad = (n: number): string => String(n).padStart(2, '0')
export const clock = (t: number): string => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`
export const monthDay = (t: number): string => `${pad(new Date(t).getMonth() + 1)}-${pad(new Date(t).getDate())}`

/** `每天 09:00` · `工作日 08:30` · `每周五 17:00` · `每周一、三 10:00` · `每隔 30 分钟` · `每隔 2 小时` · `11-12 09:00 一次`. */
export function timingLabel(timing: ScheduleTiming): string {
  switch (timing.kind) {
    case 'interval':
      return timing.minutes % 60 === 0 ? `每隔 ${timing.minutes / 60} 小时` : `每隔 ${timing.minutes} 分钟`
    case 'daily':
      return `每天 ${timing.time}`
    case 'weekdays':
      return `工作日 ${timing.time}`
    case 'weekly': {
      const days = [...timing.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      return `每周${days.map((d) => WEEKDAY[d]).join('、')} ${timing.time}`
    }
    case 'once':
      return `${monthDay(timing.at)} ${clock(timing.at)} 一次`
  }
}

/** `14:30` (today) · `明天 09:00` · `本周五 17:00` · `下周一 10:00` · `11-28 09:00`. */
export function whenLabel(t: number, now: number): string {
  const days = Math.round((startOfDay(t).getTime() - startOfDay(now).getTime()) / (24 * 60 * MINUTE))
  if (days === 0) return clock(t)
  if (days === 1) return `明天 ${clock(t)}`
  const weekStart = (x: number): number => addDays(startOfDay(x), -((new Date(x).getDay() + 6) % 7)).getTime()
  const weeks = Math.round((weekStart(t) - weekStart(now)) / (7 * 24 * 60 * MINUTE))
  if (weeks === 0 && days > 0) return `本周${WEEKDAY[new Date(t).getDay()]} ${clock(t)}`
  if (weeks === 1) return `下周${WEEKDAY[new Date(t).getDay()]} ${clock(t)}`
  return `${monthDay(t)} ${clock(t)}`
}

/** A run as the list's second line and the history show it: `没有改动，已归档`, `跳过：前置检查没过`, `补跑 · 已发送`. */
export function runLabel(run: ScheduleRun): string {
  const base =
    run.outcome === 'running'
      ? '运行中'
      : run.outcome === 'opened'
        ? (run.reason ?? '已开出会话')
        : run.outcome === 'sent'
          ? '已发送'
          : run.outcome === 'archived'
            ? '没有改动，已归档'
            : run.outcome === 'skipped'
              ? `跳过：${run.reason ?? '未知原因'}`
              : `失败：${run.reason ?? '未知原因'}`
  return run.manual ? `立即运行 · ${base}` : run.caughtUp ? `补跑 · ${base}` : base
}

/** The session a run opens: `每日依赖检查 · 11-09 09:00`. */
export const runSessionTitle = (name: string, planned: number): string => `${name} · ${monthDay(planned)} ${clock(planned)}`

/** Its branch: the user's prefix, then the name's ASCII words (else `schedule`), then `MMDD-HHmm`. */
export function runBranch(prefix: string, name: string, planned: number): string {
  const words = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '')
  const d = new Date(planned)
  return `${prefix}${words || 'schedule'}-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

// ── validation (everything from the renderer or the file) ─────────────────────

const record = (raw: unknown): Record<string, unknown> | null => (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null)
const controls = (s: string, allowNewlines: boolean): boolean => [...s].some((c) => {
  const code = c.charCodeAt(0)
  return (code < 32 && !(allowNewlines && (c === '\n' || c === '\t'))) || code === 127
})
const line = (raw: unknown, max: number): string | null => (typeof raw === 'string' && raw.trim().length > 0 && raw.length <= max && !controls(raw, false) ? raw : null)
/** A task's or session's id as the file, IPC and `wavi unschedule` take it. */
export const isScheduleId = (raw: unknown): raw is string => typeof raw === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(raw)
const id = (raw: unknown): string | null => (isScheduleId(raw) ? raw : null)
const time = (raw: unknown): number | null => (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null)

export function parseTiming(raw: unknown): ScheduleTiming | null {
  const r = record(raw)
  if (!r) return null
  switch (r.kind) {
    case 'interval': {
      const m = r.minutes
      return typeof m === 'number' && Number.isInteger(m) && m >= MIN_INTERVAL_MINUTES && m <= MAX_INTERVAL_MINUTES ? { kind: 'interval', minutes: m } : null
    }
    case 'daily':
    case 'weekdays':
      return isClockTime(r.time) ? { kind: r.kind, time: r.time } : null
    case 'weekly': {
      if (!isClockTime(r.time) || !Array.isArray(r.days)) return null
      const days = [...new Set(r.days)].filter((d): d is Weekday => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
      return days.length > 0 && days.length === r.days.length ? { kind: 'weekly', days: days.sort(), time: r.time } : null
    }
    case 'once': {
      const at = time(r.at)
      return at !== null ? { kind: 'once', at } : null
    }
    default:
      return null
  }
}

export function parseAction(raw: unknown): ScheduleAction | null {
  const r = record(raw)
  if (!r) return null
  if (r.kind === 'send') {
    const sessionId = id(r.sessionId)
    return sessionId ? { kind: 'send', sessionId } : null
  }
  if (r.kind !== 'new') return null
  const projectId = id(r.projectId)
  const base = line(r.base, 250)
  if (!projectId || !base || !isCliAgent(r.agent) || (r.ui !== 'cli' && r.ui !== 'gui') || typeof r.autoArchive !== 'boolean') return null
  const model = r.model === undefined ? undefined : line(r.model, 100)
  const precheck = r.precheck === undefined ? undefined : line(r.precheck, MAX_PRECHECK)
  if (model === null || precheck === null) return null
  if (r.permission !== undefined && !isGuiPermission(r.permission)) return null
  return {
    kind: 'new',
    projectId,
    base,
    agent: r.agent,
    ui: r.ui,
    autoArchive: r.autoArchive,
    ...(model ? { model } : {}),
    ...(r.permission !== undefined ? { permission: r.permission as GuiPermission } : {}),
    ...(precheck ? { precheck } : {})
  }
}

/** The sheet's fields; null when anything is off. */
export function parseDraft(raw: unknown): ScheduleDraft | null {
  const r = record(raw)
  if (!r) return null
  const name = line(r.name, MAX_NAME)
  const action = parseAction(r.action)
  const timing = parseTiming(r.timing)
  const prompt = typeof r.prompt === 'string' && r.prompt.trim() && r.prompt.length <= MAX_PROMPT && !controls(r.prompt, true) ? r.prompt : null
  if (!name || !action || !timing || !prompt || typeof r.enabled !== 'boolean' || (r.missed !== 'catch-up' && r.missed !== 'skip')) return null
  if (r.until !== undefined && (typeof r.until !== 'string' || !DAY.test(r.until))) return null
  return { name, enabled: r.enabled, action, prompt, timing, missed: r.missed, ...(r.until !== undefined ? { until: r.until as string } : {}) }
}

const OUTCOMES: readonly RunOutcome[] = ['running', 'opened', 'sent', 'archived', 'skipped', 'failed']

export function parseRun(raw: unknown): ScheduleRun | null {
  const r = record(raw)
  const planned = time(r?.planned)
  const at = time(r?.at)
  if (!r || planned === null || at === null || !OUTCOMES.includes(r.outcome as RunOutcome)) return null
  const reason = r.reason === undefined ? undefined : line(r.reason, 200)
  const sessionId = r.sessionId === undefined ? undefined : id(r.sessionId)
  if (reason === null || sessionId === null) return null
  return {
    planned,
    at,
    outcome: r.outcome as RunOutcome,
    ...(reason ? { reason } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(r.caughtUp === true ? { caughtUp: true } : {}),
    ...(r.manual === true ? { manual: true } : {})
  }
}

/** One task from `schedules.json`; null drops it. */
export function parseSchedule(raw: unknown): Schedule | null {
  const r = record(raw)
  const draft = parseDraft(r)
  const sid = id(r?.id)
  const createdAt = time(r?.createdAt)
  const anchor = time(r?.anchor)
  const handledThrough = time(r?.handledThrough)
  if (!r || !draft || !sid || createdAt === null || anchor === null || handledThrough === null) return null
  const createdBy = record(r.createdBy)
  const by = createdBy ? id(createdBy.sessionId) : undefined
  const expiresAt = r.expiresAt === undefined ? undefined : time(r.expiresAt)
  if (by === null || expiresAt === null) return null
  const failures = typeof r.failures === 'number' && Number.isInteger(r.failures) && r.failures >= 0 && r.failures < MAX_FAILURES ? r.failures : 0
  const runs = (Array.isArray(r.runs) ? r.runs : []).map(parseRun).filter((x): x is ScheduleRun => x !== null).slice(0, MAX_RUNS)
  return {
    ...draft,
    id: sid,
    createdAt,
    anchor,
    handledThrough,
    failures,
    runs,
    ...(by ? { createdBy: { sessionId: by } } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(r.paused === 'failures' ? { paused: 'failures' as const } : {})
  }
}

export function parseSchedules(raw: unknown): Schedule[] {
  const list = Array.isArray(record(raw)?.schedules) ? (record(raw)?.schedules as unknown[]) : []
  const seen = new Set<string>()
  const out: Schedule[] = []
  for (const item of list) {
    const s = parseSchedule(item)
    if (!s || seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
    if (out.length >= MAX_SCHEDULES) break
  }
  return out
}

// ── IPC (PRD F24) ─────────────────────────────────────────────────────────────

/** Main → renderer: run this task now (the renderer answers with `report`). */
export interface ScheduleFire {
  schedule: Schedule
  planned: number
  caughtUp: boolean
  manual: boolean
}

export interface ScheduleApi {
  list(): Promise<Schedule[]>
  /** `createdBy`: the session whose agent asked for it (`wavi schedule`); the task then expires in 7 days unless kept. */
  create(draft: ScheduleDraft, createdBy?: string): Promise<Schedule | null>
  update(id: string, draft: ScheduleDraft): Promise<Schedule | null>
  setEnabled(id: string, enabled: boolean): Promise<void>
  keep(id: string): Promise<void>
  remove(id: string): Promise<void>
  runNow(id: string): Promise<void>
  /** The renderer's outcome of a fire, or a later change to it (opened → archived). */
  report(id: string, run: ScheduleRun): Promise<void>
  /** The window can run fires now (its workspace loaded). */
  ready(): void
  onChanged(listener: (schedules: Schedule[]) => void): () => void
  onFire(listener: (fire: ScheduleFire) => void): () => void
}

export const SCHEDULE_IPC = {
  list: 'schedule:list',
  create: 'schedule:create',
  update: 'schedule:update',
  setEnabled: 'schedule:set-enabled',
  keep: 'schedule:keep',
  remove: 'schedule:remove',
  runNow: 'schedule:run-now',
  report: 'schedule:report',
  ready: 'schedule:ready',
  changed: 'schedule:changed',
  fire: 'schedule:fire'
} as const
