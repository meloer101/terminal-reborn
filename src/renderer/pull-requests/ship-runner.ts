// Runs Git · 变更's two exits (PRD F16 v1.78, Figma 29C–29I): the session's agent writes the text (a handoff file, or a
// headless run when the session cannot take a message), the user looks at it, then Wavi runs the mechanical steps.
// The state lives here, per worktree, so the Ship block can close and open (图谱 ↔ 变更) without losing a run; the
// block only draws it (ship-flow.ts is the pure part).
import { create } from 'zustand'
import { agentName, claudeOrCodex, hasHooks } from '@shared/agents'
import type { GitFailure } from '@shared/git-failures'
import { reviewEvidence, evidenceBlock, withEvidence } from '@shared/pull-requests'
import type { PrTarget } from '@shared/pull-requests'
import type { AppSettings } from '@shared/settings'
import { handoffPrompt, parseCommitHandoff, parsePrHandoff, type HandoffContext, type HandoffKind } from '@shared/ship-handoff'
import { writerFor } from '@shared/ship-writer'
import type { ReviewAgent } from '@shared/background-review'
import type { SavedShipContext, SavedShipRun } from '@shared/saved-runs'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ShipError, StepId } from '@shared/ship'
import { agentHandoffPrompt } from '@shared/ship-chain'
import type { Session, SessionId } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { cancelBackgroundReview, startBackgroundReview, useBackgroundReview } from '../review/background'
import { insertIntoTerminal, submitPrompt } from '../session-io'
import { addSnapshotPart, initialWorkspaceFile, requestSave } from '../state/persistence'
import { useWorkspace } from '../state/workspace'
import { openPullRequest } from './actions'
import {
  agentFree,
  backToGlance,
  begin,
  canTakeMessage,
  complete,
  conflictPrompt,
  createFailureStep,
  divergedPrompt,
  fail,
  failurePrompt,
  formatCommit,
  interruptedShip,
  isExitRun,
  mainFailureStep,
  markFailed,
  parseRemembered,
  POLL_MS,
  rememberedKey,
  rememberedKindOf,
  retry,
  setTexts,
  startState,
  syncConflictText,
  toGlance,
  toRunning,
  waitNote,
  withoutWriter,
  writeFailedToGlance,
  WRITE_TIMEOUT_MS,
  type ShipKind,
  type ShipState,
  type ShipTexts
} from './ship-flow'
import { setPrNotice } from './store'

/** Everything a run needs that does not change while it runs: what is saved with it, and the settings. */
export type ShipContext = SavedShipContext & { settings: Pick<AppSettings, 'review' | 'pr'> }

export const useShips = create<{ byWorktree: Record<string, ShipState> }>()(() => ({ byWorktree: {} }))

interface Run {
  ctx: ShipContext
  kind: ShipKind
  token: number
  /** The commit went in inside a shipToMain that then failed: a retry does not commit again. */
  committed: boolean
  /** The merge commit a shipToMain kept although its push failed: the retry pushes it (if the base still has it). */
  merged?: string
  /** Taken up after a reload: main may have committed or merged meanwhile, so the first retry asks before it acts. */
  resumed?: boolean
  /** 同步: how far the branch is behind the base when it started (the hand-off names it); null when not known. */
  behind?: number | null
}

/** What a run of 同步 needs beyond its context. */
export interface ShipStartOptions {
  /** A branch never pushed is rebased onto the base, a pushed one merges it (ShipPreflight.pushed). */
  syncMode?: 'rebase' | 'merge'
  behind?: number | null
}

const runs = new Map<string, Run>()
let counter = 0

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const alive = (worktree: string, token: number): boolean => runs.get(worktree)?.token === token
const current = (worktree: string): ShipState | undefined => useShips.getState().byWorktree[worktree]

/** Applies `fn` to the run's state unless the run was cancelled. */
function patch(worktree: string, token: number, fn: (state: ShipState) => ShipState): boolean {
  if (!alive(worktree, token)) return false
  useShips.setState((s) => {
    const state = s.byWorktree[worktree]
    return state ? { byWorktree: { ...s.byWorktree, [worktree]: fn(state) } } : s
  })
  return true
}

const sessionOf = (id: SessionId | null): Session | undefined => (id ? useWorkspace.getState().sessions.find((s) => s.id === id) : undefined)

/** Whether the session's agent takes the message in its terminal (an agent with hooks, so its Stop is seen). */
function viaAgent(ctx: ShipContext): boolean {
  const session = sessionOf(ctx.sessionId)
  return canTakeMessage(session, hasHooks(session?.kind))
}

const WRITER_NAME = { claude: 'Claude', codex: 'Codex' } as const

/** The agent as the steps name it: the session's, or the CLI that writes headlessly. */
export function agentLabelFor(ctx: Pick<ShipContext, 'sessionId' | 'settings'>): string {
  const session = sessionOf(ctx.sessionId)
  if (session && canTakeMessage(session, hasHooks(session.kind))) return agentName(session.kind)
  return WRITER_NAME[writerFor(ctx.settings.pr, claudeOrCodex(session?.kind)).agent]
}

function reviewAgentOf(ctx: ShipContext): ReviewAgent | null {
  return claudeOrCodex(sessionOf(ctx.sessionId)?.kind)
}

function reviewWanted(ctx: ShipContext, kind: ShipKind): boolean {
  const { review } = ctx.settings
  if (kind !== 'main' && kind !== 'pr' && kind !== 'push-pr') return false
  if (review.mode !== 'builtin' || !reviewAgentOf(ctx)) return false
  return kind === 'main' ? review.beforeMerge || review.beforePush : review.beforePush
}

// --- the remembered exit ------------------------------------------------------------------------------------------

export function readRemembered(root: string) {
  try {
    return parseRemembered(localStorage.getItem(rememberedKey(root)))
  } catch {
    return null
  }
}

function remember(root: string, kind: ShipKind): void {
  if (!isExitRun(kind)) return
  try {
    localStorage.setItem(rememberedKey(root), rememberedKindOf(kind))
  } catch {
    // Not remembered; the preflight's suggestion stands.
  }
}

// --- across a reload (saved-runs.ts) -------------------------------------------------------------------------------

/** Every open block with what its run knows, for the workspace file (the settings are read again on the way back). */
export function savedShipRuns(): SavedShipRun[] {
  const saved: SavedShipRun[] = []
  for (const [worktree, run] of runs) {
    const state = current(worktree)
    if (!state) continue
    const { settings: _settings, ...ctx } = run.ctx
    saved.push({ kind: run.kind, ctx, committed: run.committed, ...(run.merged ? { merged: run.merged } : {}), state })
  }
  return saved
}

/** Blocks an earlier window left open come back; the step that was under way is failed for 重试 (interruptedShip). */
export function restoreShipRuns(saved: readonly SavedShipRun[], settings: ShipContext['settings']): void {
  for (const item of saved) {
    if (runs.has(item.ctx.worktree)) continue
    const run: Run = { ctx: { ...item.ctx, settings }, kind: item.kind, token: ++counter, committed: item.committed, resumed: true }
    if (item.merged) run.merged = item.merged
    runs.set(item.ctx.worktree, run)
    useShips.setState((s) => ({ byWorktree: { ...s.byWorktree, [item.ctx.worktree]: interruptedShip(item.state) } }))
  }
}

/** Once per window (AppShell): open blocks are saved with the workspace and taken up again after a reload. */
let restoredOnce = false

export function startShipRuns(): () => void {
  // Before the first save can go out without them; the settings follow when they arrive.
  if (!restoredOnce) {
    restoredOnce = true
    restoreShipRuns(initialWorkspaceFile()?.shipRuns ?? [], { review: DEFAULT_SETTINGS.review, pr: DEFAULT_SETTINGS.pr })
  }
  const offSnapshot = addSnapshotPart(() => {
    const shipRuns = savedShipRuns()
    return shipRuns.length > 0 ? { shipRuns } : {}
  })
  const offSaves = useShips.subscribe((s, prev) => {
    if (s.byWorktree !== prev.byWorktree) requestSave()
  })
  void window.tr.settings.get().then((all) => {
    for (const run of runs.values()) if (run.resumed) run.ctx = { ...run.ctx, settings: { review: all.review, pr: all.pr } }
  })
  return () => {
    offSnapshot()
    offSaves()
  }
}

// --- starting and steering ----------------------------------------------------------------------------------------

export function startShip(ctx: ShipContext, kind: ShipKind, title: string, options: ShipStartOptions = {}): void {
  if (runs.has(ctx.worktree)) return
  const token = ++counter
  runs.set(ctx.worktree, { ctx, kind, token, committed: false, behind: options.behind ?? null })
  const state = startState(
    {
      kind,
      agent: agentLabelFor(ctx),
      base: ctx.base,
      branch: ctx.branch,
      remote: ctx.remote,
      review: reviewWanted(ctx, kind),
      uncommitted: (ctx.paths?.length ?? 0) > 0,
      ...(ctx.method ? { method: ctx.method } : {}),
      ...(options.syncMode ? { syncMode: options.syncMode } : {})
    },
    title
  )
  useShips.setState((s) => ({
    byWorktree: { ...s.byWorktree, [ctx.worktree]: state }
  }))
  void drive(ctx.worktree, token)
}

/** 取消: forgets the run. What the agent or a headless run is still doing is left to finish (or stopped, if headless). */
export function cancelShip(worktree: string): void {
  const run = runs.get(worktree)
  if (!run) return
  runs.delete(worktree)
  window.tr.pr.cancelWrite(worktree)
  if (useBackgroundReview.getState().byRoot[worktree]?.phase === 'running' && current(worktree)?.steps.some((s) => s.id === 'review' && s.state === 'working'))
    cancelBackgroundReview(worktree)
  useShips.setState((s) => {
    const { [worktree]: _gone, ...rest } = s.byWorktree
    return { byWorktree: rest }
  })
}

export function editShip(worktree: string, edit: Partial<ShipTexts>): void {
  useShips.setState((s) => {
    const state = s.byWorktree[worktree]
    return state ? { byWorktree: { ...s.byWorktree, [worktree]: setTexts(state, edit) } } : s
  })
}

/** The glance's go: Wavi's own steps run. */
export function submitShip(worktree: string): void {
  const run = runs.get(worktree)
  const state = current(worktree)
  if (!run || !state || state.stage !== 'glance') return
  if (patch(worktree, run.token, toRunning)) void drive(worktree, run.token)
}

export function retryShip(worktree: string): void {
  const run = runs.get(worktree)
  const state = current(worktree)
  if (!run || !state?.error) return
  if (patch(worktree, run.token, retry)) void drive(worktree, run.token)
}

/** What 交给 <agent> puts into the input line for a failed step: the text worked out when it failed, else the files. */
export function handoffText(error: ShipError | null | undefined, base: string): string | null {
  if (!error) return null
  if (error.prompt) return error.prompt
  if (error.conflicts && error.conflicts.length > 0) return conflictPrompt(base, error.conflicts)
  return null
}

/** 交给 agent 解: the conflicting files, or a failure the agent can fix, go into the agent's input line (no Enter) and
 *  the run ends. */
export async function handConflictsToAgent(worktree: string): Promise<void> {
  const run = runs.get(worktree)
  const text = handoffText(current(worktree)?.error, run?.ctx.base ?? 'main')
  if (!run || !text || !run.ctx.sessionId) return
  const { sessionId } = run.ctx
  try {
    useWorkspace.getState().setActiveSession(sessionId)
    await ensureAgentUp(sessionId)
    await insertIntoTerminal(sessionId, text)
    useWorkspace.getState().requestTerminalFocus()
    cancelShip(worktree)
  } catch (error) {
    patch(worktree, run.token, (s) =>
      s.error
        ? {
            ...s,
            error: {
              ...s.error,
              message: `没能交给 agent：${errorText(error)}`
            }
          }
        : s
    )
  }
}

/** 改为创建 PR: the base's push was refused, so the branch goes up as a PR instead. */
export function switchToPr(worktree: string): void {
  const run = runs.get(worktree)
  if (!run) return
  const { ctx } = run
  cancelShip(worktree)
  startShip({ ...ctx, paths: null }, 'pr', '创建 PR')
}

function drive(worktree: string, token: number): Promise<void> {
  const state = current(worktree)
  if (!state || !alive(worktree, token)) return Promise.resolve()
  return state.stage === 'running' ? runPhase(worktree, token) : writePhase(worktree, token)
}

// --- writing ------------------------------------------------------------------------------------------------------

async function writePhase(worktree: string, token: number): Promise<void> {
  const run = runs.get(worktree)
  if (!run) return
  const { ctx, kind } = run
  const first = current(worktree)
  if (!first) return
  if (first.steps.some((s) => s.id === 'review' && (s.state === 'working' || s.state === 'pending'))) {
    await reviewStep(worktree, token, ctx, kind)
    if (!alive(worktree, token)) return
  }
  const state = current(worktree)
  if (!state) return
  if (!state.steps.some((s) => s.id === 'write')) {
    if (patch(worktree, token, toRunning)) await runPhase(worktree, token)
    return
  }
  const agent = viaAgent(ctx)
  // 提交… needs no AI: with nobody to write, the user types the message (Figma 73F2).
  if (kind === 'commit' && !agent && !(await headlessWriterInstalled(ctx))) {
    patch(worktree, token, withoutWriter)
    return
  }
  if (!alive(worktree, token)) return
  patch(worktree, token, (s) => begin(s, 'write'))
  const written = agent ? await writeWithAgent(worktree, token, ctx, kind) : await writeHeadless(worktree, token, ctx, kind)
  if (!alive(worktree, token)) return
  if (!written.ok) patch(worktree, token, (s) => (kind === 'commit' ? writeFailedToGlance(s, written.message) : fail(s, { step: 'write', message: written.message })))
  else patch(worktree, token, (s) => toGlance(s, written.texts))
}

/** Whether the CLI a headless write would run is installed (unknown counts as installed: the write says why it failed). */
async function headlessWriterInstalled(ctx: ShipContext): Promise<boolean> {
  const writer = writerFor(ctx.settings.pr, claudeOrCodex(sessionOf(ctx.sessionId)?.kind)).agent
  try {
    const found = await window.tr.app.detectAgents()
    return found[writer] !== false
  } catch {
    return true
  }
}

type Written = { ok: true; texts: ShipTexts } | { ok: false; message: string }

async function reviewStep(worktree: string, token: number, ctx: ShipContext, kind: ShipKind): Promise<void> {
  const agent = reviewAgentOf(ctx)
  if (!agent) {
    patch(worktree, token, (s) => complete(s, 'review', '没有可用的审阅'))
    return
  }
  try {
    await startBackgroundReview(ctx.worktree, agent, kind === 'main' ? 'merge' : 'push', ctx.base)
  } catch (error) {
    patch(worktree, token, (s) => markFailed(s, 'review', `没能开始：${errorText(error)}`))
    return
  }
  await new Promise<void>((resolve) => {
    const done = (): boolean => !alive(worktree, token) || useBackgroundReview.getState().byRoot[ctx.worktree]?.phase !== 'running'
    if (done()) return resolve()
    const off = useBackgroundReview.subscribe((s) => {
      const message = s.byRoot[ctx.worktree]?.message
      if (message) patch(worktree, token, (state) => begin(state, 'review', message))
      if (done()) {
        off()
        resolve()
      }
    })
  })
  if (!alive(worktree, token)) return
  const review = useBackgroundReview.getState().byRoot[ctx.worktree]
  if (!review || review.phase === 'done' || review.phase === 'skipped') {
    const found = review?.found ?? 0
    patch(worktree, token, (s) => complete(s, 'review', found > 0 ? `找到 ${found} 条` : (review?.note ?? '没有发现问题')))
  } else patch(worktree, token, (s) => markFailed(s, 'review', review.phase === 'cancelled' ? '审阅已取消' : `审阅失败：${review.message}`))
}

/** The facts the PR text ends with: this turn's checks and the review's counts (PRD F16 v1.63's evidence block). */
function evidenceParts(ctx: ShipContext): {
  checks: string | null
  review: string | null
} {
  if (!ctx.settings.pr.evidence) return { checks: null, review: null }
  const review = useBackgroundReview.getState().byRoot[ctx.worktree]
  return {
    checks: ctx.checksLine,
    review: review?.phase === 'done' ? reviewEvidence(WRITER_NAME[review.agent], review.counts ?? {}) : null
  }
}

const evidenceLines = (ctx: ShipContext): string[] => Object.values(evidenceParts(ctx)).filter((l): l is string => Boolean(l))

async function waitUntil(test: () => boolean, ms: number, isAlive: () => boolean): Promise<'ok' | 'timeout' | 'cancelled'> {
  if (!isAlive()) return 'cancelled'
  if (test()) return 'ok'
  return new Promise((resolve) => {
    const finish = (result: 'ok' | 'timeout' | 'cancelled'): void => {
      clearTimeout(timer)
      clearInterval(poll)
      off()
      resolve(result)
    }
    const off = useWorkspace.subscribe(() => {
      if (test()) finish('ok')
    })
    const poll = setInterval(() => {
      if (!isAlive()) finish('cancelled')
    }, 500)
    const timer = setTimeout(() => finish('timeout'), ms)
  })
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function writeWithAgent(worktree: string, token: number, ctx: ShipContext, kind: ShipKind): Promise<Written> {
  const sessionId = ctx.sessionId!
  const agent = agentLabelFor(ctx)
  const target: PrTarget = { root: ctx.root, worktree: ctx.worktree }
  const withCommit = (ctx.paths?.length ?? 0) > 0
  const wantsPr = kind === 'pr'
  const wantsCommit = kind === 'main' || withCommit
  try {
    const slots: Partial<Record<HandoffKind, string>> = {}
    for (const slot of [...(wantsPr ? (['pr'] as const) : []), ...(wantsCommit ? (['commit'] as const) : [])]) {
      const made = await window.tr.ship.handoff({ ...target, kind: slot })
      if (!made.ok) return { ok: false, message: made.message }
      slots[slot] = made.path
    }
    let template: string | null = null
    if (wantsPr) {
      const draft = await window.tr.pr.draft(target)
      if (draft.ok && draft.fromTemplate) template = draft.body
    }
    const primary: HandoffKind = wantsPr ? 'pr' : 'commit'
    const context: HandoffContext = {
      kind: primary,
      path: slots[primary]!,
      branch: ctx.branch,
      base: ctx.base,
      template,
      evidence: primary === 'pr' ? evidenceLines(ctx) : [],
      // Exit B with uncommitted work: the same message also asks for the commit message.
      ...(wantsPr && slots.commit ? { commitPath: slots.commit } : {})
    }
    // The agent may be busy with its own work: wait for it, and say so.
    await ensureAgentUp(sessionId)
    if (!agentFree(sessionOf(sessionId))) {
      patch(worktree, token, (s) => begin(s, 'write', waitNote(agent)))
      const waited = await waitUntil(
        () => agentFree(sessionOf(sessionId)),
        WRITE_TIMEOUT_MS,
        () => alive(worktree, token)
      )
      if (waited === 'cancelled') return { ok: false, message: '已取消' }
      if (waited === 'timeout') return { ok: false, message: `等了 10 分钟，${agent} 还没空下来` }
      patch(worktree, token, (s) => begin(s, 'write'))
    }
    const since = Date.now()
    const gate: { open: (reason: string | null) => void } = { open: () => {} }
    const stop = new Promise<string | null>((resolve) => {
      gate.open = resolve
    })
    const off = window.tr.agent.onEvent(({ sessionId: id, at, event }) => {
      if (id !== sessionId || at < since) return
      if (event.type === 'stop') gate.open(null)
      else if (event.type === 'stop-failure') gate.open(`${agent} 这一轮出错了${event.message ? `：${event.message}` : ''}`)
      else if (event.type === 'agent-exit' || event.type === 'session-end') gate.open(`${agent} 退出了`)
    })
    try {
      await submitPrompt(sessionId, handoffPrompt(context))
      return await awaitTexts(worktree, token, target, {
        wantsPr,
        wantsCommit,
        agent,
        stop,
        ctx
      })
    } finally {
      off()
    }
  } catch (error) {
    return { ok: false, message: errorText(error) }
  }
}

/** Reads what the agent wrote: when its turn ends, and every POLL_MS meanwhile (a missed Stop must not hang the run). */
async function awaitTexts(
  worktree: string,
  token: number,
  target: PrTarget,
  opts: {
    wantsPr: boolean
    wantsCommit: boolean
    agent: string
    stop: Promise<string | null>
    ctx: ShipContext
  }
): Promise<Written> {
  const read = async (): Promise<ShipTexts | null> => {
    const texts: ShipTexts = { commit: '', title: '', body: '', draft: false }
    if (opts.wantsCommit) {
      const raw = await window.tr.ship.readHandoff({
        ...target,
        kind: 'commit'
      })
      const parsed = raw === null ? null : parseCommitHandoff(raw)
      if (!parsed) return null
      texts.commit = formatCommit(parsed)
    }
    if (opts.wantsPr) {
      const raw = await window.tr.ship.readHandoff({ ...target, kind: 'pr' })
      const parsed = raw === null ? null : parsePrHandoff(raw)
      if (!parsed) return null
      texts.title = parsed.title
      texts.body = parsed.body
    }
    return texts
  }
  const deadline = Date.now() + WRITE_TIMEOUT_MS
  let ended: string | null | undefined
  void opts.stop.then((reason) => {
    ended = reason
  })
  let late = 0
  for (;;) {
    if (!alive(worktree, token)) return { ok: false, message: '已取消' }
    try {
      const found = await read()
      if (found) return { ok: true, texts: found }
    } catch (error) {
      return { ok: false, message: errorText(error) }
    }
    if (ended !== undefined) {
      if (ended !== null) return { ok: false, message: ended }
      // The turn ended: the file may still be landing; look a few more times, then say what is missing.
      if (++late > 4)
        return {
          ok: false,
          message: `${opts.agent} 这一轮结束了，但没有写出可用的${opts.wantsPr ? '标题和正文' : '提交说明'}`
        }
    }
    if (Date.now() > deadline) return { ok: false, message: `等了 10 分钟，${opts.agent} 还没写好` }
    if (ended === undefined) await Promise.race([sleep(POLL_MS), opts.stop])
    else await sleep(700)
  }
}

/** Sessions that cannot take a message: the same texts from a headless run of the user's Claude / Codex (AI 写). */
async function writeHeadless(worktree: string, token: number, ctx: ShipContext, kind: ShipKind): Promise<Written> {
  const writer = writerFor(ctx.settings.pr, claudeOrCodex(sessionOf(ctx.sessionId)?.kind))
  const paths = ctx.paths ?? []
  const base = {
    root: ctx.root,
    worktree: ctx.worktree,
    agent: writer.agent,
    paths
  }
  const texts: ShipTexts = { commit: '', title: '', body: '', draft: false }
  try {
    if (paths.length > 0) {
      const made = await window.tr.pr.write({ ...base, kind: 'commit' })
      if (!made.ok) return { ok: false, message: made.message }
      if (made.kind === 'commit') texts.commit = made.message
    }
    if (!alive(worktree, token)) return { ok: false, message: '已取消' }
    // A branch with nothing uncommitted has no diff to describe as a commit: the merge takes the PR text's title and body.
    if (kind === 'pr' || (kind === 'main' && paths.length === 0)) {
      const made = await window.tr.pr.write({
        ...base,
        kind: 'pr',
        ...(texts.commit ? { pendingMessage: texts.commit } : {})
      })
      if (!made.ok) return { ok: false, message: made.message }
      if (made.kind === 'pr') {
        if (kind === 'main') texts.commit = formatCommit({ subject: made.title, body: made.body })
        else {
          texts.title = made.title
          texts.body = withEvidence(made.body, evidenceBlock(evidenceParts(ctx)))
        }
      }
    }
    return { ok: true, texts }
  } catch (error) {
    return { ok: false, message: errorText(error) }
  }
}

// --- running ------------------------------------------------------------------------------------------------------

async function runPhase(worktree: string, token: number): Promise<void> {
  const run = runs.get(worktree)
  const state = current(worktree)
  if (!run || !state) return
  try {
    if (run.kind === 'main') await runMain(worktree, token, run, state)
    else if (run.kind === 'commit') await runCommit(worktree, token, run, state)
    else if (run.kind === 'sync') await runSync(worktree, token, run)
    else if (run.kind === 'pull') await runPull(worktree, token, run)
    else await runPr(worktree, token, run, state)
  } catch (error) {
    // The step working now, not the one at the start: a phase runs several steps.
    const now = current(worktree) ?? state
    const stepId = now.steps.find((s) => s.state === 'working')?.id ?? now.steps.at(-1)!.id
    patch(worktree, token, (s) => fail(s, { step: stepId, message: errorText(error) }))
  }
}

const stepDone = (state: ShipState, id: string): boolean => state.steps.some((s) => s.id === id && s.state === 'done')

/**
 * A step's error with what git said (合入链路 v2): the classified failure's message (else Wavi's own), and, when the way
 * on is 交给 <agent>, the text that goes into its input line.
 */
function stepError(state: ShipState, run: Run, step: StepId, message: string, failure: GitFailure | undefined, extra: Partial<ShipError> = {}): ShipError {
  const label = state.steps.find((s) => s.id === step)?.label ?? step
  const prompt =
    failure?.next === 'handoff'
      ? failure.kind === 'diverged'
        ? divergedPrompt({ branch: run.ctx.branch, remote: run.ctx.remote ?? 'origin' })
        : failurePrompt({ step: label, failure })
      : undefined
  return { step, message: failure?.message ?? message, ...extra, ...(failure ? { failure } : {}), ...(prompt ? { prompt } : {}) }
}

/** Exit A: commit what is uncommitted, squash into the base, push it — main does all three in one call. */
async function runMain(worktree: string, token: number, run: Run, state: ShipState): Promise<void> {
  const { ctx } = run
  // Taken up after a reload: main may have finished what the old window started (shipToMain goes on without it).
  if (run.resumed && !stepDone(state, 'merge')) {
    run.resumed = false
    const now = await window.tr.ship.preflight({ root: ctx.root, worktree: ctx.worktree }).catch(() => null)
    if (!alive(worktree, token)) return
    if (now?.ok && now.uncommitted === 0 && ctx.paths) {
      run.committed = true
      patch(worktree, token, (s) => (s.steps.some((step) => step.id === 'commit') ? complete(s, 'commit') : s))
    }
    if (now?.ok && now.merged) {
      patch(worktree, token, (s) => complete(s, 'merge'))
      state = current(worktree) ?? state
    }
  }
  // After a failed push the merge stands on the local base: only the push is left.
  const mergeDone = stepDone(state, 'merge')
  const result = mergeDone
    ? await window.tr.ship.pushBase({ root: ctx.root, worktree: ctx.worktree, ...(run.merged ? { commit: run.merged } : {}) })
    : await window.tr.ship.shipToMain({
        root: ctx.root,
        worktree: ctx.worktree,
        message: state.texts.commit,
        method: ctx.method ?? 'squash',
        paths: run.committed ? null : ctx.paths
      })
  if (!alive(worktree, token)) return
  const hasCommit = state.steps.some((s) => s.id === 'commit')
  if (!result.ok) {
    if (result.reason === 'declined') {
      patch(worktree, token, backToGlance)
      return
    }
    if (result.committed) run.committed = true
    const step = mainFailureStep(result.step, state.steps)
    patch(worktree, token, (s) => {
      const committed = hasCommit && step !== 'commit' && (result.committed || run.committed) ? complete(s, 'commit') : s
      return fail(
        committed,
        stepError(committed, run, step, result.message, result.failure, {
          ...(result.output ? { output: result.output } : {}),
          ...(result.conflicts && result.conflicts.length > 0 ? { conflicts: result.conflicts } : {})
        })
      )
    })
    return
  }
  if (!mergeDone) patch(worktree, token, (s) => complete(hasCommit ? complete(s, 'commit') : s, 'merge'))
  run.merged = result.commit
  if (result.pushError) {
    patch(worktree, token, (s) => fail(s, stepError(s, run, 'push', result.pushError!, result.failure, result.pushRefused ? { pushRefused: true } : {})))
    return
  }
  patch(worktree, token, (s) => complete(s, 'push', result.pushed ? undefined : '没有远程，没有推送'))
  finish(worktree, token, `已合并到 ${ctx.base}${result.pushed ? ' 并推送' : ''} · ${result.commit.slice(0, 7)}`)
}

/** Exit B, and a push to the branch's open PR: commit if needed, then push (and create). */
async function runPr(worktree: string, token: number, run: Run, state: ShipState): Promise<void> {
  const { ctx, kind } = run
  const target: PrTarget = { root: ctx.root, worktree: ctx.worktree }
  if (state.steps.some((s) => s.id === 'commit') && !stepDone(state, 'commit')) {
    patch(worktree, token, (s) => begin(s, 'commit'))
    const made = await window.tr.pr.commit({
      ...target,
      message: state.texts.commit,
      paths: ctx.paths ?? []
    })
    if (!alive(worktree, token)) return
    if (!made.ok) {
      patch(worktree, token, (s) => fail(s, stepError(s, run, 'commit', made.message, made.failure, made.output ? { output: made.output } : {})))
      return
    }
    patch(worktree, token, (s) => complete(s, 'commit', made.commit.slice(0, 7)))
  }
  if (kind === 'push-pr') {
    patch(worktree, token, (s) => begin(s, 'push'))
    const pushed = await window.tr.pr.push(target)
    if (!alive(worktree, token)) return
    if (!pushed.ok) {
      patch(worktree, token, (s) => fail(s, stepError(s, run, 'push', pushed.message, pushed.failure)))
      return
    }
    patch(worktree, token, (s) => complete(s, 'push'))
    if (ctx.openPr) openPullRequest(ctx.openIn, ctx.openPr.url)
    finish(worktree, token, pushed.message)
    return
  }
  // gh pr create pushes the branch first: one call, two steps.
  patch(worktree, token, (s) => begin(s, 'push'))
  const created = await window.tr.pr.create({
    ...target,
    title: state.texts.title,
    body: state.texts.body,
    draft: state.texts.draft,
    pushApproved: true
  })
  if (!alive(worktree, token)) return
  if (!created.ok) {
    if (created.reason === 'declined') {
      patch(worktree, token, backToGlance)
      return
    }
    // gh pr create pushes first: a classified push failure names the push step.
    const step = created.failure && created.failure.kind !== 'not-github' && created.failure.kind !== 'no-pr' && created.failure.kind !== 'unknown' ? 'push' : createFailureStep(created.message)
    patch(worktree, token, (s) => fail(s, stepError(s, run, step, created.message, created.failure)))
    return
  }
  patch(worktree, token, (s) => complete(complete(s, 'push'), 'create'))
  openPullRequest(ctx.openIn, created.url)
  finish(worktree, token, created.number ? `已创建 PR #${created.number}` : '已创建 PR')
}

/** 提交… (Figma 73F1): commit the ticked files with the message. */
async function runCommit(worktree: string, token: number, run: Run, state: ShipState): Promise<void> {
  const { ctx } = run
  patch(worktree, token, (s) => begin(s, 'commit'))
  const made = await window.tr.pr.commit({ root: ctx.root, worktree: ctx.worktree, message: state.texts.commit, paths: ctx.paths ?? [] })
  if (!alive(worktree, token)) return
  if (!made.ok) {
    patch(worktree, token, (s) => fail(s, stepError(s, run, 'commit', made.message, made.failure, made.output ? { output: made.output } : {})))
    return
  }
  patch(worktree, token, (s) => complete(s, 'commit', made.commit.slice(0, 7)))
  finish(worktree, token, `已提交 · ${made.commit.slice(0, 7)}`)
}

/** 同步 <base> (Figma 73D1 / 73D2): main fetches, brings the base in, and on conflicts starts nothing. */
async function runSync(worktree: string, token: number, run: Run): Promise<void> {
  const { ctx } = run
  patch(worktree, token, (s) => begin(s, 'sync'))
  const result = await window.tr.ship.sync({ root: ctx.root, worktree: ctx.worktree })
  if (!alive(worktree, token)) return
  if (result.ok) {
    patch(worktree, token, (s) => complete(complete(s, 'sync', result.baseNotCaughtUp), 'merge'))
    finish(worktree, token, `已同步 ${ctx.base}`)
    return
  }
  if (result.reason === 'blocked') {
    patch(worktree, token, (s) => fail(s, { step: 'sync', message: result.message }))
    return
  }
  if (result.reason === 'conflicts') {
    const handoff = { base: ctx.base, branch: ctx.branch, behind: run.behind ?? null, conflicts: result.conflicts.length > 0 ? result.conflicts : result.files }
    const prompt = agentHandoffPrompt(result.mode === 'rebase' ? { kind: 'sync-rebase', ...handoff } : { kind: 'sync-merge', ...handoff })
    patch(worktree, token, (s) =>
      fail(complete(s, 'sync', result.baseNotCaughtUp), { step: 'merge', message: syncConflictText(result.mode, result.files), conflicts: result.files, prompt })
    )
    return
  }
  // A fetch that failed stops at 拉取; the rest at the rebase / merge.
  const { failure } = result
  const atFetch = failure.kind === 'network' || failure.kind === 'auth' || failure.kind === 'no-remote'
  patch(worktree, token, (s) => fail(atFetch ? s : complete(s, 'sync'), stepError(s, run, atFetch ? 'sync' : 'merge', failure.message, failure)))
}

/** 拉取: fast-forward the branch to its upstream. */
async function runPull(worktree: string, token: number, run: Run): Promise<void> {
  const { ctx } = run
  patch(worktree, token, (s) => begin(s, 'sync'))
  const result = await window.tr.ship.pull({ root: ctx.root, worktree: ctx.worktree })
  if (!alive(worktree, token)) return
  if (result.ok) {
    patch(worktree, token, (s) => complete(s, 'sync'))
    finish(worktree, token, `已拉取 ${ctx.remote ?? 'origin'}/${ctx.branch}`)
    return
  }
  if (result.reason === 'blocked') patch(worktree, token, (s) => fail(s, { step: 'sync', message: result.message }))
  else patch(worktree, token, (s) => fail(s, stepError(s, run, 'sync', result.failure.message, result.failure)))
}

/** Everything went through: an exit is remembered for this repository and the block goes away. */
function finish(worktree: string, token: number, notice: string): void {
  const run = runs.get(worktree)
  if (!run || run.token !== token) return
  if (isExitRun(run.kind)) remember(run.ctx.root, run.kind)
  window.tr.pr.refresh(worktree)
  runs.delete(worktree)
  useShips.setState((s) => {
    const { [worktree]: _gone, ...rest } = s.byWorktree
    return { byWorktree: rest }
  })
  setPrNotice(worktree, { tone: 'muted', text: notice })
}
