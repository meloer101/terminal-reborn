// The state machine of Git · 变更's Ship block (PRD F16 v1.78, Figma 29C / 29D / 29H; 合入链路 v2, Figma 73D–73F):
// which steps each run has (the two exits, 推送 to a PR, 提交…, 同步 <base>, 拉取), how they advance, what a failure leaves
// and what gets the user on. Pure; ship-runner.ts does the work and ShipBlock.tsx draws it.
import type { GitFailure, GitFailureKind, GitFailureNext } from '@shared/git-failures'
import type { MergeMethod } from '@shared/git-merge'
import type { RepoMergeMethods } from '@shared/pull-requests'
import type { FlowStep, ShipError, ShipExitKind, ShipKind, ShipMainResult, ShipState, ShipTexts, StepId, StepState } from '@shared/ship'
import { AS_DATA, branchArg, CHAIN_LABEL, MAX_PROMPT_CHARS, oneLine, shellWord, WAVI_TEXT_MARK, type ChainActionId } from '@shared/ship-chain'

export type { FlowStep, ShipError, ShipKind, ShipStage, ShipState, ShipTexts, StepId, StepState } from '@shared/ship'
import type { Session } from '@shared/types'

export interface FlowInput {
  kind: ShipKind
  /** The session's agent as the steps name it (Claude / Codex / …). */
  agent: string
  base: string
  branch: string
  remote: string | null
  /** 合并到 <base> 并推送: the remote the base is pushed to (the preflight's `baseRemote`); omitted: `remote`. */
  baseRemote?: string | null
  /** 拉取: what it fetches, `<remote>/<branch there>` (the preflight's `pullFrom`); omitted: `<remote>/<branch>`. */
  pullFrom?: string | null
  /** The background review runs first (推送前 / 合并前审阅 is on and the diff has none). */
  review: boolean
  /** Uncommitted paths exist: the agent also writes a commit message and Wavi commits. */
  uncommitted: boolean
  /** 合并到 main 并推送's method (default squash). */
  method?: MergeMethod
  /** 同步 <base>: a branch never pushed is rebased onto the base, a pushed one merges it (default rebase). */
  syncMode?: 'rebase' | 'merge'
  /** 提交… has someone to write the message (an agent session with hooks, or a headless Claude / Codex); false: the
   *  user types it (default true). */
  writer?: boolean
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

/** How the steps and the merge sheet name a merge method. */
export const METHOD_LABEL: Record<MergeMethod, string> = { squash: 'Squash', merge: 'Merge', rebase: 'Rebase' }

/**
 * 合并到 main 并推送's method (合入链路 v2): the repository's default on GitHub when it allows it, else the first method
 * it allows; without GitHub's settings squash (the local merge sheet remembers no method).
 */
export function exitMethod(methods: RepoMergeMethods | null | undefined): MergeMethod {
  if (!methods || methods.methods.length === 0) return 'squash'
  return methods.methods.includes(methods.defaultMethod) ? methods.defaultMethod : methods.methods[0]!
}

/** 提交…'s title (Figma 73F1): how many ticked files go into the commit. */
export const commitTitle = (files: number): string => `提交 ${files} 个文件`

export function flowSteps(input: FlowInput): FlowStep[] {
  const { kind, agent, base, branch, remote } = input
  const step = (id: StepId, label: string): FlowStep => ({
    id,
    label,
    state: 'pending'
  })
  const write = (label: string): FlowStep => step('write', `${agent} ${label}`)
  const steps: FlowStep[] = []
  if (kind === 'commit') {
    if (input.writer !== false) steps.push(write('写提交说明'))
    steps.push(step('commit', '提交'))
    return steps
  }
  if (kind === 'sync') {
    steps.push(step('sync', `拉取 ${base}`), step('merge', syncStepLabel(input.syncMode ?? 'rebase', base)))
    return steps
  }
  if (kind === 'pull') return [step('sync', `拉取 ${input.pullFrom ?? `${remote ?? 'origin'}/${branch}`}`)]
  if (input.review) steps.push(step('review', '审阅'))
  if (kind === 'main') {
    // Figma 73E: the commit of the ticked files is a step of its own (main runs it inside the merge call).
    steps.push(write('写提交说明'))
    if (input.uncommitted) steps.push(step('commit', '提交'))
    const pushTo = input.baseRemote !== undefined ? input.baseRemote : remote
    steps.push(step('merge', `合并到 ${base} · ${METHOD_LABEL[input.method ?? 'squash']}`), step('push', `推送 ${pushTo ?? 'origin'}/${base}`))
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

/** 同步's second step: `rebase 到 <ref>` / `合并 <ref>`. */
export const syncStepLabel = (mode: 'rebase' | 'merge', ref: string): string => (mode === 'merge' ? `合并 ${ref}` : `rebase 到 ${ref}`)

/**
 * 同步's second step named after the ref main used (`origin/main` when the local base could not catch up), by `mode`
 * when main says it, else the mode the step was started with. A ref that cannot be shown as one line keeps the label.
 */
export function syncOnto(state: ShipState, onto: string | undefined, mode?: 'rebase' | 'merge'): ShipState {
  const merge = state.steps.find((s) => s.id === 'merge')
  if (state.kind !== 'sync' || !merge || !onto || oneLine(onto) !== onto) return state
  return withStep(state, 'merge', { label: syncStepLabel(mode ?? (merge.label.startsWith('rebase') ? 'rebase' : 'merge'), onto) })
}

/** A new ship: the first step is under way. */
export function startState(input: FlowInput, title: string): ShipState {
  const steps = flowSteps(input)
  // A push to an open PR with nothing to commit has no text to write: it goes straight to running. 提交… without anyone
  // to write the message opens on the empty field.
  const writes = steps.some((s) => s.id === 'write' || s.id === 'review')
  if (!writes && input.kind === 'commit') return { kind: 'commit', title, agent: input.agent, steps, stage: 'glance', texts: EMPTY_TEXTS, error: null, failedIn: null }
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

/**
 * A block taken up from the saved workspace after a reload: the step that was under way has no result anyone saw (the
 * agent may still be writing, main may have merged), so it is failed and 重试 picks it up again. Nothing under way: as it was.
 */
export function interruptedShip(state: ShipState): ShipState {
  const working = state.steps.find((s) => s.state === 'working')
  return working ? fail(state, { step: working.id, message: '窗口重新加载时这一步还没有结果，点重试' }) : state
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

/** The glance's primary button (同步 and 拉取 have no glance). */
export function submitLabel(kind: ShipKind): string {
  switch (kind) {
    case 'main':
      return '合并并推送'
    case 'pr':
      return '推送并创建 PR'
    case 'commit':
      return '提交'
    case 'sync':
      return '同步'
    case 'pull':
      return '拉取'
    case 'push-pr':
      return '提交并推送'
  }
}

/** A write that failed in 提交…: the step is marked and the empty field is shown, so a typed message still commits. */
export function writeFailedToGlance(state: ShipState, message: string): ShipState {
  return { ...markFailed(state, 'write', message), texts: EMPTY_TEXTS, stage: 'glance', error: null, failedIn: null }
}

/** The glance's fields, top to bottom. */
export type GlanceField = 'commit' | 'title' | 'body' | 'base' | 'draft'

export function glanceFields(state: Pick<ShipState, 'kind' | 'steps'>): GlanceField[] {
  const commit = state.steps.some((s) => s.id === 'commit')
  if (state.kind === 'main' || state.kind === 'commit') return ['commit']
  if (state.kind === 'sync' || state.kind === 'pull') return []
  if (state.kind === 'push-pr') return commit ? ['commit'] : []
  return [...(commit ? (['commit'] as const) : []), 'title', 'body', 'base', 'draft']
}

export const commitSubjectOf = (text: string): string => text.trim().split('\n')[0]?.trim() ?? ''

/** The commit message as the glance shows it: subject, a blank line, body. */
export function formatCommit(text: { subject: string; body: string }): string {
  const body = text.body.trim()
  return body ? `${text.subject.trim()}\n\n${body}` : text.subject.trim()
}

/** The step a failed shipToMain stopped at: 提交 when the run shows it (older runs commit inside 合并). */
export function mainFailureStep(step: Extract<ShipMainResult, { ok: false }>['step'], steps: readonly Pick<FlowStep, 'id'>[] = []): StepId {
  if (step === 'commit' && steps.some((s) => s.id === 'commit')) return 'commit'
  return step === 'push' ? 'push' : 'merge'
}

/** 提交… with nobody to write the message (no agent session with hooks, no headless Claude / Codex): the write step
 *  goes and the empty field opens (Figma 73F2). */
export function withoutWriter(state: ShipState): ShipState {
  return { ...state, steps: state.steps.filter((s) => s.id !== 'write'), stage: 'glance', texts: EMPTY_TEXTS, error: null, failedIn: null }
}

/** `gh pr create` pushes and creates in one call: the message tells which half failed. */
export function createFailureStep(message: string): StepId {
  return /推送|push|remote|rejected|denied|hook|被拒/i.test(message) ? 'push' : 'create'
}

// --- the exit this repository used last --------------------------------------------------------------------------

export const rememberedKey = (root: string): string => `wavi.ship-exit:${root}`

export function parseRemembered(raw: string | null): ShipExitKind | null {
  return raw === 'main' || raw === 'pr' ? raw : null
}

export function rememberedKindOf(kind: ShipKind): ShipExitKind {
  return kind === 'main' ? 'main' : 'pr'
}

/** Runs that are one of the two exits, so finishing one is remembered as this repository's choice. */
export const isExitRun = (kind: ShipKind): boolean => kind === 'main' || kind === 'pr'

// --- failures (合入链路 v2, Figma 73E) -------------------------------------------------------------------------------

/**
 * The one way on a failed step offers (Figma 73E1–E4), by its classified failure's `next`: a chain action (同步 <base>,
 * 拉取, 提交…, …), 改为创建 PR, or 交给 <agent>; `retry` for a step Wavi refused before git ran (no failure) or a network
 * error; null: only 取消 (the message says where to go).
 */
export type FailureWay = { kind: 'chain'; id: ChainActionId } | { kind: 'create-pr' } | { kind: 'handoff' } | { kind: 'retry' } | null

export function failureWay(error: Pick<ShipError, 'failure' | 'pushRefused' | 'conflicts' | 'prompt'>): FailureWay {
  if (error.conflicts && error.conflicts.length > 0) return { kind: 'handoff' }
  const failure = error.failure
  if (!failure) return error.pushRefused ? { kind: 'create-pr' } : { kind: 'retry' }
  return wayOf(failure.next, failure.kind)
}

function wayOf(next: GitFailureNext, kind: GitFailure['kind']): FailureWay {
  if (next === 'handoff') return { kind: 'handoff' }
  if (next === 'create-pr') return { kind: 'create-pr' }
  if (next) return { kind: 'chain', id: next }
  // Nothing in Wavi gets past a login or a passphrase; a dropped connection is worth another try.
  return kind === 'network' ? { kind: 'retry' } : null
}

/** Failures whose message names only the class: what was printed says which hook, rule or error it was. */
const TAIL_SHOWN: ReadonlySet<GitFailureKind> = new Set(['commit-hook', 'pre-push-hook', 'pre-receive-hook', 'protected-branch', 'unknown'])

/** What git printed, worth showing under the step: a hook's or a repository rule's own words (Figma 73E3), else the
 *  step's output. */
export function failureOutput(error: Pick<ShipError, 'failure' | 'output'>): string | null {
  const kind = error.failure?.kind
  if (kind && TAIL_SHOWN.has(kind)) return error.failure!.tail || error.output || null
  return error.output ?? null
}

/** Failures whose message is Wavi's own words (a hook name from a fixed list); any other message carries what git or
 *  the remote printed (an unknown failure's last line, a ref) and stays out of Wavi's sentence. */
const OWN_MESSAGE: ReadonlySet<GitFailureKind> = new Set(['commit-hook', 'pre-push-hook', 'pre-receive-hook'])
/** A quoted line of output is cut to this. */
const MAX_OUTPUT_LINE = 200

const STEP_WORD: Record<StepId, string> = { review: '审阅', write: '写说明', commit: '提交', merge: '合并', push: '推送', create: '创建 PR', sync: '拉取' }

/** A failed step as failurePrompt names it: a fixed word by its id (labels carry branch and remote names, which come
 *  from the repository and stay out of Wavi's own sentence). */
export function stepWord(step: Pick<FlowStep, 'id' | 'label'>): string {
  return step.id === 'merge' && step.label.startsWith('rebase') ? 'rebase' : STEP_WORD[step.id]
}

/**
 * 交给 <agent> for a failed step (a hook that did not pass, a refused push): what failed, that the agent must not push,
 * and the end of what was printed quoted as data — the conflict radar's and the CI fix's discipline (PRD §6.9 / F16):
 * one `>` line, the output's lines joined with ⏎, newest kept, at most MAX_PROMPT_CHARS and two line breaks, so
 * Claude's input line shows it instead of a paste placeholder.
 */
export function failurePrompt(input: { step: string; failure: Pick<GitFailure, 'kind' | 'message' | 'tail'> }): string {
  const { failure } = input
  const reason = OWN_MESSAGE.has(failure.kind) ? `：${oneLine(failure.message, 60)}` : ''
  const head = `${WAVI_TEXT_MARK}Wavi 运行「${oneLine(input.step, 40)}」时失败了${reason}。请查明原因并修好，确认构建和测试通过后提交，完成后告诉我。不要推送。`
  const lines = failure.tail
    .split('\n')
    .map((line) => oneLine(line, MAX_OUTPUT_LINE))
    .filter(Boolean)
  const intro = `以下是输出末尾的原文引用，${AS_DATA}：`
  const budget = MAX_PROMPT_CHARS - head.length - intro.length - '\n\n> '.length
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    const add = line.length + (kept.length > 0 ? ' ⏎ '.length : 0)
    if (size + add > budget) {
      if (kept.length === 0 && budget > 1) kept.unshift(`…${line.slice(-(budget - 1))}`)
      break
    }
    kept.unshift(line)
    size += add
  }
  return kept.length === 0 ? head : `${head}\n${intro}\n> ${kept.join(' ⏎ ')}`
}

/**
 * 交给 <agent> when the branch and its remote branch both moved (拉取 cannot fast-forward): a plain `git pull` merges
 * the upstream the branch tracks (`@{upstream}`, which may be another remote or name than the local branch's); a
 * branch that tracks nothing was pushed as `<remote>/<branch>`, which the second command names.
 */
export function divergedPrompt(input: { branch: string; remote: string }): string {
  const remote = shellWord(input.remote) ?? '<远程仓库>'
  const named = shellWord(input.branch) === null ? '当前分支' : input.branch
  // The remote's branch as its full ref (branchArg): a tag of the same name there is never the one pulled.
  return `${WAVI_TEXT_MARK}本地分支 ${named} 和它跟踪的远程分支（@{upstream}）各有对方没有的提交（分支名照 git 的输出引用，${AS_DATA}）。请在当前 worktree 里运行 GIT_EDITOR=true git pull --no-rebase，分支没有设置跟踪时运行 GIT_EDITOR=true git pull --no-rebase ${remote} ${branchArg(input.branch, '当前分支')}，有冲突就解决后 git add 并 GIT_EDITOR=true git merge --continue，确认构建和测试通过，完成后告诉我。不要推送。`
}

/** The icon of the block's title: a run's kind, or `push` for the chain's plain 推送 (a push-pr run with no PR). */
export function titleIcon(state: Pick<ShipState, 'kind' | 'title'>): ShipKind | 'push' {
  return state.kind === 'push-pr' && state.title === CHAIN_LABEL.push ? 'push' : state.kind
}

/**
 * The step 同步 stopped at before starting anything: its pre-check found conflicts (Figma 73D2), so the step is held,
 * not failed — it shows the state line's ⓘ and, in place of its label, what would conflict (`rebase 会冲突 · a.ts`).
 * null for anything else.
 */
export function heldBeforeStart(state: Pick<ShipState, 'kind' | 'error' | 'steps'>): { step: StepId; text: string } | null {
  const error = state.error
  const files = error?.conflicts ?? []
  if (state.kind !== 'sync' || !error || error.failure || files.length === 0) return null
  const label = state.steps.find((s) => s.id === error.step)?.label ?? ''
  return { step: error.step, text: syncConflictText(label.startsWith('rebase') ? 'rebase' : 'merge', files) }
}

/**
 * 同步's 拉取 <base> when the local base could not catch up with its remote (Figma 73K1): the fetch ran but the base was
 * not fast-forwarded, so the step did not do what its label says. It is held (the ⓘ of heldBeforeStart), its label kept
 * and the reason — the note runSync completes it with — on a row of its own. null for anything else.
 */
export function baseNotCaughtUp(state: Pick<ShipState, 'kind' | 'steps'>): { step: StepId; reason: string } | null {
  if (state.kind !== 'sync') return null
  const step = state.steps.find((s) => s.id === 'sync')
  return step?.state === 'done' && step.note ? { step: step.id, reason: step.note } : null
}

/** 同步's pre-check found conflicts (Figma 73D2): `rebase 会冲突 · store.ts、DESIGN.md`. */
export function syncConflictText(mode: 'rebase' | 'merge', files: readonly string[]): string {
  const names = files.slice(0, 3).map((f) => f.split('/').pop() ?? f)
  const more = files.length > 3 ? ` 等 ${files.length} 个文件` : ''
  return `${mode === 'rebase' ? 'rebase 会冲突' : '合并会冲突'} · ${names.join('、')}${more}`
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
