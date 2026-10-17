// The right panel's Git view (PRD F6 / F17 Git · 图谱 + 变更): commit graph pages, refs and worktrees, fetch, and the
// worktree's uncommitted / committed changes with per-file diffs. Every payload from the renderer is validated here:
// paths stay inside the worktree (symlinks resolved), refs are full `refs/heads|remotes/…` names, pathspecs are
// literal, and git never gets an argument that could be read as an option.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, constants, open, realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import {
  byPath,
  GRAPH_MAX_RELOAD,
  isBaseRef,
  isValidRefName,
  LOG_FORMAT,
  parseLeftRight,
  parseLog,
  parseRawNumstat,
  parseRefs,
  parseWorktreeList,
  pickTrunk,
  REF_FORMAT,
  type GitChanges,
  type GitFileChange,
  type GitLogPage,
  type GitLogScope,
  type GitRef
} from '@shared/git-graph/log'
import { looksBinary, MAX_PREVIEW_BYTES } from '@shared/worktree-files'
import { isInside, normalizeRelative } from './worktree-files'

const GIT_TIMEOUT_MS = 15_000
const FETCH_TIMEOUT_MS = 60_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const MAX_PATH = 4096
const MAX_KNOWN_PATHS = 1000
const MAX_SKIP = 1_000_000
/** Untracked files listed in 未提交 at most (the rest is counted). */
export const MAX_UNTRACKED = 1000
/** Untracked files read at once to count their lines. */
const COUNT_CONCURRENCY = 16
/** git's empty tree: what an unborn branch is compared against. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Finder launches apps with a minimal PATH. */
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
const searchPath = () => [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH]

function run(command: string, cwd: string, args: string[], options: { timeout?: number; okCodes?: number[]; env?: Record<string, string> } = {}): Promise<string> {
  const okCodes = options.okCodes ?? [0]
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout: options.timeout ?? GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        env: {
          ...process.env,
          // Never take the index lock (agents run git in the same worktree); paths are paths, never globs.
          GIT_OPTIONAL_LOCKS: '0',
          GIT_LITERAL_PATHSPECS: '1',
          PATH: searchPath().join(delimiter),
          ...options.env
        }
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const code = typeof error.code === 'number' ? error.code : null
        if (code !== null && okCodes.includes(code)) return resolve(stdout)
        reject(new Error(String(stderr || error.message).trim() || `git exited with ${code}`))
      }
    )
  })
}

const git = (cwd: string, args: string[], options?: Parameters<typeof run>[3]) => run('git', cwd, args, options)
const gitOrEmpty = (cwd: string, args: string[]) => git(cwd, args).catch(() => '')

// --- is there a git at all ----------------------------------------------------------------------------------------

let probe: Promise<boolean> | null = null

/**
 * Whether a working git is installed. Checked once: on a Mac without the Command Line Tools, /usr/bin/git is a stub
 * that pops the install dialog on every call, so it is never run until xcode-select says the tools are there.
 */
export function gitAvailable(): Promise<boolean> {
  probe ??= (async () => {
    let found: string | null = null
    for (const dir of searchPath()) {
      const candidate = join(dir, 'git')
      if (await access(candidate, constants.X_OK).then(() => true, () => false)) {
        found = candidate
        break
      }
    }
    if (!found) return false
    if (process.platform === 'darwin' && found === '/usr/bin/git') {
      const tools = await run('/usr/bin/xcode-select', '/', ['-p']).then(() => true, () => false)
      if (!tools) return false
    }
    return run(found, '/', ['--version']).then(() => true, () => false)
  })()
  return probe
}

async function requireGit(): Promise<void> {
  if (!(await gitAvailable())) throw new Error('git not found')
}

function isPathLike(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0') && isAbsolute(value)
}

/** The worktree's top level (real path), or null when `root` is not inside a git work tree. Throws on bad input. */
async function topLevel(root: unknown): Promise<string | null> {
  if (!isPathLike(root)) throw new Error('invalid worktree root')
  await requireGit()
  const real = await realpath(root)
  if (!(await stat(real)).isDirectory()) throw new Error('worktree root is not a directory')
  try {
    const top = (await git(real, ['rev-parse', '--show-toplevel'])).trim()
    return top ? await realOrSame(top) : null
  } catch {
    return null
  }
}

async function realOrSame(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

// --- graph ------------------------------------------------------------------------------------------------------

interface RepoRefs {
  refs: GitRef[]
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

interface LogRequest {
  root: string
  skip: number
  limit: number
  scope: GitLogScope
  remotes: boolean
  known: string[]
}

function parseLogRequest(request: unknown): LogRequest {
  if (typeof request !== 'object' || request === null) throw new Error('invalid request')
  const { root, skip, limit, scope, remotes, known } = request as Record<string, unknown>
  if (!isPathLike(root)) throw new Error('invalid worktree root')
  if (!Number.isInteger(skip) || (skip as number) < 0 || (skip as number) > MAX_SKIP) throw new Error('invalid skip')
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > GRAPH_MAX_RELOAD) throw new Error('invalid limit')
  if (scope !== 'all' && scope !== 'worktrees') throw new Error('invalid scope')
  if (typeof remotes !== 'boolean') throw new Error('invalid remotes')
  if (!Array.isArray(known) || known.length > MAX_KNOWN_PATHS || !known.every(isPathLike)) throw new Error('invalid known paths')
  return { root, skip: skip as number, limit: limit as number, scope, remotes, known: known as string[] }
}

export async function logPage(request: unknown): Promise<GitLogPage | null> {
  const { root, skip, limit, scope, remotes, known } = parseLogRequest(request)
  const cwd = await topLevel(root)
  if (!cwd) return null
  const [{ refs: allRefs, worktrees: listed, originHead, signature }, head] = await Promise.all([
    readRefs(cwd),
    gitOrEmpty(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  ])
  const refs = remotes || scope === 'worktrees' ? allRefs : allRefs.filter((r) => r.kind !== 'remote')
  const worktrees = await Promise.all(listed.map(async (w) => ({ ...w, path: await realOrSame(w.path) })))
  const realPaths: Record<string, string> = {}
  for (const path of new Set(known)) realPaths[path] = await realOrSame(path)

  // Worktree HEADs count as tips too (a detached HEAD is not on any branch).
  const heads = [...new Set(worktrees.map((w) => w.head).filter((h): h is string => h !== null))]
  let trunk = pickTrunk(allRefs, originHead)
  let revs: string[]
  if (scope === 'all') {
    revs = ['--branches', '--tags', ...(remotes ? ['--remotes'] : []), ...heads]
    // A remote trunk is not in the log when remotes are hidden; reserving column 0 for it would leave a gap.
    if (trunk && !refs.some((r) => r.hash === trunk!.hash) && !heads.includes(trunk.hash)) trunk = null
  } else {
    revs = heads
    // Only what the worktrees reach: the main checkout's HEAD is the trunk there.
    const main = worktrees[0]
    trunk = main?.head ? { name: main.branch ?? 'HEAD', hash: main.head } : null
  }
  let commits =
    revs.length === 0
      ? []
      : parseLog(
          await git(cwd, [
            'log',
            '--no-show-signature',
            '--topo-order',
            `--format=${LOG_FORMAT}`,
            `--skip=${skip}`,
            `--max-count=${limit + 1}`,
            ...revs,
            '--'
          ])
        )
  const hasMore = commits.length > limit
  if (hasMore) commits = commits.slice(0, limit)
  return { commits, hasMore, refs, worktrees, head: head.trim() || null, trunk, realPaths, signature }
}

async function signature(root: unknown): Promise<string> {
  const cwd = await topLevel(root)
  return cwd ? (await readRefs(cwd)).signature : ''
}

/**
 * ssh for fetch, never prompting: the user's own command (GIT_SSH_COMMAND, core.sshCommand) with BatchMode added,
 * so multi-account keys and agents keep working. GIT_SSH (a program, not a command line) is left alone.
 */
export function sshCommandFor(env: NodeJS.ProcessEnv, coreSshCommand: string): string | null {
  if (env.GIT_SSH_COMMAND) return `${env.GIT_SSH_COMMAND} -o BatchMode=yes`
  if (coreSshCommand) return `${coreSshCommand} -o BatchMode=yes`
  if (env.GIT_SSH) return null
  return 'ssh -o BatchMode=yes'
}

async function fetchAll(root: unknown): Promise<string> {
  const cwd = await topLevel(root)
  if (!cwd) return '不是 git 仓库'
  try {
    const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' }
    const ssh = sshCommandFor(process.env, (await gitOrEmpty(cwd, ['config', '--get', 'core.sshCommand'])).trim())
    if (ssh) env.GIT_SSH_COMMAND = ssh
    await git(cwd, ['fetch', '--all', '--prune', '--quiet'], { timeout: FETCH_TIMEOUT_MS, env })
    return ''
  } catch (error) {
    return error instanceof Error && error.message ? error.message : String(error)
  }
}

// --- changes ----------------------------------------------------------------------------------------------------

/** Line count of an untracked file; `large` past the preview cap, null when binary or unreadable. */
async function countLines(abs: string): Promise<number | null | 'large'> {
  try {
    const info = await stat(abs)
    if (!info.isFile()) return null
    if (info.size > MAX_PREVIEW_BYTES) return 'large'
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

async function untrackedChange(cwd: string, entry: string): Promise<GitFileChange> {
  // `ls-files --others` lists a folder that is a repo of its own as `dir/`, not its files.
  if (entry.endsWith('/')) return { path: entry.slice(0, -1), status: 'A', added: null, removed: null, untracked: true, nested: true }
  const lines = await countLines(join(cwd, entry))
  if (lines === 'large') return { path: entry, status: 'A', added: null, removed: null, untracked: true, tooLarge: true }
  return { path: entry, status: 'A', added: lines, removed: lines === null ? null : 0, untracked: true }
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const listUntracked = async (cwd: string, path?: string) =>
  (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...(path ? [path] : [])])).split('\0').filter(Boolean)

/** The full ref of a branch name (local first), or null. */
function refFor(name: string, refs: readonly GitRef[]): string | null {
  if (refs.some((r) => r.kind === 'local' && r.name === name)) return `refs/heads/${name}`
  if (refs.some((r) => r.kind === 'remote' && r.name === name)) return `refs/remotes/${name}`
  return null
}

const shortName = (ref: string) => ref.replace(/^refs\/(heads|remotes)\//, '')

/**
 * The base to compare 已提交 against: the session's base branch, else the default branch, else (on that branch
 * itself) its upstream. A local base that is behind its origin counterpart is replaced by the remote one. Bases
 * that do not exist, are this branch, or share no history with HEAD are skipped.
 */
async function pickBase(cwd: string, branch: string | null, candidates: (string | null)[], refs: readonly GitRef[]): Promise<string | null> {
  for (const name of candidates) {
    if (!name || name === branch || !isValidRefName(name)) continue
    let ref = refFor(name, refs)
    if (!ref) continue
    const local = refs.find((r) => r.kind === 'local' && r.name === name)
    const upstream = refs.find((r) => r.kind === 'remote' && r.name === `origin/${name}`)
    if (local && upstream && local.hash !== upstream.hash && `origin/${name}` !== branch) {
      const remote = `refs/remotes/origin/${name}`
      if (await git(cwd, ['merge-base', '--is-ancestor', ref, remote]).then(() => true, () => false)) ref = remote
    }
    if (await git(cwd, ['merge-base', ref, 'HEAD']).then(() => true, () => false)) return ref
  }
  return null
}

export async function changes(root: unknown, base: unknown): Promise<GitChanges | null> {
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
  const refs = parseRefs(refsOut)

  // 未提交: one diff of index + working tree vs HEAD, then the untracked files.
  const [diffOut, untracked] = await Promise.all([
    git(cwd, ['diff', '--no-color', '--no-ext-diff', '-M', '--raw', '--numstat', '-z', hasHead ? 'HEAD' : EMPTY_TREE, '--']),
    listUntracked(cwd)
  ])
  const uncommitted = [
    ...parseRawNumstat(diffOut),
    ...(await mapLimited(untracked.slice(0, MAX_UNTRACKED), COUNT_CONCURRENCY, (entry) => untrackedChange(cwd, entry)))
  ].sort(byPath)
  const untrackedOmitted = Math.max(0, untracked.length - MAX_UNTRACKED)

  const candidates = [isValidRefName(base) ? base : null, pickTrunk(refs, originHead.trim() || null)?.name ?? null, upstream.trim() || null]
  const baseRef = hasHead ? await pickBase(cwd, branch, candidates, refs) : null
  if (!baseRef) return { branch, base: null, baseRef: null, ahead: 0, behind: 0, uncommitted, untrackedOmitted, committed: [] }
  const [counts, committedOut] = await Promise.all([
    git(cwd, ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`, '--']),
    git(cwd, ['diff', '--no-color', '--no-ext-diff', '-M', '--raw', '--numstat', '-z', `${baseRef}...HEAD`, '--'])
  ])
  return {
    branch,
    base: shortName(baseRef),
    baseRef,
    ...parseLeftRight(counts),
    uncommitted,
    untrackedOmitted,
    committed: parseRawNumstat(committedOut)
  }
}

export async function fileDiff(request: unknown): Promise<string> {
  if (typeof request !== 'object' || request === null) throw new Error('invalid request')
  const { root, path, oldPath, scope, baseRef, untracked } = request as Record<string, unknown>
  const rel = normalizeRelative(path)
  if (!rel) throw new Error('invalid path')
  const old = oldPath === undefined ? null : normalizeRelative(oldPath)
  if (old === '') throw new Error('invalid path')
  if (scope !== 'uncommitted' && scope !== 'committed') throw new Error('invalid scope')
  if (scope === 'committed' && !isBaseRef(baseRef)) throw new Error('invalid base')
  const cwd = await topLevel(root)
  if (!cwd) return ''
  const paths = old && old !== rel ? [old, rel] : [rel]
  const flags = ['diff', '--no-color', '--no-ext-diff', '-M']
  if (scope === 'committed') return git(cwd, [...flags, `${baseRef as string}...HEAD`, '--', ...paths])
  if (untracked === true) {
    // --no-index reads any path it is given: only an untracked file git lists, really inside the worktree.
    if (!(await listUntracked(cwd, rel)).includes(rel)) throw new Error('not an untracked file')
    const abs = await realpath(join(cwd, rel))
    if (!isInside(cwd, abs) || !(await stat(abs)).isFile()) throw new Error('path outside the worktree')
    // Exits 1 when the files differ, which is the point.
    return git(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', rel], { okCodes: [0, 1] })
  }
  const hasHead = (await gitOrEmpty(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).trim() !== ''
  return git(cwd, [...flags, hasHead ? 'HEAD' : EMPTY_TREE, '--', ...paths])
}

export function registerGitGraphHandlers(): void {
  ipcMain.handle(IPC.gitAvailable, () => gitAvailable())
  ipcMain.handle(IPC.gitLog, (_event, request: unknown) => logPage(request))
  ipcMain.handle(IPC.gitSignature, (_event, root: unknown) => signature(root).catch(() => ''))
  ipcMain.handle(IPC.gitFetch, (_event, root: unknown) => fetchAll(root))
  ipcMain.handle(IPC.gitChanges, (_event, root: unknown, base: unknown) => changes(root, base))
  ipcMain.handle(IPC.gitFileDiff, (_event, request: unknown) => fileDiff(request))
}
