// The merge chain's mechanical side in main (PRD F16 v1.78, Figma 29): preflight, the agent handoff files, 合并到 main
// 并推送, the diff a fix adds, risk markers, and CI on the base Wavi pushed. Channels in SHIP_IPC (src/shared/ship.ts).
//
// The agent in the session writes every piece of text and fixes code; this file runs commit, merge, push and gh, and
// the brakes. Everything the renderer sends is validated (src/shared/ship-requests.ts) and every worktree must be one
// of a workspace project. gh is the user's own login (see pull-requests.ts); nothing here stores a token.
import { spawn } from 'node:child_process'
import { mkdir, open, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { BrowserWindow, ipcMain } from 'electron'
import type { GitOperation, MergeBlocker, MergePrecheck, MergeResult } from '@shared/git-merge'
import {
  nextPollDelay,
  isRateLimited,
  isSignedOut,
  parsePrTarget,
  repoFromRemoteUrl,
  summarizeChecks,
  type ChecksSummary,
  type GitHubRepo
} from '@shared/pull-requests'
import { riskMarkers, type RiskMarker } from '@shared/risk-markers'
import { SHIP_IPC, type BaseCi, type BaseCiFailure, type DiffSinceRequest, type HandoffSlot, type ShipMainResult, type ShipPreflight } from '@shared/ship'
import { HANDOFF_FILES } from '@shared/ship-handoff'
import { parseDiffSinceRequest, parseHandoffRequest, parseShipMainRequest } from '@shared/ship-requests'
import { mergePrecheck, mergeWorktree, workInBase } from './git-merge'
import {
  branchInfo,
  commitWorktree,
  detectGh,
  failedLogs,
  gh,
  ghPausedUntil,
  git,
  gitEnv,
  gitOut,
  lastLines,
  openPrNumber,
  pauseGhForRateLimit,
  prRepoFor,
  pushEnv,
  refExists,
  uncommittedFiles
} from './pull-requests'
import { isProjectRoot } from './workspace-store'

const FETCH_TIMEOUT_MS = 60_000
/** A fast-forward checks files out. */
const CHECKOUT_TIMEOUT_MS = 5 * 60_000
/** How long a branch-protection answer is trusted. */
const PROTECTION_TTL_MS = 10 * 60_000
const HANDOFF_READ_CAP = 64 * 1024
const DIFF_SINCE_CAP = 2 * 1024 * 1024
const RISK_DIFF_CAP = 4 * 1024 * 1024
/** CI of a pushed commit: asked this often while it runs. */
const CI_POLL_MS = 60_000
/** A fresh push has no check runs for a few seconds: no checks inside this window read as "pending", not "none". */
const CI_NO_CHECKS_GRACE_MS = 90_000
/** A commit whose checks never settle is dropped after this long. */
const CI_WATCH_MAX_MS = 6 * 60 * 60_000
/** Failures in a row before a watch that never got an answer gives up (not a GitHub repository, no access). */
const CI_GIVE_UP_FAILURES = 5
/** An explicit refresh closer than this to the last poll reuses it. */
const CI_REFRESH_MIN_MS = 10_000

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const isSha = (value: string): boolean => /^[0-9a-f]{40,64}$/.test(value)

async function realOrSelf(path: string): Promise<string> {
  return realpath(path).catch(() => path)
}

// ── what a worktree's chain starts from ─────────────────────────────────────────────────────────────────────────

async function countCommits(cwd: string, range: string): Promise<number | null> {
  const ran = await git(cwd, ['rev-list', '--count', range, '--'])
  return ran.code === 0 ? Number(ran.stdout.trim()) || 0 : null
}

async function remotesOf(cwd: string): Promise<string[]> {
  return (await gitOut(cwd, ['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
}

/** The branch's upstream remote, else `origin` when there is one, else null. */
async function remoteFor(cwd: string, branch: string): Promise<string | null> {
  const [remotes, tracked] = await Promise.all([remotesOf(cwd), gitOut(cwd, ['for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${branch}`])])
  const own = tracked.trim()
  if (own && own !== '.' && remotes.includes(own)) return own
  return remotes.includes('origin') ? 'origin' : null
}

interface BaseUpstream {
  /** The remote-tracking ref, e.g. refs/remotes/origin/main. */
  ref: string
  remote: string
  /** The branch on the remote, e.g. refs/heads/main. */
  remoteRef: string
}

/** The local base's upstream, when it has one that is a remote-tracking ref Wavi can read. */
async function baseUpstream(cwd: string, base: string): Promise<BaseUpstream | null> {
  const out = (await gitOut(cwd, ['for-each-ref', '--format=%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)', `refs/heads/${base}`])).trim()
  const [ref, remote, remoteRef] = out.split('\0')
  if (!ref || !remote || remote === '.' || !remoteRef || !ref.startsWith('refs/remotes/') || !remoteRef.startsWith('refs/heads/')) return null
  return (await refExists(cwd, ref)) ? { ref, remote, remoteRef } : null
}

// ── branch protection ───────────────────────────────────────────────────────────────────────────────────────────

const protection = new Map<string, { value: boolean; at: number }>()

/** `GET repos/{o}/{r}/branches/{base}/protection`: 200 protected, 404 not, anything else unknown. Cached 10 minutes. */
async function baseProtection(cwd: string, remote: string | null, base: string): Promise<boolean | null> {
  if (!remote) return null
  if ((await detectGh()) !== 'ready' || Date.now() < ghPausedUntil()) return null
  const where = await prRepoFor(cwd, remote)
  if (!where) return null
  const { repo } = where
  const key = `${repo.host}/${repo.owner}/${repo.name}#${base}`
  const known = protection.get(key)
  if (known && Date.now() - known.at < PROTECTION_TTL_MS) return known.value
  const path = `repos/${repo.owner}/${repo.name}/branches/${base.split('/').map(encodeURIComponent).join('/')}/protection`
  const ran = await gh(['api', path, `--hostname=${repo.host}`], { timeout: 20_000 })
  const output = `${ran.stderr}\n${ran.stdout}`
  let value: boolean | null = null
  if (ran.code === 0) value = true
  else if (/HTTP 404/.test(output)) value = false
  else if (isRateLimited(output)) pauseGhForRateLimit()
  if (value !== null) protection.set(key, { value, at: Date.now() })
  return value
}

// ── preflight ───────────────────────────────────────────────────────────────────────────────────────────────────

const failure = (message: string): { ok: false; message: string } => ({ ok: false, message })

/** What the two exits need to know before anything runs (Figma 29A). */
export async function shipPreflight(raw: unknown): Promise<ShipPreflight> {
  const target = parsePrTarget(raw)
  if (!target || !isProjectRoot(target.root)) return failure('请求无效')
  const info = await branchInfo(target)
  if (!info) return failure('不是这个项目的 worktree')
  const { cwd, branch, base } = info
  if (!branch) return failure('处于分离 HEAD，没有分支可以合并')
  if (!base || base === branch) return failure('这是基线分支本身，没有可以合并的改动')
  if (!(await refExists(cwd, `refs/heads/${base}`))) return failure(`找不到基线分支 ${base}`)
  const ahead = await countCommits(cwd, `refs/heads/${base}..refs/heads/${branch}`)
  if (ahead === null) return failure(`没能数出分支比 ${base} 新的提交`)
  // An old git (no merge-tree --write-tree) only loses this check; the merge's own precheck says why.
  const merged = ahead > 0 && (await workInBase(cwd, `refs/heads/${base}`, `refs/heads/${branch}`).catch(() => false))

  const [remote, files, upstream] = await Promise.all([remoteFor(cwd, branch), uncommittedFiles(cwd), baseUpstream(cwd, base)])
  let baseAheadOfUpstream = 0
  let baseBehindUpstream = 0
  if (upstream) {
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', `${upstream.ref}...refs/heads/${base}`, '--'])
    if (counts.code === 0) {
      const [behind = '0', own = '0'] = counts.stdout.trim().split(/\s+/)
      baseBehindUpstream = Number(behind) || 0
      baseAheadOfUpstream = Number(own) || 0
    }
  }
  const baseProtected = await baseProtection(cwd, remote, base)
  return {
    ok: true,
    branch,
    base,
    remote,
    baseProtected,
    suggested: baseProtected === true ? 'pr' : 'main',
    uncommitted: files.length,
    ahead,
    merged,
    baseAheadOfUpstream,
    baseBehindUpstream,
    openPr: openPrNumber(target.worktree)
  }
}

// ── the agent's files ───────────────────────────────────────────────────────────────────────────────────────────

/** `<git dir>/wavi/<kind>.md` of the requested worktree, or why not. */
async function handoffPath(raw: unknown): Promise<{ dir: string; path: string } | { message: string }> {
  const request = parseHandoffRequest(raw)
  if (!request || !isProjectRoot(request.root)) return { message: '请求无效' }
  const info = await branchInfo(request)
  if (!info) return { message: '不是这个项目的 worktree' }
  const gitDir = (await gitOut(info.cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  if (!gitDir) return { message: '读不到 worktree 的 git 目录' }
  const dir = join(gitDir, 'wavi')
  return { dir, path: join(dir, HANDOFF_FILES[request.kind]) }
}

/** Clears an old file of this kind and answers where the agent should write the new one. */
export async function handoffSlot(raw: unknown): Promise<HandoffSlot> {
  const where = await handoffPath(raw)
  if ('message' in where) return failure(where.message)
  try {
    await mkdir(where.dir, { recursive: true })
    await rm(where.path, { force: true })
  } catch (error) {
    return failure(`没能准备给 agent 的文件：${errorText(error)}`)
  }
  return { ok: true, path: where.path }
}

/** The text the agent wrote (at most 64 KB), or null while the file is not there. */
export async function readHandoffText(raw: unknown): Promise<string | null> {
  const where = await handoffPath(raw)
  if ('message' in where) return null
  try {
    const file = await open(where.path, 'r')
    try {
      const buffer = Buffer.alloc(HANDOFF_READ_CAP)
      const { bytesRead } = await file.read(buffer, 0, HANDOFF_READ_CAP, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}

// ── 合并到 main 并推送 ──────────────────────────────────────────────────────────────────────────────────────────

const operationNames: Record<GitOperation, string> = { merge: '合并', rebase: '变基', 'cherry-pick': 'cherry-pick', revert: '撤销' }

/** Why a merge cannot run, in the user's words. */
export function blockerMessage(blocker: MergeBlocker, base: string): string {
  switch (blocker.kind) {
    case 'detached':
      return '处于分离 HEAD，没有分支可以合并'
    case 'no-base':
      return '找不到要合并进的基线分支'
    case 'base-missing':
      return `基线分支 ${blocker.base} 不在本地`
    case 'busy':
      return `${blocker.where === 'worktree' ? '这个 worktree' : `${base} 的工作区`}里有进行中的${operationNames[blocker.operation]}：先完成或放弃它`
    case 'nothing':
      return blocker.merged ? `分支已经全部合并到 ${base}` : `分支没有比 ${base} 新的提交`
    case 'old-git':
      return 'git 版本低于 2.38，没法预检合并'
    case 'base-dirty':
      return `${base} 的工作区在 ${blocker.files.slice(0, 5).join('、')} 上有未提交的改动，合并会碰到它们`
    case 'main':
      return '这是主工作区（已经在基线分支上），没有可以合并的分支'
    case 'worktree-dirty':
      return '这个 worktree 有未提交的改动：变基前先提交'
    case 'unverified':
      return `没能检查合并：${blocker.message}`
  }
}

const stepFailure = (step: 'commit' | 'merge' | 'push', reason: 'blocked' | 'conflicts' | 'failed' | 'declined', message: string, more: { conflicts?: string[]; output?: string } = {}): ShipMainResult => ({
  ok: false,
  step,
  reason,
  message,
  ...more
})

/** Whether git's push error says the remote refused the branch for being protected (GitHub's wording). */
export function pushRejectedByProtection(output: string): boolean {
  return /protected branch|GH006|GH013|repository rule violations|branch protection/i.test(output)
}

async function precheck(root: string, worktree: string): Promise<MergePrecheck | string> {
  try {
    return await mergePrecheck(root, worktree)
  } catch (error) {
    return errorText(error)
  }
}

/**
 * Brings the local base up to its upstream before a merge (so the push is not rejected): fetches the base (a failed
 * fetch leaves what is known), then fast-forwards the checkout that has it out, or the branch ref when none has.
 * Returns whether the base moved, or why it could not.
 */
async function syncBase(root: string, check: MergePrecheck): Promise<{ moved: boolean } | { message: string }> {
  const up = await baseUpstream(root, check.base)
  if (!up) return { moved: false }
  await git(root, ['fetch', '--quiet', '--', up.remote, `${up.remoteRef}:${up.ref}`], { timeout: FETCH_TIMEOUT_MS, env: await pushEnv(root) })
  const behind = (await countCommits(root, `refs/heads/${check.base}..${up.ref}`)) ?? 0
  if (behind === 0) return { moved: false }
  const name = `${up.remote}/${up.remoteRef.slice('refs/heads/'.length)}`
  const cannot = (why: string): { message: string } => ({ message: `${check.base} 落后 ${name} ${behind} 个提交，没法快进${why}` })
  if (check.baseCheckout) {
    const ran = await git(check.baseCheckout, ['merge', '--ff-only', '--quiet', '--no-edit', up.ref], { timeout: CHECKOUT_TIMEOUT_MS })
    return ran.code === 0 ? { moved: true } : cannot(`：${lastLines(ran.stderr || ran.stdout)}`)
  }
  if ((await git(root, ['merge-base', '--is-ancestor', `refs/heads/${check.base}`, up.ref])).code !== 0) {
    return { message: `${check.base} 和 ${name} 各有对方没有的提交，没法快进` }
  }
  const ran = await git(root, ['update-ref', '-m', `wavi: fast-forward ${check.base}`, `refs/heads/${check.base}`, up.ref, check.baseHead])
  return ran.code === 0 ? { moved: true } : cannot(`：${lastLines(ran.stderr || ran.stdout)}`)
}

function mergeFailure(result: Extract<MergeResult, { ok: false }>, check: MergePrecheck): ShipMainResult {
  switch (result.reason) {
    case 'stale':
      return stepFailure('merge', 'failed', `分支或 ${check.base} 在检查之后又变了：再试一次`)
    case 'conflict':
      if (result.conflicts && result.conflicts.length > 0) {
        return stepFailure('merge', 'conflicts', `${result.conflicts.length} 个文件和 ${check.base} 冲突`, { conflicts: result.conflicts.map((c) => c.path) })
      }
      return stepFailure('merge', 'failed', `变基时遇到冲突，已放弃，分支没有变化：改用「压缩」或「合并」`, { output: result.message })
    case 'blocked':
      return stepFailure('merge', 'blocked', result.blocker ? blockerMessage(result.blocker, check.base) : '现在合并不了')
    case 'invalid':
      return stepFailure('merge', 'failed', '请求无效')
    case 'git':
      return stepFailure('merge', 'failed', `合并没有成功${result.rebased ? `（分支已变基到 ${check.base} 上）` : ''}：${result.message ?? 'git 报错'}`, { output: result.message })
  }
}

const shipping = new Set<string>()

/**
 * Exit A: commit the ticked paths with the agent's message (hooks run), bring the base up to its upstream, merge the
 * branch into it and push it. A push that fails keeps the merge (`pushed: false`); a push that works starts watching
 * the pushed commit's CI.
 */
export async function shipToMain(raw: unknown): Promise<ShipMainResult> {
  const request = parseShipMainRequest(raw)
  if (!request || !isProjectRoot(request.root)) return stepFailure('merge', 'failed', '请求无效')
  if (shipping.has(request.worktree)) return stepFailure('merge', 'blocked', '正在合并这个分支')
  shipping.add(request.worktree)
  try {
    if (request.paths) {
      const committed = await commitWorktree({ root: request.root, worktree: request.worktree, message: request.message, paths: request.paths })
      if (!committed.ok) return stepFailure('commit', committed.reason, committed.message, committed.output ? { output: committed.output } : {})
    }

    let check = await precheck(request.root, request.worktree)
    if (typeof check === 'string') return stepFailure('merge', 'failed', `没能检查合并：${check}`)
    const root = await realOrSelf(request.root)
    if (check.base && !check.blocker) {
      const caught = await syncBase(root, check)
      if ('message' in caught) return stepFailure('merge', 'blocked', caught.message)
      if (caught.moved) {
        const again = await precheck(request.root, request.worktree)
        if (typeof again === 'string') return stepFailure('merge', 'failed', `没能检查合并：${again}`)
        check = again
      }
    }
    if (check.blocker) return stepFailure('merge', 'blocked', blockerMessage(check.blocker, check.base))
    if (check.conflicts.length > 0) {
      return stepFailure('merge', 'conflicts', `${check.conflicts.length} 个文件和 ${check.base} 冲突`, { conflicts: check.conflicts.map((c) => c.path) })
    }

    const merged = await mergeWorktree({
      root: request.root,
      worktree: request.worktree,
      method: request.method,
      head: check.head,
      baseHead: check.baseHead,
      push: check.hasOrigin,
      // '' (only without paths) keeps the branch's own messages.
      ...(request.message ? { message: request.message } : {})
    })
    if (!merged.ok) return mergeFailure(merged, check)
    if (merged.push === null) return { ok: true, commit: merged.commit, pushed: false }
    if (merged.push !== '') {
      const why = pushRejectedByProtection(merged.push)
        ? `${check.base} 受保护，origin 不收直接推送：改为创建 PR（合并已留在本地 ${check.base} 上）。${merged.push}`
        : `推送到 origin 失败（合并已留在本地 ${check.base} 上）：${merged.push}`
      return { ok: true, commit: merged.commit, pushed: false, pushError: why }
    }
    await startBaseCi({ root: request.root, worktree: request.worktree, cwd: root, base: check.base, sha: merged.commit, previous: check.baseHead })
    return { ok: true, commit: merged.commit, pushed: true }
  } catch (error) {
    return stepFailure('merge', 'failed', `合并没有成功：${errorText(error)}`)
  } finally {
    shipping.delete(request.worktree)
  }
}

// ── CI of the pushed base commit ────────────────────────────────────────────────────────────────────────────────

interface Watch {
  root: string
  worktree: string
  base: string
  /** The pushed commit. */
  sha: string
  /** The base's tip before this push: what "was it already failing?" asks about. */
  previous: string
  repo: GitHubRepo
  startedAt: number
  lastPoll: number
  /** Errors in a row. */
  failures: number
  answered: boolean
  timer: ReturnType<typeof setTimeout> | null
  inFlight: Promise<void> | null
  ci: BaseCi | null
}

const watches = new Map<string, Watch>()

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const upper = (value: unknown): string => String(value ?? '').toUpperCase()

/**
 * `commits/{sha}/check-runs` and `commits/{sha}/status` (REST) as the rollup entries `summarizeChecks` reads: a
 * check run keeps its status and conclusion, a legacy status its state. Stale runs are skipped. Only the statuses
 * list counts: the combined state of a commit without statuses reads "pending".
 */
export function commitRollup(checkRuns: unknown, status: unknown): unknown[] {
  const rollup: unknown[] = []
  if (isRecord(checkRuns) && Array.isArray(checkRuns.check_runs)) {
    for (const run of checkRuns.check_runs.slice(0, 300)) {
      if (!isRecord(run) || upper(run.conclusion) === 'STALE') continue
      rollup.push({ __typename: 'CheckRun', name: run.name, status: upper(run.status), conclusion: upper(run.conclusion), detailsUrl: run.details_url ?? run.html_url })
    }
  }
  if (isRecord(status) && Array.isArray(status.statuses)) {
    for (const item of status.statuses.slice(0, 200)) {
      if (!isRecord(item)) continue
      rollup.push({ __typename: 'StatusContext', context: item.context, state: upper(item.state), targetUrl: item.target_url })
    }
  }
  return rollup
}

async function ghGet(repo: GitHubRepo, path: string): Promise<{ json: unknown } | { error: string }> {
  const ran = await gh(['api', `repos/${repo.owner}/${repo.name}/${path}`, `--hostname=${repo.host}`], { timeout: 30_000 })
  if (ran.code !== 0) {
    const error = lastLines(ran.stderr || ran.stdout) || `gh exited with ${ran.code}`
    if (isRateLimited(error)) pauseGhForRateLimit()
    if (isSignedOut(error)) void detectGh(true)
    return { error }
  }
  try {
    return { json: JSON.parse(ran.stdout) as unknown }
  } catch {
    return { error: 'gh printed no JSON' }
  }
}

/** The checks of one commit (check runs and legacy statuses), or why gh could not tell. */
async function commitChecks(repo: GitHubRepo, sha: string): Promise<{ checks: ChecksSummary } | { error: string }> {
  if (!isSha(sha)) return { error: 'not a commit id' }
  const [runs, status] = await Promise.all([ghGet(repo, `commits/${sha}/check-runs?per_page=100`), ghGet(repo, `commits/${sha}/status?per_page=100`)])
  if ('error' in runs) return runs
  if ('error' in status) return status
  return { checks: summarizeChecks(commitRollup(runs.json, status.json)) }
}

function emitBaseCi(ci: BaseCi): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(SHIP_IPC.baseCiChanged, ci)
  }
}

const stopped = (checks: ChecksSummary): boolean => checks.state === 'passing' || checks.state === 'failing'

function scheduleCi(watch: Watch): void {
  if (watch.timer) clearTimeout(watch.timer)
  watch.timer = null
  if (watches.get(watch.worktree) !== watch) return
  const settled = watch.ci && (stopped(watch.ci.checks) || (watch.ci.checks.state === 'none' && Date.now() - watch.startedAt >= CI_NO_CHECKS_GRACE_MS))
  if (settled || Date.now() - watch.startedAt > CI_WATCH_MAX_MS) return
  if (!watch.answered && watch.failures >= CI_GIVE_UP_FAILURES) return
  const delay = Math.max(watch.failures > 0 ? nextPollDelay({ pr: null, focused: true, failures: watch.failures }) : CI_POLL_MS, ghPausedUntil() - Date.now())
  watch.timer = setTimeout(() => {
    watch.timer = null
    void pollCi(watch)
  }, delay)
  watch.timer.unref?.()
}

async function pollOnce(watch: Watch): Promise<void> {
  if (watches.get(watch.worktree) !== watch) return
  if ((await detectGh()) !== 'ready' || Date.now() < ghPausedUntil()) return
  const found = await commitChecks(watch.repo, watch.sha)
  if ('error' in found) {
    watch.failures++
    return
  }
  watch.failures = 0
  watch.answered = true
  let checks = found.checks
  if (checks.state === 'none' && Date.now() - watch.startedAt < CI_NO_CHECKS_GRACE_MS) checks = { ...checks, state: 'pending' }
  const previous = watch.ci
  const ci: BaseCi = {
    worktree: watch.worktree,
    base: watch.base,
    sha: watch.sha,
    checks,
    url: `https://${watch.repo.host}/${watch.repo.owner}/${watch.repo.name}/commit/${watch.sha}/checks`,
    checkedAt: Date.now()
  }
  watch.ci = ci
  if (!previous || JSON.stringify(previous.checks) !== JSON.stringify(checks)) emitBaseCi(ci)
}

/** Asks GitHub about the watched commit now (one ask at a time per watch) and plans the next. */
function pollCi(watch: Watch): Promise<void> {
  if (watch.inFlight) return watch.inFlight
  if (watch.timer) {
    clearTimeout(watch.timer)
    watch.timer = null
  }
  watch.inFlight = pollOnce(watch)
    .catch(() => {
      watch.failures++
    })
    .finally(() => {
      watch.inFlight = null
      watch.lastPoll = Date.now()
      scheduleCi(watch)
    })
  return watch.inFlight
}

/** Starts (or restarts) watching the CI of `sha`, which Wavi just pushed to the base. Nothing for a non-GitHub remote. */
async function startBaseCi(input: { root: string; worktree: string; cwd: string; base: string; sha: string; previous: string }): Promise<void> {
  const old = watches.get(input.worktree)
  if (old?.timer) clearTimeout(old.timer)
  watches.delete(input.worktree)
  const repo = repoFromRemoteUrl((await gitOut(input.cwd, ['remote', 'get-url', '--', 'origin'])).trim())
  if (!repo) return
  const { cwd: _cwd, ...rest } = input
  const watch: Watch = { ...rest, repo, startedAt: Date.now(), lastPoll: 0, failures: 0, answered: false, timer: null, inFlight: null, ci: null }
  watches.set(input.worktree, watch)
  // The first answer comes soon; GitHub needs a moment to register the push's checks.
  watch.timer = setTimeout(() => {
    watch.timer = null
    void pollCi(watch)
  }, 3_000)
  watch.timer.unref?.()
}

function watchFor(raw: unknown): Watch | null {
  const target = parsePrTarget(raw)
  if (!target || !isProjectRoot(target.root)) return null
  const watch = watches.get(target.worktree)
  return watch && watch.root === target.root ? watch : null
}

/** Asks about the watched commit now, unless it was asked a moment ago. */
export async function checkBaseCi(worktree: string, force = false): Promise<BaseCi | null> {
  const watch = watches.get(worktree)
  if (!watch) return null
  if (watch.inFlight) await watch.inFlight
  else if (force || Date.now() - watch.lastPoll >= CI_REFRESH_MIN_MS) await pollCi(watch)
  return watch.ci
}

export function baseCi(raw: unknown): BaseCi | null {
  return watchFor(raw)?.ci ?? null
}

/** The failing checks of the pushed commit (asked fresh) and the end of their logs. */
export async function baseFailure(raw: unknown): Promise<BaseCiFailure | null> {
  const watch = watchFor(raw)
  if (!watch) return null
  const ci = await checkBaseCi(watch.worktree)
  if (!ci || ci.checks.state !== 'failing') return null
  return { base: watch.base, sha: watch.sha, checks: ci.checks.failing.map((check) => check.name), log: await failedLogs(watch.repo, ci.checks.failing) }
}

/**
 * Check names failing on the base without this worktree's push: after Wavi pushed, on the base's tip before it (so
 * "already red" can be told from "this push broke it"), otherwise on the tip of the base's upstream as last fetched.
 * null when unknown (no gh, not GitHub, any error).
 */
export async function baseFailing(raw: unknown): Promise<string[] | null> {
  const target = parsePrTarget(raw)
  if (!target || !isProjectRoot(target.root)) return null
  try {
    let repo: GitHubRepo | null
    let sha: string
    const watch = watchFor(target)
    if (watch) {
      repo = watch.repo
      sha = watch.previous
    } else {
      const info = await branchInfo(target)
      if (!info?.base) return null
      const upstream = await baseUpstream(info.cwd, info.base)
      const remote = upstream?.remote ?? ((await remotesOf(info.cwd)).includes('origin') ? 'origin' : null)
      if (!remote) return null
      repo = repoFromRemoteUrl((await gitOut(info.cwd, ['remote', 'get-url', '--', remote])).trim())
      sha = (await gitOut(info.cwd, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${info.base}`])).trim()
    }
    if (!repo || !isSha(sha)) return null
    if ((await detectGh()) !== 'ready' || Date.now() < ghPausedUntil()) return null
    const found = await commitChecks(repo, sha)
    return 'checks' in found ? found.checks.failing.map((check) => check.name) : null
  } catch {
    return null
  }
}

/** Forgets every watch and cached answer (tests). */
export function resetShip(): void {
  for (const watch of watches.values()) if (watch.timer) clearTimeout(watch.timer)
  watches.clear()
  protection.clear()
}

// ── diffs ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** stdout of a git command, at most `cap` characters (the rest is dropped and the process stopped); null on failure. */
function gitCapped(cwd: string, args: string[], cap: number): Promise<string | null> {
  return new Promise((resolve) => {
    let text = ''
    let capped = false
    let settled = false
    const decoder = new StringDecoder('utf8')
    const child = spawn('git', args, { cwd, env: gitEnv(), stdio: ['ignore', 'pipe', 'ignore'] })
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(null)
    }, 60_000)
    child.stdout.on('data', (chunk: Buffer) => {
      if (capped) return
      text += decoder.write(chunk)
      if (text.length > cap) {
        capped = true
        child.kill('SIGTERM')
      }
    })
    child.once('error', () => finish(null))
    child.once('close', (code) => {
      if (capped) {
        // Whole lines only.
        const cut = text.slice(0, cap)
        finish(cut.slice(0, cut.lastIndexOf('\n') + 1) || cut)
      } else finish(code === 0 ? text + decoder.end() : null)
    })
  })
}

/** `since` resolved to a full commit id, when it is a commit that HEAD has as an ancestor (or is). */
async function ancestorOfHead(cwd: string, since: string): Promise<string | null> {
  const resolved = (await gitOut(cwd, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${since}^{commit}`])).trim()
  if (!isSha(resolved) || !resolved.startsWith(since)) return null
  return (await git(cwd, ['merge-base', '--is-ancestor', resolved, 'HEAD'])).code === 0 ? resolved : null
}

async function sinceTarget(raw: unknown): Promise<{ cwd: string; request: DiffSinceRequest; sha: string; branch: string | null; base: string | null } | string> {
  const request = parseDiffSinceRequest(raw)
  if (!request || !isProjectRoot(request.root)) return '请求无效'
  const info = await branchInfo(request)
  if (!info) return '不是这个项目的 worktree'
  const sha = await ancestorOfHead(info.cwd, request.since)
  if (!sha) return `${request.since} 不是这个分支上的提交`
  return { cwd: info.cwd, request, sha, branch: info.branch, base: info.base }
}

/** The branch's diff from `since` to HEAD (what a fix the agent committed changed), at most 2 MB. */
export async function diffSince(raw: unknown): Promise<string | null> {
  const found = await sinceTarget(raw)
  if (typeof found === 'string') return null
  return gitCapped(found.cwd, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', found.sha, 'HEAD', '--'], DIFF_SINCE_CAP)
}

const discarding = new Set<string>()

/** 丢弃: moves the worktree's branch back to `since`. Refuses with uncommitted changes to tracked files. */
export async function discardSince(raw: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const found = await sinceTarget(raw)
  if (typeof found === 'string') return failure(found)
  const { cwd, request, sha, branch, base } = found
  if (!branch) return failure('处于分离 HEAD，没有分支可以回退')
  if (!base || base === branch) return failure('这是基线分支本身：Wavi 不回退基线分支')
  if (shipping.has(request.worktree) || discarding.has(request.worktree)) return failure('正在合并或回退这个分支')
  discarding.add(request.worktree)
  try {
    // Untracked files stay where they are under `reset --hard`; changes to tracked files would be lost.
    const status = await git(cwd, ['status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=dirty'])
    if (status.code !== 0) return failure(`没能检查改动：${lastLines(status.stderr || status.stdout)}`)
    if (status.stdout.trim() !== '') return failure('有没提交的改动：先提交或放弃它们，再丢弃')
    const reset = await git(cwd, ['reset', '--hard', '--quiet', sha], { timeout: CHECKOUT_TIMEOUT_MS })
    if (reset.code !== 0) return failure(`没能回退：${lastLines(reset.stderr || reset.stdout)}`)
    return { ok: true }
  } finally {
    discarding.delete(request.worktree)
  }
}

/** Risk markers of the worktree's whole change against its base, working tree included (untracked files are skipped). */
export async function shipRisks(raw: unknown): Promise<RiskMarker[]> {
  const target = parsePrTarget(raw)
  if (!target || !isProjectRoot(target.root)) return []
  try {
    const info = await branchInfo(target)
    if (!info?.branch || !info.base || info.base === info.branch) return []
    const mergeBase = (await gitOut(info.cwd, ['merge-base', `refs/heads/${info.base}`, 'HEAD'])).trim()
    if (!isSha(mergeBase)) return []
    const diff = await gitCapped(info.cwd, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', mergeBase, '--'], RISK_DIFF_CAP)
    return diff ? riskMarkers(diff) : []
  } catch {
    return []
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function registerShipHandlers(): void {
  ipcMain.handle(SHIP_IPC.preflight, (_event, raw: unknown) => shipPreflight(raw))
  ipcMain.handle(SHIP_IPC.handoff, (_event, raw: unknown) => handoffSlot(raw))
  ipcMain.handle(SHIP_IPC.readHandoff, (_event, raw: unknown) => readHandoffText(raw))
  ipcMain.handle(SHIP_IPC.shipToMain, (_event, raw: unknown) => shipToMain(raw))
  ipcMain.handle(SHIP_IPC.diffSince, (_event, raw: unknown) => diffSince(raw))
  ipcMain.handle(SHIP_IPC.discardSince, (_event, raw: unknown) => discardSince(raw))
  ipcMain.handle(SHIP_IPC.risks, (_event, raw: unknown) => shipRisks(raw))
  ipcMain.handle(SHIP_IPC.baseCi, (_event, raw: unknown) => baseCi(raw))
  ipcMain.handle(SHIP_IPC.baseFailure, (_event, raw: unknown) => baseFailure(raw))
  ipcMain.handle(SHIP_IPC.baseFailing, (_event, raw: unknown) => baseFailing(raw))
}
