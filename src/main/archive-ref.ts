// A worktree's uncommitted state on a private ref (PRD F15). The snapshot is a stash-shaped commit
// (HEAD, the index, and untracked files) built with commit-tree, so nothing is written to refs/stash,
// the branch, the index, or git config. A clean worktree points the ref at HEAD. Restore puts that
// state back; HEAD stays where it is.
import { execFile } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import { archiveRefName } from '@shared/archive'

const GIT_TIMEOUT_MS = 60_000
const MAX_BUFFER = 32 * 1024 * 1024
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']

export interface ArchiveSnapshot {
  ref: string
  commit: string
}

interface RunResult {
  stdout: string
  stderr: string
}

function git(cwd: string, args: string[], extra?: { env?: Record<string, string>; input?: string }): Promise<RunResult> {
  return new Promise((resolveRun, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_EDITOR: 'true',
          PATH: [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter),
          ...extra?.env
        }
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(String(stderr || stdout || error.message || 'git failed').trim().split('\n').slice(-3).join(' ').slice(0, 500)))
        else resolveRun({ stdout, stderr })
      }
    )
    if (extra?.input !== undefined) child.stdin?.end(extra.input)
  })
}

/** Identity for snapshot commits only. `-c` does not write git config. */
const SNAPSHOT_IDENTITY = ['-c', 'user.name=Wavi', '-c', 'user.email=wavi@localhost', '-c', 'commit.gpgsign=false']

function refFor(id: string): string {
  const ref = archiveRefName(id)
  if (!ref) throw new Error(`archive id is not a safe ref name: ${id}`)
  return ref
}

async function commitTree(dir: string, tree: string, parents: readonly string[], message: string): Promise<string> {
  const args = [...SNAPSHOT_IDENTITY, 'commit-tree', tree]
  for (const parent of parents) args.push('-p', parent)
  args.push('-m', message)
  return (await git(dir, args)).stdout.trim()
}

/** A throwaway index so the repository's own index is never written. */
async function withTempIndex<T>(dir: string, fn: (index: string) => Promise<T>): Promise<T> {
  const indexDir = mkdtempSync(join(tmpdir(), 'tr-archive-idx-'))
  try {
    return await fn(join(indexDir, 'index'))
  } finally {
    rmSync(indexDir, { recursive: true, force: true })
  }
}

/** Commit of files git does not track and does not ignore. Null when there are none. */
async function untrackedCommit(dir: string): Promise<string | null> {
  const listed = (await git(dir, ['ls-files', '-o', '--exclude-standard', '-z'])).stdout
  if (listed === '') return null
  const tree = await withTempIndex(dir, async (index) => {
    const env = { GIT_INDEX_FILE: index }
    await git(dir, ['read-tree', '--empty'], { env })
    await git(dir, ['update-index', '--add', '-z', '--stdin'], { env, input: listed })
    return (await git(dir, ['write-tree'], { env })).stdout.trim()
  })
  return commitTree(dir, tree, [], 'untracked')
}

/** Tree of tracked files as they are in the worktree (staged adds included, unstaged edits applied). */
async function worktreeTree(dir: string): Promise<string> {
  const raw = (await git(dir, ['rev-parse', '--git-path', 'index'])).stdout.trim()
  const source = isAbsolute(raw) ? raw : resolve(dir, raw)
  return withTempIndex(dir, async (index) => {
    copyFileSync(source, index)
    const env = { GIT_INDEX_FILE: index }
    await git(dir, ['add', '-u'], { env })
    return (await git(dir, ['write-tree'], { env })).stdout.trim()
  })
}

/**
 * Stash-shaped commit: first parent HEAD, second the index, third untracked files when any exist.
 * `git stash create` ignores `--include-untracked`, so the third parent is built here.
 */
async function snapshotCommit(dir: string): Promise<string> {
  const dirty = (await git(dir, ['status', '--porcelain'])).stdout
  const head = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
  if (dirty === '') return head
  const indexTree = (await git(dir, ['write-tree'])).stdout.trim()
  const indexCommit = await commitTree(dir, indexTree, [head], 'index')
  const untracked = await untrackedCommit(dir)
  const parents = [head, indexCommit, ...(untracked ? [untracked] : [])]
  return commitTree(dir, await worktreeTree(dir), parents, 'wavi-archive')
}

/**
 * Points `refs/wavi/archive/<id>` at a commit that holds staged, unstaged and untracked files.
 * Ignored files stay out. The branch, HEAD and the working tree are left as they were.
 */
export async function captureWorktreeArchive(dir: string, id: string): Promise<ArchiveSnapshot> {
  const ref = refFor(id)
  const commit = await snapshotCommit(dir)
  await git(dir, ['update-ref', ref, commit])
  return { ref, commit }
}

/** Writes the snapshot's untracked files (third parent) without staging them. */
async function restoreUntracked(dir: string, commit: string): Promise<void> {
  const third = await git(dir, ['rev-parse', '--verify', '--quiet', `${commit}^3`]).catch(() => null)
  const tree = third?.stdout.trim()
  if (!tree) return
  await withTempIndex(dir, async (index) => {
    const env = { GIT_INDEX_FILE: index }
    await git(dir, ['read-tree', tree], { env })
    await git(dir, ['checkout-index', '-a', '-f'], { env })
  })
}

/**
 * Puts the worktree back to the snapshot: tracked edits, the index and untracked files.
 * Anything added since (including extra untracked files) is removed. The branch does not move.
 */
export async function restoreWorktreeArchive(dir: string, id: string): Promise<void> {
  const ref = refFor(id)
  const commit = (await git(dir, ['rev-parse', '--verify', ref])).stdout.trim()
  const head = (await git(dir, ['rev-parse', 'HEAD'])).stdout.trim()
  await git(dir, ['reset', '--hard', 'HEAD'])
  await git(dir, ['clean', '-fd'])
  if (commit === head) return
  await git(dir, ['stash', 'apply', '--index', commit])
  await restoreUntracked(dir, commit)
}

/** The snapshot commit, or null when the ref is gone. */
export async function archiveCommit(dir: string, id: string): Promise<string | null> {
  const found = await git(dir, ['rev-parse', '--verify', '--quiet', `${refFor(id)}^{commit}`]).catch(() => null)
  return found?.stdout.trim() || null
}

/** Deletes the private ref once the worktree is back. */
export async function dropWorktreeArchive(dir: string, id: string): Promise<void> {
  await git(dir, ['update-ref', '-d', refFor(id)])
}
