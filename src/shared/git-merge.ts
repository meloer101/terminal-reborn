// Local merge of a worktree's branch into its base (PRD F4, Figma 05): the IPC payloads, the request validation main
// uses, and pure parsers for `git merge-tree --write-tree` and the commit messages main writes.
//
// The merge never runs in a working tree: main builds the merged (or squashed) commit with `merge-tree --write-tree`
// and `commit-tree`, then moves the base forward — `merge --ff-only` where the base is checked out, `update-ref`
// (compare-and-swap) where it is not. Either the base moves to a finished commit or nothing changes.

export type MergeMethod = 'squash' | 'merge' | 'rebase'

export const MERGE_METHODS: readonly MergeMethod[] = ['squash', 'merge', 'rebase']

/** A file `git merge-tree` could not merge, with git's conflict type (content, modify/delete, add/add, rename/…). */
export interface MergeConflict {
  path: string
  type: string
}

/** Why the worktree cannot be merged at all (nothing the merge method changes). */
export type MergeBlocker =
  /** the worktree is not on a branch */
  | { kind: 'detached' }
  /** there is no base to merge into (no `branch.<name>.base`, no main branch), or it is the branch itself */
  | { kind: 'no-base' }
  /** the base is not a local branch */
  | { kind: 'base-missing'; base: string }
  /** a merge / rebase / cherry-pick / revert is in progress in the worktree or in the base's checkout */
  | { kind: 'busy'; where: 'worktree' | 'base'; operation: GitOperation }
  /** the branch has no commits the base lacks */
  | { kind: 'nothing' }
  /** git is older than 2.38 (no `merge-tree --write-tree`) */
  | { kind: 'old-git' }
  /** the base's checkout has uncommitted changes in files the merge changes */
  | { kind: 'base-dirty'; path: string; files: string[] }
  /** the worktree is the main checkout (it is on the base, or merging into itself) */
  | { kind: 'main' }
  /** rebase only: the worktree has uncommitted changes (git would refuse) */
  | { kind: 'worktree-dirty' }
  /** git failed while checking */
  | { kind: 'unverified'; message: string }

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface MergePrecheck {
  /** The worktree's branch and the base it merges into ('' when unknown). */
  branch: string
  base: string
  /** Commits as checked; the merge refuses to run when either moved meanwhile. */
  head: string
  baseHead: string
  /** Commits on the branch the base lacks / on the base the branch lacks. */
  ahead: number
  behind: number
  /** Files that would conflict; empty when the merge is clean. */
  conflicts: MergeConflict[]
  /** Uncommitted paths in the worktree (not part of the merge); null when git could not tell. */
  uncommitted: number | null
  /** Where the base is checked out, if anywhere (the merge fast-forwards that checkout). */
  baseCheckout: string | null
  /** The base's upstream (e.g. origin/main) and how many commits it has that the base does not. */
  upstream: string | null
  upstreamAhead: number
  /** Whether there is an `origin` remote to push to. */
  hasOrigin: boolean
  blocker: MergeBlocker | null
}

export interface MergeRequest {
  /** The workspace project root (main refuses anything else). */
  root: string
  /** The worktree whose branch is merged. */
  worktree: string
  method: MergeMethod
  /** From the precheck: the merge refuses when either moved. */
  head: string
  baseHead: string
  push: boolean
  /** Squash only: the commit's subject (the session's title); main falls back to the branch name. */
  title?: string
  /** Squash only (exit A, PRD F16 v1.78): the whole agent-written message, subject first; wins over `title`. */
  message?: string
}

export type MergeFailure =
  /** the branch or the base moved since the precheck: check again */
  | 'stale'
  /** the merge would conflict (or the rebase stopped on a conflict and was aborted) */
  | 'conflict'
  /** a precheck blocker (see `blocker`) */
  | 'blocked'
  | 'invalid'
  /** any other git error; nothing was changed unless `rebased` */
  | 'git'

export type MergeResult =
  | {
      ok: true
      /** The base's new commit. */
      commit: string
      /** null: not asked to push; '' pushed; otherwise git's error (the merge itself stands). */
      push: string | null
    }
  | {
      ok: false
      reason: MergeFailure
      message?: string
      blocker?: MergeBlocker
      conflicts?: MergeConflict[]
      /** Rebase only: the branch was rebased onto the base but the base could not be moved. */
      rebased?: boolean
    }

const MAX_PATH = 4096
const MAX_TITLE = 200
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/

const isAbsolutePath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') && value.startsWith('/')

/** Validates a merge request from the renderer; null when anything is off. */
export function parseMergeRequest(raw: unknown): MergeRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!isAbsolutePath(r.root) || !isAbsolutePath(r.worktree)) return null
  if (typeof r.method !== 'string' || !(MERGE_METHODS as readonly string[]).includes(r.method)) return null
  if (typeof r.head !== 'string' || !SHA.test(r.head) || typeof r.baseHead !== 'string' || !SHA.test(r.baseHead)) return null
  if (typeof r.push !== 'boolean') return null
  const request: MergeRequest = { root: r.root, worktree: r.worktree, method: r.method as MergeMethod, head: r.head, baseHead: r.baseHead, push: r.push }
  if (r.title !== undefined) {
    if (typeof r.title !== 'string') return null
    const title = oneLine(r.title).slice(0, MAX_TITLE)
    if (title) request.title = title
  }
  return request
}

/** Control characters and line breaks out, runs of spaces collapsed. */
export function oneLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * `git merge-tree --write-tree --name-only <base> <branch>` output (core.quotePath=false): the tree on the first
 * line; when it conflicts, the conflicted paths follow, then a blank line and git's messages, whose `CONFLICT (<type>)`
 * lines name each path's conflict type.
 */
export function parseMergeTree(output: string, conflicted: boolean): { tree: string; conflicts: MergeConflict[] } {
  const lines = output.split('\n')
  const tree = (lines[0] ?? '').trim()
  if (!conflicted) return { tree, conflicts: [] }
  const paths: string[] = []
  let i = 1
  for (; i < lines.length && lines[i] !== ''; i++) if (!paths.includes(lines[i]!)) paths.push(lines[i]!)
  const messages = lines.slice(i + 1).filter((line) => line.startsWith('CONFLICT ('))
  const conflicts = paths.map((path) => {
    const message = messages.find((line) => mentions(line, path))
    const type = message ? (/^CONFLICT \(([^)]+)\)/.exec(message)?.[1] ?? 'content') : 'content'
    return { path, type }
  })
  return { tree, conflicts }
}

/** Whether a merge message names `path` as a whole word ("… in src/a.ts", "a.ts deleted in …"), not inside another. */
function mentions(line: string, path: string): boolean {
  return line.endsWith(` ${path}`) || line.includes(` ${path} `) || line.includes(` ${path}.`) || line.includes(` ${path},`)
}

/** git's merge commit subject: "Merge branch 'x'", plus " into y" unless y is main / master (as fmt-merge-msg does). */
export function mergeMessage(branch: string, base: string): string {
  return base === 'main' || base === 'master' ? `Merge branch '${branch}'` : `Merge branch '${branch}' into ${base}`
}

/**
 * A squash commit's message: one commit keeps its own message; several get the title (or "Squash merge branch 'x'")
 * and a list of their subjects (oldest first).
 */
export function squashMessage(branch: string, commits: readonly { subject: string; body: string }[], title?: string): string {
  if (commits.length === 1) return commits[0]!.body.trim() || commits[0]!.subject
  const subject = title?.trim() || `Squash merge branch '${branch}'`
  if (commits.length === 0) return subject
  return `${subject}\n\n${commits.map((c) => `- ${c.subject}`).join('\n')}\n`
}

/** Which operation a git dir shows in progress, from the names of the files and folders in it. */
export function operationInProgress(entries: readonly string[]): GitOperation | null {
  const has = (name: string): boolean => entries.includes(name)
  if (has('rebase-merge') || has('rebase-apply')) return 'rebase'
  if (has('MERGE_HEAD')) return 'merge'
  if (has('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (has('REVERT_HEAD')) return 'revert'
  return null
}

/** Tracked paths with uncommitted changes, from `git status --porcelain=v1 -z` (untracked `??` entries skipped). */
export function trackedDirtyPaths(statusZ: string): string[] {
  const parts = statusZ.split('\0')
  const paths: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]!
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    if (code === '??' || code === '!!') continue
    paths.push(entry.slice(3))
    // Renames and copies are followed by their source path.
    if (code[0] === 'R' || code[0] === 'C') paths.push(parts[++i] ?? '')
  }
  return paths.filter(Boolean)
}
