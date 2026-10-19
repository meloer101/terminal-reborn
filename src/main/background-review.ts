// Background code review (PRD F13): Wavi runs its own read-only reviewer — `claude -p` or `codex exec`, a fresh
// context with the user's own login — over the diff Wavi computed, and turns the JSON it returns into F5 comments.
// One review per diff hash, one in flight per worktree (a new diff cancels the old run). Automatic triggers run only
// when their switch in 设置 · 自动化 · 代码审阅 is on. Nothing here ever types into the coding session.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { app, ipcMain, type WebContents } from 'electron'
import {
  beginReview,
  decideReview,
  DEFAULT_REVIEW_RULES,
  diffHash,
  driveReview,
  emptyReviewMemory,
  parseUnifiedDiffFiles,
  rememberReview,
  REVIEW_IPC,
  type ReviewAgent,
  type ReviewCommandResult,
  type ReviewMemory,
  type ReviewRequest,
  type ReviewStatus,
  type ReviewTrigger
} from '@shared/background-review'
import type { ReviewSettings } from '@shared/settings'
import { buildPtyEnv } from '../pty-host/env'
import { executableOnPath, userLoginPath } from './agents-installed'
import { headCommit, reviewDiff } from './git-graph'
import { getSettings } from './settings'

/** One segment may take this long before it is stopped and the review fails. */
const SEGMENT_TIMEOUT_MS = 15 * 60_000
const KILL_GRACE_MS = 1000
const MAX_STDOUT = 16 * 1024 * 1024
const MAX_STDERR = 8 * 1024
const MAX_ROOT = 4096
/** Finder launches apps with a minimal PATH; these are where Homebrew and npm usually put the CLIs. */
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
const AGENTS: ReadonlySet<unknown> = new Set<ReviewAgent>(['claude', 'codex'])
const TRIGGERS: ReadonlySet<unknown> = new Set<ReviewTrigger>(['manual', 'merge', 'push', 'turn'])

interface Job {
  hash: string
  owner: WebContents
  status: ReviewStatus
  cancelled: boolean
  child: ChildProcess | null
}

interface RootState {
  memory: ReviewMemory
  job: Job | null
  /** HEAD when the current turn started (null: no turn seen since launch). */
  turnHead: string | null
}

const roots = new Map<string, RootState>()

function stateOf(root: string): RootState {
  let state = roots.get(root)
  if (!state) {
    state = { memory: emptyReviewMemory(), job: null, turnHead: null }
    roots.set(root, state)
  }
  return state
}

function send(owner: WebContents, status: ReviewStatus): void {
  if (!owner.isDestroyed()) owner.send(REVIEW_IPC.status, status)
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // already gone
    }
  }
}

function stopChild(child: ChildProcess | null): void {
  if (!child) return
  killGroup(child, 'SIGTERM')
  setTimeout(() => killGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref()
}

/** Whether an automatic trigger may run with these settings. Manual reviews always may. */
export function triggerAllowed(trigger: ReviewTrigger, settings: ReviewSettings): boolean {
  if (trigger === 'manual') return true
  if (settings.mode !== 'builtin') return false
  if (trigger === 'merge') return settings.beforeMerge
  if (trigger === 'push') return settings.beforePush
  return settings.afterTurnWithCommits
}

export function parseReviewRequest(raw: unknown): ReviewRequest {
  if (typeof raw !== 'object' || raw === null) throw new Error('invalid review request')
  const { root, agent, trigger, base } = raw as Record<string, unknown>
  if (typeof root !== 'string' || !root.startsWith('/') || root.length > MAX_ROOT || root.includes('\0')) throw new Error('invalid worktree root')
  if (!AGENTS.has(agent)) throw new Error('invalid agent')
  if (!TRIGGERS.has(trigger)) throw new Error('invalid trigger')
  if (base !== undefined && (typeof base !== 'string' || base.length > 255)) throw new Error('invalid base')
  return { root, agent: agent as ReviewAgent, trigger: trigger as ReviewTrigger, ...(typeof base === 'string' ? { base } : {}) }
}

function rulesOf(settings: ReviewSettings): string {
  return settings.rules === 'custom' && settings.customRules.trim() !== '' ? settings.customRules : DEFAULT_REVIEW_RULES
}

async function searchPath(): Promise<string> {
  const login = await userLoginPath()
  return [...(login ?? process.env.PATH ?? '').split(delimiter), ...EXTRA_PATH].filter(Boolean).join(delimiter)
}

/** Runs one reviewer process: argv[0] resolved on the login PATH, the prompt on stdin, its own process group. */
function runCli(job: Job, binary: string, args: string[], prompt: string, cwd: string, env: Record<string, string>): Promise<Omit<ReviewCommandResult, 'outputText'>> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    job.child = child
    const out = new StringDecoder('utf8')
    const err = new StringDecoder('utf8')
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      stderr += `\n超过 ${SEGMENT_TIMEOUT_MS / 60_000} 分钟没有结束，已停止`
      stopChild(child)
    }, SEGMENT_TIMEOUT_MS)
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (job.child === child) job.child = null
      stdout += out.end()
      resolve({ code, stdout, stderr: stderr + err.end(), cancelled: job.cancelled })
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT) stdout += out.write(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + err.write(chunk)).slice(-MAX_STDERR)
    })
    child.once('error', (error) => {
      stderr += error.message
      finish(null)
    })
    child.once('close', (code) => finish(code))
    // The reviewer may exit before reading everything (a bad flag); that is reported through its exit code.
    child.stdin?.on('error', () => {})
    child.stdin?.end(prompt)
  })
}

function finishJob(state: RootState, job: Job, patch: Partial<ReviewStatus>, outcome: 'done' | 'failed' | 'cancelled'): void {
  state.memory = rememberReview(state.memory, job.hash, outcome)
  job.status = { ...job.status, ...patch, endedAt: Date.now() }
  if (state.job === job) state.job = null
  send(job.owner, job.status)
}

async function drive(state: RootState, job: Job, cwd: string, text: string, settings: ReviewSettings): Promise<void> {
  const agent = job.status.agent
  const started = Date.now()
  let dir: string | null = null
  try {
    const path = await searchPath()
    const binary = executableOnPath(path, agent)
    if (!binary) {
      finishJob(state, job, { phase: 'failed', message: `找不到 ${agent} 命令，没有审阅` }, 'failed')
      return
    }
    dir = await mkdtemp(join(tmpdir(), 'wavi-review-'))
    const schemaPath = join(dir, 'schema.json')
    const env = buildPtyEnv(process.env, { PATH: path })
    let wroteSchema = false
    const result = await driveReview({
      agent,
      rules: rulesOf(settings),
      files: parseUnifiedDiffFiles(text),
      diffText: text,
      hash: job.hash,
      ...(settings.model ? { model: settings.model } : {}),
      schemaPath,
      outputPath: (index) => join(dir!, `out-${index}.json`),
      isCancelled: () => job.cancelled,
      onSegment: (index, count) => {
        if (count < 2) return
        job.status = { ...job.status, segment: { index, count }, message: `正在审阅第 ${index + 1}/${count} 段…` }
        send(job.owner, job.status)
      },
      run: async ({ argv, prompt, schemaJson, outputPath }) => {
        if (agent === 'codex' && !wroteSchema) {
          await writeFile(schemaPath, schemaJson)
          wroteSchema = true
        }
        const ran = await runCli(job, binary, argv.slice(1), prompt, cwd, env)
        const outputText = agent === 'codex' ? await readFile(outputPath, 'utf8').catch(() => '') : ''
        return { ...ran, outputText }
      }
    })
    if (result.phase === 'cancelled' || job.cancelled) {
      finishJob(state, job, { phase: 'cancelled', message: '已取消审阅' }, 'cancelled')
      return
    }
    const durationMs = Date.now() - started
    if (result.phase === 'failed') {
      finishJob(state, job, { phase: 'failed', message: result.message, durationMs, ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}) }, 'failed')
      return
    }
    finishJob(
      state,
      job,
      { phase: 'done', message: result.message, comments: result.comments, durationMs, ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {}) },
      'done'
    )
  } catch (error) {
    finishJob(state, job, { phase: 'failed', message: `审阅失败：${error instanceof Error ? error.message : String(error)}` }, 'failed')
  } finally {
    if (dir) void rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function quick(request: ReviewRequest, phase: ReviewStatus['phase'], message: string, hash = ''): ReviewStatus {
  const now = Date.now()
  return { root: request.root, phase, trigger: request.trigger, agent: request.agent, hash, message, startedAt: now, endedAt: now }
}

export async function startReview(owner: WebContents, raw: unknown): Promise<ReviewStatus> {
  const request = parseReviewRequest(raw)
  const settings = getSettings().review
  if (!triggerAllowed(request.trigger, settings)) return quick(request, 'skipped', '自动审阅没有打开')
  let diff
  try {
    diff = await reviewDiff(request.root, request.base)
  } catch (error) {
    return quick(request, 'failed', `没能读取改动：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!diff) return quick(request, 'failed', '不是 git 仓库')
  if (diff.text === '') return quick(request, 'skipped', '没有要审阅的改动')
  const hash = diffHash(diff.text)
  const state = stateOf(request.root)
  const decision = decideReview(state.memory, hash)
  if (decision.kind === 'skip') {
    if (decision.reason === 'in-flight' && state.job) return state.job.status
    return quick(request, 'skipped', '这份改动已经审过', hash)
  }
  if (decision.kind === 'replace' && state.job) cancelJob(state, state.job, '改动变了，已取消上一次审阅')
  state.memory = beginReview(state.memory, hash)
  const job: Job = {
    hash,
    owner,
    cancelled: false,
    child: null,
    status: { root: request.root, phase: 'running', trigger: request.trigger, agent: request.agent, hash, message: '正在审阅…', startedAt: Date.now() }
  }
  state.job = job
  hookOwner(owner)
  send(owner, job.status)
  void drive(state, job, diff.cwd, diff.text, settings)
  return job.status
}

function cancelJob(state: RootState, job: Job, message: string): void {
  if (job.cancelled) return
  job.cancelled = true
  stopChild(job.child)
  finishJob(state, job, { phase: 'cancelled', message }, 'cancelled')
}

export function cancelReview(root: string): void {
  const state = roots.get(root)
  if (state?.job) cancelJob(state, state.job, '已取消审阅')
}

const hooked = new WeakSet<WebContents>()

/** A window that goes away takes its reviews with it: nobody would see the result. */
function hookOwner(owner: WebContents): void {
  if (hooked.has(owner)) return
  hooked.add(owner)
  owner.once('destroyed', () => {
    for (const state of roots.values()) if (state.job?.owner === owner) cancelJob(state, state.job, '窗口已关闭')
  })
}

export async function turnStarted(root: string): Promise<void> {
  stateOf(root).turnHead = (await headCommit(root)) || null
}

/** A turn ended: review when it committed and 一轮结束且有新提交时 is on. */
export async function turnEnded(owner: WebContents, root: string, agent: ReviewAgent): Promise<void> {
  const state = stateOf(root)
  const before = state.turnHead
  state.turnHead = null
  const settings = getSettings().review
  if (!triggerAllowed('turn', settings) || before === null) return
  const after = await headCommit(root)
  if (!after || after === before) return
  await startReview(owner, { root, agent, trigger: 'turn' }).catch(() => {})
}

const isRoot = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && value.length <= MAX_ROOT && !value.includes('\0')

export function registerBackgroundReviewHandlers(): void {
  ipcMain.handle(REVIEW_IPC.start, (event, raw: unknown) => startReview(event.sender, raw))
  ipcMain.on(REVIEW_IPC.cancel, (_event, root: unknown) => {
    if (isRoot(root)) cancelReview(root)
  })
  ipcMain.on(REVIEW_IPC.turnStarted, (_event, root: unknown) => {
    if (isRoot(root)) void turnStarted(root)
  })
  ipcMain.on(REVIEW_IPC.turnEnded, (event, root: unknown, agent: unknown) => {
    if (isRoot(root) && AGENTS.has(agent)) void turnEnded(event.sender, root, agent as ReviewAgent)
  })
  app.on('before-quit', () => {
    for (const state of roots.values()) if (state.job) cancelJob(state, state.job, '已退出')
  })
}
