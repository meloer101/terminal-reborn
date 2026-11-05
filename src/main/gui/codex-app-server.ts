// `codex app-server` notifications and server requests → GUI events (PRD F23 / §6.17). Items arrive as
// item/started → deltas → item/completed; approvals and questions are JSON-RPC requests from the server that wait
// for our response. Pure: the session host owns the process and the JSON-RPC ids.

import type { GuiAnswer, GuiConfigOption, GuiEvent, GuiPermissionOption, GuiPrompt } from '@shared/gui-chat'
import { CHAT_LIMITS, type ChatItem, type DiffHunk } from '@shared/transcript-chat'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)
const tail = (text: string, max: number): string => (text.length > max ? `…${text.slice(text.length - max)}` : text)

/** Approval presets offered in the mode picker (`never` is left out on purpose). */
export const CODEX_MODES: { value: string; label: string }[] = [
  { value: 'untrusted', label: '询问' },
  { value: 'on-request', label: '自动' }
]

const EFFORT_LABELS: Record<string, string> = { minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '最高' }

/** A unified diff (as `fileChange.changes[].diff` carries it) → hunks with ` ` / `+` / `-` lines. */
export function hunksOfUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  for (const line of diff.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (head) {
      current = { oldStart: Number(head[1]), newStart: Number(head[2]), lines: [] }
      hunks.push(current)
      continue
    }
    if (!current || line.startsWith('\\')) continue
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) current.lines.push(line)
  }
  return hunks
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

function diffOfChanges(changes: unknown, cwd: string): ToolItem['diff'] | undefined {
  const list = Array.isArray(changes) ? changes.filter(isRec) : []
  if (list.length === 0) return undefined
  const rel = (p: string) => (p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p)
  let added = 0
  let removed = 0
  const hunks: DiffHunk[] = []
  for (const change of list) {
    const diff = str(change.diff) ?? ''
    const kind = isRec(change.kind) ? change.kind.type : undefined
    const parsed = kind === 'add' && !diff.includes('@@') ? [{ oldStart: 0, newStart: 1, lines: diff.replace(/\n$/, '').split('\n').map((l) => `+${l}`) }] : hunksOfUnifiedDiff(diff)
    for (const h of parsed) {
      for (const l of h.lines) {
        if (l.startsWith('+')) added++
        else if (l.startsWith('-')) removed++
      }
    }
    hunks.push(...parsed)
  }
  const path = rel(str(list[0]!.path) ?? '')
  let budget: number = CHAT_LIMITS.diffLines
  let truncated = false
  const kept = hunks.flatMap((h) => {
    if (budget <= 0) {
      truncated = true
      return []
    }
    const lines = h.lines.slice(0, budget)
    if (lines.length < h.lines.length) truncated = true
    budget -= lines.length
    return [{ ...h, lines }]
  })
  return { path: list.length > 1 ? `${path} 等 ${list.length} 个文件` : path, hunks: kept, added, removed, truncated }
}

function userText(content: unknown): { text: string; images: number } {
  const parts = Array.isArray(content) ? content.filter(isRec) : []
  return {
    text: parts.map((p) => (p.type === 'text' ? (str(p.text) ?? '') : '')).join('').trim(),
    images: parts.filter((p) => p.type === 'image' || p.type === 'localImage').length
  }
}

export interface CodexPending {
  /** The JSON-RPC id of the server request, as a string (prompt id). */
  id: string
  method: string
  params: Rec
}

export interface CodexNormalizer {
  notification(method: string, params: Rec): GuiEvent[]
  /** A server request (approval, question): becomes a prompt; the host answers it with `codexAnswerResult`. */
  request(id: string, method: string, params: Rec): GuiEvent[]
  pending(id: string): CodexPending | undefined
  settle(id: string): GuiEvent[]
}

export function createCodexNormalizer(cwd: string, now: () => number = Date.now): CodexNormalizer {
  const items: ChatItem[] = []
  const indexOf = new Map<string, number>()
  const waiting = new Map<string, CodexPending>()
  let live: { kind: 'text' | 'thinking'; text: string; itemId: string } | null = null

  const put = (key: string, item: ChatItem): GuiEvent => {
    let index = indexOf.get(key)
    if (index === undefined) {
      index = items.length
      indexOf.set(key, index)
    }
    items[index] = item
    return { type: 'items', changes: [{ index, item }] }
  }
  const system = (text: string): GuiEvent => put(`s${items.length}`, { kind: 'system', id: `s${items.length}`, at: now(), text })
  const endLive = (itemId?: string): GuiEvent[] => {
    if (!live || (itemId && live.itemId !== itemId)) return []
    live = null
    return [{ type: 'live', live: null }]
  }

  function itemEvent(item: Rec, done: boolean): GuiEvent[] {
    const id = str(item.id) ?? `i${items.length}`
    const at = typeof item.startedAtMs === 'number' ? item.startedAtMs : now()
    switch (item.type) {
      case 'userMessage': {
        if (!done) return []
        const { text, images } = userText(item.content)
        return text || images ? [put(id, { kind: 'user', id, at, text: clip(text, CHAT_LIMITS.text), images })] : []
      }
      case 'agentMessage': {
        if (!done) return []
        const text = (str(item.text) ?? '').trim()
        return [...endLive(id), ...(text ? [put(id, { kind: 'text', id, at, text: clip(text, CHAT_LIMITS.text) })] : [])]
      }
      case 'reasoning': {
        if (!done) return []
        const summary = (Array.isArray(item.summary) ? item.summary : []).filter((s): s is string => typeof s === 'string').join('\n\n').trim()
        const ms = typeof item.completedAtMs === 'number' && typeof item.startedAtMs === 'number' ? item.completedAtMs - item.startedAtMs : undefined
        return [...endLive(id), put(id, { kind: 'thinking', id, at, text: clip(summary, CHAT_LIMITS.thinking), ...(ms !== undefined ? { ms } : {}) })]
      }
      case 'commandExecution': {
        const exit = typeof item.exitCode === 'number' ? item.exitCode : null
        const status = str(item.status)
        const state: ToolItem['state'] = !done ? 'running' : exit === 0 || status === 'completed' ? 'ok' : 'error'
        const output = str(item.aggregatedOutput)
        return [put(id, { kind: 'tool', id, at, name: 'Bash', arg: clip((str(item.command) ?? '').replace(/\s+/g, ' ').trim(), CHAT_LIMITS.arg), state, ...(output ? { output: tail(output, CHAT_LIMITS.output) } : {}) })]
      }
      case 'fileChange': {
        const diff = diffOfChanges(item.changes, cwd)
        const status = str(item.status)
        const state: ToolItem['state'] = !done ? 'running' : status === 'declined' || status === 'failed' ? 'error' : 'ok'
        return [put(id, { kind: 'tool', id, at, name: 'Edit', arg: diff?.path ?? '', state, ...(diff && done ? { diff } : {}) })]
      }
      case 'mcpToolCall':
      case 'dynamicToolCall': {
        const name = str(item.tool) ?? str(item.name) ?? 'Tool'
        const state: ToolItem['state'] = !done ? 'running' : str(item.status) === 'failed' ? 'error' : 'ok'
        return [put(id, { kind: 'tool', id, at, name, arg: clip(str(item.server) ?? '', CHAT_LIMITS.arg), state })]
      }
      case 'webSearch':
        return [put(id, { kind: 'tool', id, at, name: 'WebSearch', arg: clip(str(item.query) ?? '', CHAT_LIMITS.arg), state: done ? 'ok' : 'running' })]
      case 'contextCompaction':
        return done ? [put(id, { kind: 'system', id, at, text: '对话已压缩' })] : []
      default:
        return []
    }
  }

  return {
    notification(method, params) {
      switch (method) {
        case 'turn/started':
          return [{ type: 'busy', busy: true }]
        case 'turn/completed': {
          const turn = isRec(params.turn) ? params.turn : {}
          const events: GuiEvent[] = [...endLive()]
          if (turn.status === 'interrupted') events.push(system('已中断'))
          for (const id of waiting.keys()) events.push({ type: 'prompt-done', id })
          waiting.clear()
          events.push({ type: 'busy', busy: false })
          return events
        }
        case 'item/started':
        case 'item/completed':
          return isRec(params.item) ? itemEvent(params.item, method === 'item/completed') : []
        case 'item/agentMessage/delta':
        case 'item/reasoning/summaryTextDelta': {
          const kind = method === 'item/agentMessage/delta' ? 'text' : 'thinking'
          const itemId = str(params.itemId) ?? ''
          const delta = str(params.delta) ?? ''
          if (!live || live.itemId !== itemId || live.kind !== kind) live = { kind, text: '', itemId }
          live = { ...live, text: live.text + delta }
          return [{ type: 'live', live: { kind, text: live.text } }]
        }
        case 'serverRequest/resolved': {
          const id = String(params.requestId ?? '')
          return waiting.delete(id) ? [{ type: 'prompt-done', id }] : []
        }
        case 'error': {
          const error = isRec(params.error) ? params.error : {}
          // Retries report here too ("Reconnecting… 1/5"); only a final error is the conversation's.
          if (params.willRetry === true) return []
          return [system(clip(str(error.message) ?? 'Codex 出错', 300))]
        }
        default:
          return []
      }
    },
    request(id, method, params) {
      const prompt = promptOfCodex(id, method, params)
      if (!prompt) return []
      waiting.set(id, { id, method, params })
      return [{ type: 'prompt', prompt }]
    },
    pending: (id) => waiting.get(id),
    settle(id) {
      return waiting.delete(id) ? [{ type: 'prompt-done', id }] : []
    }
  }
}

const DECISIONS: Record<string, GuiPermissionOption> = {
  decline: { id: 'decline', label: '拒绝', kind: 'reject_once' },
  acceptForSession: { id: 'acceptForSession', label: '总是允许', kind: 'allow_always' },
  accept: { id: 'accept', label: '允许', kind: 'allow_once' }
}

export function promptOfCodex(id: string, method: string, params: Rec): GuiPrompt | null {
  if (method === 'item/commandExecution/requestApproval') {
    const offered = (Array.isArray(params.availableDecisions) ? params.availableDecisions : []).filter((d): d is string => typeof d === 'string')
    const keys = (offered.length > 0 ? offered : ['decline', 'accept']).filter((d) => d in DECISIONS)
    const options = ['decline', 'acceptForSession', 'accept'].filter((k) => keys.includes(k)).map((k) => DECISIONS[k]!)
    return { kind: 'permission', id, tool: 'Bash', detail: str(params.command) ?? str(params.reason) ?? '运行命令', options }
  }
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    return { kind: 'permission', id, tool: 'Edit', detail: str(params.reason) ?? '修改文件', options: [DECISIONS.decline!, DECISIONS.accept!] }
  }
  if (method === 'item/tool/requestUserInput') {
    const questions = (Array.isArray(params.questions) ? params.questions : []).filter(isRec).map((q) => ({
      question: str(q.question) ?? '',
      ...(str(q.header) ? { header: str(q.header)! } : {}),
      multiSelect: false,
      options: (Array.isArray(q.options) ? q.options : []).filter(isRec).map((o) => ({ label: str(o.label) ?? '', ...(str(o.description) ? { description: str(o.description)! } : {}) }))
    }))
    return { kind: 'question', id, questions }
  }
  return null
}

/** The JSON-RPC result for an answered server request. */
export function codexAnswerResult(pending: CodexPending, answer: GuiAnswer): Rec {
  if (answer.kind === 'question') {
    const questions = (Array.isArray(pending.params.questions) ? pending.params.questions : []).filter(isRec)
    const answers: Rec = {}
    for (const q of questions) {
      const text = str(q.question) ?? ''
      const key = str(q.id) ?? text
      const value = answer.answers[text]
      if (value !== undefined) answers[key] = { answers: [value] }
    }
    return { answers }
  }
  if (answer.kind === 'permission') return { decision: answer.optionId in DECISIONS ? answer.optionId : 'decline' }
  return { decision: 'decline' }
}

/** Pickers from `model/list` and the thread's settings; model and effort go with the next `turn/start`. */
export function codexConfig(models: unknown[], current: { model?: string; effort?: string; approvalPolicy?: string }): GuiConfigOption[] {
  const list = models.filter(isRec).filter((m) => m.hidden !== true)
  const values = list.flatMap((m) => {
    const value = str(m.id) ?? str(m.model)
    return value ? [{ value, label: str(m.displayName) ?? value }] : []
  })
  const model = current.model && values.some((v) => v.value === current.model) ? current.model : (str(list.find((m) => m.isDefault === true)?.id) ?? values[0]?.value ?? '')
  const config: GuiConfigOption[] = [{ id: 'model', category: 'model', label: '模型', current: model, values }]
  const chosen = list.find((m) => m.id === model)
  const efforts = (Array.isArray(chosen?.supportedReasoningEfforts) ? chosen.supportedReasoningEfforts : []).filter(isRec).flatMap((e) => (str(e.reasoningEffort) ? [str(e.reasoningEffort)!] : []))
  if (efforts.length > 0) {
    const fallback = str(chosen?.defaultReasoningEffort) ?? efforts[0]!
    config.push({
      id: 'effort',
      category: 'thought_level',
      label: '推理强度',
      current: current.effort && efforts.includes(current.effort) ? current.effort : fallback,
      values: efforts.map((e) => ({ value: e, label: EFFORT_LABELS[e] ?? e }))
    })
  }
  const policy = current.approvalPolicy && CODEX_MODES.some((m) => m.value === current.approvalPolicy) ? current.approvalPolicy : 'on-request'
  config.push({ id: 'mode', category: 'mode', label: '权限模式', current: policy, values: CODEX_MODES })
  return config
}

/** `turn/start` params with the current pickers applied (they hold for this turn and after). */
export function codexTurnParams(threadId: string, text: string, config: readonly GuiConfigOption[], images: string[] = []): Rec {
  const value = (id: string) => config.find((c) => c.id === id)?.current
  return {
    threadId,
    input: [{ type: 'text', text, text_elements: [] }, ...images.map((path) => ({ type: 'localImage', path }))],
    ...(value('model') ? { model: value('model') } : {}),
    ...(value('effort') ? { effort: value('effort') } : {}),
    ...(value('mode') ? { approvalPolicy: value('mode') } : {})
  }
}
