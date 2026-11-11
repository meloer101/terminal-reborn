// A Claude workflow run (ultracode, PRD F25, Figma 74): what the run card in a GUI chat and the WorkflowRow in the
// sidebar draw. Three sources describe the same run and are read into one shape:
// - stream-json `system/task_progress` `workflow_progress` rows (GUI sessions; queued agents and tokens included),
// - `workflows/<runId>.json`, the snapshot Claude writes when the run ends (same rows, plus status and totals),
// - `subagents/workflows/<runId>/journal.jsonl` (terminal sessions while the run goes: only agents that started).
// Shapes measured on Claude Code 2.1.322 (PRD §6.18). Pure: no Node, no Electron.

export type WorkflowStatus = 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
export type WorkflowAgentState = 'queued' | 'running' | 'done' | 'error' | 'stopped'

export interface WorkflowAgent {
  /** Claude's `agent_id` (`a` + 16 hex): the same id its hooks carry. Absent while queued. */
  id?: string
  label: string
  /** Index into `phases`. */
  phase: number
  state: WorkflowAgentState
  /** As Claude names it (`claude-opus-5-5`). */
  model?: string
  tokens?: number
  startedAt?: number
  ms?: number
  /** Why it failed, as Claude says it (an API error, a stall, skipped by the user). */
  error?: string
}

export interface WorkflowPhase {
  title: string
  detail?: string
}

export interface WorkflowRun {
  /** The run id (`wf_…`), else the Workflow call's tool_use id until the run id is known. */
  key: string
  runId?: string
  /** The Workflow tool call that launched it: a GUI chat draws the card at that call. */
  toolUseId?: string
  /** Claude's background task id (GUI sessions): what 停止 sends (`stop_task`). */
  taskId?: string
  name: string
  status: WorkflowStatus
  phases: WorkflowPhase[]
  agents: WorkflowAgent[]
  tokens?: number
  startedAt?: number
  /** Total time, once ended (the snapshot's `durationMs`). */
  ms?: number
  /** A run that failed as a whole (the script threw): its error. */
  error?: string
  /** Only the agents that have started are known (a terminal session reading the journal): totals can still grow. */
  partial?: boolean
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Claude's background task id (`w6k3u3ud4` on 2.1.322): checked before it goes into a control request. */
export const GUI_TASK_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Claude's run id: `wf_` + letters, digits and dashes (2.1.322 `/^wf_[a-z0-9-]{6,}$/`). Anything else never becomes a path. */
export const WORKFLOW_RUN_ID = /^wf_[a-z0-9-]{6,64}$/

/** Bounds on what crosses IPC: a run can have hundreds of agents (2.1.322 caps one workflow at 1000). */
const MAX_AGENTS = 400
const MAX_PHASES = 50
const LABEL_CHARS = 120
const ERROR_CHARS = 300

function phaseIndex(phases: WorkflowPhase[], title: string | undefined): number {
  const name = title ?? ''
  const at = phases.findIndex((p) => p.title === name)
  if (at >= 0) return at
  if (phases.length >= MAX_PHASES) return phases.length - 1
  phases.push({ title: clip(name, LABEL_CHARS) })
  return phases.length - 1
}

/**
 * The phases and agents of `workflow_progress` rows (stream-json and the snapshot share them): `workflow_phase`
 * `{index, title}`, `workflow_agent` `{index, label, phaseIndex, phaseTitle, agentId, state, model, tokens, queuedAt,
 * startedAt, durationMs, error, endedWithRun, skipped}`. `state` is `start | progress | done | error`; queued is `start`
 * without `startedAt`. An agent cut off by a stopped run is `error` with `endedWithRun`: stopped, not failed.
 */
export function workflowRows(rows: readonly unknown[], declared: readonly WorkflowPhase[] = []): { phases: WorkflowPhase[]; agents: WorkflowAgent[] } {
  const phases: WorkflowPhase[] = declared.map((p) => ({ ...p }))
  const byIndex = new Map<number, number>()
  for (const row of rows) {
    if (!isRec(row) || row.type !== 'workflow_phase') continue
    const at = phaseIndex(phases, str(row.title))
    const index = num(row.index)
    if (index !== undefined) byIndex.set(index, at)
  }
  const agents: WorkflowAgent[] = []
  for (const row of rows) {
    if (!isRec(row) || row.type !== 'workflow_agent' || agents.length >= MAX_AGENTS) continue
    const fromIndex = num(row.phaseIndex)
    const phase = fromIndex !== undefined && byIndex.has(fromIndex) ? byIndex.get(fromIndex)! : phaseIndex(phases, str(row.phaseTitle))
    const started = num(row.startedAt)
    const raw = str(row.state)
    const stopped = raw === 'error' && (row.endedWithRun !== undefined || row.skipped === true)
    const state: WorkflowAgentState =
      raw === 'done' ? 'done' : stopped ? 'stopped' : raw === 'error' ? 'error' : started === undefined ? 'queued' : 'running'
    const error = state === 'error' ? str(row.error) : undefined
    const id = str(row.agentId)
    agents.push({
      ...(id ? { id } : {}),
      label: clip(str(row.label) ?? str(row.title) ?? `agent ${agents.length + 1}`, LABEL_CHARS),
      phase,
      state,
      ...(str(row.model) ? { model: str(row.model)! } : {}),
      ...(num(row.tokens) !== undefined ? { tokens: num(row.tokens)! } : {}),
      ...(started !== undefined ? { startedAt: started } : {}),
      ...(num(row.durationMs) !== undefined ? { ms: num(row.durationMs)! } : {}),
      ...(error ? { error: clip(error, ERROR_CHARS) } : {})
    })
  }
  return { phases, agents }
}

/** The snapshot's `status` (`completed | failed | killed | paused`, also a live task's `running`). */
export function workflowStatus(raw: unknown): WorkflowStatus {
  if (raw === 'completed') return 'completed'
  if (raw === 'failed') return 'failed'
  if (raw === 'killed' || raw === 'stopped') return 'stopped'
  if (raw === 'paused') return 'paused'
  return 'running'
}

function declaredPhases(raw: unknown): WorkflowPhase[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_PHASES).flatMap((p) => {
    if (!isRec(p) || !str(p.title)) return []
    return [{ title: clip(str(p.title)!, LABEL_CHARS), ...(str(p.detail) ? { detail: clip(str(p.detail)!, LABEL_CHARS) } : {}) }]
  })
}

/** `workflows/<runId>.json`, written when a run ends; null when it is not one. */
export function runFromSnapshot(raw: unknown): WorkflowRun | null {
  if (!isRec(raw)) return null
  const runId = str(raw.runId)
  if (!runId || !WORKFLOW_RUN_ID.test(runId)) return null
  const { phases, agents } = workflowRows(Array.isArray(raw.workflowProgress) ? raw.workflowProgress : [], declaredPhases(raw.phases))
  const status = workflowStatus(raw.status)
  const error = status === 'failed' ? str(raw.error) ?? str(raw.summary) : undefined
  return {
    key: runId,
    runId,
    name: clip(str(raw.workflowName) ?? runId, LABEL_CHARS),
    status,
    phases,
    agents,
    ...(num(raw.totalTokens) !== undefined ? { tokens: num(raw.totalTokens)! } : {}),
    ...(num(raw.startTime) !== undefined ? { startedAt: num(raw.startTime)! } : {}),
    ...(num(raw.durationMs) !== undefined ? { ms: num(raw.durationMs)! } : {}),
    ...(error ? { error: clip(error, ERROR_CHARS) } : {})
  }
}

/**
 * `journal.jsonl` while a run goes (terminal sessions): `started {key, agentId, label, phase}`, then `result` or
 * `failed` per key. A queued agent has no line yet, so the run is `partial`. A key started again (a retry) is one agent.
 */
export function runFromJournal(text: string, base: { runId: string; name?: string; phases?: readonly WorkflowPhase[] }): WorkflowRun {
  const phases: WorkflowPhase[] = (base.phases ?? []).map((p) => ({ ...p }))
  const byKey = new Map<string, WorkflowAgent>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue // the line being written
    }
    if (!isRec(entry)) continue
    const key = str(entry.key)
    if (!key) continue
    if (entry.type === 'started') {
      const id = str(entry.agentId)
      const known = byKey.get(key)
      if (!known && byKey.size >= MAX_AGENTS) continue
      byKey.set(key, {
        ...(id ? { id } : {}),
        label: clip(str(entry.label) ?? known?.label ?? `agent ${byKey.size + 1}`, LABEL_CHARS),
        phase: phaseIndex(phases, str(entry.phase)),
        state: 'running'
      })
    } else if (entry.type === 'result' || entry.type === 'failed') {
      const agent = byKey.get(key)
      if (agent) agent.state = entry.type === 'result' ? 'done' : 'error'
    }
  }
  return { key: base.runId, runId: base.runId, name: base.name ?? base.runId, status: 'running', phases, agents: [...byKey.values()], partial: true }
}

/**
 * The phases a workflow script declares (`export const meta = { name, phases: [{ title, detail }] }`, a pure literal
 * and the script's first statement, as 2.1.322 requires), for the confirmation card before it runs. Phases the script
 * starts without declaring them appear once it runs. Null when the meta cannot be read.
 */
export function scriptMeta(script: string): { name?: string; phases: WorkflowPhase[] } | null {
  const start = /export\s+const\s+meta\s*=\s*\{/.exec(script)
  if (!start) return null
  const parsed = readLiteral(script, start.index + start[0].length - 1)
  if (!parsed || !isRec(parsed.value)) return null
  const meta = parsed.value
  return { ...(str(meta.name) ? { name: clip(str(meta.name)!, LABEL_CHARS) } : {}), phases: declaredPhases(meta.phases) }
}

/** A JS object / array / string / number / boolean literal at `at` (unquoted keys, either quote, trailing commas). */
function readLiteral(src: string, at: number): { value: unknown; end: number } | null {
  let i = at
  const space = () => {
    for (;;) {
      while (i < src.length && /\s/.test(src[i]!)) i++
      if (src.startsWith('//', i)) i = src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i)
      else if (src.startsWith('/*', i)) i = src.indexOf('*/', i) < 0 ? src.length : src.indexOf('*/', i) + 2
      else return
    }
  }
  const string = (): string | null => {
    const quote = src[i]
    if (quote !== '"' && quote !== "'" && quote !== '`') return null
    let out = ''
    i++
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\' && i + 1 < src.length) {
        const c = src[i + 1]!
        out += c === 'n' ? '\n' : c === 't' ? '\t' : c
        i += 2
      } else {
        if (quote === '`' && src.startsWith('${', i)) return null
        out += src[i++]
      }
    }
    if (i >= src.length) return null
    i++
    return out
  }
  const value = (depth: number): unknown => {
    if (depth > 8) throw new Error('too deep')
    space()
    const c = src[i]
    if (c === '{') {
      i++
      const obj: Rec = {}
      for (;;) {
        space()
        if (src[i] === '}') {
          i++
          return obj
        }
        const key = src[i] === '"' || src[i] === "'" ? string() : /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 64))?.[0]
        if (key === null || key === undefined) throw new Error('key')
        if (!(src[i - 1] === '"' || src[i - 1] === "'")) i += key.length
        space()
        if (src[i] !== ':') throw new Error(':')
        i++
        obj[key] = value(depth + 1)
        space()
        if (src[i] === ',') i++
        else if (src[i] !== '}') throw new Error('}')
      }
    }
    if (c === '[') {
      i++
      const arr: unknown[] = []
      for (;;) {
        space()
        if (src[i] === ']') {
          i++
          return arr
        }
        arr.push(value(depth + 1))
        space()
        if (src[i] === ',') i++
        else if (src[i] !== ']') throw new Error(']')
      }
    }
    if (c === '"' || c === "'" || c === '`') {
      const s = string()
      if (s === null) throw new Error('string')
      return s
    }
    const word = /^(true|false|null|-?\d+(?:\.\d+)?)/.exec(src.slice(i, i + 32))?.[0]
    if (!word) throw new Error('value')
    i += word.length
    return word === 'true' ? true : word === 'false' ? false : word === 'null' ? null : Number(word)
  }
  try {
    const v = value(0)
    return { value: v, end: i }
  } catch {
    return null
  }
}

export interface WorkflowPhaseView {
  title: string
  detail?: string
  /** Agents done, of all known in this phase (Claude's /workflows counts the same way: an error is not done). */
  done: number
  total: number
  state: 'pending' | 'running' | 'done' | 'error' | 'stopped' | 'paused'
  /** First start to last end of its agents (phases can overlap and the script runs between them). */
  ms?: number
}

/** Each phase as the card and the sidebar draw it. `now` gives a running phase's elapsed time. */
export function phaseViews(run: WorkflowRun, now: number): WorkflowPhaseView[] {
  return run.phases.map((phase, index) => {
    const agents = run.agents.filter((a) => a.phase === index)
    const done = agents.filter((a) => a.state === 'done').length
    const failed = agents.some((a) => a.state === 'error')
    const live = agents.some((a) => a.state === 'running' || a.state === 'queued')
    const state: WorkflowPhaseView['state'] =
      agents.length === 0
        ? 'pending'
        : live
          ? run.status === 'paused'
            ? 'paused'
            : run.status === 'stopped'
              ? 'stopped'
              : 'running'
          : failed
            ? 'error'
            : agents.some((a) => a.state === 'stopped')
              ? 'stopped'
              : 'done'
    const starts = agents.flatMap((a) => (a.startedAt !== undefined ? [a.startedAt] : []))
    const ends = agents.flatMap((a) => (a.startedAt !== undefined ? [a.ms !== undefined ? a.startedAt + a.ms : live && run.status === 'running' ? now : a.startedAt] : []))
    const ms = starts.length > 0 ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : undefined
    return { title: phase.title, ...(phase.detail ? { detail: phase.detail } : {}), done, total: agents.length, state, ...(ms !== undefined ? { ms } : {}) }
  })
}

export interface WorkflowCounts {
  running: number
  queued: number
  done: number
  failed: number
}

export function workflowCounts(run: WorkflowRun): WorkflowCounts {
  const counts: WorkflowCounts = { running: 0, queued: 0, done: 0, failed: 0 }
  for (const a of run.agents) {
    if (a.state === 'running') counts.running++
    else if (a.state === 'queued') counts.queued++
    else if (a.state === 'done') counts.done++
    else if (a.state === 'error') counts.failed++
  }
  return counts
}

/** The phase a run is in: the first one with agents still going, else the last with any. */
export function currentPhase(views: readonly WorkflowPhaseView[]): WorkflowPhaseView | undefined {
  return views.find((p) => p.state === 'running' || p.state === 'paused') ?? [...views].reverse().find((p) => p.total > 0)
}

/** 「workflow · 改写 2 / 6」: the session row's second line while a run goes on behind an ended turn. */
export function workflowLine(run: WorkflowRun, now: number): string {
  const phase = currentPhase(phaseViews(run, now))
  return phase ? `workflow · ${phase.title} ${phase.done} / ${phase.total}` : 'workflow'
}

/** 412k / 1.21M: a token count as the card shows it. */
export function tokenLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

/** A run is still going (the card has a 停止, the session stays 运行中). */
export const isLiveRun = (run: WorkflowRun): boolean => run.status === 'running' || run.status === 'paused'

/** A run that ended as completed with an agent that errored reads 有失败 (Figma 74C). */
export function runOutcome(run: WorkflowRun): 'running' | 'paused' | 'completed' | 'partly-failed' | 'failed' | 'stopped' {
  if (run.status === 'completed') return run.agents.some((a) => a.state === 'error') ? 'partly-failed' : 'completed'
  return run.status
}

/** A run checked when it crosses IPC: renderer input is never trusted shape-wise. */
export function sanitizeWorkflowRun(raw: unknown): WorkflowRun | null {
  if (!isRec(raw) || !str(raw.key) || !str(raw.name)) return null
  const status = workflowStatus(raw.status)
  const phases = declaredPhases(raw.phases)
  const agents = (Array.isArray(raw.agents) ? raw.agents : []).slice(0, MAX_AGENTS).flatMap((a): WorkflowAgent[] => {
    if (!isRec(a) || !str(a.label)) return []
    const state = ['queued', 'running', 'done', 'error', 'stopped'].includes(a.state as string) ? (a.state as WorkflowAgentState) : 'running'
    const phase = num(a.phase) ?? 0
    return [
      {
        ...(str(a.id) ? { id: str(a.id)! } : {}),
        label: clip(str(a.label)!, LABEL_CHARS),
        phase: phase >= 0 && phase < Math.max(phases.length, 1) ? phase : 0,
        state,
        ...(str(a.model) ? { model: str(a.model)! } : {}),
        ...(num(a.tokens) !== undefined ? { tokens: num(a.tokens)! } : {}),
        ...(num(a.startedAt) !== undefined ? { startedAt: num(a.startedAt)! } : {}),
        ...(num(a.ms) !== undefined ? { ms: num(a.ms)! } : {}),
        ...(str(a.error) ? { error: clip(str(a.error)!, ERROR_CHARS) } : {})
      }
    ]
  })
  return {
    key: clip(str(raw.key)!, 80),
    ...(str(raw.runId) && WORKFLOW_RUN_ID.test(str(raw.runId)!) ? { runId: str(raw.runId)! } : {}),
    ...(str(raw.toolUseId) ? { toolUseId: clip(str(raw.toolUseId)!, 80) } : {}),
    ...(str(raw.taskId) && GUI_TASK_ID.test(str(raw.taskId)!) ? { taskId: str(raw.taskId)! } : {}),
    name: clip(str(raw.name)!, LABEL_CHARS),
    status,
    phases,
    agents,
    ...(num(raw.tokens) !== undefined ? { tokens: num(raw.tokens)! } : {}),
    ...(num(raw.startedAt) !== undefined ? { startedAt: num(raw.startedAt)! } : {}),
    ...(num(raw.ms) !== undefined ? { ms: num(raw.ms)! } : {}),
    ...(str(raw.error) ? { error: clip(str(raw.error)!, ERROR_CHARS) } : {}),
    ...(raw.partial === true ? { partial: true } : {})
  }
}

/**
 * Whether ultracode is on, from a Claude TUI's screen (PRD F25, Figma 74D): its prompt box's top border carries the tag
 * `ultracode` at its right end while it is on (2.1.322). Null when no prompt box is on screen (a full-screen view, a
 * dialog): nothing to say.
 */
export function ultracodeOnScreen(screen: string): boolean | null {
  let border = false
  for (const line of screen.split('\n')) {
    if (!/─{8,}/.test(line)) continue
    border = true
    if (/─\s*ultracode\s*─/.test(line) || /─ ?ultracode\s*$/.test(line.trimEnd())) return true
  }
  return border ? false : null
}
