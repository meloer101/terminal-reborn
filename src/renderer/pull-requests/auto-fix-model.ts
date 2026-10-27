// 自动修复 and 通过后合并 per PR, and 自动修复 per base push (PRD F16 v1.63 · L3, v1.78), the pure part: what to send,
// when to stop, and what the rows say. The bridge (auto-fix.ts) reads the PR / base CI and the session, asks this, and
// acts. The agent fixes and commits but never pushes: after its turn Wavi checks the brakes and pushes.
import type { BrakeDecision } from '@shared/auto-fix-brakes'
import { brakeLabel } from '@shared/auto-fix-brakes'
import { checksLabel, type ChecksSummary, type MergeMethod, type PrStatus, type PrThread, type PullRequestInfo } from '@shared/pull-requests'
import type { BaseCi } from '@shared/ship'

/** Where a failure lives: a PR's checks (and comments), or the base branch after 合并到 main 并推送. */
export type FixScope = 'pr' | 'base'

/** The decision that stops a fix: a brake (before the push) or the base already failing (before the fix). */
export type StopDecision = Exclude<BrakeDecision, { kind: 'push' }>

interface FixRunBase {
  /** The agent session the fix was sent to. */
  sessionId: string
  key: string
  checks: string[]
  /** Checks failing on the base's tip too, as the ask saw them; null: unknown. */
  baseFailing: string[] | null
}

/** One fix in flight or stopped, in this window only. */
export type FixRun =
  /** Sent: the agent works; its next Stop ends the turn. `since` is the head when it was sent. */
  | (FixRunBase & { kind: 'fixing'; since: string; sentAt: number })
  /** The brakes said push: Wavi is pushing the fix. */
  | (FixRunBase & { kind: 'pushing'; since: string })
  /** Stopped by a brake (since is the head to discard back to) or by the base already failing (since null, nothing was sent). */
  | (FixRunBase & { kind: 'stopped'; since: string | null; decision: StopDecision })

/** One PR's (number > 0) or one worktree's base push's (number 0) automation in this window. Not saved: a restart starts again from 设置 · 自动化 · PR's defaults. */
export interface PrAutomation {
  /** The PR these switches belong to; another PR on the branch starts fresh. */
  number: number
  autoFix: boolean
  /** Sends so far; the user's own message in the session sets it back to 0. */
  attempts: number
  /** What the last send was about (head + failing checks + threads): the same situation is never sent twice. */
  lastKey: string | null
  lastHead: string | null
  lastThreads: string[]
  /** Why 自动修复 stopped (shown on the PR line, and notified once). */
  stopped: string | null
  /** Fixes Wavi pushed since the user last wrote in the session. */
  pushed: number
  /** failureKey of the failures those fixes answered, oldest first (a repeat is a brake). */
  keys: string[]
  /** The fix in flight or stopped. */
  run: FixRun | null
  /** The base's own failures were looked at (and the user said 在这里修, or nothing clashed): no more asking. */
  baseChecked: boolean
  /** The head (PR) or base commit (base) the last pushed fix started from: nothing is sent while it is still the newest. */
  afterPush: string | null
  /** Base commits Wavi pushed for fixes: their CI is the fix's, not a new ship. */
  pushedShas: string[]
  /** The first lines of what the agent wrote in fix.md for its last attempt (a tooltip). */
  note: string | null
}

export const freshAutomation = (number: number, autoFix: boolean): PrAutomation => ({
  number,
  autoFix,
  attempts: 0,
  lastKey: null,
  lastHead: null,
  lastThreads: [],
  stopped: null,
  pushed: 0,
  keys: [],
  run: null,
  baseChecked: false,
  afterPush: null,
  pushedShas: [],
  note: null
})

/**
 * The user wrote in the session themselves: counting starts again and whatever was in flight is theirs now. The base
 * failing already (the ask) stays: it is not about the agent's work, and answering it is the user's call.
 */
export const takenOver = (state: PrAutomation): PrAutomation => ({
  ...state,
  attempts: 0,
  lastHead: null,
  stopped: null,
  pushed: 0,
  keys: [],
  run: state.run?.kind === 'stopped' && state.run.decision.kind === 'ask' ? state.run : null,
  baseChecked: false,
  afterPush: null,
  note: null
})

/** The checks that block: the required ones when branch protection names some, else every check. */
export function failingChecks(pr: PullRequestInfo): string[] {
  const required = pr.details?.required
  if (required && required.total > 0) return [...required.failing].sort()
  return pr.checks.state === 'failing' ? pr.checks.failing.map((c) => c.name).sort() : []
}

/** Unresolved, placed threads started by someone 自动修复 may act for: the user, or a bot in the allowlist. */
export function allowedThreads(pr: PullRequestInfo, bots: readonly string[]): PrThread[] {
  const details = pr.details
  if (!details) return []
  const allowed = new Set([details.viewer, ...bots].filter(Boolean).map((l) => l.toLowerCase()))
  return details.threads.filter((t) => !t.outdated && allowed.has(t.comments[0]?.author.login.toLowerCase() ?? ''))
}

export type AutoFixDecision =
  | { kind: 'wait' }
  | { kind: 'send'; key: string; head: string; failing: string[]; threads: PrThread[] }
  | { kind: 'stop'; reason: string }

/**
 * Whether 自动修复 sends now. It waits while the agent is busy or nothing is wrong; it never sends the same head +
 * failures + threads twice; it stops after `max` sends, and when the agent did not push since the last one and no new
 * thread came in (the next send would be the same request again).
 */
export function autoFixDecision(state: PrAutomation, input: { pr: PullRequestInfo; agentIdle: boolean; max: number; bots: readonly string[] }): AutoFixDecision {
  const { pr } = input
  if (!state.autoFix || state.stopped || state.run || pr.state !== 'open' || !pr.details) return { kind: 'wait' }
  // Wavi just pushed a fix: the PR list still shows the old head until the next poll.
  if (state.afterPush && pr.details.headOid === state.afterPush) return { kind: 'wait' }
  const failing = failingChecks(pr)
  const threads = allowedThreads(pr, input.bots)
  if (failing.length === 0 && threads.length === 0) return { kind: 'wait' }
  const head = pr.details.headOid
  const ids = threads.map((t) => t.id).sort()
  const key = [head, failing.join(','), ids.join(',')].join('|')
  if (key === state.lastKey) return { kind: 'wait' }
  if (state.attempts >= input.max) {
    const what = failing.length > 0 ? `${failing.slice(0, 3).join('、')} 仍失败` : '评论仍没解决'
    return { kind: 'stop', reason: `自动修复已停：${input.max} 次后 ${what}` }
  }
  const newThread = ids.some((id) => !state.lastThreads.includes(id))
  if (state.attempts > 0 && head === state.lastHead && !newThread) return { kind: 'stop', reason: '自动修复已停：上一次之后 agent 没有推送新提交' }
  if (!input.agentIdle) return { kind: 'wait' }
  return { kind: 'send', key, head, failing, threads }
}

export function afterSend(state: PrAutomation, decision: Extract<AutoFixDecision, { kind: 'send' }>): PrAutomation {
  return { ...state, attempts: state.attempts + 1, lastKey: decision.key, lastHead: decision.head, lastThreads: decision.threads.map((t) => t.id).sort() }
}


export type BaseFixDecision =
  | { kind: 'wait' }
  | { kind: 'send'; key: string; head: string; failing: string[]; threads: PrThread[] }
  | { kind: 'stop'; reason: string }

/**
 * The same for the base after 合并到 main 并推送: its CI failed. Sends once per commit + failing checks, waits while the
 * agent is busy or while the CI still shows the commit before Wavi's last pushed fix, and stops after `max` sends.
 */
export function baseFixDecision(state: PrAutomation, input: { ci: BaseCi | undefined; agentIdle: boolean; max: number }): BaseFixDecision {
  const { ci } = input
  if (!state.autoFix || state.stopped || state.run || !ci || ci.checks.state !== 'failing') return { kind: 'wait' }
  if (state.afterPush && ci.sha === state.afterPush) return { kind: 'wait' }
  const failing = ci.checks.failing.map((c) => c.name).sort()
  const key = [ci.sha, failing.join(',')].join('|')
  if (key === state.lastKey) return { kind: 'wait' }
  if (state.attempts >= input.max) return { kind: 'stop', reason: `自动修复已停：${input.max} 次后 ${failing.slice(0, 3).join('、')} 仍失败` }
  if (!input.agentIdle) return { kind: 'wait' }
  return { kind: 'send', key, head: ci.sha, failing, threads: [] }
}

/** The base's own failing checks that clash with the ones about to be fixed: ask first (Figma 29G), or go. */
export function beforeFixDecision(input: { failingChecks: readonly string[]; baseFailing: readonly string[] | null }): { kind: 'go' } | Extract<StopDecision, { kind: 'ask' }> {
  const known = input.baseFailing
  if (!known) return { kind: 'go' }
  const clash = input.failingChecks.filter((name) => known.includes(name))
  return clash.length > 0 ? { kind: 'ask', reason: 'base-broken', checks: clash } : { kind: 'go' }
}

/** Fix `run` is pushed: it counts, its failure is remembered, and nothing is sent until the head moves on. */
export function afterPushed(state: PrAutomation, run: FixRun, from: string | null, pushedSha?: string): PrAutomation {
  return {
    ...state,
    run: null,
    pushed: state.pushed + 1,
    keys: [...state.keys, run.key],
    afterPush: from,
    pushedShas: pushedSha ? [...state.pushedShas, pushedSha] : state.pushedShas
  }
}

/** What the user reads in the stopped row: the brake's label, or the base failing already. */
export function stopLabel(decision: StopDecision): string {
  return decision.kind === 'ask' ? `基线上本来就失败：${decision.checks.slice(0, 3).join('、')}` : brakeLabel(decision)
}

/** Which of the stopped row's buttons apply. A fix that moved nothing has nothing to push or discard. */
export function stopActions(run: Extract<FixRun, { kind: 'stopped' }>): { kind: 'ask' } | { kind: 'brake'; push: boolean; discard: boolean } {
  if (run.decision.kind === 'ask') return { kind: 'ask' }
  const moved = run.decision.reason !== 'no-progress'
  return { kind: 'brake', push: moved, discard: moved && run.since !== null }
}

/** The first lines of what the agent wrote about its fix (fix.md), for the attempt's tooltip; null when there is nothing. */
export function fixNote(text: string | null, maxLines = 3, maxChars = 240): string | null {
  if (!text) return null
  const lines = text
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .slice(0, maxLines)
  if (lines.length === 0) return null
  const joined = lines.join('\n')
  return joined.length > maxChars ? `${joined.slice(0, maxChars - 1)}…` : joined
}

const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'Squash', merge: 'Merge', rebase: 'Rebase' }

/** Whether 通过后合并 is on for this PR: GitHub auto-merge, Wavi waiting, or already queued. */
export function mergeWhenGreenOn(status: Pick<PrStatus, 'pr' | 'waiting'>): boolean {
  const details = status.pr?.details
  return Boolean(status.waiting || details?.autoMerge || details?.inMergeQueue)
}

/** "检查 2/3 · 1 项在跑", "检查通过 3/3", "2 项检查失败：test、lint", "没有检查" (Figma 29I). */
export function prChecksText(checks: ChecksSummary): string {
  return checks.state === 'pending' ? `检查 ${checks.passed}/${checks.total} · ${checks.pending} 项在跑` : checksLabel(checks)
}

/** The PR line: `PR #12 · 已打开 · 检查 2/3 · 1 项在跑 · 3 条评论没解决`; `comments` counts the threads 自动修复 may act on. */
export function prLineText(pr: PullRequestInfo, stateLabel: string, comments: number): string {
  const live = pr.state === 'open' || pr.state === 'draft'
  const parts = [`PR #${pr.number}`, stateLabel]
  if (live) parts.push(prChecksText(pr.checks))
  if (live && comments > 0) parts.push(`${comments} 条评论没解决`)
  const details = pr.details
  if (live && details) {
    if (details.reviewDecision === 'review-required') parts.push('需要审批')
    else if (details.reviewDecision === 'changes-requested') parts.push('要求修改')
    if (details.mergeState === 'dirty') parts.push('和基线冲突')
  }
  return parts.join(' · ')
}

export interface AgentWords {
  /** The agent can take a prompt now. */
  idle: boolean
  /** Something is wrong and 自动修复 would send, but the agent is busy. */
  wants?: boolean
  /** Claude / Codex. */
  name?: string
}

/** What the run in flight says, shared by the PR and base rows; null when no run is going. */
function runText(state: PrAutomation, name: string): string | null {
  if (state.run?.kind === 'fixing') return `第 ${state.attempts} 次 · ${name} 在修`
  if (state.run?.kind === 'pushing') return `第 ${state.attempts} 次 · 正在推送`
  return null
}

/** The PR automation row's state words, tertiary and right-aligned (Figma 29I); tone `attention` when 自动修复 stopped. */
export function automationText(state: PrAutomation | undefined, status: Pick<PrStatus, 'pr' | 'waiting'>, agent: AgentWords): { text: string; tone: 'muted' | 'attention' } {
  const name = agent.name ?? 'Claude'
  const parts: string[] = []
  if (state?.stopped) return { text: state.stopped, tone: 'attention' }
  if (state?.run?.kind === 'stopped') return { text: stopLabel(state.run.decision), tone: 'attention' }
  const pr = status.pr
  if (state?.autoFix && pr) {
    const running = runText(state, name)
    if (running) parts.push(running)
    else if (agent.wants && !agent.idle) parts.push(`等 ${name} 空闲`)
    else if (state.attempts > 0) parts.push(`第 ${state.attempts} 次 · 等 CI`)
  }
  const details = pr?.details
  if (details?.inMergeQueue) parts.push('排队中')
  else if (details?.autoMerge) parts.push(`检查通过后由 GitHub 合并（${METHOD_LABEL[details.autoMerge]}）`)
  else if (status.waiting) parts.push('检查通过后由 Wavi 合并（Wavi 要开着）')
  return { text: parts.join(' · '), tone: 'muted' }
}

/** The base automation row's state words (Figma 29E). */
export function baseAutomationText(state: PrAutomation | undefined, agent: AgentWords): { text: string; tone: 'muted' | 'attention' } {
  const name = agent.name ?? 'Claude'
  if (!state) return { text: '', tone: 'muted' }
  if (state.stopped) return { text: state.stopped, tone: 'attention' }
  if (state.run?.kind === 'stopped') return { text: stopLabel(state.run.decision), tone: 'attention' }
  if (!state.autoFix) return { text: '', tone: 'muted' }
  const running = runText(state, name)
  if (running) return { text: running, tone: 'muted' }
  if (agent.wants && !agent.idle) return { text: `等 ${name} 空闲`, tone: 'muted' }
  if (state.attempts > 0) return { text: `第 ${state.attempts} 次 · 等 CI`, tone: 'muted' }
  return { text: '', tone: 'muted' }
}
