// PR / CI status in the window (PRD F16): which worktrees main should watch, the statuses it sends back and whether
// gh is usable. gh runs in main; this only mirrors it. Nothing shows while gh is missing or signed out.
import { create } from 'zustand'
import type { GhState, PrStatus, PrTarget, PullRequestInfo } from '@shared/pull-requests'
import type { Project, Session, Worktree } from '@shared/types'
import { useWorkspace } from '../state/workspace'

interface PrStore {
  gh: GhState
  byWorktree: Record<string, PrStatus>
  /** 创建 PR / 让 agent 修复 in flight, per worktree path. */
  busy: Record<string, 'creating' | 'fixing'>
  /** The last 创建 PR / 让 agent 修复 outcome to show under Git · 变更 (UI copy), per worktree path. */
  notice: Record<string, { tone: 'error' | 'muted'; text: string }>
}

export const usePullRequests = create<PrStore>()(() => ({ gh: 'checking', byWorktree: {}, busy: {}, notice: {} }))

export function acceptPrStatus(status: PrStatus): void {
  usePullRequests.setState((s) => ({ byWorktree: { ...s.byWorktree, [status.worktree]: status } }))
}

/** Every worktree of the workspace that is not archived, with its project's root (pure). */
export function prWatchTargets(state: { projects: readonly Project[]; worktrees: readonly Worktree[] }): PrTarget[] {
  const roots = new Map(state.projects.map((p) => [p.id, p.rootPath]))
  const targets: PrTarget[] = []
  for (const worktree of state.worktrees) {
    const root = roots.get(worktree.projectId)
    if (root && !worktree.archived) targets.push({ root, worktree: worktree.path })
  }
  return targets
}

let started = false

/** Keeps main's watch list in step with the workspace and mirrors what it sends back. Once per window. */
export function startPullRequestBridge(): void {
  if (started) return
  started = true
  window.tr.pr.onStatus(acceptPrStatus)
  window.tr.pr.onGh((gh) => usePullRequests.setState({ gh }))
  let sent = ''
  const sync = (): void => {
    const targets = prWatchTargets(useWorkspace.getState())
    const key = JSON.stringify(targets)
    if (key === sent) return
    sent = key
    window.tr.pr.watch(targets)
  }
  // The watch list goes first: statuses() answers for the worktrees this window watches.
  sync()
  useWorkspace.subscribe(sync)
  void window.tr.pr.gh().then((gh) => usePullRequests.setState({ gh }))
  void window.tr.pr.statuses().then((list) => list.forEach(acceptPrStatus))
}

/** The worktree path of a session. */
function worktreePathOf(state: { sessions: readonly Session[]; worktrees: readonly Worktree[] }, sessionId: string): string | null {
  const session = state.sessions.find((s) => s.id === sessionId)
  return state.worktrees.find((w) => w.id === session?.worktreeId)?.path ?? null
}

/** The worktree's PR while gh is ready; null otherwise. */
export function usePr(worktreePath: string | null | undefined): PullRequestInfo | null {
  return usePullRequests((s) => (s.gh === 'ready' && worktreePath ? (s.byWorktree[worktreePath]?.pr ?? null) : null))
}

export function useSessionPr(sessionId: string): PullRequestInfo | null {
  return usePr(useWorkspace((s) => worktreePathOf(s, sessionId)))
}

export function setPrBusy(worktree: string, busy: 'creating' | 'fixing' | null): void {
  usePullRequests.setState((s) => {
    const next = { ...s.busy }
    if (busy) next[worktree] = busy
    else delete next[worktree]
    return { busy: next }
  })
}

export function setPrNotice(worktree: string, notice: PrStore['notice'][string] | null): void {
  usePullRequests.setState((s) => {
    const next = { ...s.notice }
    if (notice) next[worktree] = notice
    else delete next[worktree]
    return { notice: next }
  })
}
