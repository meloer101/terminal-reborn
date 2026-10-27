// The merge chain (PRD F13 / F16 v1.78, Figma 29): three checkpoints (diff, optional review, CI) and two exits
// (合并到 main 并推送 / 创建 PR). The agent in the session writes every piece of text and fixes code; Wavi runs the
// mechanical steps (commit, merge, push, gh) and the brakes. These are the IPC payloads of window.tr.ship.
import type { MergeMethod } from './git-merge'
import type { ChecksSummary, PrTarget } from './pull-requests'
import type { RiskMarker } from './risk-markers'
import type { HandoffKind } from './ship-handoff'

export type ShipExitKind = 'main' | 'pr'

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
      /** Local base commits not on its upstream: a PR or a push would carry them too (Figma 29 note). */
      baseAheadOfUpstream: number
      /** Upstream base commits the local base lacks: 合并到 main pulls first. */
      baseBehindUpstream: number
      /** The branch's open PR, if any (then 创建 PR becomes 推送到 PR #N). */
      openPr: number | null
    }
  | { ok: false; message: string }

/** Where the agent writes one piece of text for Wavi: `<git dir>/wavi/<kind>.md` of the worktree. */
export interface HandoffRequest extends PrTarget {
  kind: HandoffKind
}

/** handoff() clears any old file and answers where the agent should write the new one. */
export type HandoffSlot = { ok: true; path: string } | { ok: false; message: string }

/** 合并到 main 并推送 (exit A): commit `paths` (null: nothing to commit) with `message`, merge into the base, push it. */
export interface ShipMainRequest extends PrTarget {
  /** The agent-written commit message, subject first; also the squash commit's message. */
  message: string
  method: MergeMethod
  paths: string[] | null
}

export type ShipMainResult =
  | { ok: true; commit: string; pushed: boolean; pushError?: string }
  | {
      ok: false
      step: 'commit' | 'merge' | 'push'
      reason: 'blocked' | 'conflicts' | 'failed' | 'declined'
      message: string
      /** reason 'conflicts': the files to hand to the agent. */
      conflicts?: string[]
      /** The end of what git and its hooks printed. */
      output?: string
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
  diffSince(request: DiffSinceRequest): Promise<string | null>
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
  /** invoke(DiffSinceRequest) → string | null */
  diffSince: 'ship:diff-since',
  /** invoke(PrTarget) → RiskMarker[] */
  risks: 'ship:risks',
  /** invoke(PrTarget) → BaseCi | null */
  baseCi: 'ship:base-ci',
  /** invoke(PrTarget) → BaseCiFailure | null */
  baseFailure: 'ship:base-failure',
  /** invoke(PrTarget) → string[] | null */
  baseFailing: 'ship:base-failing',
  /** main → renderer, payload BaseCi */
  baseCiChanged: 'ship:base-ci-changed'
} as const
