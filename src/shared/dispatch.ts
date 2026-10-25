// 派活与回报 (PRD F21 v1.66): an agent session (the dispatcher) starts new sessions through Wavi's MCP tools, each in a
// new worktree with its own task, and Wavi reports their results back to it. Pure: which agents can take part and how
// (the per-vendor table), the tool definitions the MCP server lists, the validation of what an agent asks for, the
// brief a child starts with, and the reports — what triggers one, its text, and the queue that coalesces them.
//
// Borrowed from prior art (2026-10-22 source study): one-level dispatch and a calm, short child brief (Orca); async
// start + "end your turn, you will be woken" + per-batch coalescing and ack-by-read (T3 Code); supersede per child,
// no wake on a child that waits for the user, a loop guard on report text and a wake budget (Nimbalyst); the
// final message as the report with a BLOCKED line (Superset, coder/mux). Nothing is typed into a dispatcher's
// terminal: reports go through each vendor's own message channel (§6.14).
import { folderNameFor, generateBranchName, slugify, type WorktreeCreateRequest } from './new-session'
import type { ClaudeOrCodex } from './agents'
import type { SessionId, SessionStatus } from './types'

/** The CLIs that get Wavi's dispatch MCP server and a report channel (§6.14). */
export type DispatchAgent = ClaudeOrCodex

/**
 * How Wavi delivers a report to a dispatcher of this kind (§6.14):
 * - `claude-inbox`: Claude Code's cross-session inbox socket (idle → new turn; busy → read between tool calls)
 * - `codex-queue`: `codex queue --thread <id>` (idle → new turn; busy → after the turn)
 * - `manual`: no channel; the dispatcher's row offers 送进去 and the user sends it
 */
export type ReportChannel = 'claude-inbox' | 'codex-queue' | 'manual'

export interface DispatchAgentSpec {
  kind: DispatchAgent
  name: string
  report: ReportChannel
  /** The CLI flag that picks a model at launch. */
  modelFlag: string
}

/** One row per vendor: a new agent kind joins dispatch (in either direction) by adding its row. */
export const DISPATCH_AGENTS: Record<DispatchAgent, DispatchAgentSpec> = {
  claude: { kind: 'claude', name: 'Claude Code', report: 'claude-inbox', modelFlag: '--model' },
  codex: { kind: 'codex', name: 'Codex', report: 'codex-queue', modelFlag: '-m' }
}

export const isDispatchAgent = (value: unknown): value is DispatchAgent => typeof value === 'string' && Object.hasOwn(DISPATCH_AGENTS, value)

export const DISPATCH_LIMITS = {
  /** Sessions one start_sessions call may ask for. */
  batch: 4,
  /** A dispatcher's children that are still open (listed, not archived). */
  openChildren: 4,
  task: 20_000,
  title: 80,
  reason: 500,
  message: 20_000,
  /** What the confirmation panel waits for before the call returns `timeout`. */
  confirmMs: 10 * 60_000,
  /** Settles within this window go out as one report. */
  debounceMs: 3_000,
  /** Reports a dispatcher may be woken with per hour; later ones wait for 送进去 (a child stuck in an error loop). */
  wakesPerHour: 20,
  /** All inline excerpts of one report together. */
  reportBudget: 12_000,
  /** One child's excerpt within it. */
  excerpt: 4_000,
  /** One read_result page. */
  readPage: 16_000
} as const

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:@/[\]-]{0,79}$/

// --- tools ---------------------------------------------------------------------------------------------------------

export const DISPATCH_TOOL = {
  start: 'start_sessions',
  list: 'list_sessions',
  read: 'read_result',
  send: 'send_message',
  stop: 'stop_session'
} as const

export type DispatchToolName = (typeof DISPATCH_TOOL)[keyof typeof DISPATCH_TOOL]

export const isDispatchToolName = (value: unknown): value is DispatchToolName =>
  typeof value === 'string' && (Object.values(DISPATCH_TOOL) as string[]).includes(value)

export interface DispatchToolDef {
  name: DispatchToolName
  description: string
  inputSchema: Record<string, unknown>
}

/** The MCP server's `instructions`; the start tool's description says the same, so the two never disagree. */
export const DISPATCH_INSTRUCTIONS = [
  'Wavi runs this session. Its tools let you hand work to other coding agents, each in its own new git worktree, and get their results back.',
  'Use start_sessions only for multi-step work that benefits from its own worktree or a different agent; do a single read, search or command yourself.',
  'After starting sessions, end your turn: Wavi sends you a report when each one finishes a turn, fails or exits. Do not poll or wait in a loop.',
  "A dispatched session's diff and file list are the record; its prose claims are not. Merging, pushing, archiving and approving permissions are the user's, in Wavi."
].join('\n')

const id = { type: 'string', description: 'The id start_sessions or list_sessions gave for the session.' }

export function dispatchToolDefs(agents: readonly DispatchAgent[]): DispatchToolDef[] {
  const kinds = agents.length > 0 ? [...agents] : (Object.keys(DISPATCH_AGENTS) as DispatchAgent[])
  return [
    {
      name: DISPATCH_TOOL.start,
      description: [
        `Start 1–${DISPATCH_LIMITS.batch} new Wavi sessions, each running a coding agent (${kinds.join(' or ')}) in its own new git worktree branched from your current HEAD, and give each one a task. The user approves the batch in Wavi first; this call returns once they decide.`,
        'Use it only for multi-step work that benefits from its own worktree or a different agent; do a single read, search or command yourself. Start the minimum: one session per independent deliverable, and never a second session for something already dispatched (use send_message instead).',
        'Each task must stand alone (the new agent sees nothing of this conversation): the goal, the files in scope, how to check the result, and what ends the task. Uncommitted changes in your worktree are not copied; commit first if the new sessions need them.',
        'After starting sessions, end your turn: Wavi sends you a report automatically when each one finishes a turn, fails or exits. Do not poll or wait in a loop. If the user declines, do not retry unless they ask.'
      ].join('\n\n'),
      inputSchema: {
        type: 'object',
        properties: {
          sessions: {
            type: 'array',
            minItems: 1,
            maxItems: DISPATCH_LIMITS.batch,
            items: {
              type: 'object',
              properties: {
                agent: { type: 'string', enum: kinds, description: 'Which coding agent runs this task.' },
                task: { type: 'string', description: 'The self-contained task for the new agent.' },
                title: { type: 'string', description: 'A short name for the session, 2–6 words.' },
                model: { type: 'string', description: "Optional model for this agent's CLI; omit to use the CLI's default." }
              },
              required: ['agent', 'task'],
              additionalProperties: false
            }
          },
          reason: { type: 'string', description: 'One sentence for the user on why these sessions, shown when they approve.' }
        },
        required: ['sessions'],
        additionalProperties: false
      }
    },
    {
      name: DISPATCH_TOOL.list,
      description:
        'List the sessions you started: status, branch, changes, the checks their agent ran, conflicts with the base and with each other, and a suggested merge order. For looking things up, not for waiting: reports come to you automatically.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: DISPATCH_TOOL.read,
      description: `Read the latest final message (its report) of one session you started, with its changed files and diff stats. Reading it marks its pending report as delivered. Long messages come in pages of ${DISPATCH_LIMITS.readPage} characters: pass nextOffset as offset.`,
      inputSchema: {
        type: 'object',
        properties: { id, offset: { type: 'integer', minimum: 0, description: 'Where to continue a long message.' } },
        required: ['id'],
        additionalProperties: false
      }
    },
    {
      name: DISPATCH_TOOL.send,
      description:
        "Send a follow-up to one session you started, such as a correction or the next review round. It reaches that agent as a message from another session, not from the user; a busy agent reads it after its current step or turn. Don't send acknowledgements or progress chatter.",
      inputSchema: {
        type: 'object',
        properties: { id, text: { type: 'string', description: 'The message.' } },
        required: ['id', 'text'],
        additionalProperties: false
      }
    },
    {
      name: DISPATCH_TOOL.stop,
      description:
        "Interrupt the current turn of one session you started, like pressing Esc in it. The session, its worktree and its work stay; only the user can merge, archive or close it.",
      inputSchema: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false }
    }
  ]
}

// --- results -------------------------------------------------------------------------------------------------------

/** Returned to the agent as a result (never thrown), so it can tell a refusal from a broken tool. */
export type DispatchFailure =
  | 'invalid_request'
  | 'not_allowed'
  | 'agent_unavailable'
  | 'limit'
  | 'duplicate'
  | 'declined'
  | 'timeout'
  | 'not_found'
  | 'wavi_unavailable'
  | 'blocked_by_dialog'
  | 'failed'

export type DispatchToolResult = { ok: true; text: string } | { ok: false; failure: DispatchFailure; text: string }

export const toolOk = (text: string): DispatchToolResult => ({ ok: true, text })
export const toolFail = (failure: DispatchFailure, text: string): DispatchToolResult => ({ ok: false, failure, text })

/** What the MCP server gets back for a call that is not settled yet (it polls with the call id). */
export type DispatchCallReply = { done: true; result: DispatchToolResult } | { done: false; callId: string }

/** The MCP server's first question: whether to list the tools at all, and which agents a session may start. */
export interface DispatchHello {
  tools: boolean
  agents: DispatchAgent[]
}

export function parseToolResult(raw: unknown): DispatchToolResult | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  if (typeof v.text !== 'string') return null
  const text = v.text.slice(0, 200_000)
  if (v.ok === true) return toolOk(text)
  const failures: readonly string[] = [
    'invalid_request',
    'not_allowed',
    'agent_unavailable',
    'limit',
    'duplicate',
    'declined',
    'timeout',
    'not_found',
    'wavi_unavailable',
    'blocked_by_dialog',
    'failed'
  ]
  return v.ok === false && typeof v.failure === 'string' && failures.includes(v.failure) ? toolFail(v.failure as DispatchFailure, text) : null
}

// --- start_sessions ------------------------------------------------------------------------------------------------

export interface StartItem {
  agent: DispatchAgent
  task: string
  title: string
  model?: string
}

export interface StartRequest {
  items: StartItem[]
  reason?: string
}

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)

/** A session's name from the given title, else the task's first line. */
export function titleFor(task: string, title?: string): string {
  const given = title?.replace(/\s+/g, ' ').trim()
  const line = given || (task.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? '')
  const chars = [...line]
  return chars.length > DISPATCH_LIMITS.title ? `${chars.slice(0, DISPATCH_LIMITS.title - 1).join('')}…` : line
}

export function parseStartArgs(args: unknown, available: readonly DispatchAgent[]): { ok: true; request: StartRequest } | { ok: false; result: DispatchToolResult } {
  const v = record(args)
  const list = v?.sessions
  if (!v || !Array.isArray(list) || list.length === 0) return { ok: false, result: toolFail('invalid_request', 'Pass sessions: a list of 1–4 { agent, task }.') }
  if (list.length > DISPATCH_LIMITS.batch) return { ok: false, result: toolFail('limit', `At most ${DISPATCH_LIMITS.batch} sessions per call.`) }
  const items: StartItem[] = []
  for (const [i, raw] of list.entries()) {
    const item = record(raw)
    const n = `sessions[${i}]`
    if (!item) return { ok: false, result: toolFail('invalid_request', `${n} must be an object.`) }
    if (!isDispatchAgent(item.agent)) return { ok: false, result: toolFail('invalid_request', `${n}.agent must be one of: ${available.join(', ')}.`) }
    if (!available.includes(item.agent)) {
      return { ok: false, result: toolFail('agent_unavailable', `${DISPATCH_AGENTS[item.agent].name} is not installed here. Available: ${available.join(', ') || 'none'}.`) }
    }
    if (typeof item.task !== 'string' || item.task.trim() === '') return { ok: false, result: toolFail('invalid_request', `${n}.task is empty.`) }
    if (item.task.length > DISPATCH_LIMITS.task) return { ok: false, result: toolFail('invalid_request', `${n}.task is longer than ${DISPATCH_LIMITS.task} characters.`) }
    if (looksLikeReport(item.task)) return { ok: false, result: toolFail('not_allowed', `${n}.task is a Wavi report; write the task itself.`) }
    if (item.title !== undefined && typeof item.title !== 'string') return { ok: false, result: toolFail('invalid_request', `${n}.title must be a string.`) }
    if (item.model !== undefined && (typeof item.model !== 'string' || !MODEL.test(item.model))) {
      return { ok: false, result: toolFail('invalid_request', `${n}.model is not a model name.`) }
    }
    items.push({
      agent: item.agent,
      task: item.task.trim(),
      title: titleFor(item.task, typeof item.title === 'string' ? item.title : undefined),
      ...(typeof item.model === 'string' ? { model: item.model } : {})
    })
  }
  const reason = typeof v.reason === 'string' && v.reason.trim() !== '' ? v.reason.trim().slice(0, DISPATCH_LIMITS.reason) : undefined
  return { ok: true, request: { items, ...(reason ? { reason } : {}) } }
}

const sameTask = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/** Why a dispatcher may not start these now, or null. `openTasks`: the tasks of its children still open. */
export function startRefusal(input: { isChild: boolean; toolsOn: boolean; openTasks: readonly string[]; items: readonly StartItem[] }): DispatchToolResult | null {
  if (!input.toolsOn) return toolFail('not_allowed', 'The user turned off dispatch in Wavi (设置 · 自动化 · 派活).')
  if (input.isChild) return toolFail('not_allowed', 'This session was itself dispatched; it cannot start sessions. Do the work yourself, or report back what else is needed.')
  const room = DISPATCH_LIMITS.openChildren - input.openTasks.length
  if (input.items.length > room) {
    return toolFail(
      'limit',
      room <= 0
        ? `You already have ${input.openTasks.length} open sessions (the limit is ${DISPATCH_LIMITS.openChildren}). Use send_message on one of them, or ask the user to close or archive some.`
        : `You can start ${room} more (the limit is ${DISPATCH_LIMITS.openChildren} open sessions); this call asked for ${input.items.length}.`
    )
  }
  for (const [i, item] of input.items.entries()) {
    if (input.openTasks.some((t) => sameTask(t, item.task)) || input.items.some((other, j) => j < i && sameTask(other.task, item.task))) {
      return toolFail('duplicate', `sessions[${i}] repeats a task already dispatched. Use send_message to that session instead.`)
    }
  }
  return null
}

export interface ChildPlan {
  item: StartItem
  branch: string
  path: string
  request: WorktreeCreateRequest
}

/**
 * One new worktree per item off the dispatcher's branch: `<prefix>/<title-slug>` (a generated name when the title has
 * no ASCII words, e.g. Chinese), made unique against the repository's branches and each other.
 */
export function planChildren(input: {
  items: readonly StartItem[]
  root: string
  base: string
  prefix: string
  branches: readonly string[]
  worktreesDir: string
  takenFolders: readonly string[]
  prepare: boolean
  random?: () => number
}): ChildPlan[] {
  const taken = new Set(input.branches)
  const folders = new Set(input.takenFolders)
  return input.items.map((item) => {
    const slug = slugify(item.title).slice(0, 40).replace(/-+$/, '')
    let branch = slug.length >= 3 ? (input.prefix ? `${input.prefix}/${slug}` : slug) : generateBranchName(input.prefix, taken, input.random)
    for (let n = 2; taken.has(branch); n++) branch = `${branch.replace(/-\d+$/, '')}-${n}`
    taken.add(branch)
    const folder = folderNameFor(branch, folders)
    folders.add(folder)
    return { item, branch, path: `${input.worktreesDir}/${folder}`, request: { root: input.root, branch, base: input.base, folder, prepare: input.prepare } }
  })
}

/**
 * The first message a child gets (in place of the bare task): who sent it, where it works, and what its last message
 * is for. Calm and short, rules next to what they govern (Orca: shouted rules read as injection).
 */
export function childBrief(input: { task: string; parentTitle: string; parentAgent: DispatchAgent; branch: string; base: string }): string {
  const from = `${DISPATCH_AGENTS[input.parentAgent].name}（会话「${input.parentTitle || '未命名'}」）`
  return [
    `这是 Wavi 转来的任务：${from}把它派给了你。你在新的 worktree 里，分支 ${input.branch}，基于 ${input.base}。`,
    input.task,
    '只做这件事；不要合并、推送或切换分支，这些由用户决定。做完时，你的最后一条消息就是交给派活方的报告：先写结果，再写改了哪些文件、跑了哪些检查和结果、还有什么没做。如果做不下去，最后一行写 BLOCKED: <原因>。'
  ].join('\n\n')
}

// --- reports -------------------------------------------------------------------------------------------------------

export const REPORT_HEADER = '[Wavi 派活报告]'

/** Report text fed back as a task would make a loop (Nimbalyst's guard). */
export const looksLikeReport = (text: string): boolean => text.trimStart().startsWith(REPORT_HEADER)

export type ChildEvent = 'done' | 'error' | 'exited'

/** A child's turn ended, failed or its agent went away; null for anything that does not wake the dispatcher. */
export function childEvent(prev: { status: SessionStatus; exited: boolean }, next: { status: SessionStatus; exited: boolean }): ChildEvent | null {
  if (next.exited && !prev.exited) return 'exited'
  if (next.exited) return null
  if (next.status === 'error' && prev.status !== 'error') return 'error'
  // A child waiting for the user does not wake the dispatcher: it could not answer for the user anyway.
  const wasWorking = prev.status === 'running' || prev.status === 'needs_you'
  if (wasWorking && (next.status === 'done_unread' || next.status === 'idle')) return 'done'
  return null
}

export interface ChildReport {
  childId: SessionId
  title: string
  agent: DispatchAgent
  event: ChildEvent
  branch: string
  /** `+120 −30 · 4 个文件` */
  changes?: string
  /** `测试 ✓ · lint ✗` */
  checks?: string
  /** `和 jacob/x-2 冲突 2 个文件` */
  conflicts?: string
  /** The child's last message (its report), whole; the report text cuts it. */
  message?: string
  /** The child's turn this report is about (its finishedAt), so one turn is reported once. */
  turn?: number
}

const EVENT_TEXT: Record<ChildEvent, string> = { done: '一轮结束', error: '出错', exited: 'agent 已退出' }

function cut(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/**
 * One message to the dispatcher for a batch of child reports. Each child gets a line of facts and an excerpt of its
 * last message within the shared budget; later children over budget point to read_result instead.
 */
export function reportText(reports: readonly ChildReport[], running: readonly { title: string }[] = []): string {
  const lines = [`${REPORT_HEADER} 你派出的会话有了结果（来自 ${reports.length === 1 ? '这个会话' : `${reports.length} 个会话`}，不是用户的指示）。`]
  let budget: number = DISPATCH_LIMITS.reportBudget
  for (const r of reports) {
    const facts = [`「${r.title}」`, DISPATCH_AGENTS[r.agent].name, EVENT_TEXT[r.event], `分支 ${r.branch}`, r.changes, r.checks, r.conflicts, `id ${r.childId}`]
    lines.push('', `— ${facts.filter(Boolean).join(' · ')}`)
    const message = r.message?.trim()
    if (!message) {
      // An agent whose turn failed (a provider error, a crash) often leaves no reply: say so instead of nothing.
      if (r.event !== 'exited') lines.push('  （这一轮结束时没有留下回复，可能出错了；它的终端里有原因，可以请用户去看看）')
      continue
    }
    const room = Math.min(DISPATCH_LIMITS.excerpt, budget)
    if (room < 200) {
      lines.push('  （最后一条消息较长，用 read_result 读）')
      continue
    }
    const excerpt = cut(message, room)
    budget -= excerpt.length
    lines.push(...excerpt.split('\n').map((l) => `  ${l}`))
    if (excerpt.length < message.length) lines.push('  （没写完，用 read_result 读全文）')
  }
  if (running.length > 0) lines.push('', `仍在进行：${running.map((r) => `「${r.title}」`).join('、')}。`)
  lines.push('', '要看完整结果和改动，调 read_result；要继续让某个会话做，调 send_message。合并、推送、归档由用户在 Wavi 里决定。')
  return lines.join('\n')
}

// --- the queue between a child's event and the dispatcher -----------------------------------------------------------

export interface ReportQueue {
  /** At most one per child: a newer report replaces the older one (Nimbalyst's supersede). */
  pending: ChildReport[]
  /** When the oldest pending report arrived (the debounce runs from the newest). */
  lastAt: number | null
  /** When reports were woken into the dispatcher, for the hourly budget. */
  sent: number[]
  /** Child + turn + event already reported, so the same settle is never sent twice. */
  seen: string[]
}

export const emptyQueue = (): ReportQueue => ({ pending: [], lastAt: null, sent: [], seen: [] })

const keyOf = (r: ChildReport): string => `${r.childId}:${r.turn ?? 0}:${r.event}`

export function enqueueReport(queue: ReportQueue, report: ChildReport, now: number): ReportQueue {
  const key = keyOf(report)
  if (queue.seen.includes(key)) return queue
  return {
    ...queue,
    pending: [...queue.pending.filter((r) => r.childId !== report.childId), report],
    lastAt: now,
    seen: [...queue.seen, key].slice(-200)
  }
}

/** The dispatcher read this child's result itself (read_result): its pending report is not sent (T3's ack). */
export function ackReport(queue: ReportQueue, childId: SessionId): ReportQueue {
  if (!queue.pending.some((r) => r.childId === childId)) return queue
  const pending = queue.pending.filter((r) => r.childId !== childId)
  return { ...queue, pending, lastAt: pending.length > 0 ? queue.lastAt : null }
}

export type TakeResult =
  | { kind: 'none'; queue: ReportQueue }
  /** Not yet: wait this many ms. */
  | { kind: 'wait'; queue: ReportQueue; ms: number }
  | { kind: 'send'; queue: ReportQueue; batch: ChildReport[] }
  /** Over the hourly budget: the batch waits for the user's 送进去. */
  | { kind: 'held'; queue: ReportQueue }

const HOUR = 60 * 60_000

export function takeDue(queue: ReportQueue, now: number): TakeResult {
  if (queue.pending.length === 0 || queue.lastAt === null) return { kind: 'none', queue }
  const waited = now - queue.lastAt
  if (waited < DISPATCH_LIMITS.debounceMs) return { kind: 'wait', queue, ms: DISPATCH_LIMITS.debounceMs - waited }
  const sent = queue.sent.filter((t) => now - t < HOUR)
  if (sent.length >= DISPATCH_LIMITS.wakesPerHour) return { kind: 'held', queue: { ...queue, sent } }
  return { kind: 'send', queue: { ...queue, pending: [], lastAt: null, sent: [...sent, now] }, batch: queue.pending }
}

/** The user pressed 送进去: everything pending goes now, budget or not. */
export function takeAll(queue: ReportQueue): { queue: ReportQueue; batch: ChildReport[] } {
  return { queue: { ...queue, pending: [], lastAt: null }, batch: queue.pending }
}

/** A page of a long message for read_result. */
export function messagePage(message: string, offset = 0): { text: string; nextOffset: number | null } {
  const start = Math.max(0, Math.min(offset, message.length))
  const end = Math.min(message.length, start + DISPATCH_LIMITS.readPage)
  return { text: message.slice(start, end), nextOffset: end < message.length ? end : null }
}

/** What the confirmation panel and its tooltip say will happen (PRD §2). */
export function startNote(count: number, parentTitle: string): string {
  return `新建 ${count} 个 worktree，各启动一个 agent 并把任务发给它；做完后把结果报告给「${parentTitle || '未命名'}」。每个会话各用一次你自己的额度。`
}

// --- IPC (main ↔ the window that owns the dispatcher) ---------------------------------------------------------------

export const DISPATCH_IPC = {
  /** main → renderer, payload DispatchRequest: an agent called a tool (or said hello) */
  request: 'dispatch:request',
  /** send(callId, DispatchToolResult | DispatchHello): the window's answer */
  reply: 'dispatch:reply',
  /** invoke(DeliverRequest) → DeliverResult: put a report into a dispatcher through its agent's own channel */
  deliver: 'dispatch:deliver'
} as const

export interface DispatchRequest {
  callId: string
  /** The calling session (from its hook environment; main checked the token). */
  sessionId: SessionId
  agent: DispatchAgent
  tool: DispatchToolName | 'hello'
  args: unknown
}

export interface DeliverRequest {
  sessionId: SessionId
  agent: DispatchAgent
  /** Codex's thread id for `codex queue` (the session's agentSessionId). */
  agentSessionId?: string
  text: string
}

/** `no-channel`: the agent has no way in that does not type into its terminal; the window offers 送进去 instead. */
export type DeliverResult = 'delivered' | 'no-channel' | 'failed'

export interface DispatchApi {
  onRequest(listener: (request: DispatchRequest) => void): () => void
  reply(callId: string, result: DispatchToolResult | DispatchHello): void
  deliver(request: DeliverRequest): Promise<DeliverResult>
}

const MAX_DELIVER = 64_000
const SESSION = /^[A-Za-z0-9._:-]{1,128}$/
const AGENT_SESSION = /^[A-Za-z0-9-]{8,128}$/

export function parseDeliverRequest(raw: unknown): DeliverRequest | null {
  const v = record(raw)
  if (!v || typeof v.sessionId !== 'string' || !SESSION.test(v.sessionId) || !isDispatchAgent(v.agent)) return null
  if (typeof v.text !== 'string' || v.text.trim() === '' || v.text.length > MAX_DELIVER || v.text.includes('\0')) return null
  if (v.agentSessionId !== undefined && (typeof v.agentSessionId !== 'string' || !AGENT_SESSION.test(v.agentSessionId))) return null
  return { sessionId: v.sessionId, agent: v.agent, text: v.text, ...(typeof v.agentSessionId === 'string' ? { agentSessionId: v.agentSessionId } : {}) }
}

export function parseHello(raw: unknown): DispatchHello | null {
  const v = record(raw)
  if (!v || typeof v.tools !== 'boolean' || !Array.isArray(v.agents)) return null
  return { tools: v.tools, agents: v.agents.filter(isDispatchAgent) }
}
