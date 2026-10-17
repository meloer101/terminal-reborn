// The right panel's Worktree view (PRD F17): lists a project's git worktrees with their uncommitted stats and
// ahead / behind, and removes one. Git never runs in the renderer; every payload is checked here.
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  isMergedInto,
  MAX_DIRTY_FILES,
  parseAheadBehind,
  parseBaseConfig,
  parseNumstat,
  parseWorktreePorcelain,
  pickMainBranch,
  type GitWorktreeInfo,
  type GitWorktreeListing,
  type PorcelainWorktree,
  type WorktreeRemoveResult
} from '@shared/git-worktrees'
import { parseGitStatus } from '@shared/worktree-files'
import { git, resolveRoot } from './worktree-files'

const MAX_PATH = 4096
const MAX_KNOWN_PATHS = 1000

const isPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') && isAbsolute(value)

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

const quiet = (promise: Promise<string>): Promise<string> => promise.catch(() => '')

/** Short branch name → commit, for every local branch. */
async function localBranches(cwd: string): Promise<Record<string, string>> {
  const out = await quiet(git(cwd, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads']))
  const heads: Record<string, string> = {}
  for (const line of out.split('\n')) {
    const [name, sha] = line.split('\0')
    if (name && sha) heads[name] = sha
  }
  return heads
}

async function resolveCommit(cwd: string, ref: string): Promise<string | null> {
  const out = (await quiet(git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`]))).trim()
  return out || null
}

/** Uncommitted state of one worktree: line stats vs HEAD and the changed paths. */
async function dirtyState(path: string): Promise<Pick<GitWorktreeInfo, 'added' | 'removed' | 'dirtyFiles' | 'dirtyCount'>> {
  const [numstat, status] = await Promise.all([
    quiet(git(path, ['diff', '--no-ext-diff', '--numstat', 'HEAD'])),
    quiet(git(path, ['status', '--porcelain=v2', '-z', '--untracked-files=normal']))
  ])
  const files = Object.keys(parseGitStatus(status).changes).sort()
  return { ...parseNumstat(numstat), dirtyFiles: files.slice(0, MAX_DIRTY_FILES), dirtyCount: files.length }
}

async function readPorcelain(realRoot: string): Promise<PorcelainWorktree[] | null> {
  try {
    return parseWorktreePorcelain(await git(realRoot, ['worktree', 'list', '--porcelain'])).filter((w) => !w.bare)
  } catch {
    return null // not a git repository
  }
}

export async function listWorktrees(root: unknown, knownPaths: unknown): Promise<GitWorktreeListing | null> {
  const realRoot = await resolveRoot(root)
  const entries = await readPorcelain(realRoot)
  if (!entries || entries.length === 0) return null
  const [heads, originHead, baseConfig] = await Promise.all([
    localBranches(realRoot),
    quiet(git(realRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])),
    quiet(git(realRoot, ['config', '--get-regexp', '^branch\\..*\\.base$']))
  ])
  const bases = parseBaseConfig(baseConfig)
  const mainBranch = pickMainBranch(Object.keys(heads), originHead.trim() || null, entries[0]!.branch)
  const baseHeads = new Map<string, Promise<string | null>>()
  const baseHead = (base: string) => {
    if (!baseHeads.has(base)) baseHeads.set(base, heads[base] ? Promise.resolve(heads[base]) : resolveCommit(realRoot, base))
    return baseHeads.get(base)!
  }

  const worktrees = await Promise.all(
    entries.map(async (entry, index): Promise<GitWorktreeInfo> => {
      const exists = !entry.prunable && (await isDirectory(entry.path))
      const wanted = entry.branch ? (bases[entry.branch] ?? mainBranch) : mainBranch
      const base = wanted && wanted !== entry.branch ? wanted : null
      const baseSha = base ? await baseHead(base) : null
      let counts: { ahead: number; behind: number } | null = null
      if (base && baseSha && entry.head) {
        counts = parseAheadBehind(await quiet(git(realRoot, ['rev-list', '--left-right', '--count', `${baseSha}...${entry.head}`])))
      }
      const dirty = exists ? await dirtyState(entry.path) : { added: 0, removed: 0, dirtyFiles: [], dirtyCount: 0 }
      return {
        path: entry.path,
        realPath: await realOrSelf(entry.path),
        head: entry.head,
        branch: entry.branch,
        isMain: index === 0,
        locked: entry.locked,
        prunable: !exists,
        base: baseSha ? base : null,
        ahead: counts?.ahead ?? null,
        behind: counts?.behind ?? null,
        merged: isMergedInto(counts?.ahead ?? null, entry.head, baseSha),
        ...dirty
      }
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
  return { mainBranch, worktrees, realPaths }
}

const gitMessage = (error: unknown): string => {
  const stderr = (error as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' && stderr.trim() ? stderr : error instanceof Error ? error.message : String(error)
  return text.trim().split('\n').slice(-2).join(' ').slice(0, 500)
}

/**
 * `git worktree remove` for one linked worktree of the repo at `root`. Refuses the main checkout, the root itself and
 * a worktree with uncommitted changes (even with `force`, which only gets past git's other refusals, e.g. submodules).
 * A worktree whose folder is already gone is pruned instead.
 */
export async function removeWorktree(root: unknown, path: unknown, force: unknown): Promise<WorktreeRemoveResult> {
  const realRoot = await resolveRoot(root)
  if (!isPath(path)) throw new Error('invalid worktree path')
  const entries = await readPorcelain(realRoot)
  if (!entries) return { ok: false, reason: 'unknown' }
  const target = await realOrSelf(path)
  const reals = await Promise.all(entries.map((e) => realOrSelf(e.path)))
  const index = reals.findIndex((real, i) => real === target || entries[i]!.path === path)
  if (index < 0) return { ok: false, reason: 'unknown' }
  if (index === 0 || reals[index] === realRoot) return { ok: false, reason: 'main' }
  const entry = entries[index]!
  try {
    if (entry.prunable || !(await isDirectory(entry.path))) {
      await git(realRoot, ['worktree', 'prune'])
      return { ok: true }
    }
    if ((await dirtyState(entry.path)).dirtyCount > 0) return { ok: false, reason: 'dirty' }
    await git(realRoot, ['worktree', 'remove', ...(force === true ? ['--force'] : []), '--', entry.path])
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: 'git', message: gitMessage(error) }
  }
}

export function registerGitWorktreeHandlers(): void {
  ipcMain.handle(IPC.gitWorktreesList, (_event, root: unknown, knownPaths: unknown) => listWorktrees(root, knownPaths))
  ipcMain.handle(IPC.gitWorktreesRemove, (_event, root: unknown, path: unknown, force: unknown) => removeWorktree(root, path, force))
}
