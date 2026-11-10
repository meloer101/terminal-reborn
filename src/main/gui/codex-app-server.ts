// `codex app-server` notifications and server requests → GUI events (PRD F23 / §6.17). Items arrive as
// item/started → deltas → item/completed; approvals and questions are JSON-RPC requests from the server that wait
// for our response. Pure: the session host owns the process and the JSON-RPC ids.

import { effortLabel, fastOption, permissionOption, type GuiAnswer, type GuiConfigOption, type GuiEvent, type GuiPermission, type GuiPermissionOption, type GuiPrompt } from '@shared/gui-chat'
import { addedFile, CHAT_LIMITS, fileDiffs, hunksOfUnifiedDiff, inlineOfDataUrl, keptImages, rel, todosArg, todosOf, type ChatItem, type FileDiff, type InlineImage, type KeepImage } from '@shared/transcript-chat'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text)
const tail = (text: string, max: number): string => (text.length > max ? `…${text.slice(text.length - max)}` : text)

/**
 * Figma 56: Wavi's permission levels as Codex's approval settings (each `turn/start` carries them; `never` is left out
 * on purpose). 询问 asks before anything it is not sure is safe; 接受编辑 works in the workspace without asking; 自动
 * routes what it would ask to Codex's own reviewer (`auto_review`, codex 0.166). The sandbox stays workspace-write.
 */
export const CODEX_APPROVAL: Readonly<Record<GuiPermission, { approvalPolicy: string; approvalsReviewer?: string }>> = {
  ask: { approvalPolicy: 'untrusted' },
  'accept-edits': { approvalPolicy: 'on-request' },
  // Sent only for 自动 (an older app-server may not know the field); the driver sets `user` back after it.
  auto: { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' }
}
const CODEX_LEVELS: readonly GuiPermission[] = ['ask', 'accept-edits', 'auto']
export const isCodexLevel = (value: string): value is GuiPermission => (CODEX_LEVELS as readonly string[]).includes(value)

/** Moved to @shared/transcript-chat (Pi's edit patches use it too); kept here for this module's callers. */
export { hunksOfUnifiedDiff }

type ToolItem = Extract<ChatItem, { kind: 'tool' }>

/** `fileChange.changes` → one diff per file (a new file's text is all additions). */
function diffsOfChanges(changes: unknown, cwd: string): FileDiff[] {
  const list = Array.isArray(changes) ? changes.filter(isRec) : []
  return fileDiffs(
    list.map((change) => {
      const diff = str(change.diff) ?? ''
      const kind = isRec(change.kind) ? change.kind.type : undefined
      return { path: rel(str(change.path) ?? '', cwd), hunks: kind === 'add' && !diff.includes('@@') ? [addedFile(diff)] : hunksOfUnifiedDiff(diff) }
    })
  )
}

/** A user message's text and pictures: a `localImage` names its file, an `image` URL with data is kept as one. */
function userText(content: unknown, keep: KeepImage | undefined): { text: string; images: number; attachments?: string[] } {
  const parts = Array.isArray(content) ? content.filter(isRec) : []
  const pictures = parts.filter((p) => p.type === 'image' || p.type === 'localImage')
  const local = pictures.flatMap((p) => (p.type === 'localImage' && str(p.path) ? [str(p.path)!] : []))
  const inline = pictures.flatMap((p) => (p.type === 'image' ? [inlineOfDataUrl(p.url)].filter((i): i is InlineImage => i !== null) : []))
  const attachments = [...local, ...(keptImages(inline, keep) ?? [])]
  return {
    text: parts.map((p) => (p.type === 'text' ? (str(p.text) ?? '') : '')).join('').trim(),
    images: pictures.length,
    ...(attachments.length > 0 ? { attachments } : {})
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
  /** A turn that failed outside a notification (`turn/start` refused): why, as a line in the conversation. */
  failed(message: string): GuiEvent[]
}

/** The text an MCP call (`result.content`, MCP content blocks) or a dynamic tool (`contentItems`) returned, or its error. */
function toolCallOutput(item: Rec): string {
  const error = isRec(item.error) ? str(item.error.message) : undefined
  if (error) return error
  const blocks = isRec(item.result) && Array.isArray(item.result.content) ? item.result.content : Array.isArray(item.contentItems) ? item.contentItems : []
  return blocks
    .filter(isRec)
    .map((b) => (b.type === 'text' || b.type === 'inputText' ? (str(b.text) ?? '') : ''))
    .filter((t) => t.trim() !== '')
    .join('\n')
}

export function createCodexNormalizer(cwd: string, now: () => number = Date.now, keep?: KeepImage): CodexNormalizer {
  const items: ChatItem[] = []
  const indexOf = new Map<string, number>()
  const waiting = new Map<string, CodexPending>()
  // Each fileChange item's files while it runs, so its approval can show the change (dropped once it is done or its
  // approval is resolved: the prompt already holds them).
  const fileChanges = new Map<string, FileDiff[]>()
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
  // The error already shown this turn: a failed turn/completed repeats the final `error` notification.
  let shownError: string | null = null
  const errorLine = (message: string): GuiEvent[] => {
    const text = clip(message, 300)
    if (text === shownError) return []
    shownError = text
    return [system(text)]
  }
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
        const { text, images, attachments } = userText(item.content, keep)
        return text || images ? [put(id, { kind: 'user', id, at, text: clip(text, CHAT_LIMITS.text), images, ...(attachments ? { attachments } : {}) })] : []
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
        // No summary, nothing to open: the reasoning leaves no row.
        return summary ? [...endLive(id), put(id, { kind: 'thinking', id, at, text: clip(summary, CHAT_LIMITS.thinking), ...(ms !== undefined ? { ms } : {}) })] : endLive(id)
      }
      case 'commandExecution': {
        const exit = typeof item.exitCode === 'number' ? item.exitCode : null
        const status = str(item.status)
        const state: ToolItem['state'] = !done ? 'running' : exit === 0 || status === 'completed' ? 'ok' : 'error'
        const output = str(item.aggregatedOutput)
        const command = str(item.command) ?? ''
        return [
          put(id, {
            kind: 'tool',
            id,
            at,
            name: 'Bash',
            arg: clip(command.replace(/\s+/g, ' ').trim(), CHAT_LIMITS.arg),
            state,
            ...(output ? { output: tail(output, CHAT_LIMITS.output) } : {}),
            ...(command ? { input: clip(command, CHAT_LIMITS.input) } : {}),
            ...(exit !== null ? { exit } : {})
          })
        ]
      }
      case 'fileChange': {
        const files = diffsOfChanges(item.changes, cwd)
        if (done) fileChanges.delete(id)
        else if (files.length > 0) fileChanges.set(id, files)
        const diff = files[0]
        const status = str(item.status)
        const state: ToolItem['state'] = !done ? 'running' : status === 'declined' || status === 'failed' ? 'error' : 'ok'
        const arg = diff ? (files.length > 1 ? `${diff.path} 等 ${files.length} 个文件` : diff.path) : ''
        return [put(id, { kind: 'tool', id, at, name: 'Edit', arg, state, ...(diff && done ? { diff } : {}), ...(files.length > 1 && done ? { files } : {}) })]
      }
      case 'mcpToolCall':
      case 'dynamicToolCall': {
        const name = str(item.tool) ?? str(item.name) ?? 'Tool'
        const failed = str(item.status) === 'failed' || item.success === false
        const state: ToolItem['state'] = !done ? 'running' : failed ? 'error' : 'ok'
        const output = done ? toolCallOutput(item) : ''
        return [put(id, { kind: 'tool', id, at, name, arg: clip(str(item.server) ?? '', CHAT_LIMITS.arg), state, ...(output ? { output: tail(output, CHAT_LIMITS.output) } : {}) })]
      }
      case 'collabAgentToolCall': {
        // Figma 59J: a call to another agent (spawnAgent, sendInput, wait …) is one 子 agent row; that agent works in
        // its own thread, so nothing goes under it. Fields from the generated types (`codex app-server generate-ts`,
        // 0.166.0, v2/ThreadItem.ts); not yet seen from a real Codex.
        const status = str(item.status)
        const state: ToolItem['state'] = !done || status === 'inProgress' ? 'running' : status === 'completed' ? 'ok' : 'error'
        const prompt = str(item.prompt)?.replace(/\s+/g, ' ').trim()
        const ms = done && typeof item.completedAtMs === 'number' && typeof item.startedAtMs === 'number' ? item.completedAtMs - item.startedAtMs : undefined
        return [put(id, { kind: 'tool', id, at, name: 'Subagent', arg: clip(prompt || (str(item.tool) ?? ''), CHAT_LIMITS.arg), state, ...(ms !== undefined ? { ms } : {}) })]
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
          shownError = null
          return [{ type: 'busy', busy: true }]
        case 'turn/completed': {
          const turn = isRec(params.turn) ? params.turn : {}
          const events: GuiEvent[] = [...endLive()]
          if (turn.status === 'interrupted') events.push(system('已中断'))
          if (turn.status === 'failed') events.push(...errorLine((isRec(turn.error) ? str(turn.error.message) : undefined) ?? 'Codex 出错'))
          shownError = null
          for (const id of waiting.keys()) events.push({ type: 'prompt-done', id })
          waiting.clear()
          // A change the turn never completed (interrupted, failed) is not asked about any more.
          fileChanges.clear()
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
        case 'turn/plan/updated': {
          // The turn's task list: one row per turn, rewritten by each update.
          const todos = todosOf(params.plan)
          const id = `plan:${str(params.turnId) ?? ''}`
          return [put(id, { kind: 'tool', id, at: now(), name: 'Plan', arg: todosArg(todos), state: 'ok', todos })]
        }
        case 'serverRequest/resolved': {
          const id = String(params.requestId ?? '')
          const itemId = str(waiting.get(id)?.params.itemId)
          if (itemId) fileChanges.delete(itemId)
          return waiting.delete(id) ? [{ type: 'prompt-done', id }] : []
        }
        case 'error': {
          const error = isRec(params.error) ? params.error : {}
          // Retries report here too ("Reconnecting… 1/5"); only a final error is the conversation's.
          if (params.willRetry === true) return []
          return errorLine(str(error.message) ?? 'Codex 出错')
        }
        default:
          return []
      }
    },
    request(id, method, params) {
      const prompt = promptOfCodex(id, method, params, fileChanges.get(str(params.itemId) ?? ''))
      if (!prompt) return []
      waiting.set(id, { id, method, params })
      return [{ type: 'prompt', prompt }]
    },
    pending: (id) => waiting.get(id),
    settle(id) {
      return waiting.delete(id) ? [{ type: 'prompt-done', id }] : []
    },
    failed: (message) => errorLine(message)
  }
}

const DECISIONS: Record<string, GuiPermissionOption> = {
  decline: { id: 'decline', label: '拒绝', kind: 'reject_once' },
  acceptForSession: { id: 'acceptForSession', label: '总是允许', kind: 'allow_always' },
  accept: { id: 'accept', label: '允许', kind: 'allow_once' }
}

/** A server request as a prompt; `files`: the change a file approval is about (its item's files). */
export function promptOfCodex(id: string, method: string, params: Rec, files: readonly FileDiff[] = []): GuiPrompt | null {
  if (method === 'item/commandExecution/requestApproval') {
    const offered = (Array.isArray(params.availableDecisions) ? params.availableDecisions : []).filter((d): d is string => typeof d === 'string')
    const keys = (offered.length > 0 ? offered : ['decline', 'accept']).filter((d) => d in DECISIONS)
    const options = ['decline', 'acceptForSession', 'accept'].filter((k) => keys.includes(k)).map((k) => DECISIONS[k]!)
    return { kind: 'permission', id, tool: 'Bash', detail: str(params.command) ?? str(params.reason) ?? '运行命令', options }
  }
  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    const diff = files[0]
    // No reason given: the file, as Claude's Edit names it (the card then shows it once, on the diff's header).
    const detail = str(params.reason) ?? diff?.path ?? '修改文件'
    return { kind: 'permission', id, tool: 'Edit', detail, options: [DECISIONS.decline!, DECISIONS.accept!], ...(diff ? { diff } : {}), ...(files.length > 1 ? { files: [...files] } : {}) }
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
export function codexConfig(models: unknown[], current: { model?: string; effort?: string; permission?: GuiPermission; fast?: boolean }): GuiConfigOption[] {
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
      values: efforts.map((e) => ({ value: e, label: effortLabel(e) }))
    })
  }
  config.push(permissionOption(CODEX_LEVELS, current.permission ?? 'accept-edits'))
  // 快速 (Figma 65): the model's `priority` service tier (codex 0.167 `model/list`; `additionalSpeedTiers: ['fast']` is
  // its deprecated name).
  const tiers = (Array.isArray(chosen?.serviceTiers) ? chosen.serviceTiers : []).filter(isRec)
  if (tiers.some((t) => t.id === CODEX_FAST_TIER)) config.push(fastOption(current.fast === true))
  return config
}

const CODEX_FAST_TIER = 'priority'

/** `turn/start` params with the current pickers applied (they hold for this turn and after). */
export function codexTurnParams(threadId: string, text: string, config: readonly GuiConfigOption[], images: string[] = []): Rec {
  const value = (id: string) => config.find((c) => c.id === id)?.current
  return {
    threadId,
    input: [{ type: 'text', text, text_elements: [] }, ...images.map((path) => ({ type: 'localImage', path }))],
    ...(value('model') ? { model: value('model') } : {}),
    ...(value('effort') ? { effort: value('effort') } : {}),
    // A tier holds for later turns too: anything but 快速 on (off, or a model without the tier) is sent as null.
    serviceTier: value('fast') === 'on' ? CODEX_FAST_TIER : null,
    ...CODEX_APPROVAL[isCodexLevel(value('permission') ?? '') ? (value('permission') as GuiPermission) : 'accept-edits']
  }
}
