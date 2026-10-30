// Keeps each worktree record's branch in step with git: the sidebar's third line, the session header and the overview
// read it (PRD §3.3). The main checkout's record starts without one, and any checkout can switch branch. Lists through
// the Worktree view's queue without per-worktree details (one `git worktree list`), so both share one listing; lists
// again on start, when a project or worktree is added, on window focus and when git's worktree / branch files change.
import { branchesOf } from '../panels/worktree/model'
import { refreshWorktrees, useWorktrees, watchRepo } from '../panels/worktree/store'
import { useWorkspace } from './workspace'

/** Once per window. */
export function startBranchSync(): () => void {
  const watched = new Map<string, () => void>()
  /** Each watched root's worktree paths when it was last listed for them. */
  const listedPaths = new Map<string, string>()

  const pathsOf = (root: string): string[] => {
    const { projects, worktrees } = useWorkspace.getState()
    const project = projects.find((p) => p.rootPath === root)
    return project ? worktrees.filter((w) => w.projectId === project.id).map((w) => w.path) : []
  }
  const refresh = (root: string): void => void refreshWorktrees(root, pathsOf(root), [])
  const refreshAll = (): void => watched.forEach((_unwatch, root) => refresh(root))

  const apply = (root: string): void => {
    const listing = useWorktrees.getState().roots[root]?.listing
    const { projects, worktrees } = useWorkspace.getState()
    const project = projects.find((p) => p.rootPath === root)
    if (!listing || !project) return
    useWorkspace.getState().syncWorktreeBranches(branchesOf(listing, worktrees.filter((w) => w.projectId === project.id)))
  }

  // A new project or worktree record: watch and list the projects whose records changed.
  const follow = (): void => {
    const roots = new Set(useWorkspace.getState().projects.map((p) => p.rootPath))
    for (const [root, unwatch] of watched) {
      if (roots.has(root)) continue
      unwatch()
      watched.delete(root)
      listedPaths.delete(root)
    }
    for (const root of roots) {
      const paths = pathsOf(root).join('\n')
      if (listedPaths.get(root) === paths) continue
      listedPaths.set(root, paths)
      if (!watched.has(root)) watched.set(root, watchRepo(root))
      refresh(root)
    }
  }

  const offWorkspace = useWorkspace.subscribe((state, prev) => {
    if (state.projects !== prev.projects || state.worktrees !== prev.worktrees) follow()
  })
  const offListings = useWorktrees.subscribe((state, prev) => {
    for (const root of watched.keys()) if (state.roots[root]?.listing !== prev.roots[root]?.listing) apply(root)
  })
  const offChanged = window.tr.gitWorktrees.onChanged((root) => {
    if (watched.has(root)) refresh(root)
  })
  window.addEventListener('focus', refreshAll)
  follow()
  return () => {
    offWorkspace()
    offListings()
    offChanged()
    window.removeEventListener('focus', refreshAll)
    watched.forEach((unwatch) => unwatch())
    watched.clear()
    listedPaths.clear()
  }
}
