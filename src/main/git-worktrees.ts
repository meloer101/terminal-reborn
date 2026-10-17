// The right panel's Worktree view (PRD F17): lists a project's git worktrees with their uncommitted stats and
// ahead / behind, removes one, and tells the window when the list changed. Git never runs in the renderer; every
// payload is checked here, and only the workspace's own project roots are accepted.
//
// Removal never trusts a failed check: when git cannot say whether a worktree has uncommitted work or orphaned
// commits, it is not removed. `--force` is only for git's submodule refusal (as VS Code's git extension does).
import { watch, type FSWatcher } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import {
  affectsWorktreeList,
  classifyRemoveError,
  hadOwnCommits,
  isMergedInto,
  mainWorktreeIndex,
  MAX_DIRTY_FILES,
  parseAheadBehind,
  parseBaseConfig,
  parseForEachRefAheadBehind,
  parseNumstat,
  parseRebaseHeadName,
  parseWorktreePorcelain,
  pickMainBranch,
  type GitWorktreeInfo,
  type GitWorktreeListing,
  type PorcelainWorktree,
  type WorktreeRemoveResult
} from '@shared/git-worktrees'
import { parseGitStatus } from '@shared/worktree-files'
import { isProjectRoot } from './workspace-store'
import { git as runGit, resolveRoot } from './worktree-files'

const MAX_PATH = 4096
const MAX_KNOWN_PATHS = 1000
/** Git processes one listing may run at once (crystal uses 3). */
const MAX_PARALLEL_GIT = 4
const WATCH_DEBOUNCE_MS = 500

const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') && isAbsolute(value)

// --- a small limit on concurrent git processes ----------------------------------------------------------------

let running = 0
const waiting: (() => void)[] = []

async function git(cwd: string, args: string[]): Promise<string> {
  if (running >= MAX_PARALLEL_GIT) await new Promise<void>((go) => waiting.push(go))
  running++
  try {
    return await runGit(cwd, args)
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** For lookups where "nothing" is a fine answer (no origin, no config, no reflog). Never for safety checks. */
const orEmpty = (promise: Promise<string>): Promise<string> => promise.catch(() => '')

async function realOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** The project root as a resolved directory; refuses anything that is not one of the workspace's projects. */
async function projectRoot(root: unknown): Promise<string> {
  if (!isPath(root) || !isProjectRoot(root)) throw new Error('not a project root')
  return resolveRoot(root)
}

async function readPorcelain(realRoot: string): Promise<PorcelainWorktree[] | null> {
  try {
    return parseWorktreePorcelain(await git(realRoot, ['worktree', 'list', '--porcelain']))
  } catch {
    return null // not a git repository
  }
}

/** Short branch name → commit, for every local branch. */
async function localBranches(cwd: string): Promise<Record<string, string>> {
  const out = await orEmpty(git(cwd, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads']))
  const heads: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const [name, sha] = line.split('\0')
    if (name && sha) heads[name] = sha
  }
  return heads
}

async function resolveCommit(cwd: string, ref: string): Promise<string | null> {
  const out = (await orEmpty(git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]))).trim()
  return out || null
}

type Dirty = Pick<GitWorktreeInfo, 'added' | 'removed' | 'dirtyFiles' | 'dirtyCount'>

/** Uncommitted state of one worktree. Throws when git cannot tell (timeout, dubious ownership, …). */
async function dirtyState(path: string): Promise<Dirty> {
  const changes = parseGitStatus(await git(path, ['status', '--porcelain=v2', '-z', '--untracked-files=normal'])).changes
  const files = Object.keys(changes).sort()
  // Untracked files ('U') have no lines in `diff HEAD`: skip the second process when nothing tracked changed.
  const tracked = files.some((file) => changes[file] !== 'U')
  const lines = tracked ? parseNumstat(await orEmpty(git(path, ['diff', '--no-ext-diff', '--numstat', 'HEAD']))) : { added: 0, removed: 0 }
  return { ...lines, dirtyFiles: files.slice(0, MAX_DIRTY_FILES), dirtyCount: files.length }
}

const UNKNOWN_DIRTY: Dirty = { added: 0, removed: 0, dirtyFiles: [], dirtyCount: null }

/** Commits of `head` that no branch, tag or remote has. Throws when git cannot tell. */
async function unreachableCommits(realRoot: string, head: string): Promise<number> {
  const out = await git(realRoot, ['rev-list', '--count', head, '--not', '--branches', '--tags', '--remotes'])
  const count = Number.parseInt(out.trim(), 10)
  if (!Number.isFinite(count)) throw new Error('unexpected rev-list output')
  return count
}

/** The branch a rebase in this worktree works on (porcelain shows such a worktree as detached), else null. */
async function rebasingBranch(path: string): Promise<string | null> {
  const gitDir = (await orEmpty(git(path, ['rev-parse', '--absolute-git-dir']))).trim()
  if (!gitDir) return null
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    try {
      return parseRebaseHeadName(await readFile(join(gitDir, dir, 'head-name'), 'utf8')) ?? 'HEAD'
    } catch {
      // not this kind of rebase
    }
  }
  return null
}

interface BaseInfo {
  heads: Record<string, string>
  bases: Record<string, string>
  mainBranch: string | null
  /** Per base: every branch's ahead / behind it in one `for-each-ref` (null when this git cannot). */
  aheadBehind: Map<string, Promise<Record<string, { ahead: number; behind: number }> | null>>
  baseHeads: Map<string, Promise<string | null>>
}

async function readBaseInfo(realRoot: string, mainCheckoutBranch: string | null): Promise<BaseInfo> {
  const [heads, originHead, baseConfig] = await Promise.all([
    localBranches(realRoot),
    orEmpty(git(realRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])),
    orEmpty(git(realRoot, ['config', '--get-regexp', '^branch\\..*\\.base$']))
  ])
  return {
    heads,
    bases: parseBaseConfig(baseConfig),
    mainBranch: pickMainBranch(Object.keys(heads), originHead.trim() || null, mainCheckoutBranch),
    aheadBehind: new Map(),
    baseHeads: new Map()
  }
}

function baseHeadOf(info: BaseInfo, realRoot: string, base: string): Promise<string | null> {
  let head = info.baseHeads.get(base)
  if (!head) {
    head = info.heads[base] ? Promise.resolve(info.heads[base]) : resolveCommit(realRoot, base)
    info.baseHeads.set(base, head)
  }
  return head
}

function aheadBehindOf(info: BaseInfo, realRoot: string, baseSha: string) {
  let counts = info.aheadBehind.get(baseSha)
  if (!counts) {
    // `%(ahead-behind:…)` needs git ≥ 2.41; older git fails or prints something else, and rev-list takes over.
    counts = git(realRoot, ['for-each-ref', `--format=%(refname:short)%00%(ahead-behind:${baseSha})`, 'refs/heads'])
      .then(parseForEachRefAheadBehind)
      .catch(() => null)
    info.aheadBehind.set(baseSha, counts)
  }
  return counts
}

async function details(realRoot: string, entry: PorcelainWorktree, info: BaseInfo): Promise<Omit<GitWorktreeInfo, 'path' | 'realPath' | 'isMain'>> {
  const exists = entry.prunable === null && (await isDirectory(entry.path))
  const wanted = entry.branch ? (info.bases[entry.branch] ?? info.mainBranch) : info.mainBranch
  const base = wanted && wanted !== entry.branch ? wanted : null
  const baseSha = base ? await baseHeadOf(info, realRoot, base) : null

  let counts: { ahead: number; behind: number } | null = null
  if (baseSha && entry.head) {
    const all = entry.branch ? await aheadBehindOf(info, realRoot, baseSha) : null
    counts =
      (entry.branch ? all?.[entry.branch] : undefined) ??
      parseAheadBehind(await orEmpty(git(realRoot, ['rev-list', '--left-right', '--count', `${baseSha}...${entry.head}`])))
  }
  const ownCommits =
    counts?.ahead === 0 && entry.branch !== null
      ? hadOwnCommits(await orEmpty(git(realRoot, ['reflog', 'show', '--format=%gs', `refs/heads/${entry.branch}`, '--'])))
      : false

  const [dirty, rebasing, unreachable] = await Promise.all([
    exists ? dirtyState(entry.path).catch(() => UNKNOWN_DIRTY) : Promise.resolve({ ...UNKNOWN_DIRTY, dirtyCount: 0 }),
    exists && entry.branch === null ? rebasingBranch(entry.path) : Promise.resolve(null),
    entry.branch === null && entry.head ? unreachableCommits(realRoot, entry.head).catch(() => null) : Promise.resolve(0)
  ])
  return {
    head: entry.head,
    branch: entry.branch,
    locked: entry.locked,
    prunable: exists ? null : (entry.prunable ?? 'folder is missing'),
    rebasing,
    unreachableCommits: unreachable,
    base: baseSha ? base : null,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    merged: isMergedInto(counts?.ahead ?? null, ownCommits),
    ...dirty,
    detailed: true
  }
}

/**
 * Every worktree of the project's repository. With `only` (resolved paths), only those get their details read again;
 * the rest come back with `detailed: false` and the renderer keeps what it had.
 */
export async function listWorktrees(root: unknown, knownPaths: unknown, only?: unknown): Promise<GitWorktreeListing | null> {
  const realRoot = await projectRoot(root)
  const all = await readPorcelain(realRoot)
  if (!all) return null
  const mainIndex = mainWorktreeIndex(all)
  const entries = all.map((entry, index) => ({ entry, isMain: index === mainIndex })).filter(({ entry }) => !entry.bare)
  if (entries.length === 0) return null
  const wanted = Array.isArray(only) ? new Set(only.filter(isPath).slice(0, MAX_KNOWN_PATHS)) : null
  const info = await readBaseInfo(realRoot, mainIndex === null ? null : all[mainIndex]!.branch)

  const worktrees = await Promise.all(
    entries.map(async ({ entry, isMain }): Promise<GitWorktreeInfo> => {
      const realPath = await realOrSelf(entry.path)
      if (wanted && !wanted.has(realPath)) {
        return {
          path: entry.path,
          realPath,
          isMain,
          head: entry.head,
          branch: entry.branch,
          locked: entry.locked,
          prunable: entry.prunable,
          rebasing: null,
          unreachableCommits: null,
          base: null,
          ahead: null,
          behind: null,
          merged: false,
          ...UNKNOWN_DIRTY,
          detailed: false
        }
      }
      return { path: entry.path, realPath, isMain, ...(await details(realRoot, entry, info)) }
    })
  )

  const realPaths: Record<string, string> = {}
  if (Array.isArray(knownPaths)) {
    for (const known of knownPaths.slice(0, MAX_KNOWN_PATHS)) {
      if (!isPath(known)) continue
      try {
        realPaths[known] = await realpath(known)
      } catch {
        // gone: it matches nothing
      }
    }
  }
  return { mainBranch: info.mainBranch, worktrees, realPaths }
}

const gitMessage = (error: unknown): string => {
  const stderr = (error as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error)
  return text.trim().split('\n').slice(-2).join(' ').slice(0, 500)
}

async function hasSubmodules(path: string): Promise<boolean> {
  try {
    return (await stat(join(path, '.gitmodules'))).isFile()
  } catch {
    return false
  }
}

/**
 * `git worktree remove` for one linked worktree of a project's repository. Refuses the main checkout and the project
 * folder; a worktree with uncommitted changes, a rebase in progress or a lock; a detached HEAD whose commits no branch,
 * tag or remote has; and anything git could not check. `force` only gets past git's submodule refusal.
 * A worktree whose folder is already gone is removed by path (not a repository-wide prune).
 */
export async function removeWorktree(root: unknown, path: unknown, force: unknown): Promise<WorktreeRemoveResult> {
  const realRoot = await projectRoot(root)
  if (!isPath(path)) throw new Error('invalid worktree path')
  const entries = await readPorcelain(realRoot)
  if (!entries) return { ok: false, reason: 'unknown' }
  const target = await realOrSelf(path)
  const reals = await Promise.all(entries.map((e) => realOrSelf(e.path)))
  const index = reals.findIndex((real, i) => real === target || entries[i]!.path === path)
  const entry = entries[index]
  if (!entry || entry.bare) return { ok: false, reason: 'unknown' }
  if (index === mainWorktreeIndex(entries) || reals[index] === realRoot) return { ok: false, reason: 'main' }
  if (entry.locked) return { ok: false, reason: 'locked' }

  // Orphaned commits are checked from the repository, so a missing folder is covered too.
  if (entry.branch === null && entry.head) {
    let unreachable: number
    try {
      unreachable = await unreachableCommits(realRoot, entry.head)
    } catch (error) {
      return { ok: false, reason: 'unverified', message: gitMessage(error) }
    }
    if (unreachable > 0) return { ok: false, reason: 'unreachable-commits', message: String(unreachable) }
  }

  const exists = entry.prunable === null && (await isDirectory(entry.path))
  if (exists) {
    if (entry.branch === null && (await rebasingBranch(entry.path))) return { ok: false, reason: 'busy' }
    try {
      if ((await dirtyState(entry.path)).dirtyCount !== 0) return { ok: false, reason: 'dirty' }
    } catch (error) {
      return { ok: false, reason: 'unverified', message: gitMessage(error) }
    }
  }
  const forced = force === true && exists && (await hasSubmodules(entry.path))
  if (force === true && !forced) return { ok: false, reason: 'git', message: 'force is only used for worktrees with submodules' }
  try {
    await git(realRoot, ['worktree', 'remove', ...(forced ? ['--force'] : []), '--', entry.path])
    return { ok: true }
  } catch (error) {
    const message = gitMessage(error)
    return { ok: false, reason: classifyRemoveError(message), message }
  }
}

// --- watching ---------------------------------------------------------------------------------------------------

interface Watch {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

const watches = new Map<WebContents, Map<string, Watch>>()

function stopWatch(sender: WebContents, root: string): void {
  const entry = watches.get(sender)?.get(root)
  if (!entry) return
  entry.watcher.close()
  if (entry.timer) clearTimeout(entry.timer)
  watches.get(sender)!.delete(root)
}

/** Watches the repository's common dir for worktrees, branch refs and HEADs moving; tells the window, debounced. */
async function startWatch(sender: WebContents, root: unknown): Promise<void> {
  const realRoot = await projectRoot(root)
  const key = root as string
  let forSender = watches.get(sender)
  if (!forSender) {
    forSender = new Map()
    watches.set(sender, forSender)
    sender.once('destroyed', () => {
      for (const watched of [...(watches.get(sender)?.keys() ?? [])]) stopWatch(sender, watched)
      watches.delete(sender)
    })
  }
  if (forSender.has(key)) return
  const commonDir = resolve(realRoot, (await git(realRoot, ['rev-parse', '--git-common-dir'])).trim())
  if (forSender.has(key)) return
  const watcher = watch(commonDir, { recursive: true })
  const entry: Watch = { watcher, timer: null }
  watcher.on('error', () => stopWatch(sender, key))
  watcher.on('change', (_type, filename) => {
    if (typeof filename !== 'string' || !affectsWorktreeList(relative(commonDir, join(commonDir, filename)))) return
    entry.timer ??= setTimeout(() => {
      entry.timer = null
      if (!sender.isDestroyed()) sender.send(IPC.gitWorktreesChanged, key)
    }, WATCH_DEBOUNCE_MS)
  })
  forSender.set(key, entry)
}

export function registerGitWorktreeHandlers(): void {
  ipcMain.handle(IPC.gitWorktreesList, (_event, root: unknown, knownPaths: unknown, only: unknown) => listWorktrees(root, knownPaths, only))
  ipcMain.handle(IPC.gitWorktreesRemove, (_event, root: unknown, path: unknown, force: unknown) => removeWorktree(root, path, force))
  ipcMain.on(IPC.gitWorktreesWatch, (event, root: unknown) => void startWatch(event.sender, root).catch(() => {}))
  ipcMain.on(IPC.gitWorktreesUnwatch, (event, root: unknown) => {
    if (typeof root === 'string') stopWatch(event.sender, root)
  })
}
