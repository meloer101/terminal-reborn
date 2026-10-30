// Worktree view state per project root: the last git listing, the row the user picked, and the one-line notice
// (refusals and results). Git runs in main (window.tr.gitWorktrees); this only asks and keeps the answer.
import { create } from 'zustand'
import type { GitWorktreeListing } from '@shared/git-worktrees'
import { mergeListing } from './model'

export interface ProjectWorktrees {
  /** undefined while the first listing loads; null when the project is not a git repository. */
  listing: GitWorktreeListing | null | undefined
  failed: boolean
  /** Resolved path of the row the user clicked (null = follow the active session, COLLAPSED = none open). */
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

interface Queue {
  running: Promise<void> | null
  /** What the next listing should cover once the running one ends: null = everything, a set = those paths. */
  next: { knownPaths: string[]; only: Set<string> | null } | undefined
}

const queues = new Map<string, Queue>()

async function listOnce(root: string, knownPaths: string[], only: Set<string> | null): Promise<void> {
  try {
    const listing = await window.tr.gitWorktrees.list(root, knownPaths, only ? [...only] : undefined)
    patchRoot(root, { listing: listing ? mergeListing(worktreesOf(root).listing, listing) : null, failed: false })
  } catch {
    patchRoot(root, { failed: true, listing: worktreesOf(root).listing ?? null })
  }
}

/**
 * Lists the project's worktrees again: one listing at a time per project, with at most one more queued (requests
 * that arrive meanwhile are folded into it). `only` (resolved paths) limits the details to those worktrees.
 */
export function refreshWorktrees(root: string, knownPaths: string[], only?: readonly string[]): Promise<void> {
  let queue = queues.get(root)
  if (!queue) {
    queue = { running: null, next: undefined }
    queues.set(root, queue)
  }
  const wanted = only ? new Set(only) : null
  if (queue.next === undefined) queue.next = { knownPaths, only: wanted }
  else {
    const pending = queue.next.only
    queue.next = { knownPaths, only: pending && wanted ? new Set([...pending, ...wanted]) : null }
  }
  const q = queue
  q.running ??= (async () => {
    while (q.next !== undefined) {
      const { knownPaths: paths, only: subset } = q.next
      q.next = undefined
      await listOnce(root, paths, subset)
    }
    q.running = null
  })()
  return q.running
}

const watchers = new Map<string, number>()

/**
 * Watches the repository at `root` until the returned function is called. Main keeps one watch per root and window,
 * so the Worktree view and the branch sync share it: the last one to let go stops it.
 */
export function watchRepo(root: string): () => void {
  const count = watchers.get(root) ?? 0
  watchers.set(root, count + 1)
  if (count === 0) window.tr.gitWorktrees.watch(root)
  let released = false
  return () => {
    if (released) return
    released = true
    const left = (watchers.get(root) ?? 1) - 1
    if (left > 0) return void watchers.set(root, left)
    watchers.delete(root)
    window.tr.gitWorktrees.unwatch(root)
  }
}
