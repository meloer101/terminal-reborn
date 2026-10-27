// Whether the merge sheet (PRD F4) is open, and for which worktree. Opened from Git · 变更, the Worktree view's
// details and ⇧⌘M (Git · 变更's primary exit, else the active session's worktree).
import { create } from 'zustand'
import type { ProjectId, WorktreeId } from '@shared/types'
import { useWorkspace } from '../../state/workspace'

export interface MergeTarget {
  projectId: ProjectId
  /** The project's root (main only accepts workspace project roots). */
  root: string
  /** The worktree whose branch is merged, as git lists it. */
  worktreePath: string
  /** Workspace worktree records at that path (their sessions; removed with the worktree). */
  worktreeIds: WorktreeId[]
  isMain: boolean
}

export const useMergeSheet = create<{ target: MergeTarget | null; generation: number }>()(() => ({ target: null, generation: 0 }))

let restoreFocus: HTMLElement | null = null

export function openMergeSheet(target: MergeTarget): void {
  if (useMergeSheet.getState().target) return
  const active = document.activeElement
  restoreFocus = active instanceof HTMLElement && active !== document.body ? active : null
  useMergeSheet.setState((s) => ({ target, generation: s.generation + 1 }))
}

export function closeMergeSheet(refocus: boolean): void {
  if (!useMergeSheet.getState().target) return
  useMergeSheet.setState({ target: null })
  const back = restoreFocus
  restoreFocus = null
  if (refocus) requestAnimationFrame(() => (back?.isConnected ? back.focus() : useWorkspace.getState().requestTerminalFocus()))
}

export const isMergeSheetOpen = (): boolean => useMergeSheet.getState().target !== null

/** The exit Git · 变更 shows as primary for a worktree it is open on (合并到 main 并推送 / 创建 PR); ⇧⌘M runs it. */
const primaryExits = new Map<string, () => void>()

/** Git · 变更 registers (and on unmount drops) what its primary exit button does; returns the unregister function. */
export function registerPrimaryExit(worktreePath: string, run: () => void): () => void {
  primaryExits.set(worktreePath, run)
  return () => {
    if (primaryExits.get(worktreePath) === run) primaryExits.delete(worktreePath)
  }
}

/**
 * ⇧⌘M: the primary exit of Git · 变更 when that view is open on the active session's worktree and has one; else the
 * merge sheet (the PR's when the primary is 合并 PR #N…) for the worktree (nothing for the main checkout or without a session).
 */
export function openMergeForActiveSession(): void {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === state.activeSessionId)
  const worktree = session ? state.worktrees.find((w) => w.id === session.worktreeId) : undefined
  const project = worktree ? state.projects.find((p) => p.id === worktree.projectId) : undefined
  if (!worktree || !project) return
  const exit = primaryExits.get(worktree.path)
  if (exit) return exit()
  openMergeSheet(targetFor(project.rootPath, worktree))
}

/** The target for a workspace worktree record (every record at the same path goes with it). */
export function targetFor(root: string, worktree: { projectId: ProjectId; path: string; isMain: boolean }): MergeTarget {
  const ids = useWorkspace
    .getState()
    .worktrees.filter((w) => w.projectId === worktree.projectId && w.path === worktree.path)
    .map((w) => w.id)
  return { projectId: worktree.projectId, root, worktreePath: worktree.path, worktreeIds: ids, isMain: worktree.isMain }
}
