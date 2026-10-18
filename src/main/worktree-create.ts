// The new-session sheet's git side (PRD F4, Figma 15): what the sheet needs to know about a project (branches, which
// worktree has each one out, the default base, the branch-name prefix, `.worktreeinclude`), and creating a worktree
// on a new branch: fetch → `git worktree add --no-track -b` → `branch.<name>.base` → copy the ignored files
// `.worktreeinclude` lists (APFS clones where possible). Only the workspace's own project roots are accepted and every
// payload is validated here; nothing from the renderer reaches git as an option.
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { cp, mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { mainWorktreeIndex, parseWorktreePorcelain, pickMainBranch } from '@shared/git-worktrees'
import {
  branchPrefix,
  MAX_INCLUDE_LISTED,
  parseCreateRequest,
  type NewSessionBranch,
  type NewSessionInfo,
  type WorktreeCreateResult
} from '@shared/new-session'
import { gitAvailable, sshCommandFor } from './git-graph'
import { isProjectRoot } from './workspace-store'
import { isInside, normalizeRelative } from './worktree-files'

const MAX_PATH = 4096
const GIT_TIMEOUT_MS = 15_000
/** `worktree add` checks out the whole tree. */
const ADD_TIMEOUT_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 30_000
const MAX_BUFFER = 32 * 1024 * 1024
/** `.worktreeinclude` matches copied at most (a pattern that catches node_modules collapses to one folder entry). */
const MAX_INCLUDE = 1000
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function git(cwd: string, args: string[], options: { timeout?: number; env?: Record<string, string>; input?: string } = {}): Promise<string> {
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
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          PATH: [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter),
          ...options.env
        }
      },
      (error, stdout, stderr) => (error ? reject(new Error(String(stderr || error.message).trim())) : resolve(stdout))
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
  })
}

const orEmpty = (promise: Promise<string>): Promise<string> => promise.catch(() => '')

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)

/** The repository's top level for a workspace project root; null when the folder is not in a git repository. */
async function repoTop(root: unknown): Promise<string | null> {
  if (typeof root !== 'string' || root.length > MAX_PATH || root.includes('\0') || !isAbsolute(root) || !isProjectRoot(root)) {
    throw new Error('not a project root')
  }
  const real = await realpath(root)
  if (!(await stat(real)).isDirectory()) throw new Error('project root is not a directory')
  if (!(await gitAvailable())) return null
  const top = (await orEmpty(git(real, ['rev-parse', '--show-toplevel']))).trim()
  return top ? realpath(top).catch(() => top) : null
}

/** Where new worktrees of a repository go: `~/.tr/worktrees/<repo folder name>` (PRD F4). */
export function worktreesDirFor(top: string, home = homedir()): string {
  return join(home, '.tr', 'worktrees', basename(top))
}

/** Lines of `for-each-ref --format=%(refname)`, without the given prefix. */
async function refNames(top: string, namespace: 'refs/heads/' | 'refs/remotes/'): Promise<string[]> {
  const out = await orEmpty(git(top, ['for-each-ref', '--format=%(refname)', namespace]))
  return out
    .split('\n')
    .filter((line) => line.startsWith(namespace))
    .map((line) => line.slice(namespace.length))
}

/**
 * Ignored files `.worktreeinclude` asks for, relative to the top level: the paths its patterns match (folders that
 * match as a whole come back as one `dir/` entry) that git also ignores. Tracked files are never copied — the new
 * worktree has them already.
 */
export async function includedFiles(top: string): Promise<string[]> {
  const includeFile = join(top, '.worktreeinclude')
  if (!(await exists(includeFile))) return []
  const listed = await orEmpty(git(top, ['ls-files', '-z', '--others', '--ignored', '--directory', `--exclude-from=${includeFile}`]))
  const candidates = listed
    .split('\0')
    .filter((path) => path !== '' && normalizeRelative(path.replace(/\/$/, '')) !== null)
    .slice(0, MAX_INCLUDE)
  if (candidates.length === 0) return []
  // check-ignore exits 1 when nothing is ignored; then nothing is copied.
  const ignored = await orEmpty(git(top, ['check-ignore', '-z', '--stdin'], { input: `${candidates.join('\0')}\0` }))
  const set = new Set(ignored.split('\0').filter(Boolean))
  return candidates.filter((path) => set.has(path))
}

export async function newSessionInfo(root: unknown): Promise<NewSessionInfo> {
  const top = await repoTop(root)
  const none: NewSessionInfo = {
    repo: false,
    currentBranch: null,
    defaultBranch: null,
    branches: [],
    prefix: '',
    worktreesDir: '',
    takenFolders: [],
    includeFiles: [],
    includeCount: 0
  }
  if (!top) return none
  let porcelain
  try {
    porcelain = parseWorktreePorcelain(await git(top, ['worktree', 'list', '--porcelain']))
  } catch {
    return none
  }
  const mainIndex = mainWorktreeIndex(porcelain)
  const mainCheckout = mainIndex === null ? null : porcelain[mainIndex]!
  const checkedOut = new Map<string, { path: string; main: boolean }>()
  for (const entry of porcelain) if (entry.branch && !entry.bare) checkedOut.set(entry.branch, { path: entry.path, main: entry === mainCheckout })

  const worktreesDir = worktreesDirFor(top)
  const [localNames, remoteNames, originHead, userName, taken, include] = await Promise.all([
    refNames(top, 'refs/heads/'),
    refNames(top, 'refs/remotes/'),
    orEmpty(git(top, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])),
    orEmpty(git(top, ['config', '--get', 'user.name'])),
    readdir(worktreesDir).catch(() => [] as string[]),
    includedFiles(top)
  ])
  let login = ''
  try {
    login = userInfo().username
  } catch {
    // no passwd entry
  }
  const branches: NewSessionBranch[] = [
    ...localNames.map((name) => {
      const at = checkedOut.get(name)
      return { name, remote: false, worktreePath: at?.path ?? null, inMainCheckout: at?.main ?? false }
    }),
    ...remoteNames.filter((name) => !name.endsWith('/HEAD')).map((name) => ({ name, remote: true, worktreePath: null, inMainCheckout: false }))
  ]
  const currentBranch = mainCheckout?.branch ?? null
  return {
    repo: true,
    currentBranch,
    defaultBranch: pickMainBranch(localNames, originHead.trim() || null, currentBranch),
    branches,
    prefix: branchPrefix(userName.trim(), login),
    worktreesDir,
    takenFolders: taken,
    includeFiles: include.slice(0, MAX_INCLUDE_LISTED),
    includeCount: include.length
  }
}

/** Brings remote branches up to date before branching off; offline or no remote is fine (the local refs are used). */
async function fetchRemotes(top: string): Promise<void> {
  if ((await orEmpty(git(top, ['remote']))).trim() === '') return
  const env: Record<string, string> = {}
  const ssh = sshCommandFor(process.env, (await orEmpty(git(top, ['config', '--get', 'core.sshCommand']))).trim())
  if (ssh) env.GIT_SSH_COMMAND = ssh
  await git(top, ['fetch', '--all', '--prune', '--quiet'], { timeout: FETCH_TIMEOUT_MS, env }).catch(() => {})
}

const refExists = (top: string, ref: string): Promise<boolean> =>
  git(top, ['show-ref', '--verify', '--quiet', ref]).then(() => true, () => false)

/**
 * The commit a new branch starts at for `base`: a local branch that is only behind its upstream (just fetched) starts
 * at the upstream, so the worktree is current; one with commits of its own starts at itself. Null when `base` is no branch.
 */
async function startPoint(top: string, base: string): Promise<string | null> {
  if (await refExists(top, `refs/heads/${base}`)) {
    const upstream = (await orEmpty(git(top, ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${base}`]))).trim()
    if (upstream && (await refExists(top, `refs/remotes/${upstream}`))) {
      const behindOnly = await git(top, ['merge-base', '--is-ancestor', `refs/heads/${base}`, `refs/remotes/${upstream}`]).then(
        () => true,
        () => false
      )
      if (behindOnly) return `refs/remotes/${upstream}`
    }
    return `refs/heads/${base}`
  }
  return (await refExists(top, `refs/remotes/${base}`)) ? `refs/remotes/${base}` : null
}

/** Copies the `.worktreeinclude` files into the new worktree (copy-on-write clones on APFS). Returns how many failed. */
async function copyIncluded(top: string, target: string): Promise<number> {
  let failures = 0
  for (const entry of await includedFiles(top)) {
    const rel = entry.replace(/\/$/, '')
    const from = join(top, rel)
    const to = join(target, rel)
    if (!isInside(top, from) || !isInside(target, to)) continue
    try {
      if (await exists(to)) continue
      await mkdir(join(to, '..'), { recursive: true })
      await cp(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: false, force: false, mode: constants.COPYFILE_FICLONE })
    } catch {
      failures++
    }
  }
  return failures
}

export async function createWorktree(raw: unknown): Promise<WorktreeCreateResult> {
  const request = parseCreateRequest(raw)
  if (!request) return { ok: false, reason: 'invalid' }
  const top = await repoTop(request.root)
  if (!top) return { ok: false, reason: 'not-a-repo' }
  if (await refExists(top, `refs/heads/${request.branch}`)) return { ok: false, reason: 'branch-exists' }
  const dir = worktreesDirFor(top)
  const path = join(dir, request.folder)
  if (await exists(path)) return { ok: false, reason: 'folder-exists' }

  await fetchRemotes(top)
  const start = await startPoint(top, request.base)
  if (!start) return { ok: false, reason: 'base-missing' }
  await mkdir(dir, { recursive: true })
  try {
    await git(top, ['worktree', 'add', '--no-track', '-b', request.branch, path, start], { timeout: ADD_TIMEOUT_MS })
  } catch (error) {
    return { ok: false, reason: 'git', message: error instanceof Error ? error.message : String(error) }
  }
  // The Worktree view and the merge compare against this (PRD F17 / F4).
  await git(top, ['config', `branch.${request.branch}.base`, request.base]).catch(() => {})
  const copyFailures = request.prepare ? await copyIncluded(top, path) : 0
  return { ok: true, path, copyFailures }
}

export function registerWorktreeCreateHandlers(): void {
  ipcMain.handle(IPC.gitWorktreesNewSessionInfo, (_event, root: unknown) => newSessionInfo(root))
  ipcMain.handle(IPC.gitWorktreesCreate, (_event, request: unknown) => createWorktree(request))
}
