// 自动修复 and 通过后合并 per PR (PRD F16 v1.63 · L3), the pure part: what to send, when to stop, and what the PR line
// says. The bridge (auto-fix.ts) reads the PR and the session, asks this, and acts.
import { checksLabel, type MergeMethod, type PrStatus, type PrThread, type PullRequestInfo } from '@shared/pull-requests'

/** One PR's automation in this window. Not saved: a restart starts again from 设置 · 自动化 · PR's defaults. */
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
}

export const freshAutomation = (number: number, autoFix: boolean): PrAutomation => ({
  number,
  autoFix,
  attempts: 0,
  lastKey: null,
  lastHead: null,
  lastThreads: [],
  stopped: null
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
  if (!state.autoFix || state.stopped || pr.state !== 'open' || !pr.details) return { kind: 'wait' }
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

const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'Squash', merge: 'Merge', rebase: 'Rebase' }

/** Whether 通过后合并 is on for this PR: GitHub auto-merge, Wavi waiting, or already queued. */
export function mergeWhenGreenOn(status: Pick<PrStatus, 'pr' | 'waiting'>): boolean {
  const details = status.pr?.details
  return Boolean(status.waiting || details?.autoMerge || details?.inMergeQueue)
}

/** The PR line's automation words (Figma 22E); tone `attention` when 自动修复 stopped. */
export function automationText(state: PrAutomation | undefined, status: Pick<PrStatus, 'pr' | 'waiting'>, agentIdle: boolean): { text: string; tone: 'muted' | 'attention' } {
  const parts: string[] = []
  if (state?.stopped) return { text: state.stopped, tone: 'attention' }
  const pr = status.pr
  if (state?.autoFix && pr) {
    if (state.attempts > 0) parts.push(`自动修复 · 第 ${state.attempts} 次 · ${agentIdle ? `等 ${checksLabel(pr.checks).startsWith('检查进行中') ? 'CI' : '下一次结果'}` : 'agent 在改'}`)
    else parts.push('自动修复已打开')
  }
  const details = pr?.details
  if (details?.inMergeQueue) parts.push('排队中')
  else if (details?.autoMerge) parts.push(`检查通过后由 GitHub 合并（${METHOD_LABEL[details.autoMerge]}）`)
  else if (status.waiting) parts.push('检查通过后由 Wavi 合并（Wavi 要开着）')
  return { text: parts.join(' · '), tone: 'muted' }
}
