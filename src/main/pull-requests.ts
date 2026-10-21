// PR / CI status and 创建 PR (PRD F16) with the user's own `gh` login: Wavi stores no token, and gh runs only here.
// gh is found on the login shell's PATH (as the agents are) and checked with `gh auth status`, again whenever it was
// not ready. A watched worktree whose branch has an upstream gets `gh pr list --head <branch>` now and then — sooner
// while checks run, rarely otherwise, backing off after errors and pausing every call on a rate limit. Branches
// without an upstream cost one local git call and never reach gh.
// 创建 PR pushes the branch (asking in a native sheet first when it was never pushed) and runs `gh pr create`.
// 让 agent 修复 reads the failing jobs' `gh run view --log-failed`. Everything from the renderer is validated: project
// roots must be the workspace's, worktrees theirs, and no value reaches git or gh where it could be read as an option.
import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { app, BrowserWindow, ipcMain } from 'electron'
import { mainWorktreeIndex, parseBaseConfig, parseWorktreePorcelain, pickMainBranch } from '@shared/git-worktrees'
import {
  cleanFailedLog,
  ghResolvedRemote,
  isRateLimited,
  isSignedOut,
  nextPollDelay,
  parseCreatedUrl,
  parsePrCreateRequest,
  parsePrTargets,
  pickPullRequest,
  prBody,
  prTitle,
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
function runProcess(bin: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; tail?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let overflow = false
    let settled = false
    const out = new StringDecoder('utf8')
    const err = new StringDecoder('utf8')
    const child = spawn(bin, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] })
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
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += out.write(chunk)
      if (options.tail !== undefined) {
        if (stdout.length > options.tail * 2) stdout = stdout.slice(-options.tail)
      } else if (stdout.length > MAX_STDOUT) {
        overflow = true
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
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

async function gh(args: string[], options: { cwd?: string; tail?: number; timeout?: number } = {}): Promise<Ran> {
  const bin = ghBin
  if (!bin) return { code: -1, stdout: '', stderr: 'gh not found' }
  if (ghSlots === 0) await new Promise<void>((resolve) => ghQueue.push(resolve))
  else ghSlots--
  try {
    return await runProcess(bin, args, { cwd: options.cwd ?? homedir(), env: await ghEnv(), timeout: options.timeout ?? GH_TIMEOUT_MS, tail: options.tail })
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

function setStatus(entry: Entry, branch: string | null, pr: PullRequestInfo | null): PrStatus {
  const previous = entry.status
  const status: PrStatus = { worktree: entry.target.worktree, branch, pr, checkedAt: Date.now() }
  entry.status = status
  if (!previous || previous.branch !== branch || !samePullRequest(previous.pr, pr)) broadcast(status)
  return status
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
  return setStatus(entry, info.branch, found.pr)
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
    const entry: Entry = { target, status: null, failures: 0, timer: null, inFlight: null, lastCheck: 0, repo: null }
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
      const yes = await confirm(
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
    const created = await gh(
      ['pr', 'create', `--repo=${repoArg(where.repo)}`, `--head=${head}`, `--base=${base}`, `--title=${prTitle(request.title, branch)}`, `--body=${prBody(subjects)}`],
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
  ipcMain.handle(PR_IPC.create, (event, raw: unknown) => createPullRequest(raw, BrowserWindow.fromWebContents(event.sender)))
  ipcMain.handle(PR_IPC.failure, (_event, worktree: unknown) => ciFailure(worktree))
  app.on('browser-window-focus', onFocus)
  app.on('before-quit', () => {
    for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer)
    entries.clear()
  })
}
