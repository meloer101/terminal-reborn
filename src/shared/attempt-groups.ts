// 同任务多解 (PRD F4 v1.68, was 一题多解 since v1.59; Figma 26): the task of a session sent to 2–4 new worktrees off
// that session's branch — any installed agents, Claude ×1 · Codex ×1 · Gemini ×1, say — kept together as an attempt
// group. The session it came from is not one of them: it gets one combined report once they have all stopped, sums
// them up, and carries on after the user merges one back into its branch. Pure: the group model and its
// workspace.json format, the N-way launch plan, the brief each member starts with, the diff summary each member
// shows, and the report.
import type { GitChanges } from './git-graph/log'
import { branchNameProblem, folderNameFor, type BranchNameProblem, type NewSessionBranch, type WorktreeCreateRequest } from './new-session'
import { agentName, type CliAgent } from './agents'
import { ATTEMPT_REPORT_HEADER } from './dispatch'
import type { SessionId, SessionStatus } from './types'

/** Every installed CLI can take a part (v1.68). */
export type AttemptAgent = CliAgent

/** Fewer than two is just a session; more than four does not fit side by side in the overview overlay (F9). */
export const MIN_ATTEMPTS = 2
export const MAX_ATTEMPTS = 4
export const MAX_ATTEMPT_PROMPT = 20_000
const MAX_GROUPS = 50
const MAX_BASE = 255
const MAX_TITLE = 200

/** One row of 份数: an agent and how many parts it takes (a row stepped down to 0 leaves the list). */
export interface AttemptRow {
  kind: AttemptAgent
  count: number
}

export interface AttemptGroup {
  id: string
  /** The task every member was sent (without Wavi's brief). */
  prompt: string
  /** The branch the members' worktrees started from: the session they came from is on it. */
  base: string
  createdAt: number
  /** The members' sessions, in launch order (closed ones are pruned). */
  members: SessionId[]
  /** The session the task came from, which gets the report and carries on (absent in groups made before v1.68). */
  reportTo?: SessionId
  /** The members' settle last reported to `reportTo` (settledKey), so one settle is reported once. */
  reported?: string
  /** Set once one member was merged into the base (the merge sheet); the others are then offered for archive. */
  merged?: { sessionId: SessionId; branch: string; at: number }
}

// --- 份数 ---------------------------------------------------------------------------------------------------------

/** The agents to launch, row by row: `[claude ×2, codex ×1]` → claude, claude, codex. */
export function attemptKinds(rows: readonly AttemptRow[]): AttemptAgent[] {
  return rows.flatMap((row) => Array<AttemptAgent>(Math.max(0, row.count)).fill(row.kind))
}

export type AttemptCountProblem = 'too-few' | 'too-many'

export function attemptCountProblem(rows: readonly AttemptRow[]): AttemptCountProblem | null {
  const total = attemptKinds(rows).length
  return total < MIN_ATTEMPTS ? 'too-few' : total > MAX_ATTEMPTS ? 'too-many' : null
}

/** Steps a row by ±1, past nothing that makes the total exceed MAX_ATTEMPTS; a row at 0 is dropped (加一个智能体 adds it back). */
export function stepRow(rows: readonly AttemptRow[], kind: AttemptAgent, delta: 1 | -1): AttemptRow[] {
  const next = rows.map((row) => (row.kind === kind ? { ...row, count: row.count + delta } : row)).filter((row) => row.count > 0)
  return attemptKinds(next).length > MAX_ATTEMPTS ? [...rows] : next
}

/** 加一个智能体: one more part for an agent already listed, else a new row with one; nothing past MAX_ATTEMPTS. */
export function addAgentRow(rows: readonly AttemptRow[], kind: AttemptAgent): AttemptRow[] {
  if (attemptKinds(rows).length >= MAX_ATTEMPTS) return [...rows]
  return rows.some((row) => row.kind === kind) ? stepRow(rows, kind, 1) : [...rows, { kind, count: 1 }]
}

/**
 * The rows the dialog starts with: the session's own agent and the next installed ones, one part each, three in all;
 * with a single agent installed, two parts of it.
 */
export function defaultRows(origin: AttemptAgent | null, installed: readonly AttemptAgent[]): AttemptRow[] {
  const order = [...(origin && installed.includes(origin) ? [origin] : []), ...installed.filter((kind) => kind !== origin)]
  const only = order[0] ?? origin ?? 'claude'
  return order.length <= 1 ? [{ kind: only, count: 2 }] : order.slice(0, 3).map((kind) => ({ kind, count: 1 }))
}

/** Each member's name in the group: `Claude Code 1`, `Claude Code 2`, `Codex` (a number only when an agent repeats). */
export function memberLabels(kinds: readonly AttemptAgent[]): string[] {
  const seen = new Map<AttemptAgent, number>()
  return kinds.map((kind) => {
    const n = (seen.get(kind) ?? 0) + 1
    seen.set(kind, n)
    return kinds.filter((k) => k === kind).length > 1 ? `${agentName(kind)} ${n}` : agentName(kind)
  })
}

/** A member's session title: `<the session's title> · Codex` (the sidebar shows only the part after its parent's). */
export function memberTitle(parentTitle: string, label: string): string {
  const title = parentTitle.trim() ? `${parentTitle.trim()} · ${label}` : label
  return [...title].slice(0, MAX_TITLE).join('')
}

/** The members' branches: `<stem>-2`, `-3`, … past any that exist (the session's own branch is `<stem>`). */
export function memberBranches(stem: string, count: number, taken: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (let n = 2; out.length < count; n++) {
    const name = `${stem}-${n}`
    if (!taken.has(name)) out.push(name)
  }
  return out
}

// --- the launch plan ----------------------------------------------------------------------------------------------

export interface AttemptMemberPlan {
  kind: AttemptAgent
  label: string
  path: string
  request: WorktreeCreateRequest
}

export type AttemptPlanProblem = AttemptCountProblem | BranchNameProblem | 'prompt-empty' | 'prompt-too-long'

export interface AttemptPlanInput {
  root: string
  base: string
  /** The branch-name stem (the session's branch, or a generated name when it is on the default branch). */
  stem: string
  rows: readonly AttemptRow[]
  prompt: string
  prepare: boolean
  branches: readonly NewSessionBranch[]
  worktreesDir: string
  takenFolders: readonly string[]
}

export function promptProblem(prompt: string): 'prompt-empty' | 'prompt-too-long' | null {
  if (prompt.trim() === '') return 'prompt-empty'
  return prompt.length > MAX_ATTEMPT_PROMPT ? 'prompt-too-long' : null
}

/** One worktree per member, all off `base`: branch `<stem>-N` (the next free numbers from 2), a folder of its own. */
export function planAttempts(input: AttemptPlanInput): { members: AttemptMemberPlan[]; problem: null } | { members: null; problem: AttemptPlanProblem } {
  const countProblem = attemptCountProblem(input.rows)
  if (countProblem) return { members: null, problem: countProblem }
  const stemProblem = branchNameProblem(input.stem, [])
  if (stemProblem) return { members: null, problem: stemProblem }
  const prompt = promptProblem(input.prompt)
  if (prompt) return { members: null, problem: prompt }
  const kinds = attemptKinds(input.rows)
  const branches = memberBranches(input.stem, kinds.length, new Set(input.branches.map((b) => (b.remote ? '' : b.name))))
  for (const branch of branches) {
    const problem = branchNameProblem(branch, [])
    if (problem) return { members: null, problem }
  }
  const taken = new Set(input.takenFolders)
  const labels = memberLabels(kinds)
  const members = kinds.map((kind, i): AttemptMemberPlan => {
    const branch = branches[i]!
    const folder = folderNameFor(branch, taken)
    taken.add(folder)
    return {
      kind,
      label: labels[i]!,
      path: `${input.worktreesDir}/${folder}`,
      request: { root: input.root, branch, base: input.base, folder, prepare: input.prepare }
    }
  })
  return { members, problem: null }
}

/** The dialog's primary button. */
export const attemptButtonLabel = (count: number): string => `开 ${count} 份并发送`

/**
 * What a member starts with in place of the bare task: where it came from, where it works, and what its last message
 * is for (the report to the session that sums the parts up). Calm and short, like dispatch's brief (Orca).
 */
export function attemptBrief(input: { task: string; parentTitle: string; count: number; branch: string; base: string }): string {
  return [
    `这是 Wavi 转来的任务：会话「${input.parentTitle || '未命名'}」把同一个任务交给了 ${input.count} 份各做一遍，你是其中一份。你在新的 worktree 里，分支 ${input.branch}，基于 ${input.base}。`,
    input.task,
    '只做这件事；不要合并、推送或切换分支，这些由用户决定。做完时，最后一条消息写结果：改了哪些文件、跑了哪些检查和结果、还有什么没做。'
  ].join('\n\n')
}

/** One line of a prompt for lists and titles. */
export function promptPreview(prompt: string, max = 60): string {
  const line = prompt.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
  const chars = [...line.replace(/\s+/g, ' ')]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

// --- where the task comes from ------------------------------------------------------------------------------------

/** The session's own prompts (hooks), text selected in its terminal, or the plan its agent wrote. */
export type TaskSource = 'prompts' | 'selection' | 'plan'

/** The prompts the user sent in the session, oldest first, as one task. */
export const promptsTask = (prompts: readonly string[]): string => prompts.map((p) => p.trim()).filter(Boolean).join('\n')

/** The 任务 menu's label for a source. */
export function sourceLabel(source: TaskSource, text: string, agent: string): string {
  if (source === 'prompts') {
    const n = text.split('\n').filter((l) => l.trim() !== '').length
    return `你在这个会话里说过的 ${n} 句话`
  }
  if (source === 'selection') return `终端里选中的 ${text.split('\n').length} 行`
  return `${agent} 写好的计划`
}

// --- the group over time ------------------------------------------------------------------------------------------

/** Drops members whose session is gone, then groups left with none. The same array when nothing changed. */
export function pruneAttemptGroups(groups: readonly AttemptGroup[], alive: ReadonlySet<SessionId>): AttemptGroup[] {
  let changed = false
  const next: AttemptGroup[] = []
  for (const group of groups) {
    const members = group.members.filter((id) => alive.has(id))
    if (members.length !== group.members.length) changed = true
    if (members.length === 0) continue
    next.push(members.length === group.members.length ? group : { ...group, members })
  }
  return changed ? next : (groups as AttemptGroup[])
}

export const groupOfSession = (groups: readonly AttemptGroup[], id: SessionId): AttemptGroup | undefined =>
  groups.find((g) => g.members.includes(id))

/**
 * The members still to decide about once one was merged: listed (not archived) and not the merged one.
 * Before a merge, every listed member.
 */
export function remainingMembers(group: AttemptGroup, listed: (id: SessionId) => boolean): SessionId[] {
  return group.members.filter((id) => listed(id) && id !== group.merged?.sessionId)
}

/**
 * Whether the overview lists the group: two or more members to compare, or one merged with others left to archive.
 * A group whose others were archived (or closed) has nothing left to decide.
 */
export function groupShown(group: AttemptGroup, listed: (id: SessionId) => boolean): boolean {
  const left = remainingMembers(group, listed).length
  return group.merged ? left > 0 : left >= MIN_ATTEMPTS
}

export const markMerged = (group: AttemptGroup, sessionId: SessionId, branch: string, at: number): AttemptGroup => ({
  ...group,
  merged: { sessionId, branch, at }
})

// --- the report to the session the task came from -----------------------------------------------------------------

export type MemberEvent = 'done' | 'error' | 'exited' | 'failed'

/** What the report needs to know about a member right now. */
export interface MemberState {
  id: SessionId
  status: SessionStatus
  exited: boolean
  finishedAt?: number
  /** Its task never went out (no worktree, no agent, a dialog in the way). */
  launchFailed: boolean
}

function memberEvent(group: AttemptGroup, m: MemberState): MemberEvent | null {
  if (m.launchFailed) return 'failed'
  if (m.exited) return 'exited'
  if (m.status === 'error') return 'error'
  if (m.status === 'running' || m.status === 'needs_you') return null
  // Idle before its first turn ended: the task has not run yet.
  return m.finishedAt !== undefined && m.finishedAt >= group.createdAt ? 'done' : null
}

/**
 * Once every member has stopped (its turn ended, it failed, its agent went away, or its task never went out), a key
 * for that settle; null while any is working, waiting for the user or has not run its task. A member waiting for the
 * user holds the report back: the session it goes to could not answer for the user anyway.
 */
export function settledKey(group: AttemptGroup, members: readonly MemberState[]): string | null {
  if (members.length === 0) return null
  const parts: string[] = []
  for (const m of members) {
    const event = memberEvent(group, m)
    if (!event) return null
    parts.push(`${m.id}:${m.finishedAt ?? 0}:${event}`)
  }
  return parts.join('|')
}

/** Whether the group has a settle to report now: it reports to a session, nothing was merged, and the key is new. */
export function reportDue(group: AttemptGroup, key: string | null): key is string {
  return key !== null && group.reportTo !== undefined && !group.merged && key !== group.reported
}

export const eventOf = (group: AttemptGroup, m: MemberState): MemberEvent => memberEvent(group, m) ?? 'done'

export interface MemberReport {
  label: string
  branch: string
  event: MemberEvent
  /** `+38 −12 · 3 个文件` */
  changes?: string
  /** `测试 ✓ · lint ✗` */
  checks?: string
  /** Its last message (its result), whole; the report cuts it. */
  message?: string
  /** Why its task never went out. */
  failure?: string
}

const REPORT_BUDGET = 12_000
const EXCERPT = 4_000
const EVENT_TEXT: Record<MemberEvent, string> = { done: '做完了', error: '出错', exited: 'agent 已退出', failed: '任务没发出去' }

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`)

/**
 * The one message the session gets once all members stopped: a line of facts and an excerpt of each one's last
 * message within a shared budget, then what to do — compare, recommend, leave merging to the user, carry on after.
 */
export function attemptReportText(input: { base: string; members: readonly MemberReport[] }): string {
  const lines = [`${ATTEMPT_REPORT_HEADER} 这个任务交给了 ${input.members.length} 份各做一遍，现在都停下了（基于 ${input.base}；来自 Wavi，不是用户的指示）。`]
  let budget = REPORT_BUDGET
  for (const m of input.members) {
    const facts = [m.label, EVENT_TEXT[m.event], `分支 ${m.branch}`, m.changes, m.checks]
    lines.push('', `— ${facts.filter(Boolean).join(' · ')}`)
    if (m.failure) {
      lines.push(`  ${m.failure}`)
      continue
    }
    const message = m.message?.trim()
    if (!message) {
      if (m.event !== 'exited') lines.push('  （没有留下回复）')
      continue
    }
    const room = Math.min(EXCERPT, budget)
    if (room < 200) {
      lines.push('  （回复较长，看它的终端）')
      continue
    }
    const excerpt = cut(message, room)
    budget -= excerpt.length
    lines.push(...excerpt.split('\n').map((l) => `  ${l}`))
  }
  lines.push(
    '',
    `请比较这几份：用 git diff ${input.base}...<分支> 看各自的改动，说推荐哪一份、为什么，其余几份里有什么值得借鉴。合并由用户在 Wavi 里做；用户把一份合并到 ${input.base} 后，你接着做下一步。`
  )
  return lines.join('\n')
}

// --- what each member changed -------------------------------------------------------------------------------------

export interface DiffSummary {
  added: number
  removed: number
  files: number
}

/** Committed (vs the base) plus uncommitted work, each file counted once. Binary files count as a file without lines. */
export function diffSummary(changes: Pick<GitChanges, 'committed' | 'uncommitted'>): DiffSummary {
  const paths = new Set<string>()
  let added = 0
  let removed = 0
  for (const file of [...changes.committed, ...changes.uncommitted]) {
    paths.add(file.path)
    added += file.added ?? 0
    removed += file.removed ?? 0
  }
  return { added, removed, files: paths.size }
}

/** `+12 −3 · 2 个文件`, or `还没有改动`. */
export function diffSummaryText(summary: DiffSummary): string {
  if (summary.files === 0) return '还没有改动'
  return `+${summary.added} −${summary.removed} · ${summary.files} 个文件`
}

// --- workspace.json -----------------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0')
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/**
 * Validates the saved groups (`attemptGroups`, absent in files written before they existed): members must be sessions
 * of the file, each in one group only, and the session reported to one of the file's too, not a member; a group with
 * no member left is dropped. Untrusted input.
 */
export function sanitizeAttemptGroups(raw: unknown, sessionIds: ReadonlySet<string>): AttemptGroup[] {
  if (!Array.isArray(raw)) return []
  const taken = new Set<string>()
  const ids = new Set<string>()
  const groups: AttemptGroup[] = []
  for (const value of raw.slice(0, MAX_GROUPS)) {
    if (!isRecord(value) || !isText(value.id, 64) || ids.has(value.id) || !isText(value.prompt, MAX_ATTEMPT_PROMPT) || !isText(value.base, MAX_BASE)) continue
    const members = Array.isArray(value.members)
      ? [...new Set(value.members.filter((m): m is string => typeof m === 'string' && sessionIds.has(m) && !taken.has(m)))].slice(0, MAX_ATTEMPTS)
      : []
    if (members.length === 0) continue
    for (const m of members) taken.add(m)
    ids.add(value.id)
    const merged = value.merged
    const reportTo = isText(value.reportTo, 128) && sessionIds.has(value.reportTo) && !members.includes(value.reportTo) ? value.reportTo : undefined
    groups.push({
      id: value.id,
      prompt: value.prompt,
      base: value.base,
      createdAt: isTime(value.createdAt) ? value.createdAt : 0,
      members,
      ...(reportTo ? { reportTo, ...(isText(value.reported, 4_000) ? { reported: value.reported } : {}) } : {}),
      ...(isRecord(merged) && isText(merged.sessionId, 128) && isText(merged.branch, MAX_BASE) && isTime(merged.at)
        ? { merged: { sessionId: merged.sessionId, branch: merged.branch, at: merged.at } }
        : {})
    })
  }
  return groups
}
