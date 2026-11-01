// Git · 变更's two exits (PRD F16 v1.78, Figma 29A): 合并到 main 并推送 and 创建 PR, which one is primary (the
// repository's remembered choice, else the preflight's suggestion), what each becomes once a PR is open, what blocks
// them, and the run an exit starts. Pure; Git · 变更 and the phone (PRD F22) both read it.
import type { GitChanges } from '@shared/git-graph/log'
import type { PrStatus, PullRequestInfo } from '@shared/pull-requests'
import type { AppSettings } from '@shared/settings'
import type { ShipExitKind, ShipPreflight } from '@shared/ship'
import type { SessionId } from '@shared/types'
import { onOwnBase } from '../panels/git/changes-model'
import type { ShipContext } from './ship-runner'

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

/** The branch's PR while it is open (or a draft). */
export const livePr = (status: PrStatus | null | undefined): PullRequestInfo | null =>
  status?.pr && (status.pr.state === 'open' || status.pr.state === 'draft') ? status.pr : null

/** The open PR's head differs from the local head and the PR has nothing the branch lacks. */
export function unpushedOf(status: PrStatus | null | undefined): boolean {
  const pr = livePr(status)
  const local = status?.local
  return Boolean(pr?.details && local && !local.remoteAhead && local.head !== pr.details.headOid)
}

export interface ExitInput {
  preflight: ShipPreflight | null
  remembered: ShipExitKind | null
  prStatus: PrStatus | null
  changes: Pick<GitChanges, 'branch' | 'base' | 'ahead' | 'uncommitted' | 'untrackedOmitted'>
  /** The worktree is the project's main checkout. */
  isMain: boolean
  /** The worktree's project root; null when the worktree has no project. */
  projectRoot: string | null
}

export interface ExitPlan {
  exits: { primary: ShipExit; secondary: ShipExit | null }
  /** The branch's open PR. */
  pr: PullRequestInfo | null
  unpushed: boolean
  onBase: boolean
  /** Nothing to propose or merge (merged already, or no work yet): no exits; the PR line says what happened. */
  nothingToShip: boolean
  /** A PR is open and there is nothing to push: open it, or merge it. */
  idlePr: PullRequestInfo | null
  /** Why an exit cannot run now (UI copy), or null. */
  blocker(exit: ShipExit): string | null
}

export function exitPlan(input: ExitInput): ExitPlan {
  const { preflight, remembered, prStatus, changes, isMain, projectRoot } = input
  const pr = livePr(prStatus)
  const unpushed = unpushedOf(prStatus)
  const onBase = onOwnBase(isMain, changes)
  // A squash merge leaves the branch ahead by its commits; the preflight sees their work is in the base.
  const noNewCommits = changes.ahead === 0 || (preflight?.ok === true && preflight.merged)
  const clean = changes.uncommitted.length === 0 && changes.untrackedOmitted === 0
  return {
    exits: shipExits({ preflight, remembered, unpushed }),
    pr,
    unpushed,
    onBase,
    nothingToShip: !onBase && !pr && noNewCommits && clean,
    idlePr: pr && !unpushed && clean ? pr : null,
    blocker: (exit) => {
      if (onBase) return '项目主目录检出的是基线分支，没有要合并的分支'
      if (!projectRoot) return '找不到这个 worktree 的项目'
      if (!preflight) return CHECKING
      if (!preflight.ok) return preflight.message
      return exit.blocker
    }
  }
}

/** The run an exit starts (ship-runner.ts), from what Git · 变更 (or the phone) knows about the worktree. */
export function shipContextFor(input: {
  projectRoot: string
  worktreePath: string
  preflight: Extract<ShipPreflight, { ok: true }>
  changes: Pick<GitChanges, 'uncommitted'>
  pr: PullRequestInfo | null
  /** The worktree's agent session (it writes the text). */
  agentSession: SessionId | null
  /** The session whose built-in browser opens the PR. */
  openIn: SessionId | null
  checksLine: string | null
  settings: Pick<AppSettings, 'review' | 'pr'>
}): ShipContext {
  const paths = input.changes.uncommitted.filter((c) => !c.nested).map((c) => c.path)
  return {
    root: input.projectRoot,
    worktree: input.worktreePath,
    sessionId: input.agentSession,
    base: input.preflight.base,
    branch: input.preflight.branch,
    remote: input.preflight.remote,
    paths: paths.length > 0 ? paths : null,
    openPr: input.pr ? { number: input.pr.number, url: input.pr.url } : null,
    checksLine: input.checksLine,
    settings: input.settings,
    openIn: input.openIn
  }
}
