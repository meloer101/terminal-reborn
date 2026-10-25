// 一题多解 (PRD F4 / F9 v1.59, the P2 best-of-N): one prompt sent to N new worktrees off the same base — 2× Claude and
// 1× Codex, say — kept together as an attempt group so the overview can put them side by side and merging one offers
// to archive the rest. Pure: the group model and its workspace.json format, the N-way launch plan, the diff summary
// each member shows, and the copy that says exactly what will be sent to whom (PRD §2: never spend tokens silently).
import type { GitChanges } from './git-graph/log'
import { branchNameProblem, folderNameFor, type BranchNameProblem, type NewSessionBranch, type WorktreeCreateRequest } from './new-session'
import type { ClaudeOrCodex } from './agents'
import type { SessionId } from './types'

/** 一题多解 runs Claude Code and Codex for now (the entry point is being redesigned, ROADMAP 7). */
export type AttemptAgent = ClaudeOrCodex

/** Fewer than two is just a session; more than four does not fit side by side in the overview overlay (F9). */
export const MIN_ATTEMPTS = 2
export const MAX_ATTEMPTS = 4
export const MAX_ATTEMPT_PROMPT = 20_000
const MAX_GROUPS = 50
const MAX_BASE = 255

/** How many of each agent the sheet asks for. */
export interface AttemptCounts {
  claude: number
  codex: number
}

export const AGENT_NAME: Record<AttemptAgent, string> = { claude: 'Claude Code', codex: 'Codex' }

export interface AttemptGroup {
  id: string
  /** The prompt every member was sent. */
  prompt: string
  /** The branch the members' worktrees started from. */
  base: string
  createdAt: number
  /** The members' sessions, in launch order (closed ones are pruned). */
  members: SessionId[]
  /** Set once one member was merged into the base (the merge sheet); the others are then offered for archive. */
  merged?: { sessionId: SessionId; branch: string; at: number }
}

// --- the launch plan ----------------------------------------------------------------------------------------------

/** The agents to launch, Claude first: `{ claude: 2, codex: 1 }` → claude, claude, codex. */
export function attemptKinds(counts: AttemptCounts): AttemptAgent[] {
  return [...Array<AttemptAgent>(Math.max(0, counts.claude)).fill('claude'), ...Array<AttemptAgent>(Math.max(0, counts.codex)).fill('codex')]
}

export type AttemptCountProblem = 'too-few' | 'too-many'

export function attemptCountProblem(counts: AttemptCounts): AttemptCountProblem | null {
  const total = attemptKinds(counts).length
  return total < MIN_ATTEMPTS ? 'too-few' : total > MAX_ATTEMPTS ? 'too-many' : null
}

/** Steps a count by ±1, never below 0 nor past what keeps the total at MAX_ATTEMPTS. */
export function stepCount(counts: AttemptCounts, agent: AttemptAgent, delta: 1 | -1): AttemptCounts {
  const next = { ...counts, [agent]: Math.max(0, counts[agent] + delta) }
  return attemptKinds(next).length > MAX_ATTEMPTS ? counts : next
}

/** Each member's name in the group: `Claude Code 1`, `Claude Code 2`, `Codex` (a number only when an agent repeats). */
export function memberLabels(kinds: readonly AttemptAgent[]): string[] {
  const seen: Record<AttemptAgent, number> = { claude: 0, codex: 0 }
  return kinds.map((kind) => {
    seen[kind]++
    const total = kinds.filter((k) => k === kind).length
    return total > 1 ? `${AGENT_NAME[kind]} ${seen[kind]}` : AGENT_NAME[kind]
  })
}

/** `Claude Code ×2 · Codex ×1` */
export function recipientsText(kinds: readonly AttemptAgent[]): string {
  return (['claude', 'codex'] as const)
    .map((kind) => ({ kind, n: kinds.filter((k) => k === kind).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${AGENT_NAME[x.kind]} ×${x.n}`)
    .join(' · ')
}

/** The members' branches: `<stem>-1` … `<stem>-N`. */
export function attemptBranches(stem: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${stem}-${i + 1}`)
}

/** `jacob/swift-otter-1 … -3` for the collapsed 高级 row. */
export function attemptBranchesText(stem: string, count: number): string {
  return count <= 1 ? `${stem}-1` : `${stem}-1 … -${count}`
}

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
  /** The branch-name stem (the sheet's generated or typed name); members add `-1` … `-N`. */
  stem: string
  counts: AttemptCounts
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

/**
 * One worktree per member, all off `base`: branch `<stem>-i`, a folder of its own. The stem's problems are reported
 * as the branch name's (the 分支名 field edits the stem); a member branch that already exists is `exists`.
 */
export function planAttempts(input: AttemptPlanInput): { members: AttemptMemberPlan[]; problem: null } | { members: null; problem: AttemptPlanProblem } {
  const countProblem = attemptCountProblem(input.counts)
  if (countProblem) return { members: null, problem: countProblem }
  const stemProblem = branchNameProblem(input.stem, [])
  if (stemProblem) return { members: null, problem: stemProblem }
  const kinds = attemptKinds(input.counts)
  const branches = attemptBranches(input.stem, kinds.length)
  for (const branch of branches) {
    const problem = branchNameProblem(branch, input.branches)
    if (problem) return { members: null, problem }
  }
  const prompt = promptProblem(input.prompt)
  if (prompt) return { members: null, problem: prompt }
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

/** The sheet's primary button. */
export const attemptButtonLabel = (count: number): string => `创建 ${count} 个并发送`

/** Under the prompt and as the button's tooltip: exactly what 创建 will do and to whom (PRD §2). */
export function attemptSendNote(kinds: readonly AttemptAgent[], base: string | null): string {
  const where = base ? `（基于 ${base}）` : ''
  return `新建 ${kinds.length} 个 worktree${where}，各启动一个 agent，把这段话发给每一个并按回车：${recipientsText(kinds)}。每份各用一次你自己的额度。`
}

/** One line of a prompt for lists and titles. */
export function promptPreview(prompt: string, max = 60): string {
  const line = prompt.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
  const chars = [...line.replace(/\s+/g, ' ')]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
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
 * of the file, each in one group only; a group with no member left is dropped. Untrusted input.
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
    groups.push({
      id: value.id,
      prompt: value.prompt,
      base: value.base,
      createdAt: isTime(value.createdAt) ? value.createdAt : 0,
      members,
      ...(isRecord(merged) && isText(merged.sessionId, 128) && isText(merged.branch, MAX_BASE) && isTime(merged.at)
        ? { merged: { sessionId: merged.sessionId, branch: merged.branch, at: merged.at } }
        : {})
    })
  }
  return groups
}
