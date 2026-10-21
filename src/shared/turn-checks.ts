// “这一轮跑过哪些检查” (PRD F9 / F4): the tests, lint, typecheck and builds an agent ran since the user's last prompt,
// and how each came out — so “做完了” can be checked against what actually passed. Pure; main keeps one TurnChecks per
// session from its hooks (./check-commands.ts reads each Bash call) and sends it to the renderer, which only shows it.

export type CheckKind = 'test' | 'lint' | 'typecheck' | 'build'

/** `unknown`: it ran, but neither an exit code nor the runner's summary says how it ended. */
export type CheckOutcome = 'pass' | 'fail' | 'unknown'

export interface CheckRun {
  kind: CheckKind
  /** The command as run (one simple command, no env or redirections, ≤ 120 chars); with `kind`, the check's identity. */
  command: string
  outcome: CheckOutcome
  /** Where the outcome came from: the exit code, the runner's summary line (no exit code: Codex, a pipe), or nothing. */
  basis: 'exit' | 'output' | 'none'
  /** Not narrowed to some files or tests: a full run that passes settles earlier failures of its kind. */
  full: boolean
  /** Epoch ms of the PostToolUse. */
  at: number
}

/** One turn's record: what ran and whether the agent changed files. */
export interface TurnRecord {
  /** Epoch ms of the UserPromptSubmit that began the turn (0: before the first one Wavi saw). */
  since: number
  /** The agent edited files (Edit / Write / MultiEdit / NotebookEdit, Codex apply_patch). Bash edits are not seen. */
  edited: boolean
  /** Latest run of each distinct check, oldest first. */
  runs: CheckRun[]
}

export interface TurnChecks extends TurnRecord {
  /** Kinds this session ran in earlier turns: the ones this turn not running is worth saying (“类型 未跑”). */
  known: CheckKind[]
  /**
   * The last turn that edited or checked, while this one has done neither (“提交一下”, a question): its results still
   * describe the code, so they are shown as 上一轮.
   */
  previous?: TurnRecord
}

export const KIND_ORDER: readonly CheckKind[] = ['test', 'lint', 'typecheck', 'build']
/** Kinds that “未跑” is said for; a build is not expected every turn. */
const EXPECTED: ReadonlySet<CheckKind> = new Set<CheckKind>(['test', 'lint', 'typecheck'])
/** Keeps a runaway turn (a loop of one-file test runs) from flooding IPC. */
export const MAX_RUNS = 24

export const KIND_LABEL: Record<CheckKind, string> = { test: '测试', lint: 'lint', typecheck: '类型', build: '构建' }
/** In a sentence: “类型检查没过”. */
const KIND_NAME: Record<CheckKind, string> = { test: '测试', lint: 'lint', typecheck: '类型检查', build: '构建' }

export function emptyTurnChecks(): TurnChecks {
  return { since: 0, edited: false, runs: [], known: [] }
}

const touched = (t: TurnRecord): boolean => t.edited || t.runs.length > 0

/** A new prompt: a fresh turn. What the last one ran becomes known, and it is kept as 上一轮 if it did anything. */
export function beginTurn(checks: TurnChecks, at: number): TurnChecks {
  const known = KIND_ORDER.filter((k) => checks.known.includes(k) || checks.runs.some((r) => r.kind === k))
  const previous = touched(checks) ? { since: checks.since, edited: checks.edited, runs: checks.runs } : checks.previous
  return { since: at, edited: false, runs: [], known, ...(previous ? { previous } : {}) }
}

/** The agent changed files: earlier results no longer describe the code. */
export function recordEdit(checks: TurnChecks): TurnChecks {
  if (checks.edited && !checks.previous) return checks
  const { previous: _gone, ...rest } = checks
  return { ...rest, edited: true }
}

/** New runs replace the earlier run of the same check (kind + command); the oldest fall off past MAX_RUNS. */
export function recordRuns(checks: TurnChecks, runs: readonly CheckRun[]): TurnChecks {
  if (runs.length === 0) return checks
  let list = checks.runs
  for (const run of runs) list = [...list.filter((r) => r.kind !== run.kind || r.command !== run.command), run]
  const { previous: _gone, ...rest } = checks
  return { ...rest, runs: list.slice(-MAX_RUNS) }
}

export type KindStatus = CheckOutcome | 'not-run'

export interface KindSummary {
  kind: CheckKind
  status: KindStatus
  /** This kind's runs, oldest first (empty for not-run). */
  runs: CheckRun[]
}

export interface TurnCheckView {
  /** previous: this turn has neither edited nor checked, so the last turn that did is shown. */
  turn: 'current' | 'previous'
  edited: boolean
  kinds: KindSummary[]
  runs: CheckRun[]
}

/**
 * How a kind came out: a full run that passed settles every earlier run of its kind; of the rest, any failure fails
 * it, then any unknown leaves it unknown.
 */
export function kindStatus(runs: readonly CheckRun[]): CheckOutcome {
  const settledAt = Math.max(-1, ...runs.filter((r) => r.full && r.outcome === 'pass').map((r) => r.at))
  const live = runs.filter((r) => r.at >= settledAt)
  if (live.some((r) => r.outcome === 'fail')) return 'fail'
  if (live.some((r) => r.outcome === 'unknown')) return 'unknown'
  return 'pass'
}

/** What to show for a session, or null when there is nothing to say (no edits and no checks, this turn or before). */
export function turnCheckView(checks: TurnChecks | undefined): TurnCheckView | null {
  if (!checks) return null
  const record: TurnRecord | undefined = touched(checks) ? checks : checks.previous
  if (!record) return null
  const kinds: KindSummary[] = []
  for (const kind of KIND_ORDER) {
    const runs = record.runs.filter((r) => r.kind === kind)
    if (runs.length > 0) kinds.push({ kind, status: kindStatus(runs), runs })
    else if (EXPECTED.has(kind) && checks.known.includes(kind)) kinds.push({ kind, status: 'not-run', runs: [] })
  }
  return { turn: record === checks ? 'current' : 'previous', edited: record.edited, kinds, runs: record.runs }
}

/** A space where Latin meets CJK (“lint 没过”, “的 lint”), as the rest of the UI copy writes it. */
const spaced = (text: string): string => text.replace(/([A-Za-z0-9])(?=[\u4e00-\u9fff])/g, '$1 ').replace(/([\u4e00-\u9fff])(?=[A-Za-z])/g, '$1 ')

const MARK: Record<KindStatus, string> = { pass: '✓', fail: '✗', unknown: '?', 'not-run': '未跑' }
const SAID: Record<KindStatus, string> = { pass: '通过', fail: '没过', unknown: '结果不明', 'not-run': '没跑' }

/** `测试 ✓ · lint ✗ · 类型 未跑`; `没跑检查` when the turn edited files and ran none. */
export function checksText(view: TurnCheckView): string {
  if (view.kinds.length === 0) return '没跑检查'
  return view.kinds.map((k) => `${KIND_LABEL[k.kind]} ${MARK[k.status]}`).join(' · ')
}

/** The accessible name / tooltip: `这一轮：测试通过，lint 没过，类型检查没跑`. */
export function checksDescription(view: TurnCheckView): string {
  const when = view.turn === 'current' ? '这一轮' : '上一轮'
  if (view.kinds.length === 0) return `${when}改了文件，没跑检查`
  return spaced(`${when}：${view.kinds.map((k) => `${KIND_NAME[k.kind]}${SAID[k.status]}`).join('，')}`)
}

export type ChecksTone = 'ok' | 'warn' | 'error'

/** The merge sheet's line (PRD F4): its tone and sentence; never a reason not to merge. */
export function checksVerdict(view: TurnCheckView, agent: string): { tone: ChecksTone; text: string } {
  const { tone, text } = verdict(view, agent)
  return { tone, text: spaced(text) }
}

function verdict(view: TurnCheckView, agent: string): { tone: ChecksTone; text: string } {
  const when = view.turn === 'current' ? '这一轮' : '上一轮'
  const names = (status: KindStatus) => view.kinds.filter((k) => k.status === status).map((k) => KIND_NAME[k.kind]).join('、')
  if (view.kinds.length === 0) return { tone: 'warn', text: `${agent} ${when}改了文件，没跑检查` }
  const failed = names('fail')
  if (failed) return { tone: 'error', text: `${agent} ${when}的${failed}没过` }
  const unknown = names('unknown')
  if (unknown) return { tone: 'warn', text: `${agent} ${when}跑了${unknown}，看不出结果` }
  const missing = names('not-run')
  if (missing) return { tone: 'warn', text: `${agent} ${when}没跑${missing}` }
  return { tone: 'ok', text: `${agent} ${when}跑过的检查都通过了` }
}

/** A note for one run's line: how its outcome is known when it is not from the exit code. */
export function runNote(run: CheckRun): string | undefined {
  if (run.basis === 'output') return '按输出判断'
  return run.outcome === 'unknown' ? '看不出结果' : undefined
}

export function sameTurnChecks(a: TurnChecks, b: TurnChecks): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
