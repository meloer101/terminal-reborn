// Worktree view state per project root: the last git listing, the row the user picked, and the one-line notice
// (refusals and results). Git runs in main (window.tr.gitWorktrees); this only asks and keeps the answer.
import { create } from 'zustand'
import type { GitWorktreeListing } from '@shared/git-worktrees'

export interface ProjectWorktrees {
  /** undefined while the first listing loads; null when the project is not a git repository. */
  listing: GitWorktreeListing | null | undefined
  failed: boolean
  /** Resolved path of the row the user clicked (null = follow the active session). */
  picked: string | null
  notice: string | null
  /** A delete or cleanup is running. */
  busy: boolean
}

const EMPTY: ProjectWorktrees = { listing: undefined, failed: false, picked: null, notice: null, busy: false }

export const useWorktrees = create<{ roots: Record<string, ProjectWorktrees> }>()(() => ({ roots: {} }))

export const worktreesOf = (root: string): ProjectWorktrees => useWorktrees.getState().roots[root] ?? EMPTY

export function patchRoot(root: string, patch: Partial<ProjectWorktrees>): void {
  useWorktrees.setState((s) => ({ roots: { ...s.roots, [root]: { ...(s.roots[root] ?? EMPTY), ...patch } } }))
}

const generations = new Map<string, number>()

/** Lists the project's worktrees again; an answer that a newer refresh overtook is dropped. */
export async function refreshWorktrees(root: string, knownPaths: string[]): Promise<void> {
  const generation = (generations.get(root) ?? 0) + 1
  generations.set(root, generation)
  try {
    const listing = await window.tr.gitWorktrees.list(root, knownPaths)
    if (generations.get(root) === generation) patchRoot(root, { listing, failed: false })
  } catch {
    if (generations.get(root) === generation) patchRoot(root, { failed: true, listing: worktreesOf(root).listing ?? null })
  }
}
