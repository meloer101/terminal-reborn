// A project's git worktrees for the right panel's Worktree view (PRD F17): the IPC payloads and the pure parsers
// main uses on `git worktree list --porcelain`, `git diff --numstat` and `git rev-list --left-right --count`.

/** One worktree of the repository, as main read it. Paths are absolute and resolved (symlinks followed). */
export interface GitWorktreeInfo {
  /** Path as `git worktree list` prints it. */
  path: string
  /** `path` with symlinks resolved (equals `path` when it no longer exists). */
  realPath: string
  /** Commit checked out; null for a bare entry or an unborn branch. */
  head: string | null
  /** Short branch name (`refs/heads/` stripped); null when detached. */
  branch: string | null
  /** The repository's main checkout (first entry of the list). */
  isMain: boolean
  locked: boolean
  /** The folder is gone; `git worktree prune` drops the entry. */
  prunable: boolean
  /** Branch the ahead / behind and merged state compare with; null for the base itself or when there is none. */
  base: string | null
  /** Commits on this worktree's HEAD that `base` does not have (null without a base). */
  ahead: number | null
  behind: number | null
  /** Every commit of HEAD is already in `base`, and `base` has moved past it (see isMergedInto). */
  merged: boolean
  /** Uncommitted line stats vs HEAD (`git diff --numstat HEAD`; untracked files are not counted). */
  added: number
  removed: number
  /** Uncommitted paths (tracked changes and untracked files), at most MAX_DIRTY_FILES. */
  dirtyFiles: string[]
  /** All uncommitted paths, which can be more than dirtyFiles holds. */
  dirtyCount: number
}

export interface GitWorktreeListing {
  /** Branch new worktrees fork from and merge back into: origin's HEAD, else main / master, else the main checkout's. */
  mainBranch: string | null
  worktrees: GitWorktreeInfo[]
  /** Resolved path of each `knownPaths` entry the renderer asked about (missing ones are left out). */
  realPaths: Record<string, string>
}

export type WorktreeRemoveResult =
  | { ok: true }
  | {
      ok: false
      /** dirty: uncommitted changes · main: the main checkout · unknown: not a worktree of this repo · git: git refused */
      reason: 'dirty' | 'main' | 'unknown' | 'git'
      /** git's own message (English) for reason 'git'. */
      message?: string
    }

export const MAX_DIRTY_FILES = 50

/** A raw entry of `git worktree list --porcelain`. */
export interface PorcelainWorktree {
  path: string
  head: string | null
  branch: string | null
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
}

/**
 * Parses `git worktree list --porcelain` (one attribute per line, blank line between worktrees; `-z` is not used so
 * paths with newlines are not supported, as in git's own non-z output).
 */
export function parseWorktreePorcelain(output: string): PorcelainWorktree[] {
  const result: PorcelainWorktree[] = []
  let current: PorcelainWorktree | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), head: null, branch: null, bare: false, detached: false, locked: false, prunable: false }
      result.push(current)
      continue
    }
    if (!current) continue
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    const value = space < 0 ? '' : line.slice(space + 1)
    if (key === 'HEAD') current.head = /^0+$/.test(value) ? null : value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'bare') current.bare = true
    else if (key === 'detached') current.detached = true
    else if (key === 'locked') current.locked = true
    else if (key === 'prunable') current.prunable = true
  }
  return result
}

/** Sums `git diff --numstat` lines ("added\tremoved\tpath"); binary files ("-\t-") count as no lines. */
export function parseNumstat(output: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of output.split('\n')) {
    const [a, r] = line.split('\t')
    if (a === undefined || r === undefined) continue
    added += Number.parseInt(a, 10) || 0
    removed += Number.parseInt(r, 10) || 0
  }
  return { added, removed }
}

/** `git rev-list --left-right --count <base>...<head>` prints "behind\tahead" (left = only in base). */
export function parseAheadBehind(output: string): { ahead: number; behind: number } | null {
  const match = /^(\d+)\s+(\d+)\s*$/.exec(output.trim())
  if (!match) return null
  return { behind: Number(match[1]), ahead: Number(match[2]) }
}

/**
 * Merged into the base: nothing on HEAD is missing from the base, and HEAD is not simply the base's own tip (a worktree
 * just forked from the base has nothing to merge yet, so it does not count).
 */
export function isMergedInto(ahead: number | null, head: string | null, baseHead: string | null): boolean {
  return ahead === 0 && head !== null && baseHead !== null && head !== baseHead
}

/**
 * The branch that counts as "main": origin's default branch when it exists locally, else `main` / `master`, else
 * what the main checkout has out.
 */
export function pickMainBranch(localBranches: readonly string[], originHead: string | null, mainCheckoutBranch: string | null): string | null {
  const fromOrigin = originHead?.replace(/^origin\//, '') ?? null
  if (fromOrigin && localBranches.includes(fromOrigin)) return fromOrigin
  for (const name of ['main', 'master']) if (localBranches.includes(name)) return name
  return mainCheckoutBranch
}

/**
 * Base branch per branch from `git config --get-regexp '^branch\..*\.base$'` ("branch.<name>.base <base>" lines).
 * Branch names may contain dots, so the key is cut at the last ".base".
 */
export function parseBaseConfig(output: string): Record<string, string> {
  const bases: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const match = /^branch\.(.+)\.base (.+)$/.exec(line.trim())
    if (match) bases[match[1]!] = match[2]!.replace(/^refs\/heads\//, '')
  }
  return bases
}
