// Runs Git · 变更's two exits (PRD F16 v1.78, Figma 29C–29I): the session's agent writes the text (a handoff file, or a
// headless run when the session cannot take a message), the user looks at it, then Wavi runs the mechanical steps.
// The state lives here, per worktree, so the Ship block can close and open (图谱 ↔ 变更) without losing a run; the
// block only draws it (ship-flow.ts is the pure part).
import { create } from 'zustand'
import { AGENT_SPECS, agentName, claudeOrCodex } from '@shared/agents'
import { reviewEvidence, evidenceBlock, withEvidence } from '@shared/pull-requests'
import type { PrTarget } from '@shared/pull-requests'
import type { AppSettings } from '@shared/settings'
import { handoffPrompt, parseCommitHandoff, parsePrHandoff, type HandoffContext, type HandoffKind } from '@shared/ship-handoff'
import { writerFor } from '@shared/ship-writer'
import type { ReviewAgent } from '@shared/background-review'
import type { Session, SessionId } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { cancelBackgroundReview, startBackgroundReview, useBackgroundReview } from '../review/background'
import { insertIntoTerminal, submitPrompt } from '../session-io'
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
  fail,
  formatCommit,
  mainFailureStep,
  markFailed,
  parseRemembered,
  POLL_MS,
  rememberedKey,
  rememberedKindOf,
  retry,
  setTexts,
  startState,
  toGlance,
  toRunning,
  waitNote,
  WRITE_TIMEOUT_MS,
  type ShipKind,
  type ShipState,
  type ShipTexts
} from './ship-flow'
import { setPrNotice } from './store'

/** Everything a run needs that does not change while it runs. */
export interface ShipContext {
  /** The project's root (main only accepts workspace project roots). */
  root: string
  worktree: string
  /** The worktree's agent session, if any. */
  sessionId: SessionId | null
  base: string
  branch: string
  remote: string | null
  /** Uncommitted paths to commit (null: nothing). */
  paths: string[] | null
  openPr: { number: number; url: string } | null
  /** `这一轮的检查：测试 ✓ · …` for the PR evidence, if the session ran any. */
  checksLine: string | null
  settings: Pick<AppSettings, 'review' | 'pr'>
  /** The session whose built-in browser opens the PR. */
  openIn: SessionId | null
}

export const useShips = create<{ byWorktree: Record<string, ShipState> }>()(() => ({ byWorktree: {} }))

interface Run {
  ctx: ShipContext
  kind: ShipKind
  token: number
  /** The commit went in inside a shipToMain that then failed: a retry does not commit again. */
  committed: boolean
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
  return canTakeMessage(session, session && session.kind !== 'shell' ? AGENT_SPECS[session.kind].status === 'hooks' : false)
}

const WRITER_NAME = { claude: 'Claude', codex: 'Codex' } as const

/** The agent as the steps name it: the session's, or the CLI that writes headlessly. */
export function agentLabelFor(ctx: Pick<ShipContext, 'sessionId' | 'settings'>): string {
  const session = sessionOf(ctx.sessionId)
  const hooks = session && session.kind !== 'shell' ? AGENT_SPECS[session.kind].status === 'hooks' : false
  if (session && canTakeMessage(session, hooks)) return agentName(session.kind)
  return WRITER_NAME[writerFor(ctx.settings.pr, claudeOrCodex(session?.kind)).agent]
}

function reviewAgentOf(ctx: ShipContext): ReviewAgent | null {
  return claudeOrCodex(sessionOf(ctx.sessionId)?.kind)
}

function reviewWanted(ctx: ShipContext, kind: ShipKind): boolean {
  const { review } = ctx.settings
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
  try {
    localStorage.setItem(rememberedKey(root), rememberedKindOf(kind))
  } catch {
    // Not remembered; the preflight's suggestion stands.
  }
}

// --- starting and steering ----------------------------------------------------------------------------------------

export function startShip(ctx: ShipContext, kind: ShipKind, title: string): void {
  if (runs.has(ctx.worktree)) return
  const token = ++counter
  runs.set(ctx.worktree, { ctx, kind, token, committed: false })
  const state = startState(
    {
      kind,
      agent: agentLabelFor(ctx),
      base: ctx.base,
      branch: ctx.branch,
      remote: ctx.remote,
      review: reviewWanted(ctx, kind),
      uncommitted: (ctx.paths?.length ?? 0) > 0
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

/** 交给 agent 解: the conflicting files go into the agent's input line (no Enter) and the run ends. */
export async function handConflictsToAgent(worktree: string): Promise<void> {
  const run = runs.get(worktree)
  const files = current(worktree)?.error?.conflicts
  if (!run || !files || !run.ctx.sessionId) return
  const { sessionId, base } = run.ctx
  try {
    useWorkspace.getState().setActiveSession(sessionId)
    await ensureAgentUp(sessionId)
    await insertIntoTerminal(sessionId, conflictPrompt(base, files))
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
  patch(worktree, token, (s) => begin(s, 'write'))
  const written = viaAgent(ctx) ? await writeWithAgent(worktree, token, ctx, kind) : await writeHeadless(worktree, token, ctx, kind)
  if (!alive(worktree, token)) return
  if (!written.ok) patch(worktree, token, (s) => fail(s, { step: 'write', message: written.message }))
  else patch(worktree, token, (s) => toGlance(s, written.texts))
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
    else await runPr(worktree, token, run, state)
  } catch (error) {
    const stepId = state.steps.find((s) => s.state === 'working')?.id ?? state.steps.at(-1)!.id
    patch(worktree, token, (s) => fail(s, { step: stepId, message: errorText(error) }))
  }
}

const stepDone = (state: ShipState, id: string): boolean => state.steps.some((s) => s.id === id && s.state === 'done')

/** Exit A: commit what is uncommitted, squash into the base, push it — main does all three in one call. */
async function runMain(worktree: string, token: number, run: Run, state: ShipState): Promise<void> {
  const { ctx } = run
  // After a failed push the merge stands: only the push is left (an empty message keeps the branch's own commits).
  const mergeDone = stepDone(state, 'merge')
  const result = await window.tr.ship.shipToMain({
    root: ctx.root,
    worktree: ctx.worktree,
    message: mergeDone ? '' : state.texts.commit,
    method: 'squash',
    paths: mergeDone || run.committed ? null : ctx.paths
  })
  if (!alive(worktree, token)) return
  if (!result.ok) {
    if (result.reason === 'declined') {
      patch(worktree, token, backToGlance)
      return
    }
    if (result.step !== 'commit') run.committed = true
    patch(worktree, token, (s) =>
      fail(s, {
        step: mainFailureStep(result.step),
        message: result.message,
        ...(result.output ? { output: result.output } : {}),
        ...(result.conflicts && result.conflicts.length > 0 ? { conflicts: result.conflicts } : {})
      })
    )
    return
  }
  patch(worktree, token, (s) => complete(s, 'merge'))
  if (result.pushError) {
    patch(worktree, token, (s) => fail(s, { step: 'push', message: result.pushError!, pushRefused: true }))
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
      patch(worktree, token, (s) =>
        fail(s, {
          step: 'commit',
          message: made.message,
          ...(made.output ? { output: made.output } : {})
        })
      )
      return
    }
    patch(worktree, token, (s) => complete(s, 'commit', made.commit.slice(0, 7)))
  }
  if (kind === 'push-pr') {
    patch(worktree, token, (s) => begin(s, 'push'))
    const pushed = await window.tr.pr.push(target)
    if (!alive(worktree, token)) return
    if (!pushed.ok) {
      patch(worktree, token, (s) => fail(s, { step: 'push', message: pushed.message }))
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
    patch(worktree, token, (s) =>
      fail(s, {
        step: createFailureStep(created.message),
        message: created.message
      })
    )
    return
  }
  patch(worktree, token, (s) => complete(complete(s, 'push'), 'create'))
  openPullRequest(ctx.openIn, created.url)
  finish(worktree, token, created.number ? `已创建 PR #${created.number}` : '已创建 PR')
}

/** Everything went through: the exit is remembered for this repository and the block goes away. */
function finish(worktree: string, token: number, notice: string): void {
  const run = runs.get(worktree)
  if (!run || run.token !== token) return
  remember(run.ctx.root, run.kind)
  window.tr.pr.refresh(worktree)
  runs.delete(worktree)
  useShips.setState((s) => {
    const { [worktree]: _gone, ...rest } = s.byWorktree
    return { byWorktree: rest }
  })
  setPrNotice(worktree, { tone: 'muted', text: notice })
}
