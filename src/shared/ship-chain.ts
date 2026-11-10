// The merge chain's state (合入链路 v2, PRD v1.169): one answer to "where is this worktree stuck and what can be done".
// From what the app already knows (the ship preflight, the PR poll, the change list, the worktree's sessions) it gives
// the state line, the primary and secondary move, and every chain action in a fixed order with the reason it cannot
// run now. Pure; Git · 变更, the phone (PRD F22) and ⌘K read it. Rules, first match decides (a–g):
//   a. a merge / rebase / cherry-pick stopped → hand the conflicts to the agent, or 继续; 中止 beside it
//   b. the main checkout on its base / a failed preflight (detached HEAD) / no project → only the reason
//      (while the preflight runs: d and e still apply, else the two exits wait as 正在检查…)
//   c. an open PR → 拉取 (or hand a diverged branch to the agent) / 提交并推送 / 推送 to it, else 合并 PR #N…
//   d. merged (PR merged, or the branch's work is in the base) and clean → 已经全部合并, 归档…
//   e. nothing of its own and clean → nothing at all
//   f. landing on the base would conflict → 同步 <base>
//   g. the two exits: 合并到 <base> 并推送 and 创建 PR, the remembered (else suggested) one first
import { archiveBlocker } from './archive'
import type { GitChanges } from './git-graph/log'
import { livePr, unpushedOf, type GhState, type PrStatus } from './pull-requests'
import type { ShipExitKind, ShipOperation, ShipPreflight } from './ship'
import type { Session } from './types'

// ── contract ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Every chain action, in the order `actions` lists them. `pr`: 创建 PR, or 推送到 PR #N while one is open; `main`:
 *  合并到 <base> (并推送) — the ids match ShipExitKind. */
export const CHAIN_ACTION_IDS = ['commit', 'sync', 'pull', 'push', 'pr', 'main', 'merge-pr', 'archive'] as const
export type ChainActionId = (typeof CHAIN_ACTION_IDS)[number]

/** What `next` / `second` can be: a chain action, or one of the moves only a stuck state offers. `handoff`: put the
 *  problem into the agent's input line (no Enter); `continue` / `abort`: the operation in progress. */
export type ChainMoveId = ChainActionId | 'handoff' | 'continue' | 'abort'

/** ok: done (merged) · blocked: something stands in the way · working: Wavi is still checking · info: a fact to act on. */
export type ChainTone = 'ok' | 'blocked' | 'working' | 'info'

/** Which rule decided (a–g above); `checking` while the preflight runs. */
export type ChainStage = 'operation' | 'stuck' | 'checking' | 'pr' | 'merged' | 'empty' | 'conflicts' | 'exits'

export interface ChainHeadline {
  tone: ChainTone
  text: string
}

export interface ChainAction {
  id: ChainActionId
  label: string
  /** Why it cannot run now (UI copy), or null. */
  blocker: string | null
}

export interface ChainMove {
  id: ChainMoveId
  label: string
  blocker: string | null
}

/** The branch's open (or draft) PR, as the chain needs it. */
export interface ChainPr {
  number: number
  draft: boolean
  /** The local branch has commits the PR lacks (and the PR nothing the branch lacks). */
  unpushed: boolean
  /** The PR has commits the local branch lacks. */
  remoteAhead: boolean
}

/** What Git · 变更's change list says; the counts used while the preflight runs, and always for uncommitted files. */
export interface ChainLocal {
  branch: string | null
  base: string | null
  ahead: number
  /** Every uncommitted path, untracked ones included (also those past the list's cap). */
  uncommitted: number
  /** Uncommitted paths git tracks (同步 refuses with these). */
  trackedUncommitted: number
}

export interface ChainInput {
  /** null while it runs. */
  preflight: ShipPreflight | null
  /** This repository's last used exit, null when never used. */
  remembered: ShipExitKind | null
  local: ChainLocal
  pr: ChainPr | null
  /** The branch's newest PR was merged on GitHub (and none is open). */
  prMerged: boolean
  /** The worktree is the project's main checkout. */
  isMain: boolean
  projectRoot: string | null
  /** gh as the renderer last heard (newer than the preflight's); null when unknown. */
  gh: GhState | null
  /** Display name of the worktree's agent session that takes hand-offs (`Claude`, `Codex`, a GUI driver's name);
   *  null when the worktree has none. */
  agent: string | null
  /** The worktree's sessions (归档… waits while one runs or waits on the user). */
  sessions: readonly Pick<Session, 'status'>[]
  /** The conflict radar's files against the base, used while the preflight has no `baseConflicts`; null when unknown. */
  radarConflicts: readonly string[] | null
}

export interface ChainState {
  stage: ChainStage
  /** The state line; null when there is nothing to say. */
  headline: ChainHeadline | null
  /** The primary move, or null. */
  next: ChainMove | null
  /** The other move beside it, or null. */
  second: ChainMove | null
  /** Every chain action, in CHAIN_ACTION_IDS order. */
  actions: ChainAction[]
  /** Why no action but 归档… can run at all (an operation, the base, no project, checking, a failed preflight); null otherwise. */
  blocked: string | null
  /** The base the labels name. */
  base: string
  /** The open PR the chain used, or null. */
  openPr: number | null
}

/** Action and move labels. */
export const CHAIN_LABEL = {
  commit: '提交…',
  sync: (base: string) => `同步 ${base}`,
  pull: '拉取',
  push: '推送',
  createPr: '创建 PR',
  pushPr: (n: number) => `推送到 PR #${n}`,
  commitPushPr: (n: number) => `提交并推送到 PR #${n}`,
  merge: (base: string) => `合并到 ${base}`,
  mergePush: (base: string) => `合并到 ${base} 并推送`,
  mergePr: (n: number | null) => (n === null ? '合并 PR…' : `合并 PR #${n}…`),
  archive: '归档…',
  handoff: (agent: string | null) => `交给 ${agent ?? 'agent'}`,
  continue: '继续',
  abort: '中止'
} as const

/** Every sentence the chain can show as a headline or a blocker (besides the preflight's own message). */
export const CHAIN_TEXT = {
  checking: '正在检查…',
  onBase: '项目主目录检出的是基线分支，没有要合并的分支',
  noProject: '找不到这个 worktree 的项目',
  noAgent: '这个 worktree 没有 agent 会话',
  operation: (op: ShipOperation['kind']) => `${op} 进行中`,
  operationConflicts: (op: ShipOperation['kind'], files: number) => `${op} 进行中 · ${files} 个文件有冲突`,
  diverged: '远程分支和本地分叉',
  remoteAhead: '远程有本地没有的提交',
  merged: (base: string) => `已经全部合并到 ${base}`,
  baseConflicts: (base: string, files: number) => `和 ${base} 会冲突 · ${files} 个文件`,
  nothingToCommit: '没有未提交的改动',
  commitFirst: '先提交改动',
  baseHasNothing: (base: string) => `${base} 没有新的提交`,
  noRemotePush: '没有远程仓库，没法推送分支',
  noRemotePull: '没有远程仓库，没法拉取',
  neverPushed: '分支还没有推送过',
  remoteHasNothing: '远程分支没有新的提交',
  nothingToPush: '没有要推送的提交',
  hasPr: (n: number) => `分支已有 PR #${n}`,
  notGitHub: '远程不在 GitHub 上',
  ghMissing: '创建 PR 需要 GitHub CLI：装好 gh 后在终端运行 gh auth login',
  ghSignedOut: 'gh 还没有登录：在终端运行 gh auth login 后可以创建 PR',
  nothingToMerge: '没有要合并的改动',
  nothingNewer: (base: string) => `没有比 ${base} 新的提交`,
  noPr: '这个分支没有打开的 PR',
  draftPr: 'PR 还是草稿：先在 GitHub 上标记为可审阅',
  prRemoteAhead: 'PR 上有本地没有的提交'
} as const

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the worktree has no branch of its own to merge or propose: the project's main checkout while it has its base
 * out (on the base itself the base is its upstream), no base, or a detached HEAD. A feature branch checked out in the
 * main checkout merges and opens PRs like any worktree's (PRD F4 / F16).
 */
export function onOwnBase(isMain: boolean, changes: Pick<GitChanges, 'branch' | 'base'>): boolean {
  if (!isMain) return false
  const { branch, base } = changes
  return !branch || !base || base === branch || base === `origin/${branch}`
}

/** The chain's input from what Git · 变更 (or the phone, ⌘K) reads: the preflight, the PR poll and the change list. */
export function chainInputFrom(sources: {
  preflight: ShipPreflight | null
  remembered: ShipExitKind | null
  prStatus: PrStatus | null
  changes: Pick<GitChanges, 'branch' | 'base' | 'ahead' | 'uncommitted' | 'untrackedOmitted'>
  isMain: boolean
  projectRoot: string | null
  gh?: GhState | null
  agent?: string | null
  sessions?: readonly Pick<Session, 'status'>[]
  radarConflicts?: readonly string[] | null
}): ChainInput {
  const { preflight, prStatus, changes } = sources
  const live = livePr(prStatus)
  const openPr = preflight?.ok ? preflight.openPr : null
  const pr: ChainPr | null = live
    ? { number: live.number, draft: live.state === 'draft', unpushed: unpushedOf(prStatus), remoteAhead: prStatus?.local?.remoteAhead === true }
    : openPr !== null
      ? { number: openPr, draft: false, unpushed: false, remoteAhead: false }
      : null
  return {
    preflight,
    remembered: sources.remembered,
    local: {
      branch: changes.branch,
      base: changes.base,
      ahead: changes.ahead,
      uncommitted: changes.uncommitted.length + changes.untrackedOmitted,
      trackedUncommitted: changes.uncommitted.filter((c) => !c.untracked).length
    },
    pr,
    prMerged: !live && prStatus?.pr?.state === 'merged',
    isMain: sources.isMain,
    projectRoot: sources.projectRoot,
    gh: sources.gh ?? null,
    agent: sources.agent ?? null,
    sessions: sources.sessions ?? [],
    radarConflicts: sources.radarConflicts ?? null
  }
}

/** The remote branch against the local one: from the preflight, else what the PR poll tells; null: never pushed;
 *  undefined: not known. */
function remoteBranch(pf: Extract<ShipPreflight, { ok: true }> | null, pr: ChainPr | null): { ahead: number; behind: number } | null | undefined {
  if (pf?.upstream !== undefined) return pf.upstream
  if (pr) return { ahead: pr.unpushed ? 1 : 0, behind: pr.remoteAhead ? 1 : 0 }
  if (pf?.pushed === false) return null
  return undefined
}

const first = (...reasons: Array<string | false | null | undefined>): string | null => reasons.find((r): r is string => typeof r === 'string') ?? null

// ── the chain ───────────────────────────────────────────────────────────────────────────────────────────────────

export function shipChain(input: ChainInput): ChainState {
  const { preflight, local, isMain } = input
  const pf = preflight?.ok ? preflight : null
  const operation = preflight?.operation ?? null
  const base = pf?.base ?? local.base ?? 'main'
  const ahead = pf ? pf.ahead : local.ahead
  const merged = pf?.merged === true
  const uncommitted = local.uncommitted
  /** undefined: not known yet (the preflight runs). */
  const remote = pf ? pf.remote : undefined
  const pr = input.pr
  const rb = remoteBranch(pf, pr)
  const remoteAhead = (rb?.behind ?? 0) > 0 || pr?.remoteAhead === true
  const unpushed = pr !== null && !remoteAhead && (pr.unpushed || (rb?.ahead ?? 0) > 0)
  const diverged = rb !== null && rb !== undefined && rb.ahead > 0 && rb.behind > 0
  const gh = input.gh && input.gh !== 'checking' ? input.gh : (pf?.gh ?? input.gh)
  const conflicts = pf?.baseConflicts ?? input.radarConflicts ?? null
  const nothing = (ahead === 0 || merged) && uncommitted === 0
  const onBase = onOwnBase(isMain, local)

  // What stops every action but 归档… (rule a, b and the pending preflight).
  const blocked = first(
    operation && CHAIN_TEXT.operation(operation.kind),
    onBase && CHAIN_TEXT.onBase,
    !input.projectRoot && CHAIN_TEXT.noProject,
    !preflight && CHAIN_TEXT.checking,
    preflight?.ok === false && preflight.message
  )

  const own: Record<ChainActionId, { label: string; blocker: string | null }> = {
    commit: { label: CHAIN_LABEL.commit, blocker: first(uncommitted === 0 && CHAIN_TEXT.nothingToCommit) },
    sync: {
      label: CHAIN_LABEL.sync(base),
      blocker: first(local.trackedUncommitted > 0 && CHAIN_TEXT.commitFirst, pf?.behindBase === 0 && CHAIN_TEXT.baseHasNothing(base))
    },
    pull: {
      label: CHAIN_LABEL.pull,
      blocker: first(
        remote === null && CHAIN_TEXT.noRemotePull,
        rb === null && CHAIN_TEXT.neverPushed,
        rb !== null && rb !== undefined && rb.behind === 0 && CHAIN_TEXT.remoteHasNothing,
        diverged && CHAIN_TEXT.diverged
      )
    },
    push: {
      label: CHAIN_LABEL.push,
      blocker: first(
        remote === null && CHAIN_TEXT.noRemotePush,
        pr !== null && CHAIN_TEXT.hasPr(pr.number),
        rb === null || rb === undefined ? ahead === 0 && CHAIN_TEXT.nothingToPush : rb.ahead === 0 && CHAIN_TEXT.nothingToPush,
        (rb?.behind ?? 0) > 0 && CHAIN_TEXT.remoteAhead
      )
    },
    pr: pr
      ? {
          label: uncommitted > 0 ? CHAIN_LABEL.commitPushPr(pr.number) : CHAIN_LABEL.pushPr(pr.number),
          blocker: first(remoteAhead && CHAIN_TEXT.remoteAhead, uncommitted === 0 && !unpushed && CHAIN_TEXT.nothingToPush)
        }
      : {
          label: CHAIN_LABEL.createPr,
          blocker: first(
            remote === null && CHAIN_TEXT.noRemotePush,
            pf?.remoteOnGitHub === false && CHAIN_TEXT.notGitHub,
            gh === 'missing' && CHAIN_TEXT.ghMissing,
            gh === 'signed-out' && CHAIN_TEXT.ghSignedOut,
            nothing && CHAIN_TEXT.nothingNewer(base)
          )
        },
    main: {
      label: remote === null ? CHAIN_LABEL.merge(base) : CHAIN_LABEL.mergePush(base),
      blocker: first(
        pr !== null && CHAIN_TEXT.hasPr(pr.number),
        nothing && CHAIN_TEXT.nothingToMerge,
        conflicts !== null && conflicts.length > 0 && CHAIN_TEXT.baseConflicts(base, conflicts.length)
      )
    },
    'merge-pr': {
      label: CHAIN_LABEL.mergePr(pr?.number ?? null),
      blocker: first(!pr && CHAIN_TEXT.noPr, pr?.draft === true && CHAIN_TEXT.draftPr, pr?.remoteAhead === true && CHAIN_TEXT.prRemoteAhead)
    },
    archive: { label: CHAIN_LABEL.archive, blocker: archiveBlocker(input.sessions, isMain) }
  }
  const actions: ChainAction[] = CHAIN_ACTION_IDS.map((id) => ({
    id,
    label: own[id].label,
    blocker: id === 'archive' ? own[id].blocker : (blocked ?? own[id].blocker)
  }))
  const move = (id: ChainActionId): ChainMove => {
    const found = actions.find((a) => a.id === id)!
    return { id, label: found.label, blocker: found.blocker }
  }
  const handoff: ChainMove = { id: 'handoff', label: CHAIN_LABEL.handoff(input.agent), blocker: input.agent ? null : CHAIN_TEXT.noAgent }
  const headlineOf = (next: ChainMove | null): ChainHeadline | null =>
    next?.blocker ? { tone: next.blocker === CHAIN_TEXT.checking ? 'working' : 'blocked', text: next.blocker } : null
  const state = (stage: ChainStage, headline: ChainHeadline | null, next: ChainMove | null, second: ChainMove | null = null): ChainState => ({
    stage,
    headline,
    next,
    second,
    actions,
    blocked,
    base,
    openPr: pr?.number ?? null
  })

  // a. An operation stopped in the worktree.
  if (operation) {
    const abort: ChainMove = { id: 'abort', label: CHAIN_LABEL.abort, blocker: null }
    if (operation.unresolved.length > 0) {
      return state('operation', { tone: 'blocked', text: CHAIN_TEXT.operationConflicts(operation.kind, operation.unresolved.length) }, handoff, abort)
    }
    return state('operation', { tone: 'info', text: CHAIN_TEXT.operation(operation.kind) }, { id: 'continue', label: CHAIN_LABEL.continue, blocker: null }, abort)
  }

  // b. Nowhere to go.
  if (onBase) return state('stuck', { tone: 'info', text: CHAIN_TEXT.onBase }, null)
  if (!input.projectRoot) return state('stuck', { tone: 'blocked', text: CHAIN_TEXT.noProject }, null)
  if (preflight?.ok === false) return state('stuck', { tone: 'blocked', text: preflight.message }, null)

  const clean = uncommitted === 0
  const mergedState = (): ChainState => {
    const archive = move('archive')
    return state('merged', { tone: 'ok', text: CHAIN_TEXT.merged(base) }, archive.blocker ? null : archive)
  }
  const exitOrder = (firstKind: ShipExitKind): ChainState => {
    const next = move(firstKind)
    return state(pf ? 'exits' : 'checking', headlineOf(next), next, move(firstKind === 'main' ? 'pr' : 'main'))
  }

  // While the preflight runs, only what the change list and the PR poll know is decided.
  if (!pf) {
    if (input.prMerged && clean) return mergedState()
    if (ahead === 0 && clean && !pr) return state('empty', null, null)
    return exitOrder(input.remembered ?? 'main')
  }

  // c. An open PR. A remote with commits the branch lacks comes first: a push would be refused.
  if (pr) {
    if (remoteAhead) {
      if (diverged) return state('pr', { tone: 'blocked', text: CHAIN_TEXT.diverged }, handoff)
      const pull = move('pull')
      return state('pr', pull.blocker ? headlineOf(pull) : { tone: 'info', text: CHAIN_TEXT.remoteAhead }, pull)
    }
    const next = uncommitted > 0 || unpushed ? move('pr') : move('merge-pr')
    return state('pr', headlineOf(next), next)
  }

  // d. Merged. e. Nothing of its own.
  if ((input.prMerged || merged) && clean) return mergedState()
  if (ahead === 0 && clean) return state('empty', null, null)

  // f. Landing on the base would conflict.
  if (conflicts !== null && conflicts.length > 0) {
    return state('conflicts', { tone: 'blocked', text: CHAIN_TEXT.baseConflicts(base, conflicts.length) }, move('sync'))
  }

  // g. The two exits; without a remote only 合并到 <base>.
  if (pf.remote === null) {
    const next = move('main')
    return state('exits', headlineOf(next), next)
  }
  return exitOrder(input.remembered ?? pf.suggested)
}
