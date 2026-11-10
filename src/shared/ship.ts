// The merge chain (PRD F13 / F16 v1.78, Figma 29): three checkpoints (diff, optional review, CI) and two exits
// (合并到 main 并推送 / 创建 PR). The agent in the session writes every piece of text and fixes code; Wavi runs the
// mechanical steps (commit, merge, push, gh) and the brakes. These are the IPC payloads of window.tr.ship.
import type { GitFailure } from './git-failures'
import type { MergeMethod } from './git-merge'
import type { ChecksSummary, GhState, PrTarget, RepoMergeMethods } from './pull-requests'
import type { RiskMarker } from './risk-markers'
import type { HandoffKind } from './ship-handoff'

export type ShipExitKind = 'main' | 'pr'

/**
 * A merge, rebase or cherry-pick that stopped in the worktree (合入链路 v2, PRD v1.169): 继续 / 中止 apply to it, and
 * while files are unresolved the conflicts go to the agent. A revert in progress is not reported here.
 */
export interface ShipOperation {
  kind: 'merge' | 'rebase' | 'cherry-pick'
  /** Paths git still lists as unmerged; empty once every conflict is resolved (then 继续 applies). */
  unresolved: string[]
}

/** What the two exits need to know before anything runs (Figma 29A). */
export type ShipPreflight =
  | {
      ok: true
      branch: string
      base: string
      /** The remote PRs and pushes go to; null when the repository has none (then only 合并到 main). */
      remote: string | null
      /** The base has branch protection or required reviews on GitHub; null when gh could not tell. */
      baseProtected: boolean | null
      /** The exit to offer first when this repository has no remembered choice yet. */
      suggested: ShipExitKind
      /** Uncommitted paths in the worktree. */
      uncommitted: number
      /** Commits on the branch the base lacks. */
      ahead: number
      /** Those commits' work is already in the base (a squash merge leaves them ahead): nothing of them to ship. */
      merged: boolean
      /** Local base commits not on its upstream: a PR or a push would carry them too (Figma 29 note). */
      baseAheadOfUpstream: number
      /** Upstream base commits the local base lacks: 合并到 main pulls first. */
      baseBehindUpstream: number
      /** The branch's open PR, if any (then 创建 PR becomes 推送到 PR #N). */
      openPr: number | null
      /** The merge methods the repository allows on GitHub and its default (PRD F16 v1.105); null when there are no
       *  GitHub settings to go by (no GitHub remote, no gh, or gh could not tell): the user picks, Wavi remembers. */
      mergeMethods: RepoMergeMethods | null
      // ── 合入链路 v2 (PRD v1.169), read by src/shared/ship-chain.ts. Optional for now: main does not fill them yet,
      // and the chain treats a missing field as "not known" (it blocks nothing on it). ─────────────────────────────
      /** Whether gh is installed and logged in, as main last checked. Optional for now. */
      gh?: GhState
      /** `remote` points at a GitHub host (gh can make PRs there); null when there is no remote. Optional for now. */
      remoteOnGitHub?: boolean | null
      /** A merge / rebase / cherry-pick stopped in the worktree; null when none. Optional for now. */
      operation?: ShipOperation | null
      /** Commits on the base the branch lacks (同步 <base> brings them in). Optional for now. */
      behindBase?: number
      /** Files that would conflict if the branch landed on the base now (`merge-tree --write-tree`); null when unknown
       *  (old git, the check failed). Optional for now. */
      baseConflicts?: string[] | null
      /** The branch has an upstream or a same-named branch on `remote` (同步 merges then, never rebases). Optional for now. */
      pushed?: boolean
      /** Against that remote branch: commits the local branch has that it lacks (`ahead`, 推送) and the other way round
       *  (`behind`, 拉取); null when the branch was never pushed. Optional for now. */
      upstream?: { ahead: number; behind: number } | null
    }
  | {
      ok: false
      message: string
      /** A rebase leaves HEAD detached, so main may answer ok: false and still name the operation (继续 / 中止 stay
       *  reachable). Optional for now. */
      operation?: ShipOperation | null
    }

/** Where the agent writes one piece of text for Wavi: `<git dir>/wavi/<kind>.md` of the worktree. */
export interface HandoffRequest extends PrTarget {
  kind: HandoffKind
}

/** handoff() clears any old file and answers where the agent should write the new one. */
export type HandoffSlot = { ok: true; path: string } | { ok: false; message: string }

/** 合并到 main 并推送 (exit A): commit `paths` (null: nothing to commit) with `message`, merge into the base, push it. */
export interface ShipMainRequest extends PrTarget {
  /** The agent-written commit message, subject first; also the squash commit's message. '' (only with paths null):
   *  keep the branch's own commit messages (an auto-fix merging its committed fix into the base again). */
  message: string
  method: MergeMethod
  paths: string[] | null
}

export type ShipMainResult =
  | {
      ok: true
      commit: string
      pushed: boolean
      pushError?: string
      /** The push was refused because the base is protected: 改为创建 PR is the way on (not after a network error). */
      pushRefused?: true
    }
  | {
      ok: false
      /** The ticked paths were committed before this step failed: a retry must not commit them again. */
      committed?: true
      step: 'commit' | 'merge' | 'push'
      reason: 'blocked' | 'conflicts' | 'failed' | 'declined'
      message: string
      /** reason 'conflicts': the files to hand to the agent. */
      conflicts?: string[]
      /** The end of what git and its hooks printed. */
      output?: string
    }

/** The retry of a failed push (ShipApi.pushBase). */
export interface PushBaseRequest extends PrTarget {
  /** The merge commit 合并到 main 并推送 kept: the push is refused when the base no longer has it. */
  commit?: string
}

/** The diff of the worktree's branch from `since` to HEAD (a fix the agent committed, before Wavi pushes it). */
export interface DiffSinceRequest extends PrTarget {
  since: string
}

/** CI on the base after 合并到 main pushed it (Figma 29E / 29F), pushed to the windows that watch the worktree. */
export interface BaseCi {
  worktree: string
  base: string
  sha: string
  checks: ChecksSummary
  /** The commit's checks page on GitHub, for 打开 CI; null when not on GitHub. */
  url: string | null
  checkedAt: number
}

/** The failing checks of the pushed base commit and the tail of their logs (raw; the fix prompt quotes it). */
export interface BaseCiFailure {
  base: string
  sha: string
  checks: string[]
  log: string
}

export interface ShipApi {
  preflight(target: PrTarget): Promise<ShipPreflight>
  handoff(request: HandoffRequest): Promise<HandoffSlot>
  /** The text the agent wrote, or null while the file is not there yet. */
  readHandoff(request: HandoffRequest): Promise<string | null>
  shipToMain(request: ShipMainRequest): Promise<ShipMainResult>
  /** After 合并到 main 并推送 kept the merge but its push failed: pushes the base again (nothing is merged). */
  pushBase(request: PushBaseRequest): Promise<ShipMainResult>
  diffSince(request: DiffSinceRequest): Promise<string | null>
  /** 丢弃 (Figma 29G): moves the worktree's branch back to `since` (a fix the brake stopped). Refuses with
   *  uncommitted changes or when `since` is not an ancestor of HEAD. */
  discardSince(request: DiffSinceRequest): Promise<{ ok: true } | { ok: false; message: string }>
  /** Risk markers of the worktree's whole change against its base (Figma 29A), computed from the diff, no model. */
  risks(target: PrTarget): Promise<RiskMarker[]>
  /** The latest CI state of the base commit this worktree pushed, if Wavi pushed one. */
  baseCi(target: PrTarget): Promise<BaseCi | null>
  baseFailure(target: PrTarget): Promise<BaseCiFailure | null>
  /** Check names failing on the base's upstream tip too (the brake asks before fixing them); null when unknown. */
  baseFailing(target: PrTarget): Promise<string[] | null>
  onBaseCi(listener: (ci: BaseCi) => void): () => void
}

export const SHIP_IPC = {
  /** invoke(PrTarget) → ShipPreflight */
  preflight: 'ship:preflight',
  /** invoke(HandoffRequest) → HandoffSlot */
  handoff: 'ship:handoff',
  /** invoke(HandoffRequest) → string | null */
  readHandoff: 'ship:read-handoff',
  /** invoke(ShipMainRequest) → ShipMainResult */
  shipToMain: 'ship:to-main',
  /** invoke(PushBaseRequest) → ShipMainResult */
  pushBase: 'ship:push-base',
  /** invoke(DiffSinceRequest) → string | null */
  diffSince: 'ship:diff-since',
  /** invoke(DiffSinceRequest) → { ok } */
  discardSince: 'ship:discard-since',
  /** invoke(PrTarget) → RiskMarker[] */
  risks: 'ship:risks',
  /** invoke(PrTarget) → BaseCi | null */
  baseCi: 'ship:base-ci',
  /** invoke(PrTarget) → BaseCiFailure | null */
  baseFailure: 'ship:base-failure',
  /** invoke(PrTarget) → string[] | null */
  baseFailing: 'ship:base-failing',
  /** main → renderer, payload BaseCi */
  baseCiChanged: 'ship:base-ci-changed',
  /** invoke(ShipSyncRequest) → ShipSyncResult (合入链路 v2; no handler yet) */
  sync: 'ship:sync',
  /** invoke(ShipPullRequest) → ShipPullResult (合入链路 v2; no handler yet) */
  pull: 'ship:pull',
  /** invoke(ShipOperationRequest) → ShipOperationResult (合入链路 v2; no handler yet) */
  operation: 'ship:operation'
} as const

// --- 合入链路 v2 (PRD v1.169): 同步 / 拉取 / 继续 · 中止. Contract only: main has no handlers and the preload does not
// expose them yet; they join ShipApi (as ShipChainApi's members) when both do. -----------------------------------

/**
 * 同步 <base>: fetch; fast-forward the local base when its checkout is clean; then bring the base into the branch —
 * `git rebase <base>` when the branch was never pushed, `git merge <base>` once it was (never a force-push). Checked
 * with `merge-tree --write-tree` first: on conflicts nothing is started.
 */
export type ShipSyncRequest = PrTarget

export type ShipSyncResult =
  | { ok: true }
  /** Nothing ran: tracked uncommitted changes (先提交改动), an operation in progress, no base. */
  | { ok: false; reason: 'blocked'; message: string }
  /** Nothing ran: these files would conflict. `mode` is what 同步 would have run, so the hand-off names the right steps. */
  | { ok: false; reason: 'conflicts'; files: string[]; mode: 'rebase' | 'merge' }
  | { ok: false; reason: 'failed'; failure: GitFailure }

/** 拉取: fast-forward the branch to its upstream, nothing else (a diverged branch fails as `diverged`). */
export type ShipPullRequest = PrTarget

export type ShipPullResult = { ok: true } | { ok: false; reason: 'blocked'; message: string } | { ok: false; reason: 'failed'; failure: GitFailure }

/** 继续 / 中止 the merge, rebase or cherry-pick stopped in the worktree (`GIT_EDITOR=true`: no editor opens). */
export interface ShipOperationRequest extends PrTarget {
  action: 'continue' | 'abort'
}

export type ShipOperationResult =
  | { ok: true }
  | { ok: false; reason: 'blocked'; message: string }
  /** 继续 of a rebase stopped again on the next commit's conflicts. */
  | { ok: false; reason: 'conflicts'; files: string[] }
  | { ok: false; reason: 'failed'; failure: GitFailure }

/** The ShipApi members 合入链路 v2 adds; kept apart until the preload implements them. */
export interface ShipChainApi {
  sync(request: ShipSyncRequest): Promise<ShipSyncResult>
  pull(request: ShipPullRequest): Promise<ShipPullResult>
  operation(request: ShipOperationRequest): Promise<ShipOperationResult>
}

// --- the Ship block's state (Git · 变更, Figma 29C / 29D / 29H), saved with the workspace while a run is open ---------

/**
 * `main`: 合并到 base 并推送; `pr`: 创建 PR; `push-pr`: the branch's PR is open, commit what is uncommitted and push.
 * 合入链路 v2 (not wired yet: ship-runner and saved-runs do not start or restore them): `commit`: 提交… alone (write →
 * glance → commit); `sync`: 同步 <base> (fetch, bring the base into the branch).
 */
export type ShipKind = 'main' | 'pr' | 'push-pr' | 'commit' | 'sync'
/** `sync`: the fetch-and-merge (or rebase) step of a `sync` run (not wired yet). */
export type StepId = 'review' | 'write' | 'commit' | 'merge' | 'push' | 'create' | 'sync'
export type StepState = 'pending' | 'working' | 'done' | 'failed'
/** writing: steps before the user sees the text; glance: the text is shown for a last look; running: Wavi's own steps. */
export type ShipStage = 'writing' | 'glance' | 'running'

export interface FlowStep {
  id: StepId
  label: string
  state: StepState
  /** A quiet addition to the label (what the step is waiting for, why it was skipped). */
  note?: string
}

/** What the user can edit in the glance. */
export interface ShipTexts {
  /** The commit message: subject, blank line, body. */
  commit: string
  title: string
  body: string
  draft: boolean
}

export interface ShipError {
  step: StepId
  message: string
  /** The end of what git and its hooks printed. */
  output?: string
  /** 合并 stopped on these files: 交给 agent 解. */
  conflicts?: string[]
  /** The push of the base was refused (protection, a hook): 改为创建 PR. */
  pushRefused?: boolean
}

export interface ShipState {
  kind: ShipKind
  /** The exit's label, the block's title line. */
  title: string
  agent: string
  steps: FlowStep[]
  stage: ShipStage
  texts: ShipTexts
  error: ShipError | null
  /** The stage the error happened in: 重试 resumes there. */
  failedIn: ShipStage | null
}
