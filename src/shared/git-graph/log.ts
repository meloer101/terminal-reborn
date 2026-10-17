// Contracts and parsers for the Git view of the right panel (PRD F6 / F17 Git · 图谱 + 变更). Main runs git and
// parses its output with these; the renderer only sees the typed results. Pure.

/** Commits per `git log` page. */
export const GRAPH_PAGE_SIZE = 200
export const GRAPH_MAX_PAGE_SIZE = 500

/** `git log --format` fields: hash, parents, committer time, author, subject — unit / record separated. */
export const LOG_FORMAT = '%H%x1f%P%x1f%ct%x1f%an%x1f%s%x1e'
/** `git for-each-ref --format`: object, peeled object (annotated tags), full ref name. */
export const REF_FORMAT = '%(objectname)%00%(*objectname)%00%(refname)'

export interface GitCommit {
  hash: string
  /** First parent first. */
  parents: string[]
  /** Committer time, epoch seconds. */
  time: number
  author: string
  subject: string
}

export type GitRefKind = 'local' | 'remote' | 'tag'

export interface GitRef {
  /** Short name: `main`, `origin/main`, `v1.0`. */
  name: string
  kind: GitRefKind
  /** The commit it points at (annotated tags peeled). */
  hash: string
}

export interface GitWorktreeEntry {
  /** Absolute, symlinks resolved by main. */
  path: string
  head: string | null
  /** Short branch name; null when detached. */
  branch: string | null
}

/** 全部分支 (`--all`) or 仅 worktree (only what the worktrees' HEADs reach). */
export type GitLogScope = 'all' | 'worktrees'

export interface GitLogRequest {
  /** Any worktree of the repo (the active session's). */
  root: string
  skip: number
  limit: number
  scope: GitLogScope
  /** Workspace worktree paths to resolve (symlinks), so the renderer can match them to `worktrees`. */
  known: string[]
}

export interface GitLogPage {
  commits: GitCommit[]
  hasMore: boolean
  refs: GitRef[]
  worktrees: GitWorktreeEntry[]
  /** HEAD of `root`. */
  head: string | null
  /** The default branch and its tip; the graph keeps it in column 0. */
  trunk: { name: string; hash: string } | null
  /** `known` path → its real path. */
  realPaths: Record<string, string>
  /** Changes whenever a ref or a worktree HEAD moves (see `signature`). */
  signature: string
}

export function parseLog(out: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const record of out.split('\x1e')) {
    const line = record.replace(/^\n+/, '')
    if (!line) continue
    const [hash = '', parents = '', time = '0', author = '', subject = ''] = line.split('\x1f')
    if (!/^[0-9a-f]{7,64}$/.test(hash)) continue
    commits.push({ hash, parents: parents ? parents.split(' ') : [], time: Number(time) || 0, author, subject })
  }
  return commits
}

export function parseRefs(out: string): GitRef[] {
  const refs: GitRef[] = []
  for (const line of out.split('\n')) {
    const [object = '', peeled = '', full = ''] = line.split('\0')
    if (!object || !full) continue
    const hash = peeled || object
    if (full.startsWith('refs/heads/')) refs.push({ name: full.slice(11), kind: 'local', hash })
    else if (full.startsWith('refs/remotes/')) {
      // origin/HEAD only repeats the remote's default branch.
      if (!full.endsWith('/HEAD')) refs.push({ name: full.slice(13), kind: 'remote', hash })
    } else if (full.startsWith('refs/tags/')) refs.push({ name: full.slice(10), kind: 'tag', hash })
  }
  return refs
}

/** `git worktree list --porcelain -z`; bare and prunable (folder gone) entries are left out. */
export function parseWorktreeList(out: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  let current: (GitWorktreeEntry & { skip: boolean }) | null = null
  const flush = () => {
    if (current && !current.skip) entries.push({ path: current.path, head: current.head, branch: current.branch })
    current = null
  }
  for (const field of out.split('\0')) {
    if (field === '') {
      flush()
      continue
    }
    const space = field.indexOf(' ')
    const key = space < 0 ? field : field.slice(0, space)
    const value = space < 0 ? '' : field.slice(space + 1)
    if (key === 'worktree') {
      flush()
      current = { path: value, head: null, branch: null, skip: false }
    } else if (!current) continue
    else if (key === 'HEAD') current.head = /^0+$/.test(value) ? null : value
    else if (key === 'branch') current.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'bare' || key === 'prunable') current.skip = true
  }
  flush()
  return entries
}

/** The default branch: local main / master, else whatever origin/HEAD names, else nothing. */
export function pickTrunk(refs: readonly GitRef[], originHead: string | null): { name: string; hash: string } | null {
  for (const name of ['main', 'master']) {
    const ref = refs.find((r) => r.kind === 'local' && r.name === name)
    if (ref) return { name: ref.name, hash: ref.hash }
  }
  if (originHead) {
    const short = originHead.replace(/^refs\/remotes\//, '')
    const local = refs.find((r) => r.kind === 'local' && `origin/${r.name}` === short)
    const remote = refs.find((r) => r.kind === 'remote' && r.name === short)
    const ref = local ?? remote
    if (ref) return { name: ref.name, hash: ref.hash }
  }
  return null
}

/** A branch / ref the renderer may pass as a diff base: plain names only, never an option. */
export function isSafeRefName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && /^[A-Za-z0-9_][A-Za-z0-9._/@-]*$/.test(name) && !name.includes('..')
}

// --- 变更 (F5) ---------------------------------------------------------------------------------------------------

export type GitChangeStatus = 'M' | 'A' | 'D' | 'R' | 'U'

export interface GitFileChange {
  path: string
  /** Where a rename came from. */
  oldPath?: string
  status: GitChangeStatus
  /** Line counts; null for binary files. */
  added: number | null
  removed: number | null
  /** 未提交 only: a file git does not track yet. */
  untracked?: boolean
}

export interface GitChanges {
  branch: string | null
  /** The branch compared against for 已提交; null when there is none (or this is it). */
  base: string | null
  /** Commits on HEAD that the base does not have, and the other way round. */
  ahead: number
  behind: number
  /** Working tree + index vs HEAD, untracked files included. */
  uncommitted: GitFileChange[]
  /** `base...HEAD`: what this branch committed since it left the base. */
  committed: GitFileChange[]
}

export type GitDiffScope = 'uncommitted' | 'committed'

export interface GitFileDiffRequest {
  root: string
  path: string
  oldPath?: string
  scope: GitDiffScope
  /** For `committed`. */
  base?: string
  /** For `uncommitted`: a file git does not track yet. */
  untracked?: boolean
}

/** `git diff --name-status -z` → status by path (renames keyed by the new path). */
export function parseNameStatus(out: string): Map<string, { status: GitChangeStatus; oldPath?: string }> {
  const result = new Map<string, { status: GitChangeStatus; oldPath?: string }>()
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const code = fields[i]
    if (!code) continue
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      const oldPath = fields[++i] ?? ''
      const path = fields[++i] ?? ''
      if (path) result.set(path, letter === 'R' ? { status: 'R', oldPath } : { status: 'A' })
    } else {
      const path = fields[++i] ?? ''
      if (!path) continue
      const status: GitChangeStatus = letter === 'A' ? 'A' : letter === 'D' ? 'D' : letter === 'U' ? 'U' : 'M'
      result.set(path, { status })
    }
  }
  return result
}

/** `git diff --numstat -z` → line counts by path (renames keyed by the new path; `-` = binary). */
export function parseNumstat(out: string): Map<string, { added: number | null; removed: number | null }> {
  const result = new Map<string, { added: number | null; removed: number | null }>()
  const fields = out.split('\0')
  const num = (s: string) => (s === '-' ? null : Number(s) || 0)
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    if (!field) continue
    const [added = '0', removed = '0', path = ''] = field.split('\t')
    if (path) result.set(path, { added: num(added), removed: num(removed) })
    else {
      // Rename: the paths follow as two more fields.
      i += 2
      const newPath = fields[i]
      if (newPath) result.set(newPath, { added: num(added), removed: num(removed) })
    }
  }
  return result
}

export function mergeChanges(
  status: Map<string, { status: GitChangeStatus; oldPath?: string }>,
  numstat: Map<string, { added: number | null; removed: number | null }>
): GitFileChange[] {
  const changes: GitFileChange[] = []
  for (const [path, entry] of status) {
    const counts = numstat.get(path) ?? { added: 0, removed: 0 }
    changes.push({ path, ...(entry.oldPath ? { oldPath: entry.oldPath } : {}), status: entry.status, ...counts })
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** `git rev-list --left-right --count base...HEAD` → behind (left) and ahead (right). */
export function parseLeftRight(out: string): { ahead: number; behind: number } {
  const [behind = '0', ahead = '0'] = out.trim().split(/\s+/)
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 }
}
