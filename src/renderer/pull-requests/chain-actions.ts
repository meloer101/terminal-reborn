// The one place every chain action runs from (合入链路 v2, PRD v1.170): Git · 变更's buttons, its ⋯ menu and ⌘K's Git
// group call runChainCommand with the worktree and what to do. It reads the worktree's state again (preflight, change
// list, ticks, PR), refuses with the chain's reason when the action cannot run now (said in the zone's notice line), and
// otherwise starts the Ship run, opens the sheet, or puts the hand-off into the agent's input line (never pressing Enter).
import type { GitChanges } from '@shared/git-graph/log'
import type { PrStatus } from '@shared/pull-requests'
import type { ShipPreflight } from '@shared/ship'
import { agentHandoffPrompt, CHAIN_TEXT, type ChainState } from '@shared/ship-chain'
import { checksText, turnCheckView } from '@shared/turn-checks'
import type { Project, Session, Worktree } from '@shared/types'
import { openArchiveSheet } from '../archive/store'
import { useRadar, markFor } from '../conflict-radar/store'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { commentTarget } from '../panels/git/comments'
import { tickedPaths } from '../panels/git/changes-model'
import { gitOf, loadChanges } from '../panels/git/store'
import { openMergeSheet, primaryExitOf, targetFor } from '../panels/merge/store'
import { agentLabel } from '../panels/merge/model'
import { startBackgroundReview } from '../review/background'
import { useSessionMeta } from '../session-meta/store'
import { insertIntoTerminal } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { openPullRequest } from './actions'
import { bumpChain, loadPreflight, useChainStore } from './chain-store'
import { mergePrBlocker, prRunKind, runOperation, type ChainCommand } from './chain-zone'
import { exitPlan, shipContextFor, type ExitPlan } from './exit-model'
import { commitTitle, divergedPrompt } from './ship-flow'
import { readRemembered, startShip, useShips } from './ship-runner'
import { setPrNotice, usePullRequests } from './store'

export interface ChainPlace {
  worktree: Worktree
  project: Project
  /** The worktree's agent session that takes hand-offs and writes text (the active one when it is here). */
  agent: Session | null
  /** Every session of the worktree (归档… waits while one runs). */
  sessions: Session[]
}

/** The workspace worktree at `worktreePath` (not archived) with its project and sessions; null when there is none. */
export function chainPlace(worktreePath: string): ChainPlace | null {
  const state = useWorkspace.getState()
  const worktree = state.worktrees.find((w) => w.path === worktreePath && !w.archived)
  const project = worktree && state.projects.find((p) => p.id === worktree.projectId)
  if (!worktree || !project) return null
  const ids = new Set(state.worktrees.filter((w) => w.projectId === worktree.projectId && w.path === worktree.path).map((w) => w.id))
  return {
    worktree,
    project,
    agent: commentTarget(worktree, state.sessions, state.worktrees, state.activeSessionId),
    sessions: state.sessions.filter((s) => ids.has(s.worktreeId))
  }
}

export interface ChainSources {
  preflight: ShipPreflight | null
  changes: GitChanges
  prStatus: PrStatus | null
  unticked: ReadonlySet<string>
}

export interface ChainPlan {
  plan: ExitPlan
  /** The chain, with the panel's ticks as its input (an exit commits only ticked files; 提交… needs one). */
  chain: ChainState
  ticked: string[]
}

/** The chain of a worktree from what Git · 变更 reads; the zone, the menu, ⌘K and the commands all use it. */
export function chainPlanOf(place: ChainPlace, sources: ChainSources): ChainPlan {
  const { worktree, project } = place
  const gh = usePullRequests.getState().gh
  const mark = markFor(useRadar.getState().byRoot[project.rootPath], worktree.path)
  const ticked = tickedPaths(sources.changes.uncommitted, sources.unticked)
  const plan = exitPlan({
    preflight: sources.preflight,
    remembered: readRemembered(project.rootPath),
    prStatus: sources.prStatus,
    changes: sources.changes,
    isMain: worktree.isMain,
    projectRoot: project.rootPath,
    gh,
    agent: place.agent ? agentLabel(place.agent.kind) : null,
    sessions: place.sessions,
    radarConflicts: mark ? mark.self.baseConflicts.map((c) => c.path) : null,
    // Files past the list's cap (untrackedOmitted) cannot be ticked or committed from the panel.
    ticked: ticked.length
  })
  return { plan, chain: plan.chain, ticked }
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const say = (worktree: string, text: string): void => setPrNotice(worktree, { tone: 'error', text })

/** The PR status Git · 变更 reads (gh ready), or null. */
function prStatusOf(worktree: string): PrStatus | null {
  const pr = usePullRequests.getState()
  return pr.gh === 'ready' ? (pr.byWorktree[worktree] ?? null) : null
}

/** The worktree's state read again before acting: a fresh preflight and change list. */
async function freshSources(place: ChainPlace): Promise<ChainSources | null> {
  const path = place.worktree.path
  window.tr.pr.refresh(path)
  const [changes, preflight] = await Promise.all([
    window.tr.git.changes(path, place.worktree.baseBranch ?? undefined).catch(() => null),
    loadPreflight({ root: place.project.rootPath, worktree: path })
  ])
  if (!changes) return null
  return { preflight, changes, prStatus: prStatusOf(path), unticked: gitOf(path).unticked }
}

/** Puts `text` into the agent's input line (never sent) and hands it the keyboard. */
async function handTo(place: ChainPlace, text: string): Promise<void> {
  const agent = place.agent
  if (!agent) return say(place.worktree.path, CHAIN_TEXT.noAgent)
  try {
    useWorkspace.getState().setActiveSession(agent.id)
    await ensureAgentUp(agent.id)
    await insertIntoTerminal(agent.id, text)
    useWorkspace.getState().requestTerminalFocus()
  } catch (error) {
    say(place.worktree.path, `没能交给 ${agentLabel(agent.kind)}：${errorText(error)}`)
  }
}

/** The hand-off of the state the chain is stuck in: an operation's conflicts, or a branch diverged from its remote
 *  (with an open PR or without). */
function stuckHandoff(chain: ChainState, preflight: ShipPreflight | null, branch: string): string | null {
  const operation = preflight?.operation
  if (chain.stage === 'operation' && operation) return agentHandoffPrompt({ kind: 'operation', operation: operation.kind, files: operation.unresolved })
  if (chain.headline?.text === CHAIN_TEXT.diverged && preflight?.ok) return divergedPrompt({ branch, remote: preflight.remote ?? 'origin' })
  return null
}

/** The blocker of a command in the chain, or null when it can run. */
function blockerOf(chain: ChainState, command: ChainCommand): string | null {
  if (command === 'merge-sheet') return chain.actions.find((a) => a.id === 'main')?.blocker ?? null
  if (command === 'handoff' || command === 'continue' || command === 'abort') {
    const move = [chain.next, chain.second].find((m) => m?.id === command)
    return move ? move.blocker : '现在不能这样做'
  }
  if (command === 'review' || command === 'open-pr') return null
  return chain.actions.find((a) => a.id === command)?.blocker ?? null
}

/**
 * Runs a chain command for the worktree at `worktreePath`. `openIn`: the session whose built-in browser opens a PR.
 * Resolves when the run started (or the sheet opened, the text went in); what went wrong is said in the zone.
 */
export async function runChainCommand(worktreePath: string, command: ChainCommand, openIn: string | null = null): Promise<void> {
  const place = chainPlace(worktreePath)
  if (!place) return
  const { worktree, project } = place
  const path = worktree.path
  // The sheets and opening the PR need nothing read again.
  if (command === 'archive') return openArchiveSheet(worktree.id)
  if (command === 'merge-sheet') return openMergeSheet(targetFor(project.rootPath, worktree))
  if (command === 'merge-pr') {
    // The sheet shows the PR's merge only with its details; without them it would be the local merge.
    const blocker = mergePrBlocker(prStatusOf(path), usePullRequests.getState().gh)
    return blocker ? say(path, blocker) : openMergeSheet(targetFor(project.rootPath, worktree))
  }
  if (command === 'open-pr') {
    const pr = prStatusOf(path)?.pr
    if (pr) openPullRequest(openIn ?? place.agent?.id ?? null, pr.url)
    return
  }
  if (command === 'review') {
    const agent = place.agent
    if (agent?.kind !== 'claude' && agent?.kind !== 'codex') return say(path, CHAIN_TEXT.noAgent)
    await startBackgroundReview(path, agent.kind, 'manual', worktree.baseBranch).catch((error: unknown) => say(path, `没能开始审阅：${errorText(error)}`))
    return
  }
  if (useShips.getState().byWorktree[path]) return
  const sources = await freshSources(place)
  if (!sources) return say(path, '不是 git 仓库')
  const { plan, chain, ticked } = chainPlanOf(place, sources)
  const blocker = blockerOf(chain, command)
  if (blocker) return say(path, blocker)
  setPrNotice(path, null)
  const { preflight } = sources

  if (command === 'continue' || command === 'abort') {
    const kind = preflight?.operation?.kind ?? 'rebase'
    const result = await runOperation({ root: project.rootPath, worktree: path, action: command }, kind, (request) => window.tr.ship.operation(request), (options) =>
      window.tr.ui.confirm(options)
    ).catch((error: unknown) => ({
      ok: false as const,
      reason: 'blocked' as const,
      message: errorText(error)
    }))
    void loadChanges(path)
    bumpChain(path)
    if (result && !result.ok) say(path, result.reason === 'failed' ? result.failure.message : result.reason === 'conflicts' ? CHAIN_TEXT.operationConflicts(kind, result.files.length) : result.reason === 'blocked' ? result.message : result.files.join('、'))
    return
  }
  if (command === 'handoff') {
    const text = stuckHandoff(chain, preflight, worktree.branch)
    if (text) await handTo(place, text)
    return
  }
  if (!preflight?.ok) return say(path, preflight?.message ?? CHAIN_TEXT.checking)

  const settings = await window.tr.settings.get()
  const checks = turnCheckView(place.agent ? useSessionMeta.getState().bySession[place.agent.id]?.checks : undefined)
  const ctx = shipContextFor({
    projectRoot: project.rootPath,
    worktreePath: path,
    preflight,
    changes: sources.changes,
    pr: plan.pr,
    agentSession: place.agent?.id ?? null,
    openIn: openIn ?? place.agent?.id ?? null,
    checksLine: checks ? `这一轮的检查：${checksText(checks)}` : null,
    settings: { review: settings.review, pr: settings.pr },
    ticked
  })
  const label = chain.actions.find((a) => a.id === command)?.label ?? ''
  // The tip the run starts from: the preflight just read (after a reload the run's own commit is told by it).
  const head = preflight.head
  switch (command) {
    case 'commit':
      return startShip(ctx, 'commit', commitTitle(ticked.length), { head })
    case 'sync':
      return startShip({ ...ctx, paths: null }, 'sync', label, { syncMode: preflight.pushed ? 'merge' : 'rebase', behind: preflight.behindBase, head })
    case 'pull':
      return startShip({ ...ctx, paths: null }, 'pull', label, { head, ...(preflight.pullFrom !== undefined ? { pullFrom: preflight.pullFrom } : {}) })
    case 'push':
      return startShip({ ...ctx, paths: null, openPr: null }, 'push-pr', label, { head })
    case 'pr':
      // The chain's open PR (the poll's, else the preflight's number while gh is not ready): a push to it, never 创建 PR.
      return startShip(ctx, prRunKind(chain), label, { head })
    case 'main':
      return startShip(ctx, 'main', label, { head, ...(preflight.baseRemote !== undefined ? { baseRemote: preflight.baseRemote } : {}) })
  }
}

/**
 * ⇧⌘M (menu command merge-worktree) for the active session's worktree: the primary Git · 变更 registered while it is open
 * there; else, with an open PR (the poll's, or the preflight's number), 合并 PR #N… through the chain (its reason when
 * the PR's details are not read, never the local merge sheet past the PR); else the merge sheet.
 */
export function mergeShortcut(): void {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === state.activeSessionId)
  const worktree = session ? state.worktrees.find((w) => w.id === session.worktreeId && !w.archived) : undefined
  const project = worktree ? state.projects.find((p) => p.id === worktree.projectId) : undefined
  if (!worktree || !project) return
  const exit = primaryExitOf(worktree.path)
  if (exit) return exit()
  const known = useChainStore.getState().preflights[worktree.path]
  const pr = usePullRequests.getState().byWorktree[worktree.path]
  const open = (pr?.pr && (pr.pr.state === 'open' || pr.pr.state === 'draft')) || (known?.ok && known.openPr !== null)
  if (open) return void runChainCommand(worktree.path, 'merge-pr', session?.id ?? null)
  openMergeSheet(targetFor(project.rootPath, worktree))
}
