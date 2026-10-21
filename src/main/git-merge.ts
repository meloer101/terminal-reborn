// Local merge (PRD F4, Figma 05): checks whether a worktree's branch can go into its base, and does it.
//
// The precheck runs `git merge-tree --write-tree` (git ≥ 2.38), which merges in memory without touching any working
// tree or index, so it is safe while an agent works in the worktree. Merge and squash build their commit from that tree
// with `commit-tree`, then move the base forward: `merge --ff-only` in the checkout that has the base out (so its files
// follow), or a compare-and-swap `update-ref` when no checkout has it. A failure at any step leaves the base where it
// was. Rebase replays the branch in its own worktree (aborted on a conflict) and then fast-forwards the base the same way.
//
// Only the workspace's project roots and their own worktrees are accepted; nothing from the renderer reaches git as
// an option. Both commits the precheck saw are checked again before anything moves.
import { execFile } from 'node:child_process'
import { readdir, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute } from 'node:path'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  mergeMessage,
  operationInProgress,
  parseMergeRequest,
  parseMergeTree,
  squashMessage,
  trackedDirtyPaths,
  type GitOperation,
  type MergeBlocker,
  type MergeConflict,
  type MergePrecheck,
  type MergeResult
} from '@shared/git-merge'
import { mainWorktreeIndex, parseBaseConfig, parseWorktreePorcelain, pickMainBranch, type PorcelainWorktree } from '@shared/git-worktrees'
import { parseGitStatus } from '@shared/worktree-files'
import { gitAvailable, sshCommandFor } from './git-graph'
import { isProjectRoot } from './workspace-store'

const MAX_PATH = 4096
const GIT_TIMEOUT_MS = 30_000
/** A rebase or a fast-forward checks out files. */
const CHECKOUT_TIMEOUT_MS = 5 * 60_000
const PUSH_TIMEOUT_MS = 60_000
const MAX_BUFFER = 32 * 1024 * 1024
const MAX_SQUASH_SUBJECTS = 100
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs git; resolves for exit codes in `ok` (default 0), rejects otherwise with git's last lines as the message. */
function run(
  cwd: string,
  args: string[],
  options: { timeout?: number; env?: Record<string, string>; input?: string; ok?: number[] } = {}
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        timeout: options.timeout ?? GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          // Nothing here may open an editor (rebase's todo list, commit messages).
          GIT_EDITOR: 'true',
          GIT_SEQUENCE_EDITOR: 'true',
          PATH: [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter),
          ...options.env
        }
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1) : 0
        if ((options.ok ?? [0]).includes(code)) resolve({ code, stdout, stderr })
        else reject(new Error(lastLines(String(stderr || stdout || error?.message || 'git failed'))))
      }
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
  })
}

const lastLines = (text: string): string => text.trim().split('\n').slice(-3).join(' ').slice(0, 500)

const git = async (cwd: string, args: string[], options?: Parameters<typeof run>[2]): Promise<string> => (await run(cwd, args, options)).stdout

const orEmpty = (promise: Promise<string>): Promise<string> => promise.catch(() => '')

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function realOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function projectRoot(root: unknown): Promise<string> {
  if (typeof root !== 'string' || root.length > MAX_PATH || root.includes('\0') || !isAbsolute(root) || !isProjectRoot(root)) {
    throw new Error('not a project root')
  }
  const real = await realpath(root)
  if (!(await stat(real)).isDirectory()) throw new Error('project root is not a directory')
  return real
}

/** What a worktree's git dir shows in progress. */
async function operationIn(path: string): Promise<GitOperation | null> {
  const gitDir = (await orEmpty(git(path, ['rev-parse', '--absolute-git-dir']))).trim()
  if (!gitDir) return null
  try {
    return operationInProgress(await readdir(gitDir))
  } catch {
    return null
  }
}

async function commitOf(cwd: string, ref: string): Promise<string | null> {
  return (await orEmpty(git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]))).trim() || null
}

/**
 * `git merge-tree --write-tree` of two commits (git ≥ 2.38): merges in memory, writing only objects — never a working
 * tree, an index or a ref. The merged tree and the files that would conflict ([] when clean). Rejects with git's
 * message; `isOldGit()` tells a git without `--write-tree`. Also used by the conflict radar.
 */
export async function mergeTreeConflicts(cwd: string, ours: string, theirs: string): Promise<{ tree: string; conflicts: MergeConflict[] }> {
  const merged = await run(cwd, ['-c', 'core.quotePath=false', 'merge-tree', '--write-tree', '--name-only', ours, theirs], { ok: [0, 1] })
  return parseMergeTree(merged.stdout, merged.code === 1)
}

/** Whether a merge-tree error means git is too old for `--write-tree`. */
export const isOldGit = (message: string): boolean => /write-tree|usage: git merge-tree/i.test(message)

/** One precheck's findings plus what the merge itself needs. */
interface Inspection {
  check: MergePrecheck
  realRoot: string
  worktreePath: string
  /** The merged tree (clean merges only). */
  tree: string | null
}

const EMPTY: MergePrecheck = {
  branch: '',
  base: '',
  head: '',
  baseHead: '',
  ahead: 0,
  behind: 0,
  conflicts: [],
  uncommitted: null,
  baseCheckout: null,
  upstream: null,
  upstreamAhead: 0,
  hasOrigin: false,
  blocker: null
}

async function inspect(root: unknown, worktree: unknown): Promise<Inspection> {
  const realRoot = await projectRoot(root)
  if (typeof worktree !== 'string' || worktree.length > MAX_PATH || worktree.includes('\0') || !isAbsolute(worktree)) {
    throw new Error('invalid worktree path')
  }
  if (!(await gitAvailable())) throw new Error('git is not installed')
  let entries: PorcelainWorktree[]
  try {
    entries = parseWorktreePorcelain(await git(realRoot, ['worktree', 'list', '--porcelain']))
  } catch {
    throw new Error('not a git repository')
  }
  const target = await realOrSelf(worktree)
  const reals = await Promise.all(entries.map((e) => realOrSelf(e.path)))
  const index = reals.findIndex((real, i) => !entries[i]!.bare && (real === target || entries[i]!.path === worktree))
  if (index < 0) throw new Error('not a worktree of this project')
  const entry = entries[index]!
  const isMain = index === mainWorktreeIndex(entries)
  const worktreePath = reals[index]!

  const remotes = (await orEmpty(git(realRoot, ['remote']))).split('\n').map((r) => r.trim())
  const check: MergePrecheck = { ...EMPTY, hasOrigin: remotes.includes('origin') }
  const done = (blocker: MergeBlocker | null, tree: string | null = null): Inspection => ({
    check: { ...check, blocker },
    realRoot,
    worktreePath,
    tree
  })

  const ownOperation = await operationIn(worktreePath)
  if (!entry.branch) return done(ownOperation ? { kind: 'busy', where: 'worktree', operation: ownOperation } : { kind: 'detached' })
  check.branch = entry.branch

  const [heads, originHead, baseConfig] = await Promise.all([
    orEmpty(git(realRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])),
    orEmpty(git(realRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])),
    orEmpty(git(realRoot, ['config', '--get-regexp', '^branch\\..*\\.base$']))
  ])
  const mainIndex = mainWorktreeIndex(entries)
  const mainBranch = pickMainBranch(heads.split('\n').filter(Boolean), originHead.trim() || null, mainIndex === null ? null : entries[mainIndex]!.branch)
  const base = parseBaseConfig(baseConfig)[entry.branch] ?? mainBranch
  if (!base || base === entry.branch) return done(isMain ? { kind: 'main' } : { kind: 'no-base' })
  check.base = base

  const [head, baseHead] = await Promise.all([commitOf(realRoot, `refs/heads/${entry.branch}`), commitOf(realRoot, `refs/heads/${base}`)])
  if (!baseHead) return done({ kind: 'base-missing', base })
  if (!head) return done({ kind: 'detached' })
  check.head = head
  check.baseHead = baseHead
  if (ownOperation) return done({ kind: 'busy', where: 'worktree', operation: ownOperation })

  const baseIndex = entries.findIndex((e) => !e.bare && e.branch === base)
  check.baseCheckout = baseIndex < 0 ? null : reals[baseIndex]!
  if (check.baseCheckout) {
    const baseOperation = await operationIn(check.baseCheckout)
    if (baseOperation) return done({ kind: 'busy', where: 'base', operation: baseOperation })
  }

  try {
    const counts = (await git(realRoot, ['rev-list', '--left-right', '--count', `${baseHead}...${head}`])).trim().split(/\s+/)
    check.behind = Number(counts[0]) || 0
    check.ahead = Number(counts[1]) || 0
  } catch (error) {
    return done({ kind: 'unverified', message: errorText(error) })
  }

  try {
    check.uncommitted = Object.keys(parseGitStatus(await git(worktreePath, ['status', '--porcelain=v2', '-z', '--untracked-files=normal'])).changes).length
  } catch {
    check.uncommitted = null
  }

  const upstream = (await orEmpty(git(realRoot, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${base}`]))).trim()
  if (upstream && (await commitOf(realRoot, `refs/remotes/${upstream}`))) {
    check.upstream = upstream
    check.upstreamAhead = Number((await orEmpty(git(realRoot, ['rev-list', '--count', `${baseHead}..refs/remotes/${upstream}`]))).trim()) || 0
  }

  if (check.ahead === 0) return done({ kind: 'nothing' })

  let merged: { tree: string; conflicts: MergeConflict[] }
  try {
    merged = await mergeTreeConflicts(realRoot, baseHead, head)
  } catch (error) {
    const message = errorText(error)
    return done(isOldGit(message) ? { kind: 'old-git' } : { kind: 'unverified', message })
  }
  const { tree, conflicts } = merged
  check.conflicts = conflicts
  if (conflicts.length > 0) return done(null)

  // The base's checkout gets fast-forwarded: its uncommitted changes must not touch what the merge changes.
  if (check.baseCheckout) {
    try {
      const dirty = trackedDirtyPaths(await git(check.baseCheckout, ['status', '--porcelain=v1', '-z', '--untracked-files=no']))
      if (dirty.length > 0) {
        const changed = new Set((await git(realRoot, ['diff-tree', '-r', '--name-only', '-z', baseHead, tree])).split('\0').filter(Boolean))
        const overlap = dirty.filter((path) => changed.has(path))
        if (overlap.length > 0) return done({ kind: 'base-dirty', path: check.baseCheckout, files: overlap.slice(0, 20) })
      }
    } catch (error) {
      return done({ kind: 'unverified', message: errorText(error) })
    }
  }
  return done(null, tree)
}

/** Whether a worktree's branch can be merged into its base, and what is in the way (PRD F4 预检). */
export async function mergePrecheck(root: unknown, worktree: unknown): Promise<MergePrecheck> {
  return (await inspect(root, worktree)).check
}

/** Moves the base to `commit` (a descendant of `expected`), in its checkout when it has one. */
async function advanceBase(inspection: Inspection, commit: string, expected: string): Promise<void> {
  const { check, realRoot } = inspection
  if (check.baseCheckout) {
    const [branch, head] = await Promise.all([
      orEmpty(git(check.baseCheckout, ['symbolic-ref', '--quiet', 'HEAD'])),
      commitOf(check.baseCheckout, 'HEAD')
    ])
    if (branch.trim() !== `refs/heads/${check.base}` || head !== expected) throw new StaleError()
    await git(check.baseCheckout, ['merge', '--ff-only', '--no-edit', '--quiet', commit], { timeout: CHECKOUT_TIMEOUT_MS })
  } else {
    await git(realRoot, ['update-ref', '-m', `wavi: merge ${check.branch} into ${check.base}`, `refs/heads/${check.base}`, commit, expected])
  }
}

class StaleError extends Error {
  constructor() {
    super('the base moved')
  }
}

async function squashCommits(cwd: string, base: string, head: string, ahead: number): Promise<{ subject: string; body: string }[]> {
  if (ahead === 1) {
    const body = await git(cwd, ['log', '-1', '--format=%B', head])
    return [{ subject: body.split('\n')[0] ?? '', body }]
  }
  const subjects = await git(cwd, ['log', '--reverse', `--max-count=${MAX_SQUASH_SUBJECTS}`, '--format=%s', `${base}..${head}`])
  return subjects
    .split('\n')
    .filter(Boolean)
    .map((subject) => ({ subject, body: subject }))
}

async function pushBase(realRoot: string, base: string): Promise<string> {
  try {
    const env: Record<string, string> = {}
    const ssh = sshCommandFor(process.env, (await orEmpty(git(realRoot, ['config', '--get', 'core.sshCommand']))).trim())
    if (ssh) env.GIT_SSH_COMMAND = ssh
    await git(realRoot, ['push', '--quiet', 'origin', `refs/heads/${base}:refs/heads/${base}`], { timeout: PUSH_TIMEOUT_MS, env })
    return ''
  } catch (error) {
    return errorText(error)
  }
}

/** One merge per repository at a time. */
const merging = new Set<string>()

/** Merges the worktree's branch into its base with the chosen method (PRD F4). Never leaves a half-done merge. */
export async function mergeWorktree(raw: unknown): Promise<MergeResult> {
  const request = parseMergeRequest(raw)
  if (!request) return { ok: false, reason: 'invalid' }
  let inspection: Inspection
  try {
    inspection = await inspect(request.root, request.worktree)
  } catch (error) {
    return { ok: false, reason: 'git', message: errorText(error) }
  }
  const { check, realRoot, worktreePath } = inspection
  if (check.head !== request.head || check.baseHead !== request.baseHead) return { ok: false, reason: 'stale' }
  if (check.blocker) return { ok: false, reason: 'blocked', blocker: check.blocker }
  if (check.conflicts.length > 0) return { ok: false, reason: 'conflict', conflicts: check.conflicts }
  if (request.method === 'rebase' && check.uncommitted !== 0) return { ok: false, reason: 'blocked', blocker: { kind: 'worktree-dirty' } }
  if (merging.has(realRoot)) return { ok: false, reason: 'git', message: 'another merge is running in this repository' }
  merging.add(realRoot)

  let rebased = false
  try {
    let commit: string
    if (request.method === 'rebase') {
      if (check.behind > 0) {
        try {
          await git(worktreePath, ['rebase', '--no-autostash', '--quiet', check.baseHead], { timeout: CHECKOUT_TIMEOUT_MS })
        } catch (error) {
          await orEmpty(git(worktreePath, ['rebase', '--abort']))
          return { ok: false, reason: 'conflict', message: errorText(error) }
        }
        rebased = true
      }
      const branch = (await orEmpty(git(worktreePath, ['symbolic-ref', '--quiet', 'HEAD']))).trim()
      const head = await commitOf(worktreePath, 'HEAD')
      if (branch !== `refs/heads/${check.branch}` || !head) return { ok: false, reason: 'git', message: 'the worktree left its branch', rebased }
      commit = head
    } else {
      const message =
        request.method === 'merge'
          ? mergeMessage(check.branch, check.base)
          : squashMessage(check.branch, await squashCommits(realRoot, check.baseHead, check.head, check.ahead), request.title)
      const parents = request.method === 'merge' ? ['-p', check.baseHead, '-p', check.head] : ['-p', check.baseHead]
      commit = (await git(realRoot, ['commit-tree', inspection.tree!, ...parents, '-F', '-'], { input: message })).trim()
    }
    try {
      await advanceBase(inspection, commit, check.baseHead)
    } catch (error) {
      if (error instanceof StaleError) return { ok: false, reason: 'stale', rebased }
      throw error
    }
    const push = request.push && check.hasOrigin ? await pushBase(realRoot, check.base) : null
    return { ok: true, commit, push }
  } catch (error) {
    return { ok: false, reason: 'git', message: errorText(error), rebased }
  } finally {
    merging.delete(realRoot)
  }
}

export function registerGitMergeHandlers(): void {
  ipcMain.handle(IPC.gitWorktreesMergePrecheck, (_event, root: unknown, worktree: unknown) => mergePrecheck(root, worktree))
  ipcMain.handle(IPC.gitWorktreesMerge, (_event, request: unknown) => mergeWorktree(request))
}
