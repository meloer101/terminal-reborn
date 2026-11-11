// Pi's rpc mode (`pi --mode rpc`, pi-mono modes/rpc @ ccbb224, measured on 0.84.1) → GUI events (PRD F23 v1.160), as
// Paseo (`27872a8`, providers/pi) and T3 Code (`6417151`, provider-pi) read it: `message_update` deltas stream a block,
// `tool_execution_*` are a tool row, `agent_end` ends the turn, `extension_ui_request` is something Pi waits on — Wavi's
// permission extension (resources/hooks/wavi-pi-gui.js) asks through `confirm` for every call that is not read-only,
// and other extensions' dialogs become questions. Also the pickers (models, the model's thinking levels, Wavi's 权限)
// and a conversation read back from Pi's session file. Pure: pi-driver.ts owns the process.

import { effortLabel, permissionOption, type GuiAnswer, type GuiCommand, type GuiConfigOption, type GuiEvent, type GuiPermission, type GuiPermissionOption, type GuiPrompt } from '@shared/gui-chat'
import { addedFile, CHAT_LIMITS, fileDiffs, hunksOfUnifiedDiff, keptImages, lineDiff, rel, toolArg, type ChatItem, type FileDiff, type KeepImage } from '@shared/transcript-chat'
import { clip, isRec, str, tail, type Rec } from './driver'

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** Pi's built-in tools in Claude's words, as resources/hooks/wavi-pi.js reports them; anything else keeps its name. */
const TOOL_NAMES: Readonly<Record<string, string>> = { bash: 'Bash', read: 'Read', edit: 'Edit', write: 'Write', grep: 'Grep', find: 'Glob', ls: 'LS' }
export const piToolName = (name: string): string => TOOL_NAMES[name] ?? name

/** Tools that change files: 接受编辑 lets them through without asking (T3 Code's PI_FILE_CHANGE_TOOLS). */
export const PI_FILE_CHANGE_TOOLS: ReadonlySet<string> = new Set(['edit', 'write'])

/** Figma 56: Pi can neither judge a step itself nor plan, so 询问 and 接受编辑 only (T3 Code maps auto to approval). */
export const PI_LEVELS: readonly GuiPermission[] = ['ask', 'accept-edits']

// --- pickers ------------------------------------------------------------------------------------------------------

/** A model as `--model` takes it. */
export function piModelValue(model: unknown): string | undefined {
  if (!isRec(model)) return undefined
  const provider = str(model.provider)
  const id = str(model.id)
  return provider && id ? `${provider}/${id}` : undefined
}

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The thinking levels a model takes (T3 Code thinkingCapabilities.ts): none without `reasoning`; a level mapped to null
 * is unsupported, and xhigh / max only when the model maps them.
 */
export function piThinkingLevels(model: unknown): string[] {
  if (!isRec(model) || model.reasoning !== true) return []
  const map = isRec(model.thinkingLevelMap) ? model.thinkingLevelMap : {}
  return THINKING_LEVELS.filter((level) => {
    const mapped = map[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
}

export interface PiPicks {
  model?: string
  effort?: string
  permission: GuiPermission
}

/**
 * The pickers: 模型, 推理强度 (`off` is 关), 权限. `levels`: what Pi says the running model takes
 * (`get_available_thinking_levels`); otherwise the chosen model's own (piThinkingLevels).
 */
export function piConfig(models: readonly unknown[], picks: PiPicks, levels?: readonly string[]): GuiConfigOption[] {
  const list = models.filter(isRec)
  const values = list.flatMap((m) => {
    const value = piModelValue(m)
    return value ? [{ value, label: clip(str(m.name) ?? str(m.id) ?? value, 80) }] : []
  })
  const config: GuiConfigOption[] = []
  const model = picks.model && values.some((v) => v.value === picks.model) ? picks.model : values[0]?.value
  if (model) config.push({ id: 'model', category: 'model', label: '模型', current: model, values })
  const offered = levels ?? piThinkingLevels(list.find((m) => piModelValue(m) === model))
  if (offered.length > 0) {
    config.push({
      id: 'effort',
      category: 'thought_level',
      label: '推理强度',
      current: picks.effort && offered.includes(picks.effort) ? picks.effort : offered.includes('high') ? 'high' : offered[0]!,
      values: offered.map((l) => ({ value: l, label: effortLabel(l, l === 'off' ? '关' : undefined) }))
    })
  }
  config.push(permissionOption(PI_LEVELS, picks.permission))
  return config
}

/** `get_commands` → the `/` menu; skills (`skill:<name>`) under Skills. */
export function piCommands(raw: unknown): GuiCommand[] {
  return (Array.isArray(raw) ? raw : []).filter(isRec).flatMap((c): GuiCommand[] => {
    const name = str(c.name)
    if (!name) return []
    const hint = isRec(c.input) ? str(c.input.hint) : undefined
    return [{ name, description: clip(str(c.description) ?? '', 300), ...(hint ? { argumentHint: hint } : {}), kind: c.source === 'skill' ? 'skill' : 'command' }]
  })
}

// --- tool rows ----------------------------------------------------------------------------------------------------

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  return (Array.isArray(content) ? content : [])
    .filter((b): b is Rec => isRec(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

/** What a tool is about to change (edit's `edits`, write's `content`), from its arguments. */
function diffOfArgs(tool: string, args: unknown, cwd: string): FileDiff | undefined {
  const a = isRec(args) ? args : {}
  const path = str(a.path)
  if (!path) return undefined
  if (tool === 'write' && typeof a.content === 'string') return fileDiffs([{ path: rel(path, cwd), hunks: [addedFile(a.content)] }])[0]
  if (tool === 'edit' && Array.isArray(a.edits)) {
    const hunks = a.edits.filter(isRec).flatMap((e) => lineDiff(str(e.oldText) ?? '', str(e.newText) ?? ''))
    return fileDiffs([{ path: rel(path, cwd), hunks }])[0]
  }
  return undefined
}

/** A finished edit's diff: Pi's own unified patch (`details.patch`, with the file's line numbers). */
function diffOfResult(tool: string, args: unknown, result: unknown, cwd: string): FileDiff | undefined {
  const patch = isRec(result) && isRec(result.details) ? str(result.details.patch) : undefined
  const path = isRec(args) ? str(args.path) : undefined
  if (tool === 'edit' && patch && path) return fileDiffs([{ path: rel(path, cwd), hunks: hunksOfUnifiedDiff(patch) }])[0]
  return diffOfArgs(tool, args, cwd)
}

function toolItem(id: string, at: number, tool: string, args: unknown, cwd: string): ToolItem {
  const name = piToolName(tool)
  const command = tool === 'bash' && isRec(args) ? str(args.command) : undefined
  const diff = diffOfArgs(tool, args, cwd)
  return { kind: 'tool', id, at, name, arg: toolArg(name, args, cwd), state: 'running', ...(command ? { input: clip(command, CHAT_LIMITS.input) } : {}), ...(diff ? { diff } : {}) }
}

function withResult(item: ToolItem, tool: string, args: unknown, result: unknown, isError: boolean, cwd: string): ToolItem {
  const output = textOf(isRec(result) ? result.content : result).trim()
  const diff = isError ? item.diff : diffOfResult(tool, args, result, cwd)
  return { ...item, state: isError ? 'error' : 'ok', ...(output ? { output: tail(output, CHAT_LIMITS.output) } : {}), ...(diff ? { diff } : {}) }
}

function userItem(id: string, at: number, content: unknown, keep: KeepImage | undefined): ChatItem {
  const blocks = Array.isArray(content) ? content.filter((b): b is Rec => isRec(b) && b.type === 'image') : []
  const inline = blocks.flatMap((b) => (typeof b.mimeType === 'string' && typeof b.data === 'string' ? [{ mediaType: b.mimeType, data: b.data }] : []))
  const attachments = keptImages(inline, keep)
  return { kind: 'user', id, at, text: clip(textOf(content), CHAT_LIMITS.text), images: blocks.length, ...(attachments ? { attachments } : {}) }
}

// --- what Pi waits on -----------------------------------------------------------------------------------------------

/** A tool call Wavi's extension asks about (the confirm's JSON message), or null for another extension's dialog. */
export function waviConfirm(request: Rec): { tool: string; input: unknown } | null {
  if (request.method !== 'confirm') return null
  try {
    const body: unknown = JSON.parse(str(request.message) ?? '')
    return isRec(body) && body.wavi === 1 && typeof body.tool === 'string' ? { tool: body.tool, input: body.input } : null
  } catch {
    return null
  }
}

/** Methods that wait for an `extension_ui_response` (rpc-mode.ts); notify / setStatus / setWidget / setTitle do not. */
const DIALOGS: ReadonlySet<string> = new Set(['confirm', 'select', 'input', 'editor'])
const YES = '是'
const NO = '否'
const OPTION_MAX = 300

const PERMISSION_OPTIONS: GuiPermissionOption[] = [
  { id: 'reject', label: '拒绝', kind: 'reject_once' },
  { id: 'always', label: '总是允许', kind: 'allow_always' },
  { id: 'allow', label: '允许', kind: 'allow_once' }
]

/** The same call again (T3 Code's sessionApprovals key): 总是允许 lets it through for the rest of the session. */
export const callKey = (tool: string, input: unknown): string => `${tool}\0${JSON.stringify(input ?? null)}`

export interface PiPending {
  id: string
  method: string
  /** Wavi's own confirm: the call it is about. */
  call?: { tool: string; input: unknown }
  /** The question asked (answers come back under it). */
  question?: string
  /** A select's options as the extension gave them (the card shows them clipped). */
  options?: string[]
}

/** The `extension_ui_response` fields for an answer (undefined: not an answer to this request). */
export function piAnswerResponse(pending: PiPending, answer: GuiAnswer): Rec | undefined {
  if (pending.call) {
    if (answer.kind !== 'permission') return undefined
    return { confirmed: answer.optionId === 'allow' || answer.optionId === 'always' }
  }
  if (answer.kind !== 'question') return undefined
  const value = pending.question !== undefined ? answer.answers[pending.question] : undefined
  if (value === undefined) return { cancelled: true }
  if (pending.method === 'confirm') return { confirmed: value === YES }
  // The option whose clipped label was picked, as the extension wrote it; free text as typed.
  return { value: pending.options?.find((o) => clip(o, OPTION_MAX) === value) ?? value }
}

// --- the stream ---------------------------------------------------------------------------------------------------

export interface PiNormalizer {
  /** One rpc event (not a response). */
  event(event: Rec): GuiEvent[]
  /** An `extension_ui_request` that waits on the user; [] for those that do not (or are not dialogs). */
  request(request: Rec): GuiEvent[]
  /** What a shown prompt asks (to answer it). */
  pending(id: string): PiPending | undefined
  /** Wavi's own confirms still shown (a change of 权限 or a reattach may answer them). */
  waitingCalls(): PiPending[]
  settle(id: string): GuiEvent[]
  /** The turn ended without `agent_end` (the prompt was refused). */
  failed(message: string): GuiEvent[]
  /** Pending prompts are dropped (an abort answers them). */
  dropPrompts(): GuiEvent[]
}

export function createPiNormalizer(cwd: string, now: () => number = Date.now, keep?: KeepImage): PiNormalizer {
  const items: ChatItem[] = []
  const indexOf = new Map<string, number>()
  const tools = new Map<string, { item: ToolItem; tool: string; args: unknown }>()
  const waiting = new Map<string, PiPending>()
  let seq = 0
  let live: { kind: 'text' | 'thinking'; text: string; since: number } | null = null

  const put = (key: string, item: ChatItem): GuiEvent => {
    let index = indexOf.get(key)
    if (index === undefined) {
      index = items.length
      indexOf.set(key, index)
    }
    items[index] = item
    return { type: 'items', changes: [{ index, item }] }
  }
  const system = (text: string): GuiEvent => {
    const id = `s${seq++}`
    return put(id, { kind: 'system', id, at: now(), text: clip(text, 300) })
  }
  /** The streamed block becomes a finished item (`final`: the text Pi says it ended with). */
  const flush = (final?: string): GuiEvent[] => {
    if (!live) return []
    const done = live
    live = null
    const text = (final ?? done.text).trim()
    const id = `${done.kind === 'text' ? 't' : 'k'}${seq++}`
    const events: GuiEvent[] = [{ type: 'live', live: null }]
    if (text) events.push(put(id, done.kind === 'text' ? { kind: 'text', id, at: now(), text: clip(text, CHAT_LIMITS.text) } : { kind: 'thinking', id, at: now(), text: clip(text, CHAT_LIMITS.thinking), ms: now() - done.since }))
    return events
  }

  function update(e: Rec): GuiEvent[] {
    const type = str(e.type) ?? ''
    if (type === 'text_start' || type === 'thinking_start') {
      const events = flush()
      live = { kind: type === 'text_start' ? 'text' : 'thinking', text: '', since: now() }
      return events
    }
    if (type === 'text_delta' || type === 'thinking_delta') {
      const kind = type === 'text_delta' ? 'text' : 'thinking'
      const events = live && live.kind !== kind ? flush() : []
      live = { kind, text: (live?.kind === kind ? live.text : '') + (str(e.delta) ?? ''), since: live?.kind === kind ? live.since : now() }
      return [...events, { type: 'live', live: { kind, text: live.text } }]
    }
    if (type === 'text_end' || type === 'thinking_end') return flush(str(e.content))
    return []
  }

  /** A finished message: the user's (echoed by Pi), the end of an assistant's (an error, an abort), a custom one. */
  function message(m: Rec): GuiEvent[] {
    const role = str(m.role)
    if (role === 'user') {
      const id = `u${seq++}`
      return [...flush(), put(id, userItem(id, now(), m.content, keep))]
    }
    if (role === 'assistant') {
      const events = flush()
      if (m.stopReason === 'aborted') events.push(system('已中断'))
      else if (m.stopReason === 'error') events.push(system(str(m.errorMessage) ?? 'Pi 出错了'))
      return events
    }
    if (role === 'custom' && m.display !== false) {
      const text = textOf(m.content).trim()
      return text ? [...flush(), system(text)] : []
    }
    return []
  }

  return {
    event(e) {
      switch (e.type) {
        case 'agent_start':
          return [{ type: 'busy', busy: true }]
        case 'message_update':
          return isRec(e.assistantMessageEvent) ? update(e.assistantMessageEvent) : []
        case 'message_end':
          return isRec(e.message) ? message(e.message) : []
        case 'tool_execution_start': {
          const id = str(e.toolCallId)
          const tool = str(e.toolName)
          if (!id || !tool) return []
          const item = toolItem(id, now(), tool, e.args, cwd)
          tools.set(id, { item, tool, args: e.args })
          return [...flush(), put(id, item)]
        }
        case 'tool_execution_update': {
          const known = tools.get(str(e.toolCallId) ?? '')
          if (!known) return []
          const output = textOf(isRec(e.partialResult) ? e.partialResult.content : undefined).trim()
          if (!output) return []
          known.item = { ...known.item, output: tail(output, CHAT_LIMITS.output) }
          return [put(known.item.id, known.item)]
        }
        case 'tool_execution_end': {
          const known = tools.get(str(e.toolCallId) ?? '')
          if (!known) return []
          known.item = withResult(known.item, known.tool, known.args, e.result, e.isError === true, cwd)
          return [put(known.item.id, known.item)]
        }
        case 'auto_retry_start':
          return [system(`重试中（第 ${typeof e.attempt === 'number' ? e.attempt : '?'} 次）：${str(e.errorMessage) ?? ''}`)]
        case 'agent_end': {
          if (e.willRetry === true) return []
          const events = flush()
          for (const id of waiting.keys()) events.push({ type: 'prompt-done', id })
          waiting.clear()
          events.push({ type: 'busy', busy: false })
          return events
        }
        default:
          return []
      }
    },

    request(r) {
      const id = str(r.id)
      const method = str(r.method)
      if (!id || !method || !DIALOGS.has(method)) return []
      const call = waviConfirm(r)
      let prompt: GuiPrompt
      if (call) {
        const name = piToolName(call.tool)
        const diff = diffOfArgs(call.tool, call.input, cwd)
        const command = call.tool === 'bash' && isRec(call.input) ? str(call.input.command) : undefined
        prompt = { kind: 'permission', id, tool: name, detail: clip(command ?? toolArg(name, call.input, cwd), CHAT_LIMITS.input), options: PERMISSION_OPTIONS, ...(diff ? { diff } : {}) }
        waiting.set(id, { id, method, call })
      } else {
        const title = str(r.title) ?? ''
        const question = clip([title, method === 'confirm' ? (str(r.message) ?? '') : ''].filter(Boolean).join('\n\n') || 'Pi 在等你回答', 2_000)
        const options = method === 'confirm' ? [YES, NO] : method === 'select' && Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string') : []
        prompt = { kind: 'question', id, questions: [{ question, options: options.map((label) => ({ label: clip(label, OPTION_MAX) })), multiSelect: false }] }
        waiting.set(id, { id, method, question, ...(method === 'select' ? { options } : {}) })
      }
      return [...flush(), { type: 'prompt', prompt }]
    },

    pending: (id) => waiting.get(id),

    waitingCalls: () => [...waiting.values()].filter((p) => p.call !== undefined),

    settle(id) {
      if (!waiting.delete(id)) return []
      return [{ type: 'prompt-done', id }]
    },

    failed(message) {
      return [...flush(), system(message), { type: 'busy', busy: false }]
    },

    dropPrompts() {
      const events: GuiEvent[] = [...waiting.keys()].map((id) => ({ type: 'prompt-done', id }))
      waiting.clear()
      return events
    }
  }
}

// --- a conversation read back -------------------------------------------------------------------------------------

/**
 * Pi's session file (`~/.pi/agent/sessions/--<cwd>--/<time>_<id>.jsonl`, version 3) → the messages of its active
 * branch: the entries from the last one up its `parentId`s (Paseo transcript.ts `readPiTranscript`; version 1 files are
 * a flat list). Rows that do not parse are skipped; a file read from the middle (its newest part, without the header)
 * is a tree whose walk stops where the read began.
 */
export function piBranchMessages(lines: readonly string[]): Rec[] {
  const rows = lines.flatMap((line) => {
    if (!line.trim()) return []
    try {
      const value: unknown = JSON.parse(line)
      return isRec(value) ? [value] : []
    } catch {
      return []
    }
  })
  const header = rows[0]?.type === 'session' ? rows.shift() : undefined
  let branch = rows
  if (header?.version !== 1) {
    const byId = new Map(rows.flatMap((r) => (typeof r.id === 'string' ? [[r.id, r] as const] : [])))
    branch = []
    const seen = new Set<string>()
    let entry = rows.at(-1)
    while (entry && typeof entry.id === 'string' && !seen.has(entry.id)) {
      seen.add(entry.id)
      branch.push(entry)
      entry = typeof entry.parentId === 'string' ? byId.get(entry.parentId) : undefined
    }
    branch.reverse()
  }
  return branch.flatMap((e) => (e.type === 'message' && isRec(e.message) ? [e.message] : e.type === 'custom_message' ? [{ ...e, role: 'custom' }] : []))
}

/** Finished messages → chat items (a tool call's row takes the result that follows it). */
export function piHistoryItems(messages: readonly Rec[], cwd: string, keep?: KeepImage): ChatItem[] {
  const items: ChatItem[] = []
  const calls = new Map<string, { index: number; tool: string; args: unknown }>()
  let seq = 0
  for (const m of messages) {
    const at = typeof m.timestamp === 'number' ? m.timestamp : 0
    if (m.role === 'user') items.push(userItem(`u${seq++}`, at, m.content, keep))
    else if (m.role === 'assistant') {
      for (const block of Array.isArray(m.content) ? m.content.filter(isRec) : []) {
        if (block.type === 'thinking' && str(block.thinking)?.trim()) items.push({ kind: 'thinking', id: `k${seq++}`, at, text: clip(str(block.thinking)!.trim(), CHAT_LIMITS.thinking) })
        else if (block.type === 'text' && str(block.text)?.trim()) items.push({ kind: 'text', id: `t${seq++}`, at, text: clip(str(block.text)!.trim(), CHAT_LIMITS.text) })
        else if (block.type === 'toolCall' && str(block.id) && str(block.name)) {
          calls.set(str(block.id)!, { index: items.length, tool: str(block.name)!, args: block.arguments })
          items.push({ ...toolItem(str(block.id)!, at, str(block.name)!, block.arguments, cwd), state: 'ok' })
        }
      }
      if (m.stopReason === 'aborted') items.push({ kind: 'system', id: `s${seq++}`, at, text: '已中断' })
      else if (m.stopReason === 'error') items.push({ kind: 'system', id: `s${seq++}`, at, text: clip(str(m.errorMessage) ?? 'Pi 出错了', 300) })
    } else if (m.role === 'toolResult') {
      const call = calls.get(str(m.toolCallId) ?? '')
      const item = call ? items[call.index] : undefined
      if (call && item?.kind === 'tool') items[call.index] = withResult(item, call.tool, call.args, m, m.isError === true, cwd)
    } else if (m.role === 'bashExecution' && str(m.command)) {
      const command = str(m.command)!
      const output = str(m.output)?.trim()
      items.push({ kind: 'tool', id: `b${seq++}`, at, name: 'Bash', arg: toolArg('Bash', { command }), input: clip(command, CHAT_LIMITS.input), state: typeof m.exitCode === 'number' && m.exitCode !== 0 ? 'error' : 'ok', ...(output ? { output: tail(output, CHAT_LIMITS.output) } : {}), ...(typeof m.exitCode === 'number' ? { exit: m.exitCode } : {}) })
    } else if (m.role === 'custom' && m.display !== false && textOf(m.content).trim()) items.push({ kind: 'system', id: `s${seq++}`, at, text: clip(textOf(m.content).trim(), 300) })
  }
  return items
}
