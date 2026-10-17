// The right panel's 文件 view (PRD F17): what main reports about a worktree's files, and the pure parsing of
// the git output behind it. Paths are always POSIX, relative to the worktree root ('' = the root itself).

/** Git state of one path as the tree shows it: M modified · A added · D deleted · U untracked. */
export type GitLetter = 'M' | 'A' | 'D' | 'U'

export interface DirEntry {
  name: string
  dir: boolean
}

/** `git status` of a worktree. Keys ending in '/' cover a whole directory (an untracked or ignored folder). */
export interface GitStatusSnapshot {
  changes: Record<string, GitLetter>
  ignored: string[]
}

export type FilePreview =
  | { kind: 'text'; text: string; size: number }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }
  | { kind: 'missing' }

export type LineMark = 'add' | 'mod'

/** Lines `from`…`to` (1-based, inclusive) of the working file differ from HEAD. */
export interface LineMarkRange {
  from: number
  to: number
  kind: LineMark
}

/** Files under the worktree changed on disk (main's fs.watch, debounced). */
export interface WorktreeChange {
  root: string
  /** Directories whose listing may have changed ('' = root). */
  dirs: string[]
  /** Something under .git changed (commit, checkout, stage): only the status needs a refresh. */
  git: boolean
}

/** Preview reads stop here; bigger files open in the default editor instead. */
export const MAX_PREVIEW_BYTES = 1024 * 1024
/** A directory listing returns at most this many entries. */
export const MAX_DIR_ENTRIES = 5000
/** The filter searches at most this many paths. */
export const MAX_LISTED_FILES = 50_000

/** Folders first, then names in natural, case-insensitive order (Figma 13D). */
export function compareEntries(a: DirEntry, b: DirEntry): number {
  if (a.dir !== b.dir) return a.dir ? -1 : 1
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true }) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

/**
 * Letter for a porcelain v2 `XY` pair (index, worktree). Deletions win, then additions; a rename, copy or
 * conflict counts as a modification.
 */
export function letterForXY(xy: string): GitLetter {
  if (xy.includes('D')) return 'D'
  if (xy[0] === 'A') return 'A'
  return 'M'
}

/**
 * Parses `git status --porcelain=v2 -z --ignored`. Porcelain paths are relative to the repository root;
 * `prefix` (`git rev-parse --show-prefix`, e.g. 'packages/web/') is where the worktree root sits inside it.
 * Entries outside the prefix are dropped, the rest are made relative to the worktree root.
 */
export function parseGitStatus(output: string, prefix = ''): GitStatusSnapshot {
  const changes: Record<string, GitLetter> = {}
  const ignored: string[] = []
  const fields = output.split('\0')
  const local = (path: string | undefined): string | null => {
    if (!path || !path.startsWith(prefix)) return null
    const rest = path.slice(prefix.length)
    return rest === '' ? null : rest
  }
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]!
    if (entry === '') continue
    const kind = entry[0]
    if (kind === '1' || kind === '2' || kind === 'u') {
      // '1 XY sub mH mI mW hH hI path' · '2 … Xscore path\0orig' · 'u XY sub m1 m2 m3 mW h1 h2 h3 path'
      const parts = entry.split(' ')
      const skip = kind === '1' ? 8 : kind === '2' ? 9 : 10
      const path = local(parts.slice(skip).join(' '))
      if (path) changes[path] = kind === 'u' ? 'M' : letterForXY(parts[1] ?? '')
      if (kind === '2') i++ // the rename's original path
    } else if (kind === '?') {
      const path = local(entry.slice(2))
      if (path) changes[path] = 'U'
    } else if (kind === '!') {
      const path = local(entry.slice(2))
      if (path) ignored.push(path)
    }
  }
  return { changes, ignored }
}

const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Changed line ranges of the working file from `git diff -U0 HEAD -- <file>`. Pure deletions leave no mark. */
export function parseLineMarks(diff: string): LineMarkRange[] {
  const ranges: LineMarkRange[] = []
  for (const line of diff.split('\n')) {
    const match = HUNK.exec(line)
    if (!match) continue
    const removed = match[1] === undefined ? 1 : Number(match[1])
    const start = Number(match[2])
    const added = match[3] === undefined ? 1 : Number(match[3])
    if (added === 0) continue
    ranges.push({ from: start, to: start + added - 1, kind: removed === 0 ? 'add' : 'mod' })
  }
  return ranges
}

/** Whether `data` looks like a binary file: a NUL byte in its first 8 KB. */
export function looksBinary(data: Uint8Array): boolean {
  const end = Math.min(data.length, 8192)
  for (let i = 0; i < end; i++) if (data[i] === 0) return true
  return false
}

/** Lookups over a status snapshot for drawing the tree. */
export interface StatusIndex {
  /** Letter of a path, including files inside an untracked folder. */
  letter(path: string): GitLetter | null
  /** A folder that contains changes (shown as "•"). */
  hasChanges(dir: string): boolean
  ignored(path: string): boolean
  /** Number of changed entries ("有改动 N"). */
  count: number
}

/** Every ancestor folder of a path: 'a/b/c.ts' → ['a', 'a/b']. */
export function ancestors(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/** Folders listed with a trailing '/', and whether `path` is one of them or inside one. */
function underAny(path: string, folders: readonly string[]): boolean {
  return folders.some((folder) => path === folder.slice(0, -1) || path.startsWith(folder))
}

export function indexStatus(snapshot: GitStatusSnapshot | null): StatusIndex {
  const changes = snapshot?.changes ?? {}
  const ignoredExact = new Set<string>()
  const ignoredFolders: string[] = []
  for (const path of snapshot?.ignored ?? []) {
    if (path.endsWith('/')) ignoredFolders.push(path)
    else ignoredExact.add(path)
  }
  const changedFolders = new Set<string>()
  const untrackedFolders: string[] = []
  for (const path of Object.keys(changes)) {
    const bare = path.endsWith('/') ? path.slice(0, -1) : path
    if (path.endsWith('/')) untrackedFolders.push(path)
    for (const dir of ancestors(bare)) changedFolders.add(dir)
  }
  return {
    letter: (path) => changes[path] ?? changes[`${path}/`] ?? (underAny(path, untrackedFolders) ? 'U' : null),
    hasChanges: (dir) => changedFolders.has(dir) || underAny(dir, untrackedFolders),
    ignored: (path) => ignoredExact.has(path) || underAny(path, ignoredFolders),
    count: Object.keys(changes).length
  }
}
