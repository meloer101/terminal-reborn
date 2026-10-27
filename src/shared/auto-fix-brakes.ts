// The auto-fix brakes (PRD F16 v1.78, Figma 29G). The agent fixes and commits; before Wavi pushes the fix it checks
// the fix's diff and the failure history here. Pure, so the renderer loop and its tests share one decision.
import type { RiskMarker } from './risk-markers'

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
  | { kind: 'stop'; reason: 'weakened' | 'repeated' | 'limit' | 'no-progress'; markers?: RiskMarker[] }
  | { kind: 'ask'; reason: 'base-broken'; checks: string[] }

export function brakeDecision(input: BrakeInput): BrakeDecision {
  if (!input.headMoved) return { kind: 'stop', reason: 'no-progress' }
  if (input.attempts >= input.maxAttempts) return { kind: 'stop', reason: 'limit' }
  return { kind: 'push' }
}

/** A stable key for "the same failure": the sorted check names and a normalized log signature. */
export function failureKey(checks: string[], log: string): string {
  void log
  return [...checks].sort().join(',')
}

/** One stop reason as the PR / base row reads, e.g. "自动修复已停：这次修复删了 1 个测试". */
export function brakeLabel(decision: Exclude<BrakeDecision, { kind: 'push' }>): string {
  return decision.kind === 'ask' ? '自动修复已停：基线上本来就失败' : `自动修复已停：${decision.reason}`
}
