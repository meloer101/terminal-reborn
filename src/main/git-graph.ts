// The right panel's Git view (PRD F6 / F17 Git · 图谱 + 变更): commit graph pages, refs and worktrees, fetch, and the
// worktree's uncommitted / committed changes with per-file diffs. Every payload from the renderer is validated here;
// paths stay inside the worktree, refs must be plain names, and git never gets an argument that could be an option.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { open, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  GRAPH_MAX_PAGE_SIZE,
  isSafeRefName,
  LOG_FORMAT,
  mergeChanges,
  parseLeftRight,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseRefs,
  parseWorktreeList,
  pickTrunk,
  REF_FORMAT,
  type GitChanges,
  type GitFileChange,
  type GitFileDiffRequest,
  type GitLogPage,
  type GitLogScope
} from '@shared/git-graph/log'
import { looksBinary, MAX_PREVIEW_BYTES } from '@shared/worktree-files'
import { normalizeRelative } from './worktree-files'

const GIT_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_MS = 60_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const MAX_PATH = 4096
const MAX_KNOWN_PATHS = 1000
const MAX_SKIP = 1_000_000
/** Untracked files listed in 未提交 at most. */
const MAX_UNTRACKED = 1000
/** git's empty tree: what an unborn branch is compared against. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null
  ) {
    super(message)
  }
}

function git(cwd: string, args: string[], options: { timeout?: number; okCodes?: number[]; env?: Record<string, string> } = {}): Promise<string> {
  const okCodes = options.okCodes ?? [0]
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: options.timeout ?? GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        // Never take the index lock (agents run git in the same worktree); Finder launches with a minimal PATH.
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin`,
          ...options.env
        }
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const code = typeof error.code === 'number' ? error.code : null
        if (code !== null && okCodes.includes(code)) return resolve(stdout)
        reject(new GitError(String(stderr || error.message).trim(), code))
      }
    )
  })
}

const gitOrEmpty = (cwd: string, args: string[]) => git(cwd, args).catch(() => '')

function isPathLike(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') && isAbsolute(value)
}

/** The worktree's top level (real path), or null when `root` is not inside a git work tree. Throws on bad input. */
async function topLevel(root: unknown): Promise<string | null> {
  if (!isPathLike(root)) throw new Error('invalid worktree root')
  const real = await realpath(root)
  if (!(await stat(real)).isDirectory()) throw new Error('worktree root is not a directory')
  try {
    return (await git(real, ['rev-parse', '--show-toplevel'])).trim() || null
  } catch {
    return null
  }
}

async function realOrSame(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

// --- graph ------------------------------------------------------------------------------------------------------

interface RepoRefs {
  refs: ReturnType<typeof parseRefs>
  worktrees: ReturnType<typeof parseWorktreeList>
  originHead: string | null
  signature: string
}

async function readRefs(cwd: string): Promise<RepoRefs> {
  const [refsOut, worktreesOut, originHead] = await Promise.all([
    git(cwd, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes', 'refs/tags']),
    gitOrEmpty(cwd, ['worktree', 'list', '--porcelain', '-z']),
    gitOrEmpty(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  ])
  const signature = createHash('sha1').update(refsOut).update('\0\0').update(worktreesOut).digest('hex')
  return { refs: parseRefs(refsOut), worktrees: parseWorktreeList(worktreesOut), originHead: originHead.trim() || null, signature }
}

function parseLogRequest(request: unknown): { root: string; skip: number; limit: number; scope: GitLogScope; known: string[] } {
  if (typeof request !== 'object' || request === null) throw new Error('invalid request')
  const { root, skip, limit, scope, known } = request as Record<string, unknown>
  if (!isPathLike(root)) throw new Error('invalid worktree root')
  if (!Number.isInteger(skip) || (skip as number) < 0 || (skip as number) > MAX_SKIP) throw new Error('invalid skip')
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > GRAPH_MAX_PAGE_SIZE) throw new Error('invalid limit')
  if (scope !== 'all' && scope !== 'worktrees') throw new Error('invalid scope')
  if (!Array.isArray(known) || known.length > MAX_KNOWN_PATHS || !known.every(isPathLike)) throw new Error('invalid known paths')
  return { root, skip: skip as number, limit: limit as number, scope, known: known as string[] }
}

async function logPage(request: unknown): Promise<GitLogPage | null> {
  const { root, skip, limit, scope, known } = parseLogRequest(request)
  const cwd = await topLevel(root)
  if (!cwd) return null
  const [{ refs, worktrees: listed, originHead, signature }, head] = await Promise.all([
    readRefs(cwd),
    gitOrEmpty(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  ])
  const worktrees = await Promise.all(listed.map(async (w) => ({ ...w, path: await realOrSame(w.path) })))
  const realPaths: Record<string, string> = {}
  for (const path of new Set(known)) realPaths[path] = await realOrSame(path)

  // Worktree HEADs count as tips too (a detached HEAD is not on any branch).
  const heads = [...new Set(worktrees.map((w) => w.head).filter((h): h is string => h !== null))]
  let trunk = pickTrunk(refs, originHead)
  let revs: string[]
  if (scope === 'all') revs = ['--branches', '--remotes', '--tags', ...heads]
  else {
    revs = heads
    // Only what the worktrees reach: the main checkout's HEAD is the trunk there.
    const main = worktrees[0]
    trunk = main?.head ? { name: main.branch ?? 'HEAD', hash: main.head } : null
  }
  let commits = revs.length === 0 ? [] : parseLog(
    await git(cwd, ['log', '--topo-order', `--format=${LOG_FORMAT}`, `--skip=${skip}`, `--max-count=${limit + 1}`, ...revs, '--'])
  )
  const hasMore = commits.length > limit
  if (hasMore) commits = commits.slice(0, limit)
  return { commits, hasMore, refs, worktrees, head: head.trim() || null, trunk, realPaths, signature }
}

async function signature(root: unknown): Promise<string> {
  const cwd = await topLevel(root)
  return cwd ? (await readRefs(cwd)).signature : ''
}

async function fetchAll(root: unknown): Promise<string> {
  const cwd = await topLevel(root)
  if (!cwd) return '不是 git 仓库'
  try {
    // Never wait on a password prompt nobody can see.
    const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }
    if (!process.env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
    await git(cwd, ['fetch', '--all', '--prune', '--quiet'], { timeout: FETCH_TIMEOUT_MS, env })
    return ''
  } catch (error) {
    return error instanceof Error && error.message ? error.message : String(error)
  }
}

// --- changes ----------------------------------------------------------------------------------------------------

/** Line count of an untracked file (null when binary or too large to read). */
async function countLines(abs: string): Promise<number | null> {
  try {
    const info = await stat(abs)
    if (!info.isFile() || info.size > MAX_PREVIEW_BYTES) return null
    const handle = await open(abs, 'r')
    try {
      const buffer = Buffer.alloc(info.size)
      const { bytesRead } = await handle.read(buffer, 0, info.size, 0)
      const data = buffer.subarray(0, bytesRead)
      if (looksBinary(data)) return null
      if (data.length === 0) return 0
      let lines = 0
      for (const byte of data) if (byte === 10) lines++
      return data[data.length - 1] === 10 ? lines : lines + 1
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

async function diffFiles(cwd: string, range: string): Promise<GitFileChange[]> {
  const [names, counts] = await Promise.all([
    git(cwd, ['diff', '--no-color', '--no-ext-diff', '-M', '--name-status', '-z', range, '--']),
    git(cwd, ['diff', '--no-color', '--no-ext-diff', '-M', '--numstat', '-z', range, '--'])
  ])
  return mergeChanges(parseNameStatus(names), parseNumstat(counts))
}

async function resolvesToCommit(cwd: string, ref: string): Promise<boolean> {
  return (await gitOrEmpty(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() !== ''
}

async function changes(root: unknown, base: unknown): Promise<GitChanges | null> {
  if (base !== undefined && base !== null && !isSafeRefName(base)) throw new Error('invalid base')
  const cwd = await topLevel(root)
  if (!cwd) return null
  const [branchOut, headOut, refsOut, originHead, upstream] = await Promise.all([
    gitOrEmpty(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    gitOrEmpty(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD']),
    gitOrEmpty(cwd, ['for-each-ref', `--format=${REF_FORMAT}`, 'refs/heads', 'refs/remotes']),
    gitOrEmpty(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']),
    gitOrEmpty(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  ])
  const branch = branchOut.trim() || null
  const hasHead = headOut.trim() !== ''

  // 未提交: index + working tree vs HEAD, then the untracked files.
  const uncommitted = await diffFiles(cwd, hasHead ? 'HEAD' : EMPTY_TREE)
  const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  for (const path of untracked.slice(0, MAX_UNTRACKED)) {
    const lines = await countLines(join(cwd, path))
    uncommitted.push({ path, status: 'A', added: lines, removed: lines === null ? null : 0, untracked: true })
  }
  uncommitted.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  // 已提交: against the session's base branch, else the default branch; on that branch itself, its upstream.
  const candidates = [
    typeof base === 'string' ? base : null,
    pickTrunk(parseRefs(refsOut), originHead.trim() || null)?.name ?? null,
    upstream.trim() || null
  ]
  let against: string | null = null
  if (hasHead) {
    for (const candidate of candidates) {
      if (!candidate || candidate === branch || !isSafeRefName(candidate)) continue
      if (await resolvesToCommit(cwd, candidate)) {
        against = candidate
        break
      }
    }
  }
  if (!against) return { branch, base: null, ahead: 0, behind: 0, uncommitted, committed: [] }
  const [counts, committed] = await Promise.all([
    git(cwd, ['rev-list', '--left-right', '--count', `${against}...HEAD`, '--']),
    diffFiles(cwd, `${against}...HEAD`)
  ])
  return { branch, base: against, ...parseLeftRight(counts), uncommitted, committed }
}

async function fileDiff(request: unknown): Promise<string> {
  if (typeof request !== 'object' || request === null) throw new Error('invalid request')
  const { root, path, oldPath, scope, base, untracked } = request as Partial<Record<keyof GitFileDiffRequest, unknown>>
  const rel = normalizeRelative(path)
  if (!rel) throw new Error('invalid path')
  const old = oldPath === undefined ? null : normalizeRelative(oldPath)
  if (old === '') throw new Error('invalid path')
  if (scope !== 'uncommitted' && scope !== 'committed') throw new Error('invalid scope')
  if (scope === 'committed' && !isSafeRefName(base)) throw new Error('invalid base')
  const cwd = await topLevel(root)
  if (!cwd) return ''
  const paths = old && old !== rel ? [old, rel] : [rel]
  const flags = ['diff', '--no-color', '--no-ext-diff', '-M']
  if (scope === 'committed') return git(cwd, [...flags, `${base as string}...HEAD`, '--', ...paths])
  if (untracked === true) {
    // --no-index exits 1 when the files differ, which is the point.
    return git(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', rel], { okCodes: [0, 1] })
  }
  const hasHead = (await gitOrEmpty(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).trim() !== ''
  return git(cwd, [...flags, hasHead ? 'HEAD' : EMPTY_TREE, '--', ...paths])
}

export function registerGitGraphHandlers(): void {
  ipcMain.handle(IPC.gitLog, (_event, request: unknown) => logPage(request))
  ipcMain.handle(IPC.gitSignature, (_event, root: unknown) => signature(root).catch(() => ''))
  ipcMain.handle(IPC.gitFetch, (_event, root: unknown) => fetchAll(root))
  ipcMain.handle(IPC.gitChanges, (_event, root: unknown, base: unknown) => changes(root, base))
  ipcMain.handle(IPC.gitFileDiff, (_event, request: unknown) => fileDiff(request))
}
