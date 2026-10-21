// Conflict radar (ROADMAP 多 agent 第二批; PRD F4 冲突雷达): in the background, for the workspace's active worktrees of
// each repository, `git merge-tree --write-tree` (the merge precheck's in-memory merge) on every pair and against the
// base, so the overview and the Worktree view can say "和 xxx 会冲突" before anyone merges — and, once one worktree
// is merged, which others the base left behind. No tokens, and no working tree, index or ref is written: merges and
// snapshots only add objects (a throwaway index holds uncommitted work).
//
// Cost: a repository is looked at when its refs change (fs.watch on the common dir, debounced), when a session's turn
// ends there (the window's `stamp`), and on window focus (at most every FOCUS_REFRESH_MS). One `git worktree list`
// reads every HEAD; uncommitted work is snapshotted only for worktrees whose HEAD or stamp changed. Merges are cached
// by the two commits, so a commit in one worktree re-runs only its n − 1 pairs and its base check. At most
// GIT_CONCURRENCY git processes at once across repositories. Worktrees without work of their own (nothing ahead of
// the base, nothing uncommitted), the main checkout and archived worktrees (the window does not send them) are skipped.
// git older than 2.38 (no --write-tree) turns the feature off.
import { execFile } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, watch, type FSWatcher } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import { app, ipcMain } from 'electron'
import {
  parseRadarTargets,
  planRadar,
  RADAR_IPC,
  trackBase,
  type BaseTrack,
  type RadarJob,
  type RadarNode,
  type RadarPair,
  type RadarReport,
  type RadarTarget,
  type RadarWorktree
} from '@shared/conflict-radar'
import type { MergeConflict } from '@shared/git-merge'
import { affectsWorktreeList, mainWorktreeIndex, parseBaseConfig, parseWorktreePorcelain, pickMainBranch } from '@shared/git-worktrees'
import { gitAvailable } from './git-graph'
import { isOldGit, mergeTreeConflicts } from './git-merge'
import { isProjectRoot } from './workspace-store'

const GIT_TIMEOUT_MS = 30_000
const MAX_BUFFER = 16 * 1024 * 1024
/** Ref changes come in bursts (a commit, a rebase, a merge with its fast-forward). */
const WATCH_DEBOUNCE_MS = 1500
/** A changed watch list (a turn ended) is folded with whatever else happens in this window. */
const TARGET_DEBOUNCE_MS = 400
/** On focus, repositories whose uncommitted work was snapshotted longer ago than this are snapshotted again. */
const FOCUS_REFRESH_MS = 2 * 60_000
/** git processes the radar runs at once, all repositories together. */
const GIT_CONCURRENCY = 2
/** Untracked files bigger than this, or more of them than this, stay out of the snapshot. */
const MAX_UNTRACKED_BYTES = 1024 * 1024
const MAX_UNTRACKED_FILES = 1000
/** Cached merges kept beyond the ones the latest reports use. */
const MAX_CACHE = 4000
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
/** Snapshot commits: a fixed identity and date, so the same work gives the same commit (and cache key). */
const SNAPSHOT_ENV = {
  GIT_AUTHOR_NAME: 'Wavi',
  GIT_AUTHOR_EMAIL: 'wavi@localhost',
  GIT_COMMITTER_NAME: 'Wavi',
  GIT_COMMITTER_EMAIL: 'wavi@localhost',
  GIT_AUTHOR_DATE: '@0 +0000',
  GIT_COMMITTER_DATE: '@0 +0000'
}

// ── processes ───────────────────────────────────────────────────────────────────────────────────────────────────

let active = 0
const waiting: (() => void)[] = []

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= GIT_CONCURRENCY) await new Promise<void>((go) => waiting.push(go))
  active++
  try {
    return await fn()
  } finally {
    active--
    waiting.shift()?.()
  }
}

function git(cwd: string, args: string[], options: { env?: Record<string, string>; input?: string } = {}): Promise<string> {
  return limited(
    () =>
      new Promise<string>((resolveRun, reject) => {
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
              // Never take the repository's index lock away from an agent (status would refresh the index).
              GIT_OPTIONAL_LOCKS: '0',
              PATH: [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter),
              ...options.env
            }
          },
          (error, stdout, stderr) => {
            if (error) reject(new Error(String(stderr || stdout || error.message).trim().split('\n').slice(-3).join(' ').slice(0, 500)))
            else resolveRun(stdout)
          }
        )
        if (options.input !== undefined) child.stdin?.end(options.input)
      })
  )
}

const orEmpty = (promise: Promise<string>): Promise<string> => promise.catch(() => '')

async function realOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

let support: Promise<boolean> | null = null

/** git is there and has `merge-tree --write-tree` (2.38+). Asked once. */
export function radarSupported(): Promise<boolean> {
  support ??= (async () => {
    if (!(await gitAvailable())) return false
    const match = /git version (\d+)\.(\d+)/.exec(await orEmpty(git(tmpdir(), ['--version'])))
    if (!match) return false
    const [major, minor] = [Number(match[1]), Number(match[2])]
    return major > 2 || (major === 2 && minor >= 38)
  })()
  return support
}

// ── snapshots ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The commit that stands for the worktree's work: HEAD when nothing is uncommitted, else a commit (parent HEAD) of
 * the files as they are — tracked edits, deletions and untracked files up to MAX_UNTRACKED_BYTES — built in a
 * throwaway copy of the index. Neither the worktree nor its index changes.
 */
async function workCommit(dir: string, head: string): Promise<{ commit: string; dirty: boolean }> {
  const status = await git(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  if (status === '') return { commit: head, dirty: false }
  const rawIndex = (await git(dir, ['rev-parse', '--git-path', 'index'])).trim()
  const indexDir = mkdtempSync(join(tmpdir(), 'tr-radar-idx-'))
  try {
    const index = join(indexDir, 'index')
    const env = { GIT_INDEX_FILE: index }
    try {
      copyFileSync(isAbsolute(rawIndex) ? rawIndex : resolve(dir, rawIndex), index)
    } catch {
      await git(dir, ['read-tree', 'HEAD'], { env })
    }
    await git(dir, ['add', '-u'], { env })
    const untracked = await smallUntracked(dir)
    if (untracked.length > 0) await git(dir, ['update-index', '--add', '-z', '--stdin'], { env, input: untracked.map((p) => `${p}\0`).join('') })
    const tree = (await git(dir, ['write-tree'], { env })).trim()
    const headTree = (await git(dir, ['rev-parse', `${head}^{tree}`])).trim()
    if (tree === headTree) return { commit: head, dirty: false }
    const commit = (await git(dir, ['commit-tree', tree, '-p', head, '-m', 'wavi conflict radar snapshot'], { env: SNAPSHOT_ENV })).trim()
    return { commit, dirty: true }
  } finally {
    rmSync(indexDir, { recursive: true, force: true })
  }
}

async function smallUntracked(dir: string): Promise<string[]> {
  const listed = (await git(dir, ['ls-files', '-o', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  if (listed.length > MAX_UNTRACKED_FILES) return []
  const kept: string[] = []
  for (const path of listed) {
    const info = await lstat(join(dir, path)).catch(() => null)
    if (info && (info.isFile() || info.isSymbolicLink()) && info.size <= MAX_UNTRACKED_BYTES) kept.push(path)
  }
  return kept
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A window watching (WebContents in the app; a stub in tests). */
export interface RadarWatcher {
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
}

interface Tracked {
  target: RadarTarget
  /** What the last snapshot was taken at. */
  head: string | null
  stamp: number
  commit: string | null
  dirty: boolean
  /** Snapshot again on the next run (focus, a new target). */
  stale: boolean
  /** Counts of ahead / behind, for this head and base head. */
  counts: { key: string; ahead: number; behind: number } | null
  track: BaseTrack | undefined
}

interface Repo {
  root: string
  worktrees: Map<string, Tracked>
  watcher: FSWatcher | null
  timer: ReturnType<typeof setTimeout> | null
  running: Promise<RadarReport | null> | null
  again: boolean
  report: RadarReport | null
  snapshotAt: number
}

const repos = new Map<string, Repo>()
const watchers = new Map<RadarWatcher, RadarTarget[]>()
/** Merge results by pairKey of the two commits; null = git could not tell (no common history, an error). */
const cache = new Map<string, { tree: string; conflicts: MergeConflict[] } | null>()
let mergesRun = 0

/** How many merge-tree runs the radar made (tests: the cache works). */
export function radarMerges(): number {
  return mergesRun
}

function broadcast(report: RadarReport): void {
  for (const [watcher, list] of watchers) {
    if (list.some((t) => t.root === report.root) && !watcher.isDestroyed()) watcher.send(RADAR_IPC.report, report)
  }
}

function schedule(repo: Repo, delay: number): void {
  if (repo.timer) clearTimeout(repo.timer)
  repo.timer = setTimeout(() => {
    repo.timer = null
    void checkRepo(repo.root)
  }, delay)
  repo.timer.unref?.()
}

async function startWatch(repo: Repo): Promise<void> {
  try {
    const real = await realOrSelf(repo.root)
    const commonDir = resolve(real, (await git(real, ['rev-parse', '--git-common-dir'])).trim())
    if (repos.get(repo.root) !== repo || repo.watcher) return
    const watcher = watch(commonDir, { recursive: true })
    watcher.on('error', () => {
      watcher.close()
      if (repo.watcher === watcher) repo.watcher = null
    })
    watcher.on('change', (_type, filename) => {
      if (typeof filename !== 'string' || !affectsWorktreeList(relative(commonDir, join(commonDir, filename)))) return
      schedule(repo, WATCH_DEBOUNCE_MS)
    })
    repo.watcher = watcher
  } catch {
    // Not a git repository (yet): the next watch list tries again.
  }
}

function dropRepo(repo: Repo): void {
  if (repo.timer) clearTimeout(repo.timer)
  repo.watcher?.close()
  repos.delete(repo.root)
}

/** The worktrees `watcher` shows (replacing its earlier list). New repositories are checked soon, a little apart. */
export function watchTargets(watcher: RadarWatcher, raw: unknown): void {
  const targets = parseRadarTargets(raw)
  if (!targets) return
  watchers.set(
    watcher,
    targets.filter((t) => isProjectRoot(t.root))
  )
  sync()
}

export function unwatch(watcher: RadarWatcher): void {
  watchers.delete(watcher)
  sync()
}

/** Repositories and worktrees = what any window watches (several windows may show the same repository). */
function sync(): void {
  const wanted = new Map<string, Map<string, RadarTarget>>()
  for (const list of watchers.values()) {
    for (const target of list) {
      const forRoot = wanted.get(target.root) ?? new Map<string, RadarTarget>()
      const known = forRoot.get(target.worktree)
      forRoot.set(target.worktree, known && known.stamp > target.stamp ? known : target)
      wanted.set(target.root, forRoot)
    }
  }
  let fresh = 0
  for (const [root, list] of wanted) {
    let repo = repos.get(root)
    if (!repo) {
      repo = { root, worktrees: new Map(), watcher: null, timer: null, running: null, again: false, report: null, snapshotAt: 0 }
      repos.set(root, repo)
      void startWatch(repo)
      schedule(repo, 500 * fresh++)
    }
    let changed = false
    for (const target of list.values()) {
      const known = repo.worktrees.get(target.worktree)
      if (!known) {
        repo.worktrees.set(target.worktree, { target, head: null, stamp: target.stamp, commit: null, dirty: false, stale: true, counts: null, track: undefined })
        changed = true
      } else if (known.target.stamp !== target.stamp || known.target.root !== target.root) {
        known.target = target
        known.stale = true
        changed = true
      }
    }
    for (const worktree of [...repo.worktrees.keys()]) {
      if (!list.has(worktree)) {
        repo.worktrees.delete(worktree)
        changed = true
      }
    }
    if (changed && (repo.report || repo.running)) schedule(repo, TARGET_DEBOUNCE_MS)
  }
  for (const repo of [...repos.values()]) if (!wanted.has(repo.root)) dropRepo(repo)
}

export function reportsFor(watcher: RadarWatcher): RadarReport[] {
  const roots = new Set((watchers.get(watcher) ?? []).map((t) => t.root))
  return [...roots].map((root) => repos.get(root)?.report).filter((r): r is RadarReport => Boolean(r))
}

/** Checks a repository now (one run at a time; a request meanwhile runs once more after it) and reports. */
export function checkRepo(root: string): Promise<RadarReport | null> {
  const repo = repos.get(root)
  if (!repo) return Promise.resolve(null)
  if (repo.running) {
    repo.again = true
    return repo.running
  }
  if (repo.timer) {
    clearTimeout(repo.timer)
    repo.timer = null
  }
  repo.running = (async () => {
    let report: RadarReport | null
    do {
      repo.again = false
      report = await checkOnce(repo).catch(() => repo.report)
    } while (repo.again && repos.get(root) === repo)
    return report
  })().finally(() => {
    repo.running = null
  })
  return repo.running
}

function sameReport(a: RadarReport | null, b: RadarReport): boolean {
  return a !== null && JSON.stringify({ ...a, checkedAt: 0 }) === JSON.stringify({ ...b, checkedAt: 0 })
}

function publish(repo: Repo, report: RadarReport): RadarReport {
  const previous = repo.report
  repo.report = report
  if (!sameReport(previous, report)) broadcast(report)
  return report
}

async function checkOnce(repo: Repo): Promise<RadarReport | null> {
  const empty = (state: RadarReport['state']): RadarReport => ({ root: repo.root, state, worktrees: [], pairs: [], checkedAt: Date.now() })
  if (!(await radarSupported())) return publish(repo, empty('unsupported'))
  if (!isProjectRoot(repo.root)) return publish(repo, empty('ok'))
  const realRoot = await realOrSelf(repo.root)

  const [listing, heads, originHead, baseConfig] = await Promise.all([
    orEmpty(git(realRoot, ['worktree', 'list', '--porcelain'])),
    orEmpty(git(realRoot, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/heads'])),
    orEmpty(git(realRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])),
    orEmpty(git(realRoot, ['config', '--get-regexp', '^branch\\..*\\.base$']))
  ])
  const entries = parseWorktreePorcelain(listing)
  if (entries.length === 0) return publish(repo, empty('ok'))
  const branchHeads = new Map<string, string>()
  for (const line of heads.split('\n')) {
    const [name, sha] = line.split('\0')
    if (name && sha) branchHeads.set(name, sha)
  }
  const mainIndex = mainWorktreeIndex(entries)
  const mainBranch = pickMainBranch([...branchHeads.keys()], originHead.trim() || null, mainIndex === null ? null : entries[mainIndex]!.branch)
  const bases = parseBaseConfig(baseConfig)
  const reals = await Promise.all(entries.map((e) => realOrSelf(e.path)))

  const nodes: (RadarNode & { tracked: Tracked; branch: string; base: string })[] = []
  let snapshotted = false
  for (const tracked of repo.worktrees.values()) {
    const wanted = await realOrSelf(tracked.target.worktree)
    const index = reals.findIndex((real, i) => !entries[i]!.bare && (real === wanted || entries[i]!.path === tracked.target.worktree))
    if (index < 0 || index === mainIndex) continue
    const entry = entries[index]!
    const branch = entry.branch
    const head = entry.head
    if (!branch || !head || entry.prunable !== null) continue
    const base = bases[branch] ?? mainBranch
    const baseHead = base ? branchHeads.get(base) : undefined
    if (!base || !baseHead || base === branch) continue

    if (tracked.stale || tracked.head !== head || tracked.stamp !== tracked.target.stamp || !tracked.commit) {
      try {
        const work = await workCommit(reals[index]!, head)
        tracked.commit = work.commit
        tracked.dirty = work.dirty
      } catch {
        tracked.commit = head
        tracked.dirty = false
      }
      tracked.head = head
      tracked.stamp = tracked.target.stamp
      tracked.stale = false
      snapshotted = true
    }
    const countsKey = `${baseHead}:${head}`
    if (tracked.counts?.key !== countsKey) {
      const counts = (await orEmpty(git(realRoot, ['rev-list', '--left-right', '--count', `${baseHead}...${head}`]))).trim().split(/\s+/)
      tracked.counts = { key: countsKey, behind: Number(counts[0]) || 0, ahead: Number(counts[1]) || 0 }
    }
    tracked.track = trackBase(tracked.track, baseHead, tracked.counts.behind)
    if (tracked.counts.ahead === 0 && !tracked.dirty) continue
    nodes.push({ worktree: tracked.target.worktree, commit: tracked.commit!, baseHead, tracked, branch, base })
  }
  if (snapshotted) repo.snapshotAt = Date.now()

  const commitOf = new Map(nodes.map((n) => [n.worktree, n]))
  let oldGit = false
  const runJobs = (list: readonly RadarJob[]): Promise<void[]> =>
    Promise.all(
      list.map(async (job) => {
        const [ours, theirs] = jobCommits(job, commitOf)
        try {
          mergesRun++
          cache.set(job.key, await mergeTreeConflicts(realRoot, ours, theirs))
        } catch (error) {
          if (isOldGit(error instanceof Error ? error.message : String(error))) oldGit = true
          cache.set(job.key, null)
        }
      })
    )

  // Against the base first: work that is already in the base (a squash-merged branch, a cherry-picked fix) merges
  // to the base's own tree and drops out — it would otherwise show as "behind" and pair with everything.
  const first = planRadar(nodes, (key) => cache.has(key))
  await runJobs(first.missing.filter((job) => job.kind === 'base'))
  if (oldGit) {
    support = Promise.resolve(false)
    return publish(repo, empty('unsupported'))
  }
  const baseTrees = new Map<string, string>()
  for (const baseHead of new Set(nodes.map((n) => n.baseHead))) baseTrees.set(baseHead, (await orEmpty(git(realRoot, ['rev-parse', `${baseHead}^{tree}`]))).trim())
  const baseResult = (node: RadarNode) => cache.get(first.jobs.find((j) => j.kind === 'base' && j.worktree === node.worktree)!.key)
  const working = nodes.filter((node) => {
    const merged = baseResult(node)
    return !merged || merged.conflicts.length > 0 || merged.tree !== baseTrees.get(node.baseHead)
  })

  const { jobs, missing } = planRadar(working, (key) => cache.has(key))
  await runJobs(missing)
  if (oldGit) {
    support = Promise.resolve(false)
    return publish(repo, empty('unsupported'))
  }
  trimCache()

  const worktrees: RadarWorktree[] = working.map((node) => ({
    worktree: node.worktree,
    branch: node.branch,
    base: node.base,
    ahead: node.tracked.counts!.ahead,
    behind: node.tracked.counts!.behind,
    uncommitted: node.tracked.dirty,
    baseConflicts: baseResult(node)?.conflicts ?? [],
    baseMoved: node.tracked.track?.moved ?? false
  }))
  const pairs: RadarPair[] = []
  for (const job of jobs) {
    if (job.kind !== 'pair') continue
    const conflicts = cache.get(job.key)?.conflicts
    if (conflicts && conflicts.length > 0) pairs.push({ a: job.a, b: job.b, conflicts })
  }
  return publish(repo, { root: repo.root, state: 'ok', worktrees, pairs, checkedAt: Date.now() })
}

function jobCommits(job: RadarJob, nodes: Map<string, RadarNode>): [string, string] {
  if (job.kind === 'base') {
    const node = nodes.get(job.worktree)!
    return [node.baseHead, node.commit]
  }
  return [nodes.get(job.a)!.commit, nodes.get(job.b)!.commit]
}

/** Keeps the cache bounded; oldest entries go first (Map keeps insertion order). */
function trimCache(): void {
  const excess = cache.size - MAX_CACHE
  if (excess <= 0) return
  let n = 0
  for (const key of cache.keys()) {
    if (n++ >= excess) break
    cache.delete(key)
  }
}

function onFocus(): void {
  let n = 0
  for (const repo of repos.values()) {
    if (repo.running || Date.now() - repo.snapshotAt < FOCUS_REFRESH_MS) continue
    for (const tracked of repo.worktrees.values()) tracked.stale = true
    schedule(repo, 300 * n++)
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const hooked = new WeakSet<object>()

export function registerConflictRadarHandlers(): void {
  ipcMain.on(RADAR_IPC.watch, (event, raw: unknown) => {
    const sender = event.sender
    if (!hooked.has(sender)) {
      hooked.add(sender)
      sender.once('destroyed', () => unwatch(sender))
    }
    watchTargets(sender, raw)
  })
  ipcMain.handle(RADAR_IPC.reports, (event) => reportsFor(event.sender))
  app.on('browser-window-focus', onFocus)
  app.on('before-quit', () => {
    for (const repo of [...repos.values()]) dropRepo(repo)
  })
}
