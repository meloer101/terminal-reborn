// The runs a window drives that must outlive it (architecture review, batch 6): an unfinished 自动修复 fix, an open
// Ship block, dispatch's waiting 开始 and reports. They are saved with the workspace file (main validates them here)
// and taken up again after a reload, a crash or a restart. The switches themselves stay the window's (PRD v1.65).
import type { BrakeDecision, FixRun, FixScope } from './auto-fix-brakes'
import { emptyQueue, type ChildReport, type HeldItem, type PendingStart, type ReportQueue } from './dispatch'
import { isCliAgent } from './agents'
import { parseCreateRequest } from './new-session'
import type { RiskMarker } from './risk-markers'
import type { FlowStep, ShipError, ShipKind, ShipStage, ShipState, ShipTexts, StepId, StepState } from './ship'
import type { SessionId } from './types'

const MAX_RUNS = 100
const MAX_TEXT = 100_000
const MAX_LIST = 200
const SHA = /^[0-9a-f]{7,64}$/

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max && !v.includes('\0')
const isPath = (v: unknown): v is string => isText(v, 4096) && v.startsWith('/')
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const textList = (v: unknown, max = MAX_LIST): string[] | null => (Array.isArray(v) && v.length <= max && v.every((x) => isText(x, 4096)) ? [...v] : null)
const optional = <K extends string, T>(key: K, value: T | undefined): Partial<Record<K, T>> => (value === undefined ? {} : ({ [key]: value } as Record<K, T>))

// --- 自动修复 -------------------------------------------------------------------------------------------------------

/** A fix that had not finished when the window went: it comes back stopped, its commits not pushed unchecked. */
export interface SavedFixRun {
  scope: FixScope
  worktree: string
  /** The PR's number (0: the base after 合并到 main 并推送). */
  number: number
  run: FixRun
}

const STOP_REASONS: ReadonlySet<unknown> = new Set(['weakened', 'repeated', 'limit', 'no-progress', 'interrupted'])
const RISK_KINDS: ReadonlySet<unknown> = new Set(['test-deleted', 'test-skipped', 'check-silenced', 'ci-config', 'dependencies', 'migration'])

function sanitizeMarkers(raw: unknown): RiskMarker[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const markers = raw.filter((m): m is RiskMarker => isRecord(m) && RISK_KINDS.has(m.kind) && isText(m.path, 4096) && isCount(m.count))
  return markers.slice(0, MAX_LIST).map((m) => ({ kind: m.kind, path: m.path, count: m.count, ...(m.wholeFile === true ? { wholeFile: true } : {}) }))
}

function sanitizeStop(raw: unknown): Exclude<BrakeDecision, { kind: 'push' }> | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'ask') {
    const checks = textList(raw.checks)
    return raw.reason === 'base-broken' && checks ? { kind: 'ask', reason: 'base-broken', checks } : null
  }
  if (raw.kind !== 'stop' || !STOP_REASONS.has(raw.reason)) return null
  const markers = sanitizeMarkers(raw.markers)
  return {
    kind: 'stop',
    reason: raw.reason as Extract<BrakeDecision, { kind: 'stop' }>['reason'],
    ...optional('markers', markers),
    ...optional('attempts', isCount(raw.attempts) ? raw.attempts : undefined)
  }
}

function sanitizeFixRun(raw: unknown): FixRun | null {
  if (!isRecord(raw) || !isText(raw.sessionId, 256) || !isText(raw.key)) return null
  const checks = textList(raw.checks)
  const baseFailing = raw.baseFailing === null ? null : textList(raw.baseFailing)
  if (!checks || (raw.baseFailing !== null && !baseFailing)) return null
  const base = { sessionId: raw.sessionId, key: raw.key, checks, baseFailing }
  const since = typeof raw.since === 'string' && SHA.test(raw.since) ? raw.since : null
  if (raw.kind === 'fixing') return since && isTime(raw.sentAt) ? { ...base, kind: 'fixing', since, sentAt: raw.sentAt } : null
  if (raw.kind === 'pushing') return since ? { ...base, kind: 'pushing', since } : null
  if (raw.kind !== 'stopped' || (raw.since !== null && !since)) return null
  const decision = sanitizeStop(raw.decision)
  return decision ? { ...base, kind: 'stopped', since, decision } : null
}

export function sanitizeFixRuns(raw: unknown, worktrees: ReadonlySet<string>): SavedFixRun[] {
  if (!Array.isArray(raw)) return []
  const runs: SavedFixRun[] = []
  for (const item of raw.slice(0, MAX_RUNS)) {
    if (!isRecord(item) || (item.scope !== 'pr' && item.scope !== 'base') || !isPath(item.worktree) || !worktrees.has(item.worktree)) continue
    if (!isCount(item.number)) continue
    const run = sanitizeFixRun(item.run)
    if (run) runs.push({ scope: item.scope, worktree: item.worktree, number: item.number, run })
  }
  return runs
}

// --- the Ship block ----------------------------------------------------------------------------------------------

/** What a Ship run needs that does not change while it runs (the renderer's ShipContext without the settings). */
export interface SavedShipContext {
  root: string
  worktree: string
  sessionId: SessionId | null
  base: string
  branch: string
  remote: string | null
  /** Uncommitted paths to commit (null: nothing). */
  paths: string[] | null
  openPr: { number: number; url: string } | null
  checksLine: string | null
  openIn: SessionId | null
}

/** An open Ship block: its context, its state, and what main already did (commit, merge). */
export interface SavedShipRun {
  kind: ShipKind
  ctx: SavedShipContext
  committed: boolean
  /** The merge commit 合并到 main 并推送 kept although its push failed. */
  merged?: string
  state: ShipState
}

const SHIP_KINDS: ReadonlySet<unknown> = new Set(['main', 'pr', 'push-pr'])
const STEP_IDS: ReadonlySet<unknown> = new Set(['review', 'write', 'commit', 'merge', 'push', 'create'])
const STEP_STATES: ReadonlySet<unknown> = new Set(['pending', 'working', 'done', 'failed'])
const STAGES: ReadonlySet<unknown> = new Set(['writing', 'glance', 'running'])
const isRelative = (v: unknown): v is string => isText(v, 4096) && v !== '' && !v.startsWith('/') && !v.split('/').includes('..')

function sanitizeContext(raw: unknown): SavedShipContext | null {
  if (!isRecord(raw) || !isPath(raw.root) || !isPath(raw.worktree) || !isText(raw.base, 256) || !isText(raw.branch, 256)) return null
  const nullableText = (v: unknown, max = 4096): string | null | undefined => (v === null ? null : isText(v, max) ? v : undefined)
  const sessionId = nullableText(raw.sessionId, 256)
  const remote = nullableText(raw.remote, 256)
  const checksLine = nullableText(raw.checksLine)
  const openIn = nullableText(raw.openIn, 256)
  if (sessionId === undefined || remote === undefined || checksLine === undefined || openIn === undefined) return null
  let paths: string[] | null = null
  if (raw.paths !== null) {
    if (!Array.isArray(raw.paths) || raw.paths.length > 10_000 || !raw.paths.every(isRelative)) return null
    paths = [...raw.paths]
  }
  let openPr: SavedShipContext['openPr'] = null
  if (raw.openPr !== null) {
    if (!isRecord(raw.openPr) || !isCount(raw.openPr.number) || !isText(raw.openPr.url, 4096)) return null
    openPr = { number: raw.openPr.number, url: raw.openPr.url }
  }
  return { root: raw.root, worktree: raw.worktree, sessionId, base: raw.base, branch: raw.branch, remote, paths, openPr, checksLine, openIn }
}

function sanitizeShipState(raw: unknown): ShipState | null {
  if (!isRecord(raw) || !SHIP_KINDS.has(raw.kind) || !isText(raw.title, 256) || !isText(raw.agent, 256) || !STAGES.has(raw.stage)) return null
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > 10) return null
  const steps: FlowStep[] = []
  for (const step of raw.steps) {
    if (!isRecord(step) || !STEP_IDS.has(step.id) || !isText(step.label, 256) || !STEP_STATES.has(step.state)) return null
    steps.push({ id: step.id as StepId, label: step.label, state: step.state as StepState, ...optional('note', isText(step.note, 1024) ? step.note : undefined) })
  }
  const t = raw.texts
  if (!isRecord(t) || !isText(t.commit) || !isText(t.title, 1024) || !isText(t.body) || typeof t.draft !== 'boolean') return null
  const texts: ShipTexts = { commit: t.commit, title: t.title, body: t.body, draft: t.draft }
  let error: ShipError | null = null
  if (raw.error !== null) {
    const e = raw.error
    if (!isRecord(e) || !STEP_IDS.has(e.step) || !isText(e.message, 4096)) return null
    const conflicts = e.conflicts === undefined ? undefined : textList(e.conflicts, 10_000)
    if (conflicts === null) return null
    error = {
      step: e.step as StepId,
      message: e.message,
      ...optional('output', isText(e.output) ? e.output : undefined),
      ...optional('conflicts', conflicts),
      ...optional('pushRefused', e.pushRefused === true ? true : undefined)
    }
  }
  if (raw.failedIn !== null && !STAGES.has(raw.failedIn)) return null
  return { kind: raw.kind as ShipKind, title: raw.title, agent: raw.agent, steps, stage: raw.stage as ShipStage, texts, error, failedIn: raw.failedIn as ShipStage | null }
}

export function sanitizeShipRuns(raw: unknown, worktrees: ReadonlySet<string>): SavedShipRun[] {
  if (!Array.isArray(raw)) return []
  const runs: SavedShipRun[] = []
  const seen = new Set<string>()
  for (const item of raw.slice(0, MAX_RUNS)) {
    if (!isRecord(item) || !SHIP_KINDS.has(item.kind) || typeof item.committed !== 'boolean') continue
    const ctx = sanitizeContext(item.ctx)
    const state = sanitizeShipState(item.state)
    if (!ctx || !state || !worktrees.has(ctx.worktree) || seen.has(ctx.worktree)) continue
    if (item.merged !== undefined && !(typeof item.merged === 'string' && SHA.test(item.merged))) continue
    seen.add(ctx.worktree)
    runs.push({ kind: item.kind as ShipKind, ctx, committed: item.committed, ...optional('merged', item.merged as string | undefined), state })
  }
  return runs
}

// --- dispatch ----------------------------------------------------------------------------------------------------

/** `wavi run` requests waiting for 开始, and the reports on their way to each dispatcher (by its session). */
export interface SavedDispatch {
  confirms: PendingStart[]
  queues: Record<SessionId, ReportQueue>
  held: Record<SessionId, HeldItem[]>
}

const CHILD_EVENTS: ReadonlySet<unknown> = new Set(['report', 'done', 'error', 'exited'])

function sanitizePending(raw: unknown): PendingStart | null {
  if (!isRecord(raw) || !isText(raw.callId, 256) || !isText(raw.parentId, 256) || !isText(raw.childId, 256)) return null
  if (!isText(raw.base, 256) || typeof raw.uncommitted !== 'boolean' || !isRecord(raw.plan)) return null
  const { item, branch, path, request } = raw.plan
  const parsed = parseCreateRequest(request)
  if (!isRecord(item) || !isCliAgent(item.agent) || !isText(item.task) || !isText(item.title, 1024) || (item.base !== 'head' && item.base !== 'snapshot')) return null
  if (!parsed || !isText(branch, 256) || !isPath(path)) return null
  return {
    callId: raw.callId,
    parentId: raw.parentId,
    childId: raw.childId,
    base: raw.base,
    uncommitted: raw.uncommitted,
    plan: { item: { agent: item.agent, task: item.task, title: item.title, ...optional('model', isText(item.model, 256) ? item.model : undefined), base: item.base }, branch, path, request: parsed }
  }
}

function sanitizeReport(raw: unknown): ChildReport | null {
  if (!isRecord(raw) || !isText(raw.childId, 256) || !isText(raw.title, 1024) || !isCliAgent(raw.agent) || !CHILD_EVENTS.has(raw.event) || !isText(raw.branch, 256)) return null
  const text = (key: string, max = MAX_TEXT): string | undefined => (isText(raw[key], max) ? (raw[key] as string) : undefined)
  return {
    childId: raw.childId,
    title: raw.title,
    agent: raw.agent,
    event: raw.event as ChildReport['event'],
    branch: raw.branch,
    ...optional('model', text('model', 256)),
    ...optional('changes', text('changes', 1024)),
    ...optional('checks', text('checks', 1024)),
    ...optional('conflicts', text('conflicts', 1024)),
    ...optional('message', text('message')),
    ...optional('turn', isTime(raw.turn) ? raw.turn : undefined)
  }
}

function sanitizeQueue(raw: unknown): ReportQueue | null {
  if (!isRecord(raw) || !Array.isArray(raw.pending)) return null
  const pending = raw.pending.slice(0, MAX_LIST).map(sanitizeReport)
  if (pending.some((r) => r === null)) return null
  const sent = Array.isArray(raw.sent) && raw.sent.every(isTime) ? (raw.sent as number[]).slice(-MAX_LIST) : null
  const seen = textList(raw.seen, 10_000)
  if (!sent || !seen || (raw.lastAt !== null && !isTime(raw.lastAt))) return null
  return { ...emptyQueue(), pending: pending as ChildReport[], lastAt: raw.lastAt as number | null, sent, seen }
}

function sanitizeHeld(raw: unknown): HeldItem | null {
  if (!isRecord(raw)) return null
  if (raw.kind === 'report') {
    const report = sanitizeReport(raw.report)
    return report ? { kind: 'report', report } : null
  }
  return raw.kind === 'message' && isText(raw.key, 1024) && isText(raw.title, 1024) && isText(raw.text) ? { kind: 'message', key: raw.key, title: raw.title, text: raw.text } : null
}

/** Null when nothing worth keeping is left (sessions gone, bad data). */
export function sanitizeSavedDispatch(raw: unknown, sessions: ReadonlySet<string>): SavedDispatch | null {
  if (!isRecord(raw)) return null
  const confirms = (Array.isArray(raw.confirms) ? raw.confirms.slice(0, MAX_RUNS) : [])
    .map(sanitizePending)
    .filter((p): p is PendingStart => p !== null && sessions.has(p.parentId))
  const queues: Record<SessionId, ReportQueue> = {}
  if (isRecord(raw.queues)) {
    for (const [id, queue] of Object.entries(raw.queues)) {
      const clean = sessions.has(id) ? sanitizeQueue(queue) : null
      if (clean) queues[id] = clean
    }
  }
  const held: Record<SessionId, HeldItem[]> = {}
  if (isRecord(raw.held)) {
    for (const [id, items] of Object.entries(raw.held)) {
      if (!sessions.has(id) || !Array.isArray(items)) continue
      const clean = items.slice(0, MAX_LIST).map(sanitizeHeld).filter((h): h is HeldItem => h !== null)
      if (clean.length > 0) held[id] = clean
    }
  }
  return confirms.length > 0 || Object.keys(queues).length > 0 || Object.keys(held).length > 0 ? { confirms, queues, held } : null
}
