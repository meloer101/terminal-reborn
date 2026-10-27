// The state machine of Git · 变更's Ship block (PRD F16 v1.78, Figma 29C / 29D / 29H): which steps each exit has, how
// they advance, what a failure leaves and what 重试 resumes. Pure; ship-runner.ts does the work and ShipBlock.tsx draws it.
import type { ShipExitKind, ShipMainResult } from '@shared/ship'
import type { Session } from '@shared/types'

/** `main`: 合并到 base 并推送; `pr`: 创建 PR; `push-pr`: the branch's PR is open, commit what is uncommitted and push. */
export type ShipKind = 'main' | 'pr' | 'push-pr'
export type StepId = 'review' | 'write' | 'commit' | 'merge' | 'push' | 'create'
export type StepState = 'pending' | 'working' | 'done' | 'failed'
/** writing: steps before the user sees the text; glance: the text is shown for a last look; running: Wavi's own steps. */
export type ShipStage = 'writing' | 'glance' | 'running'

export interface FlowStep {
  id: StepId
  label: string
  state: StepState
  /** A quiet addition to the label (what the step is waiting for, why it was skipped). */
  note?: string
}

export interface FlowInput {
  kind: ShipKind
  /** The session's agent as the steps name it (Claude / Codex / …). */
  agent: string
  base: string
  branch: string
  remote: string | null
  /** The background review runs first (推送前 / 合并前审阅 is on and the diff has none). */
  review: boolean
  /** Uncommitted paths exist: the agent also writes a commit message and Wavi commits. */
  uncommitted: boolean
}

/** What the user can edit in the glance. */
export interface ShipTexts {
  /** The commit message: subject, blank line, body. */
  commit: string
  title: string
  body: string
  draft: boolean
}

export interface ShipError {
  step: StepId
  message: string
  /** The end of what git and its hooks printed. */
  output?: string
  /** 合并 stopped on these files: 交给 agent 解. */
  conflicts?: string[]
  /** The push of the base was refused (protection, a hook): 改为创建 PR. */
  pushRefused?: boolean
}

export interface ShipState {
  kind: ShipKind
  /** The exit's label, the block's title line. */
  title: string
  agent: string
  steps: FlowStep[]
  stage: ShipStage
  texts: ShipTexts
  error: ShipError | null
  /** The stage the error happened in: 重试 resumes there. */
  failedIn: ShipStage | null
}

export const EMPTY_TEXTS: ShipTexts = {
  commit: '',
  title: '',
  body: '',
  draft: false
}

/** `对比 main · 领先 3 · 落后 2`; 落后 only when there is some (Figma 29A). */
export function compareLine(base: string, ahead: number, behind: number): string {
  return `对比 ${base} · 领先 ${ahead}${behind > 0 ? ` · 落后 ${behind}` : ''}`
}

/** The text of the glyph column: working, done, pending, failed. */
export function stepGlyph(state: StepState): string {
  return state === 'working' ? '◌' : state === 'done' ? '✓' : state === 'failed' ? '✗' : '○'
}

export const STEP_GLYPH_NAME: Record<StepState, string> = {
  working: '进行中',
  done: '已完成',
  pending: '等待',
  failed: '失败'
}

/** While the agent is busy with something else, the write step says whom it waits for. */
export function waitNote(agent: string): string {
  return `等 ${agent} 空闲`
}

export function flowSteps(input: FlowInput): FlowStep[] {
  const { kind, agent, base, branch, remote } = input
  const step = (id: StepId, label: string): FlowStep => ({
    id,
    label,
    state: 'pending'
  })
  const write = (label: string): FlowStep => step('write', `${agent} ${label}`)
  const steps: FlowStep[] = []
  if (input.review) steps.push(step('review', '审阅'))
  if (kind === 'main') {
    steps.push(write('写提交说明'), step('merge', `合并到 ${base} · Squash`), step('push', `推送 ${remote ?? 'origin'}/${base}`))
  } else if (kind === 'pr') {
    steps.push(write('写标题和正文'))
    if (input.uncommitted) steps.push(step('commit', '提交'))
    steps.push(step('push', `推送 ${branch}`), step('create', '创建 PR'))
  } else {
    if (input.uncommitted) steps.push(write('写提交说明'), step('commit', '提交'))
    steps.push(step('push', `推送 ${branch}`))
  }
  return steps
}

/** A new ship: the first step is under way. */
export function startState(input: FlowInput, title: string): ShipState {
  const steps = flowSteps(input)
  // A push to an open PR with nothing to commit has no text to write: it goes straight to running.
  const writes = steps.some((s) => s.id === 'write' || s.id === 'review')
  const state: ShipState = {
    kind: input.kind,
    title,
    agent: input.agent,
    steps,
    stage: writes ? 'writing' : 'running',
    texts: EMPTY_TEXTS,
    error: null,
    failedIn: null
  }
  return begin(state, steps[0]!.id)
}

const withStep = (state: ShipState, id: StepId, patch: Partial<FlowStep>): ShipState => ({
  ...state,
  steps: state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
})

/** The step is under way; `note` replaces whatever it said. */
export function begin(state: ShipState, id: StepId, note?: string): ShipState {
  return withStep(state, id, { state: 'working', note })
}

export function complete(state: ShipState, id: StepId, note?: string): ShipState {
  return withStep(state, id, { state: 'done', note })
}

/** A step ended badly but the flow goes on (a review that failed does not stop a merge). */
export function markFailed(state: ShipState, id: StepId, note: string): ShipState {
  return withStep(state, id, { state: 'failed', note })
}

/** The flow stops at `error.step`. */
export function fail(state: ShipState, error: ShipError): ShipState {
  return {
    ...withStep(state, error.step, { state: 'failed', note: undefined }),
    error,
    failedIn: state.stage
  }
}

/** The user declined a confirmation in main: back to the glance, nothing failed. */
export function backToGlance(state: ShipState): ShipState {
  const steps = state.steps.map((s): FlowStep => (s.state === 'done' ? s : { ...s, state: 'pending', note: undefined }))
  return { ...state, steps, stage: 'glance', error: null, failedIn: null }
}

/** The text is written: the write step is done and the user looks at it. */
export function toGlance(state: ShipState, texts: ShipTexts): ShipState {
  return {
    ...complete(state, 'write'),
    texts,
    stage: 'glance',
    error: null,
    failedIn: null
  }
}

/** The user said go: Wavi's own steps run. The first one that is not done is under way. */
export function toRunning(state: ShipState): ShipState {
  const next = firstUndone(state.steps)
  return {
    ...(next ? begin(state, next.id) : state),
    stage: 'running',
    error: null,
    failedIn: null
  }
}

export function firstUndone(steps: readonly FlowStep[]): FlowStep | null {
  return steps.find((s) => s.state !== 'done') ?? null
}

/** 重试: the error goes and the failed step is tried again in the stage it failed in; steps that are done stay done. */
export function retry(state: ShipState): ShipState {
  if (!state.error) return state
  return withStep(
    {
      ...state,
      error: null,
      failedIn: null,
      stage: state.failedIn ?? 'writing'
    },
    state.error.step,
    { state: 'working', note: undefined }
  )
}

export function setTexts(state: ShipState, patch: Partial<ShipTexts>): ShipState {
  return { ...state, texts: { ...state.texts, ...patch } }
}

/** Why the glance cannot go ahead, or null. */
export function submitBlocker(state: Pick<ShipState, 'kind' | 'texts' | 'steps'>): string | null {
  const needsCommit = state.kind === 'main' || state.steps.some((s) => s.id === 'commit')
  if (needsCommit && !commitSubjectOf(state.texts.commit)) return '写一句提交说明'
  if (state.kind === 'pr' && !state.texts.title.trim()) return '写一个标题'
  return null
}

/** The glance's primary button. */
export function submitLabel(kind: ShipKind): string {
  return kind === 'main' ? '合并并推送' : kind === 'pr' ? '推送并创建 PR' : '提交并推送'
}

/** The glance's fields, top to bottom. */
export type GlanceField = 'commit' | 'title' | 'body' | 'base' | 'draft'

export function glanceFields(state: Pick<ShipState, 'kind' | 'steps'>): GlanceField[] {
  const commit = state.steps.some((s) => s.id === 'commit')
  if (state.kind === 'main') return ['commit']
  if (state.kind === 'push-pr') return commit ? ['commit'] : []
  return [...(commit ? (['commit'] as const) : []), 'title', 'body', 'base', 'draft']
}

export const commitSubjectOf = (text: string): string => text.trim().split('\n')[0]?.trim() ?? ''

/** The commit message as the glance shows it: subject, a blank line, body. */
export function formatCommit(text: { subject: string; body: string }): string {
  const body = text.body.trim()
  return body ? `${text.subject.trim()}\n\n${body}` : text.subject.trim()
}

/** The step a failed shipToMain stopped at: the commit happens inside 合并. */
export function mainFailureStep(step: Extract<ShipMainResult, { ok: false }>['step']): StepId {
  return step === 'push' ? 'push' : 'merge'
}

/** `gh pr create` pushes and creates in one call: the message tells which half failed. */
export function createFailureStep(message: string): StepId {
  return /推送|push|remote|rejected|denied|hook|被拒/i.test(message) ? 'push' : 'create'
}

/** What 交给 agent 解 puts into the input line (no Enter): the files, nothing else. */
export function conflictPrompt(base: string, files: readonly string[]): string {
  return [
    `合并到 ${base} 时这些文件有冲突，请解决后提交：`,
    ...files.slice(0, 50).map((f) => `- ${f}`),
    ...(files.length > 50 ? [`- 另外 ${files.length - 50} 个文件`] : [])
  ].join('\n')
}

// --- the exit this repository used last --------------------------------------------------------------------------

export const rememberedKey = (root: string): string => `wavi.ship-exit:${root}`

export function parseRemembered(raw: string | null): ShipExitKind | null {
  return raw === 'main' || raw === 'pr' ? raw : null
}

export function rememberedKindOf(kind: ShipKind): ShipExitKind {
  return kind === 'main' ? 'main' : 'pr'
}

// --- who can take the message --------------------------------------------------------------------------------------

type SessionLike = Pick<Session, 'kind' | 'status' | 'phase'>

/** The session can be asked in its terminal: an agent with hooks, so its Stop is seen (an exited one is started again first). */
export function canTakeMessage(session: SessionLike | null | undefined, hooks: boolean): boolean {
  return Boolean(session && session.kind !== 'shell' && hooks)
}

/** Idle enough to be typed into: not mid-turn and not on a dialog. */
export function agentFree(session: SessionLike | null | undefined): boolean {
  if (!session) return false
  if (session.phase !== undefined && session.phase !== 'ready') return false
  return session.status === 'idle' || session.status === 'done_unread' || session.status === 'error'
}

/** How long to wait for the agent's text before giving up. */
export const WRITE_TIMEOUT_MS = 10 * 60 * 1000
/** The fallback poll for the handoff file when no Stop event shows up. */
export const POLL_MS = 2000
