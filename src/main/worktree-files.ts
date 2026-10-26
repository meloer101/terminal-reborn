// The right panel's 文件 view (PRD F17): directory listings, read-only previews, git status and file watching for
// a session's worktree. Every path from the renderer is checked to stay inside the worktree root, symlinks included.
import { execFile } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import { ipcMain, shell, type WebContents } from 'electron'
import { IPC } from '@shared/ipc'
import { isGuarded, protectedInside } from './protected-folders'
import {
  compareEntries,
  looksBinary,
  MAX_DIR_ENTRIES,
  MAX_LISTED_FILES,
  MAX_PREVIEW_BYTES,
  parseGitStatus,
  parseLineMarks,
  type DirEntry,
  type FilePreview,
  type GitStatusSnapshot,
  type LineMarkRange,
  type WorktreeChange
} from '@shared/worktree-files'

const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER = 64 * 1024 * 1024
const WATCH_DEBOUNCE_MS = 250
const MAX_PATH = 4096

/**
 * The renderer's relative path as a normalized POSIX path inside the root ('' = the root), or null when it
 * is not a plain relative path or climbs out of the root.
 */
export function normalizeRelative(path: unknown): string | null {
  if (typeof path !== 'string' || path.length > MAX_PATH || path.includes('\0') || path.startsWith('/')) return null
  const normalized = posix.normalize(path === '' ? '.' : path)
  if (normalized === '.') return ''
  if (normalized === '..' || normalized.startsWith('../')) return null
  return normalized.replace(/\/+$/, '')
}

/** Whether `target` is `root` itself or inside it (both already resolved). */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel.split(sep)[0] !== '..')
}

/** Absolute, existing directory; throws otherwise. Resolves symlinks so containment checks compare real paths. */
export async function resolveRoot(root: unknown): Promise<string> {
  if (typeof root !== 'string' || root.length > MAX_PATH || root.includes('\0') || !isAbsolute(root)) throw new Error('invalid worktree root')
  const real = await realpath(root)
  if (!(await stat(real)).isDirectory()) throw new Error('worktree root is not a directory')
  return real
}

/** Real absolute path of `path` under the root; throws when it does not exist or leaves the root (via `..` or a symlink). */
async function resolveInside(realRoot: string, path: unknown): Promise<{ rel: string; abs: string }> {
  const rel = normalizeRelative(path)
  if (rel === null) throw new Error('invalid path')
  const abs = await realpath(join(realRoot, rel))
  if (!isInside(realRoot, abs)) throw new Error('path outside the worktree')
  return { rel, abs }
}

/** Paths checked per call (the renderer sends one terminal line's candidates). */
const MAX_LINK_PATHS = 64

/**
 * Which of the paths printed in a session's terminal are files inside the worktree (PRD F17): each becomes its
 * relative POSIX path, or null. Relative paths are relative to the root; absolute ones must lie inside it.
 */
export async function resolveFileLinks(root: unknown, paths: unknown, folders?: readonly string[]): Promise<(string | null)[]> {
  if (!Array.isArray(paths) || paths.length > MAX_LINK_PATHS) throw new Error('invalid paths')
  const realRoot = await resolveRoot(root)
  // A root that contains Desktop / Documents / Downloads (the home directory) never looks inside them: checking a
  // printed path there would make macOS ask for access the user never gave.
  const guarded = protectedInside(realRoot, folders)
  return Promise.all(paths.map((path) => resolveFileLink(root as string, realRoot, path, guarded).catch(() => null)))
}

async function resolveFileLink(root: string, realRoot: string, path: unknown, guarded: readonly string[]): Promise<string | null> {
  if (typeof path !== 'string' || path === '' || path.length > MAX_PATH || path.includes('\0')) return null
  let rel = isAbsolute(path) ? null : normalizeRelative(path)
  if (isAbsolute(path)) {
    // As printed when it is under the root as given or as resolved; otherwise (an alias of it) via the real path.
    for (const base of [root, realRoot]) {
      const candidate = relative(base, path)
      if (!isAbsolute(candidate)) rel ??= normalizeRelative(candidate.split(sep).join('/'))
    }
    if (rel === null) {
      const real = await realpath(path)
      if (isInside(realRoot, real)) rel = relative(realRoot, real).split(sep).join('/')
    }
  }
  if (!rel) return null
  if (isGuarded(join(realRoot, rel), guarded)) return null
  const { abs } = await resolveInside(realRoot, rel)
  return (await stat(abs)).isFile() ? rel : null
}

export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        // Never take the index lock: agents run git in the same worktree. Finder launches with a minimal PATH.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', PATH: `${process.env.PATH ?? ''}:/opt/homebrew/bin:/usr/local/bin:/usr/bin` }
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
}

async function listDir(root: unknown, dir: unknown): Promise<DirEntry[]> {
  const realRoot = await resolveRoot(root)
  const { abs } = await resolveInside(realRoot, dir)
  const dirents = await readdir(abs, { withFileTypes: true })
  const entries: DirEntry[] = []
  for (const dirent of dirents) {
    if (dirent.name === '.git') continue
    let isDir = dirent.isDirectory()
    // A symlink counts as a folder only when it points at one inside the worktree.
    if (dirent.isSymbolicLink()) {
      try {
        const target = await realpath(join(abs, dirent.name))
        isDir = isInside(realRoot, target) && (await stat(target)).isDirectory()
      } catch {
        isDir = false
      }
    }
    entries.push({ name: dirent.name, dir: isDir })
    if (entries.length >= MAX_DIR_ENTRIES) break
  }
  return entries.sort(compareEntries)
}

async function readPreview(root: unknown, path: unknown): Promise<FilePreview> {
  const realRoot = await resolveRoot(root)
  let abs: string
  try {
    abs = (await resolveInside(realRoot, path)).abs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw error
  }
  const info = await stat(abs)
  if (!info.isFile()) throw new Error('not a file')
  if (info.size > MAX_PREVIEW_BYTES) return { kind: 'too-large', size: info.size }
  const handle = await open(abs, 'r')
  try {
    const buffer = Buffer.alloc(info.size)
    const { bytesRead } = await handle.read(buffer, 0, info.size, 0)
    const data = buffer.subarray(0, bytesRead)
    if (looksBinary(data)) return { kind: 'binary', size: info.size }
    return { kind: 'text', text: data.toString('utf8'), size: info.size }
  } finally {
    await handle.close()
  }
}

async function gitStatus(root: unknown): Promise<GitStatusSnapshot | null> {
  const realRoot = await resolveRoot(root)
  let prefix: string
  try {
    prefix = (await git(realRoot, ['rev-parse', '--show-prefix'])).trim()
  } catch {
    return null
  }
  const out = await git(realRoot, ['status', '--porcelain=v2', '-z', '--untracked-files=normal', '--ignored=traditional'])
  return parseGitStatus(out, prefix)
}

async function lineMarks(root: unknown, path: unknown): Promise<LineMarkRange[]> {
  const realRoot = await resolveRoot(root)
  const rel = normalizeRelative(path)
  if (!rel) throw new Error('invalid path')
  try {
    return parseLineMarks(await git(realRoot, ['diff', '--no-color', '--no-ext-diff', '-U0', 'HEAD', '--', rel]))
  } catch {
    return [] // not a repo, no commits yet, …
  }
}

/**
 * Not a git checkout: walk the tree, skipping the usual heavy folders, until the cap. A root that is the home
 * directory is walked without Desktop, Documents and Downloads (see protected-folders.ts).
 */
export async function walkFiles(realRoot: string, folders?: readonly string[]): Promise<string[]> {
  const guarded = protectedInside(realRoot, folders)
  const out: string[] = []
  const queue = ['']
  while (queue.length > 0 && out.length < MAX_LISTED_FILES) {
    const dir = queue.shift()!
    let dirents
    try {
      dirents = await readdir(join(realRoot, dir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const rel = dir ? `${dir}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if (dirent.name !== '.git' && dirent.name !== 'node_modules' && !isGuarded(join(realRoot, rel), guarded)) queue.push(rel)
      } else if (dirent.isFile()) out.push(rel)
    }
  }
  return out.slice(0, MAX_LISTED_FILES)
}

async function listFiles(root: unknown): Promise<string[]> {
  const realRoot = await resolveRoot(root)
  try {
    const out = await git(realRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
    return [...new Set(out.split('\0').filter(Boolean))].slice(0, MAX_LISTED_FILES)
  } catch {
    return walkFiles(realRoot)
  }
}

// --- watching -------------------------------------------------------------------------------------------------

/** Folders whose listing a change to `file` affects, and whether it is git's own bookkeeping. */
export function classifyChange(file: string): { dir: string; git: boolean } | null {
  const path = file.split(sep).join('/')
  if (path === '.git' || path.startsWith('.git/')) {
    // index, HEAD and refs move on stage / commit / checkout; objects and logs never change what we show.
    return /^\.git\/(index|HEAD|refs\/)/.test(path) ? { dir: '', git: true } : null
  }
  const slash = path.lastIndexOf('/')
  return { dir: slash < 0 ? '' : path.slice(0, slash), git: false }
}

/**
 * A recursive watch enters every folder below the root, so one on a root that contains Desktop, Documents or
 * Downloads (the home directory) would raise macOS's access prompt for each. Such a root is watched for changes
 * to its own entries only.
 */
export function watchesRecursively(realRoot: string, folders?: readonly string[]): boolean {
  return protectedInside(realRoot, folders).length === 0
}

interface Watch {
  watcher: FSWatcher
  dirs: Set<string>
  git: boolean
  timer: NodeJS.Timeout | null
}

const watches = new Map<WebContents, Map<string, Watch>>()

function stopWatch(sender: WebContents, root: string): void {
  const forSender = watches.get(sender)
  const entry = forSender?.get(root)
  if (!entry) return
  entry.watcher.close()
  if (entry.timer) clearTimeout(entry.timer)
  forSender!.delete(root)
}

async function startWatch(sender: WebContents, root: unknown): Promise<void> {
  if (typeof root !== 'string') return
  const realRoot = await resolveRoot(root)
  let forSender = watches.get(sender)
  if (!forSender) {
    forSender = new Map()
    watches.set(sender, forSender)
    sender.once('destroyed', () => {
      for (const key of [...(watches.get(sender)?.keys() ?? [])]) stopWatch(sender, key)
      watches.delete(sender)
    })
  }
  if (forSender.has(root)) return
  const watcher = watch(realRoot, { recursive: watchesRecursively(realRoot) })
  const entry: Watch = { watcher, dirs: new Set(), git: false, timer: null }
  watcher.on('error', () => stopWatch(sender, root))
  watcher.on('change', (_type, filename) => {
    const change = typeof filename === 'string' ? classifyChange(filename) : null
    if (!change) return
    if (change.git) entry.git = true
    else entry.dirs.add(change.dir)
    entry.timer ??= setTimeout(() => {
      entry.timer = null
      const payload: WorktreeChange = { root, dirs: [...entry.dirs], git: entry.git }
      entry.dirs.clear()
      entry.git = false
      if (!sender.isDestroyed()) sender.send(IPC.worktreeChanged, payload)
    }, WATCH_DEBOUNCE_MS)
  })
  forSender.set(root, entry)
}

export function registerWorktreeFileHandlers(): void {
  ipcMain.handle(IPC.worktreeListDir, (_event, root: unknown, dir: unknown) => listDir(root, dir))
  ipcMain.handle(IPC.worktreeReadFile, (_event, root: unknown, path: unknown) => readPreview(root, path))
  ipcMain.handle(IPC.worktreeGitStatus, (_event, root: unknown) => gitStatus(root))
  ipcMain.handle(IPC.worktreeLineMarks, (_event, root: unknown, path: unknown) => lineMarks(root, path))
  ipcMain.handle(IPC.worktreeListFiles, (_event, root: unknown) => listFiles(root))
  ipcMain.handle(IPC.worktreeResolveLinks, (_event, root: unknown, paths: unknown) => resolveFileLinks(root, paths))
  ipcMain.handle(IPC.worktreeOpen, async (_event, root: unknown, path: unknown) => {
    const { abs } = await resolveInside(await resolveRoot(root), path)
    return shell.openPath(abs)
  })
  ipcMain.on(IPC.worktreeReveal, (_event, root: unknown, path: unknown) => {
    void (async () => {
      const realRoot = await resolveRoot(root)
      const { rel, abs } = await resolveInside(realRoot, path)
      if (rel === '') await shell.openPath(abs)
      else shell.showItemInFolder(abs)
    })().catch(() => {})
  })
  ipcMain.on(IPC.worktreeWatch, (event, root: unknown) => void startWatch(event.sender, root).catch(() => {}))
  ipcMain.on(IPC.worktreeUnwatch, (event, root: unknown) => {
    if (typeof root === 'string') stopWatch(event.sender, root)
  })
}
