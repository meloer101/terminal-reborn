// 自动修复 and 通过后合并 (PRD F16 v1.63 · L3, v1.78), the bridge. Both are off until the user turns them on (per PR in
// Git · 变更, or for new PRs in 设置 · 自动化 · PR): they spend the user's quota and act on GitHub as the user.
//
// 自动修复 watches two places: a PR's required checks and allowed review threads, and the base's CI after 合并到 main
// 并推送 pushed it. It waits for the worktree's agent to be idle, hands it the failure through the ship handoff
// (`window.tr.ship.handoff`, fix.md) and presses Enter. The agent fixes and COMMITS but never pushes: at its next Stop
// Wavi looks at the fix's diff against the brakes (src/shared/auto-fix-brakes.ts) and pushes it — `pr.push` for a PR,
// `ship.shipToMain` for the base — or stops with a row that asks the user (Figma 29G). auto-fix-model.ts decides when to
// send and what the rows say. 通过后合并 is GitHub auto-merge (or Wavi's own wait); a new allowed thread or a P0 / P1
// review turns it off again, since GitHub would merge past them.
import { beforeFix, brakeDecision, brakeLabel, failureKey } from '@shared/auto-fix-brakes'
import { prThreadsPrompt, type PrStatus, type PrThread, type PullRequestInfo } from '@shared/pull-requests'
import { DEFAULT_SETTINGS, type PrSettings } from '@shared/settings'
import { handoffPrompt, type HandoffContext, type HandoffFailure } from '@shared/ship-handoff'
import type { Session } from '@shared/types'
import { interruptAgent, submitPrompt } from '../session-io'
import { useBackgroundReview } from '../review/background'
import { useWorkspace } from '../state/workspace'
import {
  afterPushed,
  afterSend,
  allowedThreads,
  autoFixDecision,
  baseFixDecision,
  fixNote,
  freshAutomation,
  mergeWhenGreenOn,
  takenOver,
  type FixRun,
  type FixScope,
  type PrAutomation
} from './auto-fix-model'
import { acceptBaseCi, setBaseAutomation, useBaseCi } from './base-ci'
import { prWatchTargets, setAutomation, setPrNotice, usePullRequests } from './store'

/** Every 自动修复 prompt starts with this, so its own UserPromptSubmit is not taken for the user taking over. */
export const AUTO_FIX_MARK = '（Wavi 自动修复'

let settings: PrSettings = DEFAULT_SETTINGS.pr
const sending = new Set<string>()
/** Scope + worktree whose Stop is being looked at (diff, brakes, push). */
const handling = new Set<string>()
/** Scope + worktree → when 自动修复 first wanted to send a failure whose log GitHub did not give yet. */
const awaitingLog = new Map<string, number>()
/** How long to wait for a failed run's log (GitHub publishes it some seconds after the run, and the PR list can lag). */
const LOG_WAIT_MS = 180_000
const LOG_RETRY_MS = 15_000
/** Worktree → the PR number whose new-PR defaults were applied (once per PR). */
const initialized = new Map<string, number>()
/** Worktree → the base commit whose CI the base automation last looked at. */
const baseSeen = new Map<string, string>()

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The worktree's agent session (the active one when it is there), or null. */
function agentFor(worktreePath: string): Session | null {
  const state = useWorkspace.getState()
  const ids = new Set(state.worktrees.filter((w) => w.path === worktreePath).map((w) => w.id))
  const sessions = state.sessions.filter((s) => ids.has(s.worktreeId) && (s.kind === 'claude' || s.kind === 'codex'))
  return sessions.find((s) => s.id === state.activeSessionId) ?? sessions[0] ?? null
}

export const agentIdle = (session: Session | null): boolean =>
  session !== null && session.phase !== 'exited' && session.phase !== 'not-started' && (session.status === 'idle' || session.status === 'done_unread')

export const agentName = (session: Session | null): string => (session?.kind === 'codex' ? 'Codex' : 'Claude')

function projectRootOf(worktreePath: string): string | null {
  const state = useWorkspace.getState()
  const worktree = state.worktrees.find((w) => w.path === worktreePath)
  return state.projects.find((p) => p.id === worktree?.projectId)?.rootPath ?? null
}

/** A system notification that opens the session when clicked (status/bridge.ts). */
function notify(session: Session, body: string): void {
  window.tr.ui.notify({ title: session.title, body, tag: session.id })
}

// ── the automation state of a scope ─────────────────────────────────────────────────────────────────────────────

const idOf = (scope: FixScope, worktreePath: string): string => `${scope}:${worktreePath}`

function read(scope: FixScope, worktreePath: string): PrAutomation | undefined {
  return scope === 'pr' ? usePullRequests.getState().automation[worktreePath] : useBaseCi.getState().automation[worktreePath]
}

function write(scope: FixScope, worktreePath: string, next: PrAutomation | null): void {
  if (scope === 'pr') setAutomation(worktreePath, next)
  else setBaseAutomation(worktreePath, next)
}

interface FixCtx {
  scope: FixScope
  worktree: string
  root: string
  session: Session
}

function ctxFor(scope: FixScope, worktreePath: string, session: Session | null = agentFor(worktreePath)): FixCtx | null {
  const root = projectRootOf(worktreePath)
  return root && session ? { scope, worktree: worktreePath, root, session } : null
}

const targetOf = (c: FixCtx): { root: string; worktree: string } => ({ root: c.root, worktree: c.worktree })

/** "PR #12" or the base's name: what a notification says the stop is about. */
function placeOf(c: FixCtx): string {
  if (c.scope === 'pr') return `PR #${usePullRequests.getState().byWorktree[c.worktree]?.pr?.number ?? ''}`
  return useBaseCi.getState().byWorktree[c.worktree]?.base ?? 'main'
}

/** Stops 自动修复 for `why` (shown on its row, notified once). */
function stopWith(c: FixCtx, why: string): void {
  const state = read(c.scope, c.worktree)
  if (!state) return
  write(c.scope, c.worktree, { ...state, run: null, stopped: why })
  notify(c.session, `${placeOf(c)}：${why}`)
}

/** The worktree branch's HEAD, from the git graph's log (the page carries HEAD of `root`). */
async function headOf(worktreePath: string): Promise<string | null> {
  const page = await window.tr.git.log({ root: worktreePath, skip: 0, limit: 1, scope: 'worktrees', remotes: false, known: [worktreePath] }).catch(() => null)
  return page?.head ?? null
}

// ── 通过后合并 ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Turns 通过后合并 on (GitHub auto-merge, or Wavi waits) or off. Returns the line to show when it did not work. */
export async function setMergeWhenGreen(worktreePath: string, on: boolean): Promise<string | null> {
  const root = projectRootOf(worktreePath)
  const details = usePullRequests.getState().byWorktree[worktreePath]?.pr?.details
  if (!root || !details) return '没能读到 PR 的状态'
  const result = on
    ? await window.tr.pr.merge({ root, worktree: worktreePath, method: details.repo.defaultMethod, when: 'when-ready', deleteRemoteBranch: false })
    : await window.tr.pr.cancelMerge({ root, worktree: worktreePath })
  if (result.ok) {
    setPrNotice(worktreePath, null)
    return null
  }
  setPrNotice(worktreePath, { tone: result.reason === 'declined' ? 'muted' : 'error', text: result.message })
  return result.message
}

export function setAutoFix(worktreePath: string, on: boolean): void {
  const status = usePullRequests.getState().byWorktree[worktreePath]
  const number = status?.pr?.number
  if (!number) return
  const current = usePullRequests.getState().automation[worktreePath]
  // Turning it on again starts over: the user looked at why it stopped.
  setAutomation(worktreePath, current && current.number === number && !on ? { ...current, autoFix: false } : freshAutomation(number, on))
}

/** 自动修复 for the worktree's base push (Figma 29E). */
export function setBaseAutoFix(worktreePath: string, on: boolean): void {
  const current = useBaseCi.getState().automation[worktreePath]
  setBaseAutomation(worktreePath, current && !on ? { ...current, autoFix: false } : freshAutomation(0, on))
}

/** 自动修复 would send for this PR now if the agent were idle (the row says 等 Claude 空闲 while it is busy). */
export function prWantsFix(worktreePath: string, status: Pick<PrStatus, 'pr'>): boolean {
  const state = usePullRequests.getState().automation[worktreePath]
  if (!status.pr || !state || state.number !== status.pr.number) return false
  return autoFixDecision(state, { pr: status.pr, agentIdle: true, max: settings.maxAutoFixes, bots: settings.bots }).kind === 'send'
}

export function baseWantsFix(worktreePath: string): boolean {
  const state = useBaseCi.getState().automation[worktreePath]
  return Boolean(state) && baseFixDecision(state!, { ci: useBaseCi.getState().byWorktree[worktreePath], agentIdle: true, max: settings.maxAutoFixes }).kind === 'send'
}

/** The unresolved threads 自动修复 may act on (the user's own, and the allowed bots'): Git · 变更 counts and sends these. */
export function actionableThreads(pr: PullRequestInfo): PrThread[] {
  return allowedThreads(pr, settings.bots)
}

// ── sending a fix ───────────────────────────────────────────────────────────────────────────────────────────────

interface Send {
  key: string
  head: string
  failing: string[]
  threads: PrThread[]
}

interface Retry {
  since: string
  previousStop: string
  baseFailing: string[] | null
}

/**
 * Hands the failure to the agent and presses Enter. Before the first fix of a failure it asks whether the base fails
 * the same checks already (the row then waits for the user). `retry`: 让 Claude 重修 after a brake, from the same
 * head, told what stopped the last one.
 */
async function sendFix(c: FixCtx, send: Send, retry?: Retry): Promise<void> {
  const id = idOf(c.scope, c.worktree)
  if (sending.has(id)) return
  sending.add(id)
  try {
    const target = targetOf(c)
    const pr = c.scope === 'pr' ? usePullRequests.getState().byWorktree[c.worktree]?.pr : null
    const worktree = useWorkspace.getState().worktrees.find((w) => w.path === c.worktree)
    const base = c.scope === 'base' ? (useBaseCi.getState().byWorktree[c.worktree]?.base ?? 'main') : (worktree?.baseBranch ?? 'main')
    const where = c.scope === 'pr' ? String(pr?.number ?? '') : base

    let failure: HandoffFailure | null = null
    if (send.failing.length > 0) {
      const raw = c.scope === 'pr' ? await window.tr.pr.failure(c.worktree).catch(() => null) : await window.tr.ship.baseFailure(target).catch(() => null)
      if (!raw?.log && !retry) {
        // No log yet: try again shortly, and after LOG_WAIT_MS send the check names alone rather than nothing.
        const since = awaitingLog.get(id) ?? Date.now()
        awaitingLog.set(id, since)
        if (Date.now() - since < LOG_WAIT_MS) {
          setTimeout(step, LOG_RETRY_MS)
          return
        }
      }
      awaitingLog.delete(id)
      failure = { scope: c.scope, where, checks: raw && raw.checks.length > 0 ? raw.checks : send.failing, log: raw?.log ?? '' }
    }

    let state = read(c.scope, c.worktree)
    if (!state) return
    const key = failureKey(failure?.checks ?? send.threads.map((t) => t.id), failure?.log ?? '')
    let baseFailing = retry?.baseFailing ?? null
    if (!retry && failure && !state.baseChecked) {
      baseFailing = await window.tr.ship.baseFailing(target).catch(() => null)
      const before = beforeFix({ failingChecks: failure.checks, baseFailing })
      state = read(c.scope, c.worktree)
      if (!state?.autoFix || state.run) return
      if (before.kind === 'ask') {
        write(c.scope, c.worktree, { ...state, run: { kind: 'stopped', sessionId: c.session.id, since: null, key, checks: failure.checks, baseFailing, decision: before } })
        notify(c.session, `${placeOf(c)}：${brakeLabel(before)}`)
        return
      }
    }

    const slot = await window.tr.ship.handoff({ ...target, kind: 'fix' })
    if (!slot.ok) return stopWith(c, `自动修复已停：没能准备交接文件（${slot.message}）`)
    const since = retry?.since ?? (await headOf(c.worktree))
    if (!since) return stopWith(c, '自动修复已停：没能读到当前提交')

    state = read(c.scope, c.worktree)
    if (!state || (retry ? state.run?.kind !== 'stopped' : !state.autoFix || state.run)) return
    const context: HandoffContext = {
      kind: 'fix',
      path: slot.path,
      branch: worktree?.branch ?? '',
      base,
      template: null,
      evidence: [],
      attempt: state.attempts + 1,
      ...(failure ? { failure } : {}),
      ...(retry ? { previousStop: retry.previousStop } : {})
    }
    const parts = [`${AUTO_FIX_MARK} 第 ${state.attempts + 1} 次）`]
    parts.push(handoffPrompt(context))
    if (send.threads.length > 0) parts.push(prThreadsPrompt(pr?.number ?? null, send.threads))
    if (!failure) parts.push(`修好后提交（不要推送），并把改了什么写到 ${slot.path}。`)

    const run: FixRun = { kind: 'fixing', sessionId: c.session.id, since, key, checks: failure?.checks ?? [], baseFailing, sentAt: Date.now() }
    const sentState = retry ? { ...state, attempts: state.attempts + 1 } : afterSend(state, { kind: 'send', ...send })
    write(c.scope, c.worktree, { ...sentState, baseChecked: true, note: null, run })
    try {
      await submitPrompt(c.session.id, parts.join('\n\n'))
    } catch (error) {
      const why = errorText(error)
      stopWith(c, `自动修复已停：没能发送（${why}）`)
    }
  } finally {
    sending.delete(id)
  }
}

// ── after the agent's turn: brakes, then push ───────────────────────────────────────────────────────────────────

/** The agent's turn ended: look at what it committed against the brakes, then push it or stop. */
async function handleStop(c: FixCtx): Promise<void> {
  const id = idOf(c.scope, c.worktree)
  const state = read(c.scope, c.worktree)
  const run = state?.run
  if (!state || run?.kind !== 'fixing' || handling.has(id)) return
  handling.add(id)
  try {
    const target = targetOf(c)
    const diff = (await window.tr.ship.diffSince({ ...target, since: run.since }).catch(() => null)) ?? ''
    const note = fixNote(await window.tr.ship.readHandoff({ ...target, kind: 'fix' }).catch(() => null))
    const decision = brakeDecision({
      fixDiff: diff,
      failureKey: run.key,
      previousKeys: state.keys,
      attempts: state.pushed,
      maxAttempts: settings.maxAutoFixes,
      headMoved: diff.trim().length > 0,
      failingChecks: run.checks,
      baseFailing: run.baseFailing
    })
    const latest = read(c.scope, c.worktree)
    // The user took over (or turned it off) while the diff was read: whatever the agent committed is theirs.
    if (!latest || latest.run !== run) return
    if (!latest.autoFix) return write(c.scope, c.worktree, { ...latest, run: null, note })
    if (decision.kind === 'push') {
      write(c.scope, c.worktree, { ...latest, note })
      await pushFix(c, run)
      return
    }
    write(c.scope, c.worktree, {
      ...latest,
      note,
      run: { kind: 'stopped', sessionId: run.sessionId, since: run.since, key: run.key, checks: run.checks, baseFailing: run.baseFailing, decision }
    })
    notify(c.session, `${placeOf(c)}：${brakeLabel(decision, state.pushed)}`)
  } finally {
    handling.delete(id)
  }
}

/** Pushes the fix the agent committed: the PR's branch, or the worktree merged into the base and the base pushed. */
async function pushFix(c: FixCtx, run: FixRun): Promise<void> {
  if (run.kind === 'pushing' || (run.kind === 'stopped' && run.since === null)) return
  const before = read(c.scope, c.worktree)
  if (!before) return
  const since = run.since as string
  write(c.scope, c.worktree, { ...before, run: { kind: 'pushing', sessionId: run.sessionId, since, key: run.key, checks: run.checks, baseFailing: run.baseFailing } })
  const target = targetOf(c)
  let failed: string | null = null
  let sha: string | undefined
  try {
    if (c.scope === 'pr') {
      const result = await window.tr.pr.push(target)
      if (!result.ok) failed = result.message
    } else {
      const result = await window.tr.ship.shipToMain({ ...target, message: '', paths: null, method: 'squash' })
      if (!result.ok) failed = result.message
      else if (!result.pushed) failed = result.pushError ?? '没能推送'
      else sha = result.commit
    }
  } catch (error) {
    failed = errorText(error)
  }
  if (failed) return stopWith(c, `自动修复已停：没能推送（${failed}）`)
  const latest = read(c.scope, c.worktree)
  if (!latest) return
  const from = c.scope === 'pr' ? (usePullRequests.getState().byWorktree[c.worktree]?.pr?.details?.headOid ?? null) : (useBaseCi.getState().byWorktree[c.worktree]?.sha ?? null)
  write(c.scope, c.worktree, afterPushed(latest, run, from, sha))
  if (c.scope === 'pr') window.tr.pr.refresh(c.worktree)
}

// ── the stopped row's buttons (Figma 29G) ───────────────────────────────────────────────────────────────────────

function stoppedRunOf(scope: FixScope, worktreePath: string): Extract<FixRun, { kind: 'stopped' }> | null {
  const run = read(scope, worktreePath)?.run
  return run?.kind === 'stopped' ? run : null
}

/** 仍然推送: pushes the fix the brake stopped, after a native confirm. */
export async function pushAnyway(scope: FixScope, worktreePath: string): Promise<void> {
  const run = stoppedRunOf(scope, worktreePath)
  const c = ctxFor(scope, worktreePath)
  if (!run || !c || run.since === null) return
  const confirmed = await window.tr.ui.confirm({ message: '仍然推送这次修复？', detail: brakeLabel(run.decision, read(scope, worktreePath)?.pushed), confirmLabel: '仍然推送', cancelLabel: '取消' })
  if (confirmed && read(scope, worktreePath)?.run === run) await pushFix(c, run)
}

/** 丢弃: moves the branch back to the head the fix started from. */
export async function discardFix(scope: FixScope, worktreePath: string): Promise<void> {
  const run = stoppedRunOf(scope, worktreePath)
  const c = ctxFor(scope, worktreePath)
  if (!run || !c || run.since === null) return
  const result = await window.tr.ship.discardSince({ ...targetOf(c), since: run.since }).catch((error: unknown) => ({ ok: false as const, message: errorText(error) }))
  const state = read(scope, worktreePath)
  if (!result.ok) return setPrNotice(worktreePath, { tone: 'error', text: `没能丢弃：${result.message}` })
  if (state && state.run === run) write(scope, worktreePath, { ...state, run: null })
}

/** 让 Claude 重修: the same failure again from the same head, told why the last one stopped. Counts as an attempt. */
export async function retryFix(scope: FixScope, worktreePath: string): Promise<void> {
  const run = stoppedRunOf(scope, worktreePath)
  const state = read(scope, worktreePath)
  const c = ctxFor(scope, worktreePath)
  if (!run || !state || !c || run.since === null) return
  if (!agentIdle(c.session)) return setPrNotice(worktreePath, { tone: 'muted', text: `${agentName(c.session)} 还在忙` })
  const pr = usePullRequests.getState().byWorktree[worktreePath]?.pr
  const threads = scope === 'pr' && pr ? allowedThreads(pr, settings.bots) : []
  const send: Send = { key: state.lastKey ?? run.key, head: state.lastHead ?? run.since, failing: run.checks, threads }
  await sendFix(c, send, { since: run.since, previousStop: brakeLabel(run.decision, state.pushed), baseFailing: run.baseFailing })
}

/** 在这里修: the base failing the same checks does not matter; go on. */
export function proceedAnyway(scope: FixScope, worktreePath: string): void {
  const state = read(scope, worktreePath)
  if (state?.run?.kind === 'stopped' && state.run.decision.kind === 'ask') write(scope, worktreePath, { ...state, run: null, baseChecked: true })
  step()
}

/** 不修: leaves the failure alone. */
export function declineFix(scope: FixScope, worktreePath: string): void {
  const state = read(scope, worktreePath)
  if (state?.run?.kind === 'stopped') write(scope, worktreePath, { ...state, run: null, stopped: brakeLabel(state.run.decision, state.pushed) })
}

/** 停下: interrupts the agent's turn and stops 自动修复 until it is switched on again. */
export function stopFix(scope: FixScope, worktreePath: string): void {
  const state = read(scope, worktreePath)
  const run = state?.run
  if (!state || run?.kind !== 'fixing') return
  write(scope, worktreePath, { ...state, run: null, stopped: '自动修复已停：你停下了它' })
  void interruptAgent(run.sessionId).catch(() => undefined)
}

// ── the loop ────────────────────────────────────────────────────────────────────────────────────────────────────

function stepPr(worktreePath: string, status: PrStatus): void {
  const pr = status.pr
  if (!pr || (pr.state !== 'open' && pr.state !== 'draft')) return
  const { automation } = usePullRequests.getState()
  let state = automation[worktreePath]
  // Another PR on this branch starts from the defaults again.
  if (initialized.get(worktreePath) !== pr.number) {
    initialized.set(worktreePath, pr.number)
    if (!state || state.number !== pr.number) {
      state = freshAutomation(pr.number, settings.autoFix)
      setAutomation(worktreePath, state)
      if (settings.mergeWhenGreen && pr.details && !mergeWhenGreenOn(status)) void setMergeWhenGreen(worktreePath, true)
    }
  }
  // 通过后合并 does not merge past a thread 自动修复 would act on, or a P0 / P1 the review found.
  if (mergeWhenGreenOn(status) && !pr.details?.inMergeQueue) {
    const review = useBackgroundReview.getState().byRoot[worktreePath]
    const severe = review?.phase === 'done' ? (review.counts?.P0 ?? 0) + (review.counts?.P1 ?? 0) : 0
    if (allowedThreads(pr, settings.bots).length > 0 || severe > 0) {
      void setMergeWhenGreen(worktreePath, false).then((failure) => {
        if (!failure) setPrNotice(worktreePath, { tone: 'muted', text: severe > 0 ? '审阅有 P0 / P1，已取消检查通过后合并' : '有没解决的评论，已取消检查通过后合并' })
      })
    }
  }
  const session = agentFor(worktreePath)
  const c = ctxFor('pr', worktreePath, session)
  if (!state?.autoFix || sending.has(idOf('pr', worktreePath)) || !c) return
  const decision = autoFixDecision(state, { pr, agentIdle: agentIdle(session), max: settings.maxAutoFixes, bots: settings.bots })
  if (decision.kind === 'stop') {
    setAutomation(worktreePath, { ...state, stopped: decision.reason })
    notify(c.session, `PR #${pr.number}：${decision.reason}`)
  } else if (decision.kind === 'send') void sendFix(c, decision)
}

function stepBase(worktreePath: string): void {
  const ci = useBaseCi.getState().byWorktree[worktreePath]
  if (!ci) return
  let state = useBaseCi.getState().automation[worktreePath]
  // A commit Wavi did not push for a fix is a new 合并到 main 并推送: counting starts again.
  if (baseSeen.get(worktreePath) !== ci.sha) {
    baseSeen.set(worktreePath, ci.sha)
    if (!state || !state.pushedShas.includes(ci.sha)) {
      state = freshAutomation(0, state?.autoFix ?? settings.autoFix)
      setBaseAutomation(worktreePath, state)
    }
  }
  const session = agentFor(worktreePath)
  const c = ctxFor('base', worktreePath, session)
  if (!state?.autoFix || sending.has(idOf('base', worktreePath)) || !c) return
  const decision = baseFixDecision(state, { ci, agentIdle: agentIdle(session), max: settings.maxAutoFixes })
  if (decision.kind === 'stop') {
    setBaseAutomation(worktreePath, { ...state, stopped: decision.reason })
    notify(c.session, `${ci.base}：${decision.reason}`)
  } else if (decision.kind === 'send') void sendFix(c, decision)
}

function step(): void {
  const { byWorktree, gh } = usePullRequests.getState()
  if (gh === 'ready') {
    for (const [worktreePath, status] of Object.entries(byWorktree)) stepPr(worktreePath, status)
  }
  for (const worktreePath of Object.keys(useBaseCi.getState().byWorktree)) stepBase(worktreePath)
}

/** Base CI from main, plus one ask per worktree for a CI that settled before this window loaded. */
function watchBaseCi(): () => void {
  const off = window.tr.ship.onBaseCi(acceptBaseCi)
  const asked = new Set<string>()
  const ask = (): void => {
    for (const target of prWatchTargets(useWorkspace.getState())) {
      if (asked.has(target.worktree)) continue
      asked.add(target.worktree)
      void window.tr.ship
        .baseCi(target)
        .then((ci) => ci && acceptBaseCi(ci))
        .catch(() => undefined)
    }
  }
  ask()
  const offWorkspace = useWorkspace.subscribe((s, prev) => {
    if (s.worktrees !== prev.worktrees) ask()
  })
  return () => {
    off()
    offWorkspace()
  }
}

let started = false

/** Once per window. Returns a function that stops listening. */
export function startPrAutomation(): () => void {
  if (started) return () => {}
  started = true
  const offSettings = window.tr.settings.onChange((next) => {
    settings = next.pr
  })
  void window.tr.settings.get().then((initial) => {
    settings = initial.pr
    step()
  })
  const offPr = usePullRequests.subscribe((s, prev) => {
    if (s.byWorktree !== prev.byWorktree || s.automation !== prev.automation) step()
  })
  const offBase = useBaseCi.subscribe((s, prev) => {
    if (s.byWorktree !== prev.byWorktree || s.automation !== prev.automation) step()
  })
  const offBaseWatch = watchBaseCi()
  const offWorkspace = useWorkspace.subscribe((s, prev) => {
    if (s.sessions !== prev.sessions) step()
  })
  const sessionWorktree = (sessionId: string): string | undefined => {
    const state = useWorkspace.getState()
    const session = state.sessions.find((s) => s.id === sessionId)
    return state.worktrees.find((w) => w.id === session?.worktreeId)?.path
  }
  const offEvents = window.tr.agent.onEvent(({ sessionId, event }) => {
    const path = sessionWorktree(sessionId)
    if (!path) return
    if (event.type === 'stop' || event.type === 'stop-failure') {
      // The turn of a fix ended: the brakes, then the push.
      const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId) ?? null
      for (const scope of ['pr', 'base'] as const) {
        const run = read(scope, path)?.run
        const c = ctxFor(scope, path, session)
        if (c && run?.kind === 'fixing' && run.sessionId === sessionId) void handleStop(c)
      }
      return
    }
    // The user's own message in the session: counting starts from zero again (it may also have been the fix).
    if (event.type !== 'prompt-submit' || event.prompt.startsWith(AUTO_FIX_MARK)) return
    for (const scope of ['pr', 'base'] as const) {
      const current = read(scope, path)
      if (current && (current.attempts > 0 || current.run)) write(scope, path, takenOver(current))
    }
  })
  return () => {
    started = false
    offSettings()
    offPr()
    offBase()
    offBaseWatch()
    offWorkspace()
    offEvents()
  }
}
