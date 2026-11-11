// Runs Git · 变更's two exits (PRD F16 v1.78, Figma 29C–29I): the session's agent writes the text (a handoff file, or a
// headless run when the session cannot take a message), the user looks at it, then Wavi runs the mechanical steps.
// The state lives here, per worktree, so the Ship block can close and open (图谱 ↔ 变更) without losing a run; the
// block only draws it (ship-flow.ts is the pure part).
import { create } from 'zustand'
import { agentName, hasHooks, headlessAgent } from '@shared/agents'
import type { GitFailure } from '@shared/git-failures'
import { reviewEvidence, evidenceBlock, withEvidence } from '@shared/pull-requests'
import type { PrTarget } from '@shared/pull-requests'
import type { AppSettings } from '@shared/settings'
import { handoffPrompt, parseCommitHandoff, parsePrHandoff, type HandoffContext, type HandoffKind } from '@shared/ship-handoff'
import { writerFor } from '@shared/ship-writer'
import type { ReviewAgent } from '@shared/background-review'
import type { SavedShipContext, SavedShipRun } from '@shared/saved-runs'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ShipError, ShipPreflight, StepId } from '@shared/ship'
import { agentHandoffPrompt, mergeConflictPrompt } from '@shared/ship-chain'
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
  createFailureStep,
  divergedPrompt,
  fail,
  failurePrompt,
  failureWay,
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
  stepWord,
  syncConflictText,
  syncOnto,
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
  /** The commit this run made of `ctx.paths` (its hash), once known: a retry after a reload does not commit again. */
  commit?: string
  /** Taken up after a reload while its commit (or 合并到 main 并推送's merge) was under way: main may have committed or
   *  merged meanwhile, so the first retry asks before it acts. */
  resumed?: boolean
  /** Taken up after a reload at all: a commit main refuses because the ticked files have nothing left to commit went in
   *  while no window watched. */
  restored?: boolean
  /** 同步: how far the branch is behind the base when it started (the hand-off names it); null when not known. */
  behind?: number | null
}

/** What a run of 同步 needs beyond its context. */
export interface ShipStartOptions {
  /** A branch never pushed is rebased onto the base, a pushed one merges it (ShipPreflight.pushed). */
  syncMode?: 'rebase' | 'merge'
  behind?: number | null
  /** The branch's tip the run starts from (the preflight the starting command just read); default: `ctx.head`, else
   *  unknown (the reload check then falls back to the older count). */
  head?: string
  /** 合并到 <base> 并推送: where the base is pushed (the preflight's `baseRemote`), for the push step's label. */
  baseRemote?: string | null
  /** 拉取: what it fetches (the preflight's `pullFrom`), for the step's label. */
  pullFrom?: string | null
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

/** The 未提交 paths the worktree's open run commits (null: none); undefined while no run is open. */
export function useShipPaths(worktree: string): readonly string[] | null | undefined {
  return useShips((s) => (s.byWorktree[worktree] ? (runs.get(worktree)?.ctx.paths ?? null) : undefined))
}

/** The agent session the run's 交给 <agent> types into: the one it started with, while it is still open; else null. */
export function shipHandoffSession(worktree: string, sessions: readonly Session[] = useWorkspace.getState().sessions): Session | null {
  const id = runs.get(worktree)?.ctx.sessionId
  const session = id ? sessions.find((s) => s.id === id) : undefined
  return session && session.kind !== 'shell' ? session : null
}

/** shipHandoffSession, for the Ship block (follows the sessions and the run). */
export function useShipHandoffSession(worktree: string): Session | null {
  useShips((s) => s.byWorktree[worktree])
  return useWorkspace((s) => shipHandoffSession(worktree, s.sessions))
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
  return WRITER_NAME[writerFor(ctx.settings.pr, headlessAgent(session?.kind)).agent]
}

function reviewAgentOf(ctx: ShipContext): ReviewAgent | null {
  return headlessAgent(sessionOf(ctx.sessionId)?.kind)
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
    saved.push({ kind: run.kind, ctx, committed: run.committed, ...(run.merged ? { merged: run.merged } : {}), ...(run.commit ? { commit: run.commit } : {}), state })
  }
  return saved
}

/** The step that was under way when the block was saved: where main may have gone on without a window. Only a commit
 *  (or 合并到 main 并推送's merge, which commits inside it) can have landed then; at the glance, the writing or a failed
 *  step nothing ran. */
function interruptedAtCommit(item: SavedShipRun): boolean {
  const working = item.state.steps.find((s) => s.state === 'working')?.id
  return working === 'commit' || (item.kind === 'main' && working === 'merge')
}

/** Blocks an earlier window left open come back; the step that was under way is failed for 重试 (interruptedShip). */
export function restoreShipRuns(saved: readonly SavedShipRun[], settings: ShipContext['settings']): void {
  for (const item of saved) {
    if (runs.has(item.ctx.worktree)) continue
    const run: Run = { ctx: { ...item.ctx, settings }, kind: item.kind, token: ++counter, committed: item.committed, restored: true, resumed: interruptedAtCommit(item) }
    if (item.merged) run.merged = item.merged
    if (item.commit) run.commit = item.commit
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
    for (const run of runs.values()) if (run.restored) run.ctx = { ...run.ctx, settings: { review: all.review, pr: all.pr } }
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
  // The tip the starting command just read (or the run's own, carried over by 改为创建 PR); never an older preflight a
  // panel left in the chain store, which would make the reload check judge commits made before the run.
  const head = options.head ?? ctx.head
  runs.set(ctx.worktree, { ctx: head ? { ...ctx, head } : ctx, kind, token, committed: false, behind: options.behind ?? null })
  const state = startState(
    {
      kind,
      agent: agentLabelFor(ctx),
      base: ctx.base,
      branch: ctx.branch,
      remote: ctx.remote,
      ...(options.baseRemote !== undefined ? { baseRemote: options.baseRemote } : {}),
      ...(options.pullFrom !== undefined ? { pullFrom: options.pullFrom } : {}),
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

/** Whether a failed step has something for 交给 <agent> to type (handoffText is not null). */
export const hasHandoffText = (error: ShipError | null | undefined): boolean => Boolean(error?.prompt || (error?.conflicts && error.conflicts.length > 0))

/** What 交给 <agent> puts into the input line for a failed step: the text worked out when it failed, else the files
 *  (a block saved before the text was worked out). */
export function handoffText(error: ShipError | null | undefined, base: string, branch: string): string | null {
  if (!error) return null
  if (error.prompt) return error.prompt
  if (error.conflicts && error.conflicts.length > 0) return mergeConflictPrompt({ base, branch, conflicts: error.conflicts })
  return null
}

/** 交给 agent 解: the conflicting files, or a failure the agent can fix, go into the agent's input line (no Enter) and
 *  the run ends. */
export async function handConflictsToAgent(worktree: string): Promise<void> {
  const run = runs.get(worktree)
  const text = run ? handoffText(current(worktree)?.error, run.ctx.base, run.ctx.branch) : null
  const session = shipHandoffSession(worktree)
  if (!run || !text || !session) return
  const sessionId = session.id
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

/** 改为创建 PR: the base's push was refused, so the branch goes up as a PR instead (offered only where 创建 PR can work,
 *  see prPossible). */
export function switchToPr(worktree: string): void {
  const run = runs.get(worktree)
  if (!run || !current(worktree)?.error?.pushRefused) return
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
  const writer = writerFor(ctx.settings.pr, headlessAgent(sessionOf(ctx.sessionId)?.kind)).agent
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
      ...(wantsPr && slots.commit ? { commitPath: slots.commit } : {}),
      // The commit takes the ticked files only: the message describes those.
      ...(slots.commit && ctx.paths && ctx.paths.length > 0 ? { files: ctx.paths } : {})
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
  const writer = writerFor(ctx.settings.pr, headlessAgent(sessionOf(ctx.sessionId)?.kind))
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

/**
 * 重试 / ⌘↵ applies: the failure's own way on is another try, or a commit failed while Wavi's steps ran — the message
 * stays editable (a commit-msg hook, a fixed identity or key) and goes in as edited, nothing is written again.
 */
export function shipCanRetry(state: Pick<ShipState, 'error' | 'failedIn'>): boolean {
  const { error } = state
  if (!error) return false
  return failureWay(error)?.kind === 'retry' || (state.failedIn === 'running' && error.step === 'commit')
}

/** Every step went through and the block stays to say something (同步 whose base could not catch up): only closing is left. */
export const shipFinished = (state: Pick<ShipState, 'error' | 'steps'>): boolean => state.error === null && state.steps.every((s) => s.state === 'done')

const stepDone = (state: ShipState, id: string): boolean => state.steps.some((s) => s.id === id && s.state === 'done')

/**
 * A step's error with what git said (合入链路 v2): the classified failure's message (else Wavi's own), and, when the way
 * on is 交给 <agent>, the text that goes into its input line.
 */
function stepError(state: ShipState, run: Run, step: StepId, message: string, failure: GitFailure | undefined, extra: Partial<ShipError> = {}): ShipError {
  const found = state.steps.find((s) => s.id === step)
  const prompt =
    failure?.next === 'handoff'
      ? failure.kind === 'diverged'
        ? divergedPrompt({ branch: run.ctx.branch, remote: run.ctx.remote ?? 'origin' })
        : failurePrompt({ step: found ? stepWord(found) : step, failure })
      : undefined
  return { step, message: failure?.message ?? message, ...extra, ...(failure ? { failure } : {}), ...(prompt ? { prompt } : {}) }
}

/** Whether every file header of a diff names one of `paths` (as its new path), and there is at least one. */
function onlyPaths(diff: string, paths: readonly string[]): boolean {
  const headers = diff.split('\n').filter((line) => line.startsWith('diff --git '))
  return headers.length > 0 && headers.every((line) => paths.some((path) => line.endsWith(` b/${path}`)))
}

/** Whether a diff has a file header for every one of `paths`. */
function namesEvery(diff: string, paths: readonly string[]): boolean {
  const headers = diff.split('\n').filter((line) => line.startsWith('diff --git '))
  return paths.every((path) => headers.some((line) => line.endsWith(` b/${path}`)))
}

/** None of `paths` is uncommitted now (the change list read now); false when that cannot be told. */
async function noneUncommitted(ctx: ShipContext): Promise<boolean> {
  const changes = await window.tr.git.changes(ctx.worktree).catch(() => null)
  if (!changes || changes.untrackedOmitted > 0) return false
  const left = new Set(changes.uncommitted.map((c) => c.path))
  return (ctx.paths ?? []).every((path) => !left.has(path))
}

/**
 * After a reload: the commit of `ctx.paths` the run made while no window watched (main goes on without the window),
 * decided from the commit, never from a count of what is left uncommitted (unticked files stay). The hash it remembers;
 * else, when it knows the tip it started from, a branch moved off that tip by a commit of exactly its files — every one
 * of them in it and none still uncommitted (a commit the agent made of some of them is not the run's) — (`now` is the
 * preflight read now). null: not made. undefined: an older saved run that knows neither (the caller's old check).
 */
async function landedCommit(run: Run, now: ShipPreflight | null): Promise<string | null | undefined> {
  if (run.commit) return run.commit
  const { ctx } = run
  if (!ctx.head) return undefined
  if (!ctx.paths || !now?.ok || now.head === ctx.head) return null
  const [diff, committed] = await Promise.all([
    window.tr.ship.diffSinceWithCut({ root: ctx.root, worktree: ctx.worktree, since: ctx.head }).catch(() => null),
    noneUncommitted(ctx)
  ])
  // A diff cut at its cap names only some of the files: it cannot tell that the commit was only the run's (unknown,
  // so not made; a commit main then refuses for having nothing left is caught by committedMeanwhile).
  if (!diff || diff.cut) return null
  return committed && onlyPaths(diff.text, ctx.paths) && namesEvery(diff.text, ctx.paths) ? now.head : null
}

/**
 * A commit main refused (blocked, nothing classified) in a run taken up after a reload: when the branch moved off the
 * start tip and none of the ticked files is uncommitted any more, they went in while no window watched (a commit the
 * landed-commit check could not read as only the run's); the tip now, else null.
 */
async function committedMeanwhile(run: Run): Promise<string | null> {
  const { ctx } = run
  if (!run.restored || !ctx.head || !ctx.paths) return null
  const now = await window.tr.ship.preflight({ root: ctx.root, worktree: ctx.worktree }).catch(() => null)
  if (!now?.ok || now.head === ctx.head) return null
  return (await noneUncommitted(ctx)) ? now.head : null
}

/** Before the commit step of a run taken up after a reload: the commit it made meanwhile is completed, not made again.
 *  Whether it was found (the run goes on past the commit). */
async function resumeCommit(worktree: string, token: number, run: Run, state: ShipState): Promise<boolean> {
  if (!run.resumed || stepDone(state, 'commit')) return false
  run.resumed = false
  const { ctx } = run
  // An older saved run knows neither its commit nor its start tip: it commits as before.
  if (!run.commit && !ctx.head) return false
  const now = await window.tr.ship.preflight({ root: ctx.root, worktree: ctx.worktree }).catch(() => null)
  const made = await landedCommit(run, now)
  if (!made || !alive(worktree, token)) return false
  run.commit = made
  run.committed = true
  patch(worktree, token, (s) => complete(s, 'commit', made.slice(0, 7)))
  return true
}

/** Exit A: commit what is uncommitted, squash into the base, push it — main does all three in one call. */
async function runMain(worktree: string, token: number, run: Run, state: ShipState): Promise<void> {
  const { ctx } = run
  // Taken up after a reload: main may have finished what the old window started (shipToMain goes on without it).
  if (run.resumed && !stepDone(state, 'merge')) {
    run.resumed = false
    const now = await window.tr.ship.preflight({ root: ctx.root, worktree: ctx.worktree }).catch(() => null)
    if (!alive(worktree, token)) return
    const made = ctx.paths && !run.committed ? await landedCommit(run, now) : null
    if (!alive(worktree, token)) return
    if (made) run.commit = made
    // An older saved run (no start tip): nothing uncommitted means its commit went in.
    if (made || (made === undefined && now?.ok && now.uncommitted === 0)) {
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
  const ship = () =>
    window.tr.ship.shipToMain({
      root: ctx.root,
      worktree: ctx.worktree,
      message: state.texts.commit,
      method: ctx.method ?? 'squash',
      paths: run.committed ? null : ctx.paths
    })
  let result = mergeDone ? await window.tr.ship.pushBase({ root: ctx.root, worktree: ctx.worktree, ...(run.merged ? { commit: run.merged } : {}) }) : await ship()
  if (!alive(worktree, token)) return
  const hasCommit = state.steps.some((s) => s.id === 'commit')
  // Main refused the commit (nothing classified) in a run taken up after a reload: the ticked files may have gone in
  // while no window watched (as in runPr / runCommit). Then the merge goes on with nothing to commit.
  if (!result.ok && result.step === 'commit' && result.reason === 'blocked' && !result.failure && !run.committed) {
    const landed = await committedMeanwhile(run)
    if (!alive(worktree, token)) return
    if (landed) {
      run.commit = landed
      run.committed = true
      if (hasCommit) patch(worktree, token, (s) => begin(complete(s, 'commit', landed.slice(0, 7)), 'merge'))
      result = await ship()
      if (!alive(worktree, token)) return
    }
  }
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
          ...(result.conflicts && result.conflicts.length > 0
            ? { conflicts: result.conflicts, prompt: mergeConflictPrompt({ base: ctx.base, branch: ctx.branch, conflicts: result.conflicts }) }
            : {})
        })
      )
    })
    return
  }
  if (!mergeDone) patch(worktree, token, (s) => complete(hasCommit && !stepDone(s, 'commit') ? complete(s, 'commit') : s, 'merge'))
  run.merged = result.commit
  if (result.pushError) {
    // 改为创建 PR only where a PR can be made; the merge Wavi kept on the local base is said with the class's words.
    const refused = result.pushRefused === true && (await prPossible(ctx))
    if (!alive(worktree, token)) return
    const kept = `（合并已留在本地 ${ctx.base} 上）`
    const failure = result.failure
      ? { ...result.failure, message: `${result.failure.message}${kept}`, next: !refused && result.failure.next === 'create-pr' ? null : result.failure.next }
      : undefined
    patch(worktree, token, (s) => fail(s, stepError(s, run, 'push', result.pushError!, failure, refused ? { pushRefused: true } : {})))
    return
  }
  patch(worktree, token, (s) => complete(s, 'push', result.pushed ? undefined : '没有远程，没有推送'))
  finish(worktree, token, `已合并到 ${ctx.base}${result.pushed ? ' 并推送' : ''} · ${result.commit.slice(0, 7)}`)
}

/** 创建 PR can work for the run's branch: its remote is a GitHub repository and gh is installed and signed in (the
 *  chain blocks 创建 PR otherwise), as a fresh preflight says. */
async function prPossible(ctx: ShipContext): Promise<boolean> {
  const now = await window.tr.ship.preflight({ root: ctx.root, worktree: ctx.worktree }).catch(() => null)
  return Boolean(now?.ok && now.remote !== null && now.remoteOnGitHub === true && now.gh === 'ready')
}

/** Exit B, and a push to the branch's open PR: commit if needed, then push (and create). */
async function runPr(worktree: string, token: number, run: Run, state: ShipState): Promise<void> {
  const { ctx, kind } = run
  const target: PrTarget = { root: ctx.root, worktree: ctx.worktree }
  if (state.steps.some((s) => s.id === 'commit') && !stepDone(state, 'commit') && !(await resumeCommit(worktree, token, run, state))) {
    if (!alive(worktree, token)) return
    patch(worktree, token, (s) => begin(s, 'commit'))
    const made = await window.tr.pr.commit({
      ...target,
      message: state.texts.commit,
      paths: ctx.paths ?? []
    })
    if (!alive(worktree, token)) return
    const landed = !made.ok && !made.failure ? await committedMeanwhile(run) : null
    if (!alive(worktree, token)) return
    if (!made.ok && !landed) {
      patch(worktree, token, (s) => fail(s, stepError(s, run, 'commit', made.message, made.failure, made.output ? { output: made.output } : {})))
      return
    }
    const hash = made.ok ? made.commit : landed!
    run.commit = hash
    patch(worktree, token, (s) => complete(s, 'commit', hash.slice(0, 7)))
  }
  if (!alive(worktree, token)) return
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
    // Main says which half failed (the push, or gh pr create); an older main does not: a classified push failure then
    // names the push step.
    const step =
      created.step ??
      (created.failure && created.failure.kind !== 'not-github' && created.failure.kind !== 'no-pr' && created.failure.kind !== 'unknown' ? 'push' : createFailureStep(created.message))
    if (step === 'create') patch(worktree, token, (s) => begin(complete(s, 'push'), 'create'))
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
  if (await resumeCommit(worktree, token, run, state)) return finish(worktree, token, `已提交 · ${run.commit!.slice(0, 7)}`)
  if (!alive(worktree, token)) return
  patch(worktree, token, (s) => begin(s, 'commit'))
  const made = await window.tr.pr.commit({ root: ctx.root, worktree: ctx.worktree, message: state.texts.commit, paths: ctx.paths ?? [] })
  if (!alive(worktree, token)) return
  const landed = !made.ok && !made.failure ? await committedMeanwhile(run) : null
  if (!alive(worktree, token)) return
  if (!made.ok && !landed) {
    patch(worktree, token, (s) => fail(s, stepError(s, run, 'commit', made.message, made.failure, made.output ? { output: made.output } : {})))
    return
  }
  const hash = made.ok ? made.commit : landed!
  run.commit = hash
  patch(worktree, token, (s) => complete(s, 'commit', hash.slice(0, 7)))
  finish(worktree, token, `已提交 · ${hash.slice(0, 7)}`)
}

/** 同步 <base> (Figma 73D1 / 73D2): main fetches, brings the base in, and on conflicts starts nothing. */
async function runSync(worktree: string, token: number, run: Run): Promise<void> {
  const { ctx } = run
  patch(worktree, token, (s) => begin(s, 'sync'))
  const result = await window.tr.ship.sync({ root: ctx.root, worktree: ctx.worktree })
  if (!alive(worktree, token)) return
  if (result.ok) {
    patch(worktree, token, (s) => complete(complete(syncOnto(s, result.onto), 'sync', result.baseNotCaughtUp), 'merge'))
    // The local base could not catch up with its remote: the block stays, saying so on the step, until it is closed.
    if (result.baseNotCaughtUp) window.tr.pr.refresh(worktree)
    else finish(worktree, token, `已同步 ${ctx.base}`)
    return
  }
  if (result.reason === 'blocked') {
    patch(worktree, token, (s) => fail(s, { step: 'sync', message: result.message }))
    return
  }
  if (result.reason === 'conflicts') {
    // The ref 同步 used (origin/main when the local base could not catch up); an older main does not say: the local base.
    const onto = result.onto && result.ontoRef ? { base: result.onto, baseRef: result.ontoRef } : { base: ctx.base }
    const handoff = { ...onto, branch: ctx.branch, behind: run.behind ?? null, conflicts: result.conflicts.length > 0 ? result.conflicts : result.files }
    const prompt = agentHandoffPrompt(result.mode === 'rebase' ? { kind: 'sync-rebase', ...handoff } : { kind: 'sync-merge', ...handoff })
    patch(worktree, token, (s) =>
      fail(complete(syncOnto(s, result.onto, result.mode), 'sync', result.baseNotCaughtUp), {
        step: 'merge',
        message: syncConflictText(result.mode, result.files),
        conflicts: result.files,
        prompt
      })
    )
    return
  }
  // A fetch that failed stops at 拉取 (main says so); the rest at the rebase / merge. An older main does not say: the
  // classes only a fetch has then.
  const { failure } = result
  const atFetch = result.step === 'fetch' || failure.kind === 'network' || failure.kind === 'auth' || failure.kind === 'no-remote'
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
    // The step names what was fetched (its upstream, which may be named otherwise than the local branch).
    const label = current(worktree)?.steps.find((s) => s.id === 'sync')?.label
    finish(worktree, token, label ? `已${label}` : `已拉取 ${ctx.remote ?? 'origin'}/${ctx.branch}`)
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
