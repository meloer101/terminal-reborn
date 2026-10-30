// Git · 变更's two exits (PRD F16 v1.78, Figma 29A): 合并到 main 并推送 and 创建 PR, which one is primary (the
// repository's remembered choice, else the preflight's suggestion), and what each becomes once a PR is open.
import type { ShipExitKind, ShipPreflight } from '@shared/ship'

export type ShipExit =
  | { kind: 'main'; label: string; blocker: string | null }
  | { kind: 'pr'; label: string; blocker: string | null }
  /** The branch has an open PR and something to push to it. */
  | { kind: 'push-pr'; number: number; label: string; blocker: string | null }
  /** The branch has an open PR and nothing to send. */
  | { kind: 'open-pr'; number: number; label: string; blocker: null }

export interface ExitState {
  preflight: ShipPreflight | null
  /** This repository's last used exit (renderer-remembered), null when never used. */
  remembered: ShipExitKind | null
  /** The open PR's head differs from the local head and the PR has nothing the branch lacks. */
  unpushed: boolean
}

const CHECKING = '正在检查…'

/** The footer's primary exit and the other one (null when only one applies). */
export function shipExits(state: ExitState): { primary: ShipExit; secondary: ShipExit | null } {
  const { preflight, remembered, unpushed } = state
  if (preflight === null) return both(remembered ?? 'main', '合并到 main 并推送', '创建 PR', CHECKING, CHECKING)
  if (!preflight.ok) return both('main', '合并到 main 并推送', '创建 PR', preflight.message, preflight.message)

  const { base, openPr, uncommitted, ahead, merged } = preflight
  if (openPr !== null) {
    if (uncommitted > 0 || unpushed) {
      const label = uncommitted > 0 ? `提交并推送到 PR #${openPr}` : `推送到 PR #${openPr}`
      return { primary: { kind: 'push-pr', number: openPr, label, blocker: null }, secondary: null }
    }
    return { primary: { kind: 'open-pr', number: openPr, label: `打开 PR #${openPr}`, blocker: null }, secondary: null }
  }

  const nothing = (ahead === 0 || merged) && uncommitted === 0
  const mainBlocker = nothing ? '没有要合并的改动' : null
  const prBlocker = nothing ? `没有比 ${base} 新的提交` : null

  if (preflight.remote === null) {
    return { primary: { kind: 'main', label: `合并到 ${base}`, blocker: mainBlocker }, secondary: null }
  }
  return both(remembered ?? preflight.suggested, `合并到 ${base} 并推送`, '创建 PR', mainBlocker, prBlocker)
}

function both(
  first: ShipExitKind,
  mainLabel: string,
  prLabel: string,
  mainBlocker: string | null,
  prBlocker: string | null
): { primary: ShipExit; secondary: ShipExit } {
  const main: ShipExit = { kind: 'main', label: mainLabel, blocker: mainBlocker }
  const pr: ShipExit = { kind: 'pr', label: prLabel, blocker: prBlocker }
  return first === 'main' ? { primary: main, secondary: pr } : { primary: pr, secondary: main }
}
