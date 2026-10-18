// The new-session sheet (PRD F4, Figma 15): what main tells the sheet about a project, the request that creates a
// worktree, and the pure rules both sides share — generated branch names, folder names, the branch list, the
// remembered working-directory choice and payload validation.
import { isValidRefName } from './git-graph/log'

/** 工作目录: a new worktree on a new branch, or the project's main checkout as it is. */
export type Workdir = 'worktree' | 'current'

export interface NewSessionBranch {
  /** Short name: `main`, or `origin/feat/x` for a remote branch. */
  name: string
  remote: boolean
  /** Folder of the worktree that has this local branch checked out; null when no worktree has it. */
  worktreePath: string | null
  /** That worktree is the project's main checkout. */
  inMainCheckout: boolean
}

export interface NewSessionInfo {
  /** False when the project folder is not in a git repository: only 当前目录 is possible. */
  repo: boolean
  /** What the main checkout has out; null when detached or not a repo. */
  currentBranch: string | null
  /** The branch new worktrees start from by default (origin's default, else main / master, else current). */
  defaultBranch: string | null
  branches: NewSessionBranch[]
  /** `<prefix>/` of generated branch names, from git's user.name or the login name; '' for none. */
  prefix: string
  /** Absolute folder new worktrees of this repository go in (`~/.tr/worktrees/<repo>`). */
  worktreesDir: string
  /** Names already used inside worktreesDir. */
  takenFolders: string[]
  /** Ignored files `.worktreeinclude` asks to copy (relative, at most MAX_INCLUDE_LISTED). */
  includeFiles: string[]
  /** All of them; 0 when there is no `.worktreeinclude`. */
  includeCount: number
}

export interface WorktreeCreateRequest {
  /** One of the workspace's project roots. */
  root: string
  /** New local branch. */
  branch: string
  /** Branch it starts from: a local branch or a remote one (`origin/x`). */
  base: string
  /** Single folder name inside NewSessionInfo.worktreesDir. */
  folder: string
  /** Copy the files `.worktreeinclude` lists. */
  prepare: boolean
}

export type WorktreeCreateRefusal =
  /** the payload did not validate */
  | 'invalid'
  | 'not-a-repo'
  | 'branch-exists'
  | 'folder-exists'
  | 'base-missing'
  /** `git worktree add` failed for another reason (message has git's words) */
  | 'git'

export type WorktreeCreateResult =
  | { ok: true; path: string; /** Files `.worktreeinclude` asked for that could not be copied. */ copyFailures: number }
  | { ok: false; reason: WorktreeCreateRefusal; message?: string }

export const MAX_INCLUDE_LISTED = 20
const MAX_FOLDER = 100
const MAX_PATH = 4096

// --- names ------------------------------------------------------------------------------------------------------

/** Lowercase ASCII words joined by `-`; accents dropped, anything else removed. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `<prefix>` of generated branch names: the first word of git's user.name, else the login name; '' when neither is usable. */
export function branchPrefix(gitUserName: string, loginName: string): string {
  for (const source of [gitUserName, loginName]) {
    const first = slugify(source.trim().split(/\s+/)[0] ?? '')
    if (first.length >= 2 && first.length <= 24) return first
  }
  return ''
}

const ADJECTIVES = [
  'amber', 'bold', 'brave', 'brisk', 'calm', 'clever', 'cosmic', 'crisp', 'dapper', 'eager',
  'fancy', 'gentle', 'glad', 'golden', 'happy', 'jolly', 'keen', 'lively', 'lucky', 'mellow',
  'misty', 'nimble', 'noble', 'plucky', 'polite', 'quick', 'quiet', 'rapid', 'rosy', 'shiny',
  'silver', 'sleek', 'snowy', 'sunny', 'swift', 'tidy', 'vivid', 'warm', 'witty', 'zesty'
] as const

const NOUNS = [
  'badger', 'beacon', 'bison', 'cedar', 'comet', 'coral', 'crane', 'dune', 'falcon', 'fern',
  'finch', 'fjord', 'gecko', 'heron', 'ibis', 'koala', 'lark', 'lemur', 'lynx', 'maple',
  'meadow', 'otter', 'owl', 'panda', 'pebble', 'puffin', 'quail', 'raven', 'reef', 'river',
  'robin', 'sparrow', 'spruce', 'stork', 'tiger', 'tulip', 'walrus', 'willow', 'wren', 'yak'
] as const

const pick = <T>(items: readonly T[], random: () => number): T => items[Math.floor(random() * items.length) % items.length]!

/**
 * `<prefix>/<adjective>-<noun>` (no prefix: just the two words) that is not in `taken`. After a few unlucky draws a
 * number is added, so this always returns.
 */
export function generateBranchName(prefix: string, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const make = (suffix: string) => {
    const words = `${pick(ADJECTIVES, random)}-${pick(NOUNS, random)}${suffix}`
    return prefix ? `${prefix}/${words}` : words
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const name = make('')
    if (!taken.has(name)) return name
  }
  for (let n = 2; ; n++) {
    const name = make(`-${n}`)
    if (!taken.has(name)) return name
  }
}

/** A folder name is one plain path segment. */
export function isSafeFolderName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_FOLDER && /^[A-Za-z0-9._-]+$/.test(name) && !/^\.+$/.test(name)
}

/** Folder for a branch: its last segment (`jacob/swift-otter` → `swift-otter`), made unique among `taken`. */
export function folderNameFor(branch: string, taken: ReadonlySet<string>): string {
  const last = branch.split('/').filter(Boolean).pop() ?? ''
  const base = last.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'worktree'
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

export type BranchNameProblem = 'empty' | 'invalid' | 'exists'

/** Why a typed branch name cannot be created, or null. Only local branches clash (`origin/x` may share the name). */
export function branchNameProblem(name: string, branches: readonly NewSessionBranch[]): BranchNameProblem | null {
  if (name.trim() === '') return 'empty'
  if (!isValidRefName(name) || name.startsWith('refs/') || name === 'HEAD') return 'invalid'
  return branches.some((b) => !b.remote && b.name === name) ? 'exists' : null
}

// --- the branch list (Figma 15C) ----------------------------------------------------------------------------------

export interface BranchGroups {
  local: NewSessionBranch[]
  remote: NewSessionBranch[]
}

/**
 * 本地分支 / 远程分支 for the 基于 menu, filtered by `query` (case-insensitive substring). Local: the default branch
 * first, then by name. Remote: `*\/HEAD` and branches that also exist locally under the same name are left out.
 */
export function groupBranches(branches: readonly NewSessionBranch[], defaultBranch: string | null, query = ''): BranchGroups {
  const needle = query.trim().toLowerCase()
  const matches = (b: NewSessionBranch) => needle === '' || b.name.toLowerCase().includes(needle)
  const localNames = new Set(branches.filter((b) => !b.remote).map((b) => b.name))
  const byName = (a: NewSessionBranch, b: NewSessionBranch) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const local = branches
    .filter((b) => !b.remote && matches(b))
    .sort((a, b) => (a.name === defaultBranch ? -1 : b.name === defaultBranch ? 1 : byName(a, b)))
  const remote = branches
    .filter((b) => {
      if (!b.remote || !matches(b)) return false
      const slash = b.name.indexOf('/')
      const short = slash < 0 ? b.name : b.name.slice(slash + 1)
      return short !== 'HEAD' && !localNames.has(short)
    })
    .sort(byName)
  return { local, remote }
}

/** The branch 基于 starts on: the default branch, else the current one, else the first local branch. */
export function defaultBase(info: Pick<NewSessionInfo, 'defaultBranch' | 'currentBranch' | 'branches'>): string | null {
  return info.defaultBranch ?? info.currentBranch ?? info.branches.find((b) => !b.remote)?.name ?? null
}

// --- the remembered 工作目录 ------------------------------------------------------------------------------------------

/** 工作目录 for a project: what was used last time, first time 新 worktree; a folder that is not a repo can only be 当前目录. */
export function initialWorkdir(remembered: Readonly<Record<string, Workdir>>, projectId: string, repo: boolean): Workdir {
  if (!repo) return 'current'
  return remembered[projectId] ?? 'worktree'
}

/** Records the choice a session was created with. A forced 当前目录 (not a repo) is not a choice and is not remembered. */
export function rememberWorkdir(
  remembered: Readonly<Record<string, Workdir>>,
  projectId: string,
  choice: Workdir,
  repo: boolean
): Readonly<Record<string, Workdir>> {
  if (!repo || remembered[projectId] === choice) return remembered
  return { ...remembered, [projectId]: choice }
}

export const isWorkdir = (value: unknown): value is Workdir => value === 'worktree' || value === 'current'

// --- validation in main -----------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isAbsolutePath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('/') && v.length <= MAX_PATH && !v.includes('\0')

/** The create request as main accepts it, or null. (Whether root is a project, the branch is new, … is checked against git.) */
export function parseCreateRequest(raw: unknown): WorktreeCreateRequest | null {
  if (!isRecord(raw)) return null
  const { root, branch, base, folder, prepare } = raw
  if (!isAbsolutePath(root) || !isValidRefName(branch) || branch.startsWith('refs/') || branch === 'HEAD') return null
  if (!isValidRefName(base) || !isSafeFolderName(folder) || typeof prepare !== 'boolean') return null
  return { root, branch, base, folder, prepare }
}
