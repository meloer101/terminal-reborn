// PR / CI status and 创建 PR (PRD F16) with the user's own `gh` login: Wavi stores no token, and gh runs only here.
// gh is found on the login shell's PATH (as the agents are) and checked with `gh auth status`, again whenever it was
// not ready. A watched worktree whose branch has an upstream gets `gh pr list --head <branch>` now and then — sooner
// while checks run, rarely otherwise, backing off after errors and pausing every call on a rate limit. Branches
// without an upstream cost one local git call and never reach gh.
// 创建 PR pushes the branch (asking in a native sheet first when it was never pushed) and runs `gh pr create`.
// 让 agent 修复 reads the failing jobs' `gh run view --log-failed`. Everything from the renderer is validated: project
// roots must be the workspace's, worktrees theirs, and no value reaches git or gh where it could be read as an option.
// v1.63 adds the writes (PRD F16 · L2): merging the PR (pinned to the head Wavi checked, GitHub auto-merge or Wavi's own
// wait), resolving threads and posting Wavi's review. Each runs only on a button the user clicked; several at once ask.
import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { app, BrowserWindow, ipcMain } from 'electron'
import { hostWindowFor } from './app-windows'
import { mainWorktreeIndex, parseBaseConfig, parseWorktreePorcelain, pickMainBranch } from '@shared/git-worktrees'
import {
  cleanFailedLog,
  ghResolvedRemote,
  isRateLimited,
  isSignedOut,
  nextPollDelay,
  parseCreatedUrl,
  parsePrCreateRequest,
  parsePrDetails,
  parsePrMergeRequest,
  parsePrPostReviewRequest,
  parsePrResolveRequest,
  parsePrTarget,
  PR_TEMPLATE_PATHS,
  mergeArgs,
  mergeBlockers,
  readyToMerge,
  ADD_REVIEW_MUTATION,
  REPLY_THREAD_MUTATION,
  RESOLVE_THREAD_MUTATION,
  reviewBody,
  reviewBodyWithFindings,
  reviewThreadsInput,
  parsePrTargets,
  pickPullRequest,
  prBody,
  prTitle,
  PR_DETAILS_QUERY,
  PR_IPC,
  PR_JSON_FIELDS,
  PR_POLL,
  repoArg,
  repoFromRemoteUrl,
  samePullRequest,
  type CiFailure,
  type GhState,
  type GitHubRepo,
  type PrCreateResult,
  type PrDetails,
  type PrDraft,
  type PrMergeRequest,
  type PrWriteResult,
  type PrStatus,
  type PrTarget,
  type PullRequestInfo
} from '@shared/pull-requests'
import { buildPtyEnv } from '../pty-host/env'
import { executableOnPath, userLoginPath } from './agents-installed'
import { confirm } from './confirm'
import { sshCommandFor } from './git-graph'
import { isProjectRoot } from './workspace-store'

const GIT_TIMEOUT_MS = 15_000
const GH_TIMEOUT_MS = 30_000
const PUSH_TIMEOUT_MS = 120_000
const MAX_STDOUT = 8 * 1024 * 1024
const MAX_STDERR = 8 * 1024
/** Of `gh run view --log-failed`, only the end is kept (the failure is at the bottom). */
const LOG_TAIL_CHARS = 256 * 1024
const LOGS_PER_FAILURE = 2
/** A gh that was missing or signed out is looked at again after this long (when asked, or on focus). */
const GH_RECHECK_MS = 60_000
/** Explicit refreshes (Git · 变更 opened) closer together than this reuse the last answer. */
const REFRESH_MIN_MS = 10_000
/** On window focus, worktrees not checked for this long are checked again. */
const FOCUS_REFRESH_MS = 60_000
/** gh processes at once. */
const GH_CONCURRENCY = 2
/** Finder launches apps with a minimal PATH; these are where Homebrew usually puts gh. */
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

// ── processes ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Ran {
  code: number
  stdout: string
  stderr: string
}

/** Runs a program; never rejects (a spawn error is code -1). `tail` keeps only the end of stdout. */
function runProcess(bin: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; tail?: number; input?: string }): Promise<Ran> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let overflow = false
    let settled = false
    const out = new StringDecoder('utf8')
    const err = new StringDecoder('utf8')
    const child = spawn(bin, args, { cwd: options.cwd, env: options.env, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    if (options.input !== undefined) {
      child.stdin?.on('error', () => {})
      child.stdin?.end(options.input)
    }
    const timer = setTimeout(() => {
      stderr += `\n超过 ${Math.round(options.timeout / 1000)} 秒没有结束，已停止`
      child.kill('SIGTERM')
    }, options.timeout)
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stdout += out.end()
      resolve({ code: overflow ? -1 : code, stdout, stderr: (stderr + err.end()).slice(-MAX_STDERR) })
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += out.write(chunk)
      if (options.tail !== undefined) {
        if (stdout.length > options.tail * 2) stdout = stdout.slice(-options.tail)
      } else if (stdout.length > MAX_STDOUT) {
        overflow = true
        child.kill('SIGTERM')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + err.write(chunk)).slice(-MAX_STDERR)
    })
    child.once('error', (error) => {
      stderr += error.message
      finish(-1)
    })
    child.once('close', (code) => finish(code ?? -1))
  })
}

const lastLines = (text: string): string => text.trim().split('\n').slice(-3).join(' ').slice(0, 500)

function gitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    PATH: [...(process.env.PATH ?? '').split(delimiter).filter(Boolean), ...EXTRA_PATH].join(delimiter),
    ...extra
  }
}

async function git(cwd: string, args: string[], options: { timeout?: number; env?: Record<string, string> } = {}): Promise<Ran> {
  return runProcess('git', args, { cwd, env: gitEnv(options.env), timeout: options.timeout ?? GIT_TIMEOUT_MS })
}

/** stdout of a git command, '' when it failed. */
async function gitOut(cwd: string, args: string[]): Promise<string> {
  const ran = await git(cwd, args)
  return ran.code === 0 ? ran.stdout : ''
}

async function searchPath(): Promise<string> {
  const login = await userLoginPath()
  return [...(login ?? process.env.PATH ?? '').split(delimiter), ...EXTRA_PATH].filter(Boolean).join(delimiter)
}

async function ghEnv(): Promise<Record<string, string>> {
  return buildPtyEnv(process.env, {
    PATH: await searchPath(),
    // Never a prompt, a pager, a spinner, colors or an update check: gh answers and exits.
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    GH_SPINNER_DISABLED: '1',
    GH_PAGER: 'cat',
    NO_COLOR: '1',
    CLICOLOR: '0',
    GIT_TERMINAL_PROMPT: '0'
  })
}

let ghSlots = GH_CONCURRENCY
const ghQueue: (() => void)[] = []

async function gh(args: string[], options: { cwd?: string; tail?: number; timeout?: number; input?: string } = {}): Promise<Ran> {
  const bin = ghBin
  if (!bin) return { code: -1, stdout: '', stderr: 'gh not found' }
  if (ghSlots === 0) await new Promise<void>((resolve) => ghQueue.push(resolve))
  else ghSlots--
  try {
    return await runProcess(bin, args, { cwd: options.cwd ?? homedir(), env: await ghEnv(), timeout: options.timeout ?? GH_TIMEOUT_MS, tail: options.tail, input: options.input })
  } finally {
    const next = ghQueue.shift()
    if (next) next()
    else ghSlots++
  }
}

// ── is gh usable ────────────────────────────────────────────────────────────────────────────────────────────────

let ghState: GhState = 'checking'
let ghBin: string | null = null
let ghCheckedAt = 0
let ghProbe: Promise<GhState> | null = null

function broadcastGh(state: GhState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(PR_IPC.ghChanged, state)
  }
}

/**
 * Whether gh is installed and logged in. A ready gh is not asked again unless `force`; a missing or signed-out one
 * at most once per GH_RECHECK_MS. `TR_GH=off` (e2e) behaves as if gh were not installed.
 */
export function detectGh(force = false): Promise<GhState> {
  if (ghProbe) return ghProbe
  if (!force && (ghState === 'ready' || (ghState !== 'checking' && Date.now() - ghCheckedAt < GH_RECHECK_MS))) return Promise.resolve(ghState)
  ghProbe = (async () => {
    let next: GhState
    if (process.env.TR_GH === 'off') {
      ghBin = null
      next = 'missing'
    } else {
      ghBin = executableOnPath(await searchPath(), 'gh')
      if (!ghBin) next = 'missing'
      else {
        // `--active` (gh ≥ 2.40) ignores other accounts' trouble; an older gh rejects the flag, which reads as ready.
        const ran = await gh(['auth', 'status', '--active'], { timeout: 15_000 })
        next = ran.code !== 0 && isSignedOut(`${ran.stdout}\n${ran.stderr}`) ? 'signed-out' : 'ready'
      }
    }
    ghCheckedAt = Date.now()
    const changed = next !== ghState
    ghState = next
    if (changed) broadcastGh(next)
    return next
  })().finally(() => {
    ghProbe = null
  })
  return ghProbe
}

// ── a worktree's branch ─────────────────────────────────────────────────────────────────────────────────────────

interface BranchInfo {
  /** The worktree's real path. */
  cwd: string
  branch: string | null
  /** The branch it is proposed into: `branch.<name>.base`, else the project's main branch. */
  base: string | null
  /** The upstream's remote and branch on it (`refs/heads/…`); null without an upstream. */
  remote: string | null
  remoteRef: string | null
}

async function realOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

/** The worktree's branch facts, or null when `worktree` is not a worktree of the project at `root`. */
async function branchInfo(target: PrTarget): Promise<BranchInfo | null> {
  if (!isProjectRoot(target.root)) return null
  const root = await realOrSelf(target.root)
  const listing = await git(root, ['worktree', 'list', '--porcelain'])
  if (listing.code !== 0) return null
  const entries = parseWorktreePorcelain(listing.stdout)
  const wanted = await realOrSelf(target.worktree)
  const reals = await Promise.all(entries.map((e) => realOrSelf(e.path)))
  const index = reals.findIndex((real, i) => !entries[i]!.bare && (real === wanted || entries[i]!.path === target.worktree))
  if (index < 0) return null
  const entry = entries[index]!
  const cwd = reals[index]!
  if (!entry.branch) return { cwd, branch: null, base: null, remote: null, remoteRef: null }
  const branch = entry.branch
  const [heads, originHead, baseConfig, upstream] = await Promise.all([
    gitOut(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    gitOut(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']),
    gitOut(root, ['config', '--get-regexp', '^branch\\..*\\.base$']),
    gitOut(root, ['for-each-ref', '--format=%(upstream:remotename)%00%(upstream:remoteref)', `refs/heads/${branch}`])
  ])
  const mainIndex = mainWorktreeIndex(entries)
  const main = pickMainBranch(heads.split('\n').filter(Boolean), originHead.trim() || null, mainIndex === null ? null : entries[mainIndex]!.branch)
  const base = parseBaseConfig(baseConfig)[branch] ?? main
  const [remote, remoteRef] = upstream.trim().split('\0')
  const tracked = remote && remoteRef?.startsWith('refs/heads/') ? { remote, remoteRef } : null
  return { cwd, branch, base, remote: tracked?.remote ?? null, remoteRef: tracked?.remoteRef ?? null }
}

/** Where the PR lives (gh's set-default remote, else the branch's remote) and, in a fork workflow, the head's owner. */
async function prRepoFor(cwd: string, remote: string): Promise<{ repo: GitHubRepo; headOwner: string | null } | null> {
  const [url, resolved] = await Promise.all([gitOut(cwd, ['remote', 'get-url', '--', remote]), gitOut(cwd, ['config', '--get-regexp', '^remote\\..*\\.gh-resolved$'])])
  const head = repoFromRemoteUrl(url.trim())
  if (!head) return null
  const baseRemote = ghResolvedRemote(resolved)
  const repo = baseRemote && baseRemote !== remote ? repoFromRemoteUrl((await gitOut(cwd, ['remote', 'get-url', '--', baseRemote])).trim()) : head
  if (!repo) return null
  const same = repo.host === head.host && repo.owner.toLowerCase() === head.owner.toLowerCase() && repo.name.toLowerCase() === head.name.toLowerCase()
  return { repo, headOwner: same ? null : head.owner }
}

/** `gh pr list --head`: the branch's PR (null when it has none), or an error message. */
async function listPr(repo: GitHubRepo, headOwner: string | null, headBranch: string): Promise<{ pr: PullRequestInfo | null } | { error: string }> {
  const ran = await gh(['pr', 'list', `--repo=${repoArg(repo)}`, `--head=${headBranch}`, '--state=all', '--limit=10', `--json=${PR_JSON_FIELDS}`])
  if (ran.code !== 0) return { error: lastLines(ran.stderr || ran.stdout) || `gh exited with ${ran.code}` }
  try {
    return { pr: pickPullRequest(JSON.parse(ran.stdout) as unknown, headOwner) }
  } catch {
    return { error: 'gh printed no JSON' }
  }
}

/** Review threads, merge state and the repository's merge options of an open PR (PRD F16 v1.63); null when gh failed. */
async function prDetails(repo: GitHubRepo, number: number): Promise<{ details: PrDetails | null } | { error: string }> {
  const ran = await gh([
    'api',
    'graphql',
    `--hostname=${repo.host}`,
    '-f',
    `query=${PR_DETAILS_QUERY}`,
    '-f',
    `owner=${repo.owner}`,
    '-f',
    `name=${repo.name}`,
    '-F',
    `number=${number}`
  ])
  if (ran.code !== 0) return { error: lastLines(ran.stderr || ran.stdout) || `gh exited with ${ran.code}` }
  try {
    return { details: parsePrDetails(JSON.parse(ran.stdout) as unknown) }
  } catch {
    return { error: 'gh printed no JSON' }
  }
}

// ── watching ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A window watching worktrees (WebContents in the app; a stub in tests). */
export interface PrWatcher {
  send(channel: string, payload: unknown): void
  isDestroyed(): boolean
}

interface Entry {
  target: PrTarget
  status: PrStatus | null
  failures: number
  timer: ReturnType<typeof setTimeout> | null
  inFlight: Promise<PrStatus | null> | null
  lastCheck: number
  /** From the last check that reached gh: where `failure()` reads logs. */
  repo: GitHubRepo | null
  /** 检查通过后由 Wavi 合并 (auto-merge off in the repository): merged by the first check that finds it ready. */
  waiting: { method: PrMergeRequest['method']; headOid: string } | null
}

const entries = new Map<string, Entry>()
const watchers = new Map<PrWatcher, Set<string>>()
/** Every gh call waits until then (GitHub said "rate limit"). */
let pausedUntil = 0

function focused(): boolean {
  return BrowserWindow.getFocusedWindow() !== null
}

function broadcast(status: PrStatus): void {
  for (const [watcher, worktrees] of watchers) {
    if (worktrees.has(status.worktree) && !watcher.isDestroyed()) watcher.send(PR_IPC.status, status)
  }
}

function schedule(entry: Entry, delay?: number): void {
  if (entry.timer) clearTimeout(entry.timer)
  const wait = delay ?? Math.max(nextPollDelay({ pr: entry.status?.pr ?? null, focused: focused(), failures: entry.failures }), pausedUntil - Date.now())
  entry.timer = setTimeout(() => {
    entry.timer = null
    void checkEntry(entry)
  }, wait)
  entry.timer.unref?.()
}

function setStatus(entry: Entry, branch: string | null, pr: PullRequestInfo | null, local?: PrStatus['local']): PrStatus {
  const previous = entry.status
  const status: PrStatus = {
    worktree: entry.target.worktree,
    branch,
    pr,
    checkedAt: Date.now(),
    ...(local ? { local } : {}),
    ...(entry.waiting ? { waiting: entry.waiting.method } : {})
  }
  entry.status = status
  const sameExtras = JSON.stringify([previous?.local, previous?.waiting]) === JSON.stringify([status.local, status.waiting])
  if (!previous || previous.branch !== branch || !samePullRequest(previous.pr, pr) || !sameExtras) broadcast(status)
  return status
}

/** The status again after `waiting` changed (nothing else did). */
function rebroadcast(entry: Entry): void {
  if (!entry.status) return
  const { waiting: _old, ...rest } = entry.status
  entry.status = { ...rest, checkedAt: Date.now(), ...(entry.waiting ? { waiting: entry.waiting.method } : {}) }
  broadcast(entry.status)
}

async function checkOnce(entry: Entry): Promise<PrStatus | null> {
  if ((await detectGh()) !== 'ready' || Date.now() < pausedUntil) return entry.status
  const info = await branchInfo(entry.target)
  if (!info) return setStatus(entry, null, null)
  // The base branch itself (the main checkout) does not get PRs; a branch nobody pushed has none on GitHub.
  if (!info.branch || !info.remote || !info.remoteRef || info.branch === info.base) {
    entry.failures = 0
    return setStatus(entry, info.branch, null)
  }
  const where = await prRepoFor(info.cwd, info.remote)
  if (!where) {
    entry.failures = 0
    return setStatus(entry, info.branch, null)
  }
  entry.repo = where.repo
  const found = await listPr(where.repo, where.headOwner, info.remoteRef.slice('refs/heads/'.length))
  if ('error' in found) {
    entry.failures++
    if (isRateLimited(found.error)) pausedUntil = Date.now() + PR_POLL.rateLimitMs
    if (isSignedOut(found.error)) void detectGh(true)
    return entry.status
  }
  entry.failures = 0
  let pr = found.pr
  if (pr && (pr.state === 'open' || pr.state === 'draft')) {
    const more = await prDetails(where.repo, pr.number)
    if ('details' in more && more.details) pr = { ...pr, details: more.details }
    else {
      // Keep what the last check knew about the same PR rather than flashing its threads away.
      const known = entry.status?.pr
      if (known?.number === pr.number && known.details) pr = { ...pr, details: known.details }
      if ('error' in more && isRateLimited(more.error)) pausedUntil = Date.now() + PR_POLL.rateLimitMs
    }
  }
  let local: PrStatus['local']
  if (pr?.details) {
    const head = (await gitOut(info.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`])).trim()
    if (head) local = { head, remoteAhead: pr.details.headOid !== head && !(await localHas(info.cwd, pr.details.headOid, info.branch)) }
  }
  const status = setStatus(entry, info.branch, pr, local)
  if (entry.waiting) void mergeWhenReady(entry)
  return status
}

/** Checks one worktree now (one check per worktree at a time) and schedules the next. */
function checkEntry(entry: Entry): Promise<PrStatus | null> {
  if (entry.inFlight) return entry.inFlight
  if (entry.timer) {
    clearTimeout(entry.timer)
    entry.timer = null
  }
  entry.inFlight = checkOnce(entry)
    .catch(() => {
      entry.failures++
      return entry.status
    })
    .finally(() => {
      entry.inFlight = null
      entry.lastCheck = Date.now()
      if (entries.get(entry.target.worktree) === entry) schedule(entry)
    })
  return entry.inFlight
}

function prune(): void {
  const wanted = new Set<string>()
  for (const set of watchers.values()) for (const worktree of set) wanted.add(worktree)
  for (const [worktree, entry] of entries) {
    if (wanted.has(worktree)) continue
    if (entry.timer) clearTimeout(entry.timer)
    entries.delete(worktree)
  }
}

/** The worktrees `watcher` shows (replacing its earlier list). New ones are checked soon, a little apart. */
export function watchTargets(watcher: PrWatcher, raw: unknown): void {
  const targets = parsePrTargets(raw)
  if (!targets) return
  const mine = new Set<string>()
  let fresh = 0
  for (const target of targets) {
    if (!isProjectRoot(target.root)) continue
    mine.add(target.worktree)
    const known = entries.get(target.worktree)
    if (known) {
      if (known.target.root !== target.root) known.target = target
      continue
    }
    const entry: Entry = { target, status: null, failures: 0, timer: null, inFlight: null, lastCheck: 0, repo: null, waiting: null }
    entries.set(target.worktree, entry)
    schedule(entry, 300 * fresh++)
  }
  watchers.set(watcher, mine)
  prune()
}

export function unwatch(watcher: PrWatcher): void {
  watchers.delete(watcher)
  prune()
}

/** Ask about a watched worktree now, unless it was asked a moment ago or GitHub asked us to wait. */
export function refreshWorktree(worktree: unknown): void {
  if (typeof worktree !== 'string') return
  const entry = entries.get(worktree)
  if (!entry || entry.inFlight || Date.now() < pausedUntil || Date.now() - entry.lastCheck < REFRESH_MIN_MS) return
  void checkEntry(entry)
}

export function statusesFor(watcher: PrWatcher): PrStatus[] {
  const mine = watchers.get(watcher)
  if (!mine) return []
  return [...mine].map((worktree) => entries.get(worktree)?.status).filter((s): s is PrStatus => Boolean(s))
}

/** Checks a watched worktree and waits for the answer (tests; 让 agent 修复 asks for fresh checks). */
export function checkWorktree(worktree: string): Promise<PrStatus | null> {
  const entry = entries.get(worktree)
  return entry ? checkEntry(entry) : Promise.resolve(null)
}

function onFocus(): void {
  void detectGh().then((state) => {
    if (state !== 'ready') return
    let n = 0
    for (const entry of entries.values()) {
      if (entry.failures > 0 || entry.inFlight || Date.now() - entry.lastCheck < FOCUS_REFRESH_MS) continue
      schedule(entry, 300 * n++)
    }
  })
}

// ── 创建 PR ─────────────────────────────────────────────────────────────────────────────────────────────────────

const creating = new Set<string>()

const blocked = (message: string): PrCreateResult => ({ ok: false, reason: 'blocked', message })

async function pushEnv(cwd: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  const ssh = sshCommandFor(process.env, (await gitOut(cwd, ['config', '--get', 'core.sshCommand'])).trim())
  if (ssh) env.GIT_SSH_COMMAND = ssh
  return env
}

async function countCommits(cwd: string, range: string): Promise<number | null> {
  const ran = await git(cwd, ['rev-list', '--count', range, '--'])
  return ran.code === 0 ? Number(ran.stdout.trim()) || 0 : null
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  return (await git(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`])).code === 0
}

/**
 * Pushes the worktree's branch — after the user says yes in a native sheet when it has no upstream yet — and opens a
 * PR into its base with the session title and the commit subjects. An open PR the branch already has is returned.
 */
export async function createPullRequest(raw: unknown, parent?: BrowserWindow | null): Promise<PrCreateResult> {
  const request = parsePrCreateRequest(raw)
  if (!request || !isProjectRoot(request.root)) return blocked('请求无效')
  const state = await detectGh(true)
  if (state === 'missing') return blocked('没有找到 gh：装好 GitHub CLI 并运行 gh auth login')
  if (state !== 'ready') return blocked('gh 还没有登录：在终端运行 gh auth login')
  if (creating.has(request.worktree)) return blocked('正在创建 PR')
  creating.add(request.worktree)
  try {
    const info = await branchInfo(request)
    if (!info) return blocked('不是这个项目的 worktree')
    const { cwd, branch, base } = info
    if (!branch) return blocked('处于分离 HEAD，没有分支可以提 PR')
    if (!base || base === branch) return blocked('这是基线分支本身，没有可以提 PR 的改动')
    const remotes = (await gitOut(cwd, ['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
    const remote = info.remote ?? (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0]! : null)
    if (!remote) return blocked('没有远程仓库，没法推送分支')
    const where = await prRepoFor(cwd, remote)
    if (!where) return blocked(`远程仓库 ${remote} 不在 GitHub 上`)
    const baseRef = (await refExists(cwd, `refs/remotes/${remote}/${base}`)) ? `refs/remotes/${remote}/${base}` : `refs/heads/${base}`
    const ahead = await countCommits(cwd, `${baseRef}..refs/heads/${branch}`)
    if (ahead === null) return blocked(`找不到基线分支 ${base}`)
    if (ahead === 0) return blocked(`分支没有比 ${base} 新的提交`)

    const headBranch = info.remoteRef ? info.remoteRef.slice('refs/heads/'.length) : branch
    if (info.remoteRef) {
      const existing = await listPr(where.repo, where.headOwner, headBranch)
      if ('pr' in existing && existing.pr && (existing.pr.state === 'open' || existing.pr.state === 'draft')) {
        await refreshAfterCreate(request.worktree)
        return { ok: true, url: existing.pr.url, number: existing.pr.number, existed: true }
      }
    }

    const env = await pushEnv(cwd)
    if (!info.remoteRef) {
      const yes = request.pushApproved === true || await confirm(
        {
          message: `把分支 ${branch} 推送到 ${remote}？`,
          detail: `这个分支还没有推送过，创建 PR 前要先推送（git push -u ${remote} ${branch}）。`,
          confirmLabel: '推送并创建 PR'
        },
        parent
      )
      if (!yes) return { ok: false, reason: 'declined', message: '没有推送，也没有创建 PR' }
      const pushed = await git(cwd, ['push', '--quiet', '--set-upstream', '--', remote, `refs/heads/${branch}:refs/heads/${branch}`], { timeout: PUSH_TIMEOUT_MS, env })
      if (pushed.code !== 0) return { ok: false, reason: 'failed', message: `推送失败：${lastLines(pushed.stderr || pushed.stdout)}` }
    } else if ((await countCommits(cwd, `refs/remotes/${remote}/${headBranch}..refs/heads/${branch}`)) !== 0) {
      const pushed = await git(cwd, ['push', '--quiet', '--', remote, `refs/heads/${branch}:${info.remoteRef}`], { timeout: PUSH_TIMEOUT_MS, env })
      if (pushed.code !== 0) return { ok: false, reason: 'failed', message: `推送失败：${lastLines(pushed.stderr || pushed.stdout)}` }
    }

    const subjects = (await gitOut(cwd, ['log', '--reverse', '--max-count=101', '--format=%s', `${baseRef}..refs/heads/${branch}`, '--'])).split('\n').filter(Boolean)
    const head = where.headOwner ? `${where.headOwner}:${headBranch}` : headBranch
    const body = request.body !== undefined ? request.body : prBody(subjects)
    const created = await gh(
      [
        'pr',
        'create',
        `--repo=${repoArg(where.repo)}`,
        `--head=${head}`,
        `--base=${base}`,
        `--title=${prTitle(request.title, branch)}`,
        `--body=${body}`,
        ...(request.draft ? ['--draft'] : [])
      ],
      { cwd, timeout: 60_000 }
    )
    const url = created.code === 0 ? parseCreatedUrl(created.stdout) : null
    if (!url) return { ok: false, reason: 'failed', message: `gh 没能创建 PR：${lastLines(created.stderr || created.stdout) || `退出码 ${created.code}`}` }
    await refreshAfterCreate(request.worktree)
    return { ok: true, url: url.url, number: url.number, existed: false }
  } finally {
    creating.delete(request.worktree)
  }
}

/** The repository's PR template from the worktree (GitHub's locations, any case), or null. */
async function prTemplate(cwd: string): Promise<string | null> {
  const listed = (await gitOut(cwd, ['ls-files', '--', '.github', 'docs', '*.md'])).split('\n').filter(Boolean)
  for (const wanted of PR_TEMPLATE_PATHS) {
    const path = listed.find((p) => p.toLowerCase() === wanted)
    if (!path) continue
    const text = await readFile(join(cwd, path), 'utf8').catch(() => null)
    if (text !== null && text.trim() !== '') return text.slice(0, 20_000)
  }
  return null
}

/** 创建 PR 面板 (PRD F16 v1.63): the branch, its base, whether it was pushed, and the body to start from. */
export async function prDraft(raw: unknown): Promise<PrDraft> {
  const target = parsePrTarget(raw)
  if (!target || !isProjectRoot(target.root)) return { ok: false, message: '请求无效' }
  const info = await branchInfo(target)
  if (!info) return { ok: false, message: '不是这个项目的 worktree' }
  const { cwd, branch, base } = info
  if (!branch) return { ok: false, message: '处于分离 HEAD，没有分支可以提 PR' }
  if (!base || base === branch) return { ok: false, message: '这是基线分支本身，没有可以提 PR 的改动' }
  const remotes = (await gitOut(cwd, ['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
  const remote = info.remote ?? (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0]! : null)
  if (!remote) return { ok: false, message: '没有远程仓库，没法推送分支' }
  const baseRef = (await refExists(cwd, `refs/remotes/${remote}/${base}`)) ? `refs/remotes/${remote}/${base}` : `refs/heads/${base}`
  const subjects = (await gitOut(cwd, ['log', '--reverse', '--max-count=101', '--format=%s', `${baseRef}..refs/heads/${branch}`, '--'])).split('\n').filter(Boolean)
  const template = await prTemplate(cwd)
  return { ok: true, branch, base, remote, pushed: info.remoteRef !== null, body: template ?? prBody(subjects), fromTemplate: template !== null }
}

async function refreshAfterCreate(worktree: string): Promise<void> {
  const entry = entries.get(worktree)
  if (!entry) return
  if (entry.inFlight) await entry.inFlight
  await checkEntry(entry)
}

// ── 让 agent 修复 ────────────────────────────────────────────────────────────────────────────────────────────────

/** The failing checks of a watched worktree's PR (asked fresh) and the end of their `--log-failed` output. */
export async function ciFailure(worktree: unknown): Promise<CiFailure | null> {
  if (typeof worktree !== 'string') return null
  const entry = entries.get(worktree)
  if (!entry) return null
  if (Date.now() - entry.lastCheck >= REFRESH_MIN_MS) await checkEntry(entry)
  const pr = entry.status?.pr
  const repo = entry.repo
  if (!pr || pr.checks.state !== 'failing' || !repo) return null
  const logs: string[] = []
  const seen = new Set<string>()
  for (const check of pr.checks.failing) {
    if (logs.length >= LOGS_PER_FAILURE || check.runId === null) continue
    const key = check.jobId !== null ? `job:${check.jobId}` : `run:${check.runId}`
    if (seen.has(key)) continue
    seen.add(key)
    const tries = [
      ...(check.jobId !== null ? [['run', 'view', `--repo=${repoArg(repo)}`, `--job=${check.jobId}`, '--log-failed']] : []),
      ['run', 'view', String(check.runId), `--repo=${repoArg(repo)}`, '--log-failed']
    ]
    for (const args of tries) {
      const ran = await gh(args, { tail: LOG_TAIL_CHARS, timeout: 60_000 })
      const text = ran.code === 0 ? cleanFailedLog(ran.stdout) : ''
      if (text) {
        logs.push(text)
        break
      }
    }
  }
  return { number: pr.number, checks: pr.checks.failing.map((check) => check.name), log: logs.join('\n') }
}

// ── writing to GitHub (v1.63) ───────────────────────────────────────────────────────────────────────────────────

const writing = new Set<string>()

const writeBlocked = (message: string): PrWriteResult => ({ ok: false, reason: 'blocked', message })
const writeFailed = (what: string, ran: Ran): PrWriteResult => ({ ok: false, reason: 'failed', message: `${what}：${lastLines(ran.stderr || ran.stdout) || `退出码 ${ran.code}`}` })

/** The watched entry of a validated target, freshly checked, with gh ready. */
async function freshEntry(where: { root: string; worktree: string }): Promise<Entry | PrWriteResult> {
  if (!isProjectRoot(where.root)) return writeBlocked('请求无效')
  const state = await detectGh()
  if (state === 'missing') return writeBlocked('没有找到 gh：装好 GitHub CLI 并运行 gh auth login')
  if (state !== 'ready') return writeBlocked('gh 还没有登录：在终端运行 gh auth login')
  const entry = entries.get(where.worktree)
  if (!entry || entry.target.root !== where.root) return writeBlocked('这个 worktree 没有在 Wavi 里显示')
  if (entry.inFlight) await entry.inFlight
  await checkEntry(entry)
  return entry
}

/** One GraphQL request with its variables on stdin (nothing user-written lands in argv). */
function graphql(host: string, query: string, variables: Record<string, unknown>): Promise<Ran> {
  return gh(['api', 'graphql', `--hostname=${host}`, '--input', '-'], { input: JSON.stringify({ query, variables }), timeout: 60_000 })
}

/** Whether `oid` is a commit the local branch already has (fetching the remote branch first is the user's call). */
async function localHas(cwd: string, oid: string, branch: string): Promise<boolean> {
  if (!(await refExists(cwd, oid))) return false
  return (await git(cwd, ['merge-base', '--is-ancestor', oid, `refs/heads/${branch}`])).code === 0
}

/** After a merge: fetch the base, and fast-forward the local base branch when nothing is in the way. */
async function catchUpBase(cwd: string, remote: string, base: string): Promise<void> {
  const env = await pushEnv(cwd)
  const fetched = await git(cwd, ['fetch', '--quiet', '--', remote, `refs/heads/${base}:refs/remotes/${remote}/${base}`], { timeout: PUSH_TIMEOUT_MS, env })
  if (fetched.code !== 0) return
  const listing = parseWorktreePorcelain(await gitOut(cwd, ['worktree', 'list', '--porcelain']))
  const holder = listing.find((e) => e.branch === base)
  if (holder) {
    // Checked out: only a clean checkout moves, and only forward.
    if ((await gitOut(holder.path, ['status', '--porcelain', '--untracked-files=no'])).trim() !== '') return
    await git(holder.path, ['merge', '--ff-only', '--quiet', `refs/remotes/${remote}/${base}`])
    return
  }
  const old = (await gitOut(cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`])).trim()
  if (!old || (await git(cwd, ['merge-base', '--is-ancestor', old, `refs/remotes/${remote}/${base}`])).code !== 0) return
  await git(cwd, ['update-ref', `refs/heads/${base}`, `refs/remotes/${remote}/${base}`, old])
}

async function runMerge(entry: Entry, method: PrMergeRequest['method'], headOid: string, auto: boolean): Promise<Ran | null> {
  const pr = entry.status?.pr
  if (!pr || !entry.repo) return null
  return gh(mergeArgs(entry.repo, pr.number, method, headOid, auto), { timeout: 120_000 })
}

/** Wavi's own wait: the first check that finds the PR ready merges it — still pinned to the head the user merged. */
async function mergeWhenReady(entry: Entry): Promise<void> {
  const waiting = entry.waiting
  const pr = entry.status?.pr
  if (!waiting || !pr) return
  if (pr.state !== 'open' || !pr.details || pr.details.headOid !== waiting.headOid) {
    // Merged elsewhere, closed, or new commits: the wait is over (the user merges again after looking).
    entry.waiting = null
    rebroadcast(entry)
    return
  }
  if (!readyToMerge(pr)) return
  entry.waiting = null
  const ran = await runMerge(entry, waiting.method, waiting.headOid, false)
  if (ran && ran.code === 0) await afterMerge(entry, false)
}

async function afterMerge(entry: Entry, deleteRemoteBranch: boolean): Promise<void> {
  const info = await branchInfo(entry.target)
  if (info?.remote && info.base) {
    if (deleteRemoteBranch && info.remoteRef) {
      await git(info.cwd, ['push', '--quiet', '--', info.remote, `:${info.remoteRef}`], { timeout: PUSH_TIMEOUT_MS, env: await pushEnv(info.cwd) })
    }
    await catchUpBase(info.cwd, info.remote, info.base)
  }
  await checkEntry(entry)
}

/**
 * 合并 PR (PRD F16 v1.63): checks the PR fresh, refuses what GitHub would refuse anyway or what the user has not seen
 * (commits on the PR that are not local), pushes local commits first, then `gh pr merge` pinned to that head. With
 * `when-ready`, GitHub auto-merge when the repository allows it, else Wavi merges at the first check that finds the
 * checks passed (only while Wavi runs).
 */
export async function mergePullRequest(raw: unknown): Promise<PrWriteResult> {
  const request = parsePrMergeRequest(raw)
  if (!request) return writeBlocked('请求无效')
  if (writing.has(request.worktree)) return writeBlocked('正在处理这个 PR')
  writing.add(request.worktree)
  try {
    const entry = await freshEntry(request)
    if ('ok' in entry) return entry
    const pr = entry.status?.pr
    const info = await branchInfo(entry.target)
    if (!pr || !info?.branch || !info.remote || !info.remoteRef || !entry.repo) return writeBlocked('这个分支没有打开的 PR')
    const details = pr.details
    const localHead = (await gitOut(info.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${info.branch}`])).trim()
    const remoteAhead = details ? details.headOid !== localHead && !(await localHas(info.cwd, details.headOid, info.branch)) : false
    const blockers = mergeBlockers({ pr, method: request.method, remoteAhead, when: request.when })
    if (blockers.length > 0 || !details) return writeBlocked(blockers.join('；'))

    let headOid = details.headOid
    let when = request.when
    if (localHead && localHead !== headOid) {
      // Local commits the PR does not have yet: push them; the checks start over, so the merge waits for them.
      const pushed = await git(info.cwd, ['push', '--quiet', '--', info.remote, `refs/heads/${info.branch}:${info.remoteRef}`], { timeout: PUSH_TIMEOUT_MS, env: await pushEnv(info.cwd) })
      if (pushed.code !== 0) return writeFailed('推送失败', pushed)
      headOid = localHead
      when = 'when-ready'
    }

    if (when === 'when-ready') {
      if (details.repo.autoMergeAllowed) {
        const ran = await runMerge(entry, request.method, headOid, true)
        if (!ran || ran.code !== 0) return writeFailed('没能打开自动合并', ran ?? { code: -1, stdout: '', stderr: '' })
        await checkEntry(entry)
        const queued = entry.status?.pr?.details?.inMergeQueue === true
        return { ok: true, outcome: queued ? 'queued' : 'auto-merge', message: queued ? `PR #${pr.number} 已进入合并队列` : `检查通过后 GitHub 会合并 PR #${pr.number}` }
      }
      entry.waiting = { method: request.method, headOid }
      rebroadcast(entry)
      schedule(entry, 5_000)
      return { ok: true, outcome: 'waiting', message: `检查通过后由 Wavi 合并 PR #${pr.number}（Wavi 要开着）` }
    }

    const ran = await runMerge(entry, request.method, headOid, false)
    if (!ran || ran.code !== 0) return writeFailed('GitHub 没有合并', ran ?? { code: -1, stdout: '', stderr: '' })
    await afterMerge(entry, request.deleteRemoteBranch)
    const merged = entry.status?.pr?.state === 'merged'
    if (!merged && entry.status?.pr?.details?.inMergeQueue) return { ok: true, outcome: 'queued', message: `PR #${pr.number} 已进入合并队列` }
    return { ok: true, outcome: 'merged', message: `已合并 PR #${pr.number}` }
  } finally {
    writing.delete(request.worktree)
  }
}

export async function cancelMerge(raw: unknown): Promise<PrWriteResult> {
  const where = parsePrTarget(raw)
  if (!where) return writeBlocked('请求无效')
  const entry = entries.get(where.worktree)
  if (!entry || entry.target.root !== where.root) return writeBlocked('这个 worktree 没有在 Wavi 里显示')
  if (entry.waiting) {
    entry.waiting = null
    rebroadcast(entry)
    return { ok: true, outcome: 'cancelled', message: '不再等检查通过后合并' }
  }
  const pr = entry.status?.pr
  if (!pr || !entry.repo) return writeBlocked('这个分支没有打开的 PR')
  const ran = await gh(['pr', 'merge', String(pr.number), `--repo=${repoArg(entry.repo)}`, '--disable-auto'])
  if (ran.code !== 0) return writeFailed('没能取消自动合并', ran)
  await checkEntry(entry)
  return { ok: true, outcome: 'cancelled', message: `已取消 PR #${pr.number} 的自动合并` }
}

/** Resolves threads Wavi showed (ids must be among the PR's unresolved threads), each with the reply first. */
export async function resolveThreads(raw: unknown, parent?: BrowserWindow | null): Promise<PrWriteResult> {
  const request = parsePrResolveRequest(raw)
  if (!request) return writeBlocked('请求无效')
  const entry = await freshEntry(request)
  if ('ok' in entry) return entry
  const details = entry.status?.pr?.details
  if (!details || !entry.repo) return writeBlocked('没能读到 PR 的评论')
  const open = new Set(details.threads.map((t) => t.id))
  const ids = request.threadIds.filter((id) => open.has(id))
  if (ids.length === 0) return { ok: true, outcome: 'resolved', message: '这些评论已经解决了' }
  if (ids.length > 1) {
    const yes = await confirm(
      {
        message: `以 @${details.viewer || '你的账号'} 把 ${ids.length} 条评论标记为已解决？`,
        detail: request.reply ? `每条先回复：${request.reply.slice(0, 200)}` : '会在 GitHub 上标记为已解决，不附回复。',
        confirmLabel: '标记已解决'
      },
      parent
    )
    if (!yes) return { ok: false, reason: 'declined', message: '没有改动 GitHub 上的评论' }
  }
  let done = 0
  for (const id of ids) {
    if (request.reply) {
      const replied = await graphql(entry.repo.host, REPLY_THREAD_MUTATION, { id, body: request.reply })
      if (replied.code !== 0) return writeFailed(`回复失败（已处理 ${done} 条）`, replied)
    }
    const resolved = await graphql(entry.repo.host, RESOLVE_THREAD_MUTATION, { id })
    if (resolved.code !== 0) return writeFailed(`标记已解决失败（已处理 ${done} 条）`, resolved)
    done++
  }
  await checkEntry(entry)
  return { ok: true, outcome: 'resolved', message: `已把 ${done} 条评论标记为已解决` }
}

/**
 * 把 Wavi 审阅发到 PR: one review with event COMMENT (never an approval or a request for changes), each finding on
 * its lines. GitHub refuses lines outside the PR's diff; then the same findings go out as one body instead.
 */
export async function postReview(raw: unknown, parent?: BrowserWindow | null): Promise<PrWriteResult> {
  const request = parsePrPostReviewRequest(raw)
  if (!request) return writeBlocked('请求无效')
  const entry = await freshEntry(request)
  if ('ok' in entry) return entry
  const pr = entry.status?.pr
  const details = pr?.details
  if (!pr || !details || !entry.repo || (pr.state !== 'open' && pr.state !== 'draft')) return writeBlocked('这个分支没有打开的 PR')
  const yes = await confirm(
    {
      message: `以 @${details.viewer || '你的账号'} 在 PR #${pr.number} 上发 ${request.comments.length} 条审阅评论？`,
      detail: '发成一次“评论”审阅，不会批准也不会要求修改。别人能在 PR 上看到。',
      confirmLabel: '发到 PR'
    },
    parent
  )
  if (!yes) return { ok: false, reason: 'declined', message: '没有发到 PR' }
  const variables = { pr: details.id, oid: details.headOid }
  let ran = await graphql(entry.repo.host, ADD_REVIEW_MUTATION, {
    ...variables,
    body: reviewBody(request.reviewer, request.comments.length),
    threads: reviewThreadsInput(request.comments)
  })
  if (ran.code !== 0 && /line|diff|position|path/i.test(ran.stderr || ran.stdout)) {
    ran = await graphql(entry.repo.host, ADD_REVIEW_MUTATION, { ...variables, body: reviewBodyWithFindings(request.reviewer, request.comments), threads: [] })
    if (ran.code === 0) {
      await checkEntry(entry)
      return { ok: true, outcome: 'posted', message: `有的行不在 PR 的改动里，已作为一条总评论发到 PR #${pr.number}` }
    }
  }
  if (ran.code !== 0) return writeFailed('没能发到 PR', ran)
  await checkEntry(entry)
  return { ok: true, outcome: 'posted', message: `已在 PR #${pr.number} 上发了 ${request.comments.length} 条审阅评论` }
}

// ── IPC ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const hooked = new WeakSet<object>()

export function registerPullRequestHandlers(): void {
  ipcMain.handle(PR_IPC.gh, () => detectGh())
  ipcMain.on(PR_IPC.watch, (event, raw: unknown) => {
    const sender = event.sender
    if (!hooked.has(sender)) {
      hooked.add(sender)
      sender.once('destroyed', () => unwatch(sender))
    }
    watchTargets(sender, raw)
  })
  ipcMain.on(PR_IPC.refresh, (_event, worktree: unknown) => refreshWorktree(worktree))
  ipcMain.handle(PR_IPC.statuses, (event) => statusesFor(event.sender))
  ipcMain.handle(PR_IPC.create, (event, raw: unknown) => createPullRequest(raw, hostWindowFor(event.sender)))
  ipcMain.handle(PR_IPC.failure, (_event, worktree: unknown) => ciFailure(worktree))
  ipcMain.handle(PR_IPC.draft, (_event, raw: unknown) => prDraft(raw))
  ipcMain.handle(PR_IPC.merge, (_event, raw: unknown) => mergePullRequest(raw))
  ipcMain.handle(PR_IPC.cancelMerge, (_event, raw: unknown) => cancelMerge(raw))
  ipcMain.handle(PR_IPC.resolveThreads, (event, raw: unknown) => resolveThreads(raw, hostWindowFor(event.sender)))
  ipcMain.handle(PR_IPC.postReview, (event, raw: unknown) => postReview(raw, hostWindowFor(event.sender)))
  app.on('browser-window-focus', onFocus)
  app.on('before-quit', () => {
    for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer)
    entries.clear()
  })
}
