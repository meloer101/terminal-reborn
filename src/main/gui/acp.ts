// ACP (Agent Client Protocol) `session/update` notifications and `session/request_permission` → GUI events
// (PRD F23 / §6.17), for the agents that speak ACP (Gemini, Qwen, OpenCode, Goose, Kimi, Kiro, Copilot, Cursor,
// Droid, Cline, Auggie, CodeBuddy, Grok, Antigravity; Pi and Amp through adapters). ACP streams message chunks with
// no "message done" signal: a run of chunks is one block, finished when anything else arrives or the prompt returns.
// Pure: the session host owns the process and the JSON-RPC ids.

import type { GuiAnswer, GuiCommand, GuiConfigOption, GuiEvent, GuiPermissionOption, GuiPrompt } from '@shared/gui-chat'
import { CHAT_LIMITS, type ChatItem, type DiffHunk } from '@shared/transcript-chat'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)
const tail = (text: string, max: number): string => (text.length > max ? `…${text.slice(text.length - max)}` : text)

const CONTEXT = 3
/** Above this many line pairs the diff is shown as a whole replacement (the table would be too big). */
const MAX_PAIRS = 4_000_000

/** Old / new text → hunks with three lines of context (longest common subsequence of lines). */
export function lineDiff(oldText: string, newText: string): DiffHunk[] {
  const a = oldText === '' ? [] : oldText.replace(/\n$/, '').split('\n')
  const b = newText === '' ? [] : newText.replace(/\n$/, '').split('\n')
  type Op = { op: ' ' | '-' | '+'; line: string; oldNo: number; newNo: number }
  const ops: Op[] = []
  if (a.length * b.length > MAX_PAIRS) {
    a.forEach((line, i) => ops.push({ op: '-', line, oldNo: i + 1, newNo: 1 }))
    b.forEach((line, i) => ops.push({ op: '+', line, oldNo: a.length + 1, newNo: i + 1 }))
  } else {
    const w = b.length + 1
    const lcs = new Uint32Array((a.length + 1) * w)
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) ops.push({ op: ' ', line: a[i++]!, oldNo: i, newNo: ++j })
      // Removals before additions, as git prints them.
      else if (i < a.length && (j >= b.length || lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!)) ops.push({ op: '-', line: a[i++]!, oldNo: i, newNo: j + 1 })
      else ops.push({ op: '+', line: b[j++]!, oldNo: i + 1, newNo: j })
    }
  }
  const hunks: DiffHunk[] = []
  let k = 0
  while (k < ops.length) {
    if (ops[k]!.op === ' ') {
      k++
      continue
    }
    const from = Math.max(0, k - CONTEXT)
    let to = k
    let quiet = 0
    while (to < ops.length && quiet <= CONTEXT * 2) {
      quiet = ops[to]!.op === ' ' ? quiet + 1 : 0
      to++
    }
    const end = Math.min(ops.length, to - Math.max(0, quiet - CONTEXT))
    const slice = ops.slice(from, end)
    hunks.push({ oldStart: slice[0]!.oldNo, newStart: slice[0]!.newNo, lines: slice.map((o) => `${o.op}${o.line}`) })
    k = end
  }
  return hunks
}

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** ACP tool kinds → the names the chat view shows (same words as Claude's tools where they match). */
const KIND_NAMES: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Bash',
  think: 'Think',
  fetch: 'Fetch',
  switch_mode: 'Mode',
  other: 'Tool'
}

function textOfBlock(block: unknown): string {
  return isRec(block) && block.type === 'text' ? (str(block.text) ?? '') : ''
}

function rel(path: string, cwd: string): string {
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
}

function diffOfContent(content: unknown, cwd: string): ToolItem['diff'] | undefined {
  const diffs = (Array.isArray(content) ? content : []).filter((c): c is Rec => isRec(c) && c.type === 'diff')
  if (diffs.length === 0) return undefined
  let added = 0
  let removed = 0
  let budget: number = CHAT_LIMITS.diffLines
  let truncated = false
  const hunks: DiffHunk[] = []
  for (const d of diffs) {
    for (const h of lineDiff(str(d.oldText) ?? '', str(d.newText) ?? '')) {
      for (const l of h.lines) {
        if (l.startsWith('+')) added++
        else if (l.startsWith('-')) removed++
      }
      if (budget <= 0) {
        truncated = true
        continue
      }
      const lines = h.lines.slice(0, budget)
      if (lines.length < h.lines.length) truncated = true
      budget -= lines.length
      hunks.push({ ...h, lines })
    }
  }
  const path = rel(str(diffs[0]!.path) ?? '', cwd)
  return { path: diffs.length > 1 ? `${path} 等 ${diffs.length} 个文件` : path, hunks, added, removed, truncated }
}

function outputOfContent(content: unknown): string | undefined {
  const text = (Array.isArray(content) ? content : [])
    .filter(isRec)
    .map((c) => (c.type === 'content' ? textOfBlock(c.content) : ''))
    .filter(Boolean)
    .join('\n')
  return text ? tail(text, CHAT_LIMITS.output) : undefined
}

const STATE: Record<string, ToolItem['state']> = { pending: 'running', in_progress: 'running', completed: 'ok', failed: 'error' }

export interface AcpPending {
  id: string
  options: { optionId: string; kind: string }[]
}

export interface AcpNormalizer {
  update(update: Rec): GuiEvent[]
  /** `session/prompt` returned: the turn is over. */
  promptDone(stopReason: string | undefined): GuiEvent[]
  /** The user's own message, shown at once (ACP does not echo it back). */
  sent(id: string, text: string, images: number): GuiEvent[]
  request(id: string, params: Rec): GuiEvent[]
  pending(id: string): AcpPending | undefined
  settle(id: string): GuiEvent[]
}

export function createAcpNormalizer(cwd: string, now: () => number = Date.now): AcpNormalizer {
  const items: ChatItem[] = []
  const indexOf = new Map<string, number>()
  const tools = new Map<string, ToolItem>()
  const waiting = new Map<string, AcpPending>()
  let seq = 0
  let live: { kind: 'text' | 'thinking'; text: string } | null = null

  const put = (key: string, item: ChatItem): GuiEvent => {
    let index = indexOf.get(key)
    if (index === undefined) {
      index = items.length
      indexOf.set(key, index)
    }
    items[index] = item
    return { type: 'items', changes: [{ index, item }] }
  }
  /** The streamed block becomes a finished item. */
  const flush = (): GuiEvent[] => {
    if (!live) return []
    const done = live
    live = null
    const id = `${done.kind === 'text' ? 't' : 'k'}${seq++}`
    const text = done.text.trim()
    const events: GuiEvent[] = [{ type: 'live', live: null }]
    if (text) events.push(put(id, done.kind === 'text' ? { kind: 'text', id, at: now(), text: clip(text, CHAT_LIMITS.text) } : { kind: 'thinking', id, at: now(), text: clip(text, CHAT_LIMITS.thinking) }))
    return events
  }

  function tool(update: Rec): GuiEvent[] {
    const id = str(update.toolCallId)
    if (!id) return []
    const before = tools.get(id)
    const kind = str(update.kind)
    const title = str(update.title)
    const locations = (Array.isArray(update.locations) ? update.locations : []).filter(isRec)
    const path = str(locations[0]?.path)
    const status = str(update.status)
    const diff = 'content' in update ? diffOfContent(update.content, cwd) : before?.diff
    const output = 'content' in update ? outputOfContent(update.content) : before?.output
    const item: ToolItem = {
      kind: 'tool',
      id,
      at: before?.at ?? now(),
      name: kind ? (KIND_NAMES[kind] ?? 'Tool') : (before?.name ?? 'Tool'),
      arg: clip(((path ? rel(path, cwd) : undefined) ?? title ?? before?.arg ?? '').replace(/\s+/g, ' ').trim(), CHAT_LIMITS.arg),
      state: status ? (STATE[status] ?? 'running') : (before?.state ?? 'running'),
      ...(output ? { output } : {}),
      ...(diff ? { diff } : {})
    }
    tools.set(id, item)
    return [...flush(), put(id, item)]
  }

  return {
    update(update) {
      switch (update.sessionUpdate) {
        case 'agent_message_chunk':
        case 'agent_thought_chunk': {
          const kind = update.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thinking'
          const piece = textOfBlock(update.content)
          const events = live && live.kind !== kind ? flush() : []
          live = { kind, text: (live?.text ?? '') + piece }
          return [...events, { type: 'live', live: { ...live } }]
        }
        case 'user_message_chunk':
          // Replayed history (session/load); a live session shows the user's message from `sent`.
          return [...flush(), put(`u${seq}`, { kind: 'user', id: `u${seq++}`, at: now(), text: clip(textOfBlock(update.content), CHAT_LIMITS.text), images: 0 })]
        case 'tool_call':
        case 'tool_call_update':
          return tool(update)
        case 'plan': {
          const entries = (Array.isArray(update.entries) ? update.entries : []).filter(isRec)
          const text = entries.map((e) => `${e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '◌' : '○'} ${str(e.content) ?? ''}`).join('\n')
          return [...flush(), put('plan', { kind: 'system', id: 'plan', at: now(), text })]
        }
        case 'available_commands_update':
          return [{ type: 'commands', commands: acpCommands(update.availableCommands) }]
        default:
          return []
      }
    },
    promptDone(stopReason) {
      const events = flush()
      if (stopReason === 'cancelled') events.push(put(`s${seq}`, { kind: 'system', id: `s${seq++}`, at: now(), text: '已中断' }))
      for (const id of waiting.keys()) events.push({ type: 'prompt-done', id })
      waiting.clear()
      events.push({ type: 'busy', busy: false })
      return events
    },
    sent(id, text, images) {
      return [...flush(), put(id, { kind: 'user', id, at: now(), text: clip(text, CHAT_LIMITS.text), images }), { type: 'busy', busy: true }]
    },
    request(id, params) {
      const prompt = acpPermissionPrompt(id, params)
      const options = (Array.isArray(params.options) ? params.options : []).filter(isRec).map((o) => ({ optionId: str(o.optionId) ?? '', kind: str(o.kind) ?? '' }))
      waiting.set(id, { id, options })
      const toolCall = isRec(params.toolCall) ? params.toolCall : undefined
      return [...flush(), ...(toolCall ? tool(toolCall) : []), { type: 'prompt', prompt }]
    },
    pending: (id) => waiting.get(id),
    settle(id) {
      return waiting.delete(id) ? [{ type: 'prompt-done', id }] : []
    }
  }
}

const OPTION_ORDER: GuiPermissionOption['kind'][] = ['reject_once', 'reject_always', 'allow_always', 'allow_once']
const OPTION_LABELS: Record<GuiPermissionOption['kind'], string> = { reject_once: '拒绝', reject_always: '总是拒绝', allow_always: '总是允许', allow_once: '允许' }

export function acpPermissionPrompt(id: string, params: Rec): GuiPrompt {
  const toolCall = isRec(params.toolCall) ? params.toolCall : {}
  const options = (Array.isArray(params.options) ? params.options : [])
    .filter(isRec)
    .flatMap((o): GuiPermissionOption[] => {
      const kind = str(o.kind) as GuiPermissionOption['kind'] | undefined
      const optionId = str(o.optionId)
      return kind && optionId && kind in OPTION_LABELS ? [{ id: optionId, label: OPTION_LABELS[kind], kind }] : []
    })
    .sort((x, y) => OPTION_ORDER.indexOf(x.kind) - OPTION_ORDER.indexOf(y.kind))
  const kind = str(toolCall.kind)
  return { kind: 'permission', id, tool: kind ? (KIND_NAMES[kind] ?? 'Tool') : 'Tool', detail: str(toolCall.title) ?? '', options }
}

/** The `session/request_permission` result for an answer. */
export function acpAnswerResult(pending: AcpPending, answer: GuiAnswer): Rec {
  if (answer.kind === 'permission' && pending.options.some((o) => o.optionId === answer.optionId)) {
    return { outcome: { outcome: 'selected', optionId: answer.optionId } }
  }
  return { outcome: { outcome: 'cancelled' } }
}

export function acpCommands(raw: unknown): GuiCommand[] {
  return (Array.isArray(raw) ? raw : []).filter(isRec).flatMap((c) => {
    const name = str(c.name)
    if (!name) return []
    const hint = isRec(c.input) ? str(c.input.hint) : undefined
    return [{ name, description: str(c.description) ?? '', ...(hint ? { argumentHint: hint } : {}) }]
  })
}

/** `configOptions` from `session/new` (or `config_option_update`) → pickers; falls back to the older modes / models. */
export function acpConfig(session: Rec): GuiConfigOption[] {
  const options = (Array.isArray(session.configOptions) ? session.configOptions : []).filter(isRec)
  if (options.length > 0) {
    return options.flatMap((o): GuiConfigOption[] => {
      const id = str(o.id)
      if (!id || o.type !== 'select') return []
      const category = (['model', 'mode', 'thought_level'] as const).find((c) => c === o.category) ?? 'other'
      const values = (Array.isArray(o.options) ? o.options : []).filter(isRec).flatMap((v) => {
        const value = str(v.value) ?? str(v.id)
        return value ? [{ value, label: str(v.name) ?? str(v.label) ?? value }] : []
      })
      return [{ id, category, label: str(o.name) ?? id, current: str(o.currentValue) ?? values[0]?.value ?? '', values }]
    })
  }
  const config: GuiConfigOption[] = []
  if (isRec(session.models)) {
    const values = (Array.isArray(session.models.availableModels) ? session.models.availableModels : []).filter(isRec).flatMap((m) => {
      const value = str(m.modelId)
      return value ? [{ value, label: str(m.name) ?? value }] : []
    })
    config.push({ id: 'model', category: 'model', label: '模型', current: str(session.models.currentModelId) ?? values[0]?.value ?? '', values })
  }
  if (isRec(session.modes)) {
    const values = (Array.isArray(session.modes.availableModes) ? session.modes.availableModes : []).filter(isRec).flatMap((m) => {
      const value = str(m.id)
      return value ? [{ value, label: str(m.name) ?? value }] : []
    })
    config.push({ id: 'mode', category: 'mode', label: '模式', current: str(session.modes.currentModeId) ?? values[0]?.value ?? '', values })
  }
  return config
}

/** The request that applies a picker change: `session/set_config_option` when the agent sent configOptions. */
export function acpConfigRequest(sessionId: string, option: GuiConfigOption, value: string, viaConfigOptions: boolean): { method: string; params: Rec } {
  if (viaConfigOptions) return { method: 'session/set_config_option', params: { sessionId, configId: option.id, value } }
  if (option.category === 'mode') return { method: 'session/set_mode', params: { sessionId, modeId: value } }
  return { method: 'session/set_model', params: { sessionId, modelId: value } }
}
