// The auto-fix brakes (PRD F16 v1.78, Figma 29G). The agent fixes and commits; before Wavi pushes the fix it checks
// the fix's diff and the failure history here. Pure, so the renderer loop and its tests share one decision.
import { cleanFailedLog } from './pull-requests'
import { riskMarkers, riskPhrase, type RiskKind, type RiskMarker } from './risk-markers'

export interface BrakeInput {
  /** `git diff <last pushed>..HEAD` of the worktree: the fix about to be pushed. */
  fixDiff: string
  /** The failure this fix answers (failureKey of its checks and log). */
  failureKey: string
  /** Keys of the failures earlier attempts answered, oldest first. */
  previousKeys: string[]
  /** Attempts already pushed for this PR / base push, and the setting's cap (1–5). */
  attempts: number
  maxAttempts: number
  /** The agent committed something since the last push. */
  headMoved: boolean
  /** The failing check names, and those failing on the base's tip too (null: unknown). */
  failingChecks: string[]
  baseFailing: string[] | null
}

export type BrakeDecision =
  | { kind: 'push' }
  | {
      kind: 'stop'
      reason: 'weakened' | 'repeated' | 'limit' | 'no-progress'
      markers?: RiskMarker[]
      /** reason 'limit': how many fixes were already pushed. */
      attempts?: number
    }
  | { kind: 'ask'; reason: 'base-broken'; checks: string[] }

/** The risk kinds that make a fix a weakening: it passes by checking less, not by fixing. */
const WEAKENING: ReadonlySet<RiskKind> = new Set<RiskKind>(['test-deleted', 'test-skipped', 'check-silenced', 'ci-config'])

/** In order: nothing committed, the fix weakens checks, the same failure again, the attempt cap; else push. */
export function brakeDecision(input: BrakeInput): BrakeDecision {
  if (!input.headMoved) return { kind: 'stop', reason: 'no-progress' }
  const weakening = riskMarkers(input.fixDiff).filter((marker) => WEAKENING.has(marker.kind))
  if (weakening.length > 0) return { kind: 'stop', reason: 'weakened', markers: weakening }
  if (input.previousKeys.includes(input.failureKey)) return { kind: 'stop', reason: 'repeated' }
  if (input.attempts >= input.maxAttempts) return { kind: 'stop', reason: 'limit', attempts: input.attempts }
  return { kind: 'push' }
}

/**
 * Before the agent is asked to fix anything: when every failing check also fails on the base's tip, the fix is not
 * this change's to make, so ask first. `baseFailing` null (unknown) never asks.
 */
export function beforeFix(input: {
  failingChecks: string[]
  baseFailing: string[] | null
}): { kind: 'fix' } | { kind: 'ask'; reason: 'base-broken'; checks: string[] } {
  const { failingChecks, baseFailing } = input
  if (baseFailing && failingChecks.length > 0 && failingChecks.every((name) => baseFailing.includes(name))) {
    return { kind: 'ask', reason: 'base-broken', checks: failingChecks }
  }
  return { kind: 'fix' }
}

/** 32-bit FNV-1a, base 36: stable across runs and platforms. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** A log line without the parts that differ between two runs of the same failure. */
function normalizeLogLine(line: string): string {
  return line
    .replace(/\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?/g, '<time>')
    .replace(/\b\d{1,2}:\d\d:\d\d(?:[.,]\d+)?\b/g, '<time>')
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|µs|us|ns|s|sec|secs|seconds?|m|min|mins|minutes?|h)\b/gi, '<dur>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\b[0-9a-f]{7,64}\b/gi, '<hex>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A stable key for "the same failure": the sorted check names and a normalized log signature. */
export function failureKey(checks: string[], log: string): string {
  const signature = cleanFailedLog(log, 20)
    .split('\n')
    .map(normalizeLogLine)
    .filter(Boolean)
    .slice(-20)
    .join('\n')
  return `${[...checks].sort().join(',')}#${hash(signature)}`
}

/** One stop reason as the PR / base row reads, e.g. "自动修复已停：这次修复删了 1 个测试". */
export function brakeLabel(decision: Exclude<BrakeDecision, { kind: 'push' }>, attempts?: number): string {
  if (decision.kind === 'ask') return `基线上本来就失败：${decision.checks.join('、')}`
  const head = '自动修复已停：'
  switch (decision.reason) {
    case 'weakened': {
      const first = decision.markers?.[0]
      return `${head}${first ? `这次修复${riskPhrase(first)}` : '这次修复放宽了检查'}`
    }
    case 'repeated':
      return `${head}同一个失败又出现了`
    case 'limit': {
      const n = attempts ?? decision.attempts
      return `${head}${n !== undefined ? `已经修了 ${n} 次` : '已经修了很多次'}`
    }
    case 'no-progress':
      return `${head}这一轮没有新的提交`
  }
}

// --- what a fix run is (the window's 自动修复, saved while unfinished) -------------------------------------------

/** Where a failure lives: a PR's checks (and comments), or the base branch after 合并到 main 并推送. */
export type FixScope = 'pr' | 'base'

/** The decision that stops a fix: a brake (before the push) or the base already failing (before the fix). */
export type StopDecision = Exclude<BrakeDecision, { kind: 'push' }>

export interface FixRunBase {
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
