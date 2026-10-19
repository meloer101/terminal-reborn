// IPC for archiving a worktree (PRD F15). Capture keeps the worktree's state on `refs/wavi/archive/<id>` and never
// touches its files; restore leaves an existing folder alone and only recreates a folder that is gone (`git worktree
// add` on its branch, then the snapshot's uncommitted state), then drops the ref. Every payload is validated: the
// root is a workspace project, capture targets a non-main worktree git lists, ids are safe ref names.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { delimiter, isAbsolute, normalize } from 'node:path'
import { ipcMain } from 'electron'
import {
  ARCHIVE_IPC,
  archiveRefName,
  type ArchiveCaptureResult,
  type ArchiveRestoreRequest,
  type ArchiveRestoreResult
} from '@shared/archive'
import { mainWorktreeIndex, parseWorktreePorcelain, type PorcelainWorktree } from '@shared/git-worktrees'
import { archiveCommit, captureWorktreeArchive, dropWorktreeArchive, restoreWorktreeArchive } from './archive-ref'
import { isProjectRoot } from './workspace-store'

const MAX_PATH = 4096
const GIT_TIMEOUT_MS = 60_000
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          PATH: [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter)
        }
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || error.message).trim().split('\n').slice(-2).join(' ').slice(0, 300) || 'git failed'))
        else resolve(stdout)
      }
    )
  })
}

const realOrSelf = (path: string): Promise<string> => realpath(path).catch(() => path)

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PATH && !value.includes('\0') && isAbsolute(value) && normalize(value) === value
}

async function projectRoot(root: unknown): Promise<string> {
  if (!isPath(root) || !isProjectRoot(root)) throw new Error('not a project root')
  const real = await realpath(root)
  if (!(await stat(real)).isDirectory()) throw new Error('project root is not a directory')
  return real
}

function safeId(id: unknown): string {
  if (typeof id !== 'string' || archiveRefName(id) === null) throw new Error('invalid archive id')
  return id
}

interface Listed {
  entry: PorcelainWorktree
  real: string
  isMain: boolean
}

/** The worktree git lists at `path` (by real path), or null. */
async function listedWorktree(realRoot: string, path: string): Promise<Listed | null> {
  const entries = parseWorktreePorcelain(await git(realRoot, ['worktree', 'list', '--porcelain']))
  const target = await realOrSelf(path)
  const reals = await Promise.all(entries.map((e) => realOrSelf(e.path)))
  const index = reals.findIndex((real, i) => !entries[i]!.bare && (real === target || entries[i]!.path === path))
  if (index < 0) return null
  return { entry: entries[index]!, real: reals[index]!, isMain: index === mainWorktreeIndex(entries) }
}

export async function captureArchive(root: unknown, worktree: unknown, id: unknown): Promise<ArchiveCaptureResult> {
  try {
    const realRoot = await projectRoot(root)
    if (!isPath(worktree)) throw new Error('invalid worktree path')
    const archiveId = safeId(id)
    const listed = await listedWorktree(realRoot, worktree)
    if (!listed || !existsSync(listed.real)) return { ok: false, message: '它已经不在 git worktree 列表里' }
    if (listed.isMain) return { ok: false, message: '项目主目录不能归档' }
    const head = (await git(listed.real, ['rev-parse', 'HEAD'])).trim()
    const saved = await captureWorktreeArchive(listed.real, archiveId)
    return { ok: true, commit: saved.commit, dirty: saved.commit !== head }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  return git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).then(
    () => true,
    () => false
  )
}

export function parseRestoreRequest(raw: unknown): ArchiveRestoreRequest {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid request')
  const { root, worktree, branch, id } = raw as Record<string, unknown>
  if (!isPath(root) || !isPath(worktree)) throw new Error('invalid path')
  if (typeof branch !== 'string' || branch.length === 0 || branch.length > 255 || branch.startsWith('-') || branch.includes('\0')) {
    throw new Error('invalid branch')
  }
  return { root, worktree, branch, id: safeId(id) }
}

export async function restoreArchive(raw: unknown): Promise<ArchiveRestoreResult> {
  try {
    const request = parseRestoreRequest(raw)
    const realRoot = await projectRoot(request.root)
    const commit = await archiveCommit(realRoot, request.id)
    const listed = await listedWorktree(realRoot, request.worktree)
    if (listed && existsSync(listed.real)) {
      // The folder is still there with whatever is in it now: never overwrite it with the snapshot.
      if (commit) await dropWorktreeArchive(realRoot, request.id)
      return { ok: true, recreated: false }
    }
    if (!commit) return { ok: false, message: '文件夹已经不在了，归档时的记录也找不到' }
    await git(realRoot, ['check-ref-format', '--branch', request.branch])
    if (existsSync(request.worktree) && readdirSync(request.worktree).length > 0) {
      return { ok: false, message: `${request.worktree} 已经被别的文件占用` }
    }
    await git(realRoot, ['worktree', 'prune'])
    // A dirty snapshot is a stash-shaped `wavi-archive` commit whose first parent is the HEAD it was taken on;
    // a clean one is that HEAD itself.
    const [subject, parents] = (await git(realRoot, ['log', '-1', '--format=%s%x00%P', commit])).trim().split('\0')
    const firstParent = parents?.split(' ')[0]
    const dirty = subject === 'wavi-archive' && (parents?.split(' ').length ?? 0) >= 2 && firstParent !== undefined
    const startAt = dirty ? firstParent : commit
    if (await branchExists(realRoot, request.branch)) {
      await git(realRoot, ['worktree', 'add', '--', request.worktree, request.branch])
    } else {
      await git(realRoot, ['worktree', 'add', '-b', request.branch, '--', request.worktree, startAt])
    }
    if (dirty) await restoreWorktreeArchive(request.worktree, request.id)
    await dropWorktreeArchive(realRoot, request.id)
    return { ok: true, recreated: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function registerArchiveHandlers(): void {
  ipcMain.handle(ARCHIVE_IPC.capture, (_event, root: unknown, worktree: unknown, id: unknown) => captureArchive(root, worktree, id))
  ipcMain.handle(ARCHIVE_IPC.restore, (_event, raw: unknown) => restoreArchive(raw))
}
