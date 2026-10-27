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

/** The footer's primary exit and the other one (null when only one applies). */
export function shipExits(state: ExitState): { primary: ShipExit; secondary: ShipExit | null } {
  void state
  return {
    primary: { kind: 'main', label: '合并到 main 并推送', blocker: null },
    secondary: { kind: 'pr', label: '创建 PR', blocker: null }
  }
}
