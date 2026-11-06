// Claude's `-p` stream-json output → GUI events (PRD F23 / §6.17). Finished `assistant` / `user` messages have the
// transcript's shape and go through the phone's parser (@shared/transcript-chat) after three renames; `stream_event`
// deltas become the live block; `can_use_tool` requests become prompts. Pure: the session host owns the process.

import {
  effortLabel,
  permissionOption,
  planOption,
  type GuiAnswer,
  type GuiCommand,
  type GuiConfigOption,
  type GuiEvent,
  type GuiPermission,
  type GuiPermissionOption,
  type GuiPrompt,
  type GuiQuestion
} from '@shared/gui-chat'
import { createChatParser, type ChatParser } from '@shared/transcript-chat'
import { safeSuggestions } from '../hooks/normalize'

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Figma 56: Wavi's permission levels as Claude's permission modes (`bypassPermissions` is left out on purpose). */
export const CLAUDE_MODE_OF: Readonly<Record<GuiPermission, string>> = { ask: 'default', 'accept-edits': 'acceptEdits', auto: 'auto' }
const CLAUDE_LEVELS: readonly GuiPermission[] = ['ask', 'accept-edits', 'auto']
const isClaudeLevel = (value: string): value is GuiPermission => (CLAUDE_LEVELS as readonly string[]).includes(value)

/** The level a Claude permission mode stands for; `plan` stands for the level it returns to (`before`). */
export function claudeLevel(mode: string | undefined, before: GuiPermission | undefined): GuiPermission {
  if (mode === 'plan') return before ?? 'ask'
  return mode === 'acceptEdits' ? 'accept-edits' : mode === 'auto' ? 'auto' : 'ask'
}

/** What the driver keeps for the pickers: Claude's own permission `mode`, and the level 计划 returns to. */
export interface ClaudePickerState {
  model?: string
  effort?: string
  mode?: string
  level?: GuiPermission
}

/** A `can_use_tool` request still waiting, kept to build the answer. */
export interface ClaudePending {
  requestId: string
  tool: string
  input: Rec
  suggestions: unknown[]
}

export interface ClaudeStreamNormalizer {
  /** One parsed stdout line. */
  push(message: Rec): GuiEvent[]
  /** The pending request behind a prompt id (the request id). */
  pending(id: string): ClaudePending | undefined
  /** Forgets a prompt once answered. */
  settle(id: string): GuiEvent[]
}

/** The transcript parser reads camelCase fields and `isSidechain`; stream-json has their snake_case twins. */
export function asTranscriptLine(message: Rec, cwd: string): Rec {
  const line: Rec = { ...message, cwd }
  if ('tool_use_result' in message) line.toolUseResult = message.tool_use_result
  if (typeof message.thinking_duration_ms === 'number') line.thinkingDurationMs = message.thinking_duration_ms
  // A subagent's own messages: the phone shows them as the Agent call that started them.
  if (typeof message.parent_tool_use_id === 'string') line.isSidechain = true
  return line
}

const ANSWER_OPTIONS: GuiPermissionOption[] = [
  { id: 'reject_once', label: '拒绝', kind: 'reject_once' },
  { id: 'allow_always', label: '总是允许', kind: 'allow_always' },
  { id: 'allow_once', label: '允许', kind: 'allow_once' }
]

function questionsOf(input: Rec): GuiQuestion[] {
  const raw = Array.isArray(input.questions) ? input.questions : []
  return raw.filter(isRec).map((q) => ({
    question: str(q.question) ?? '',
    ...(str(q.header) ? { header: str(q.header)! } : {}),
    multiSelect: q.multiSelect === true,
    options: (Array.isArray(q.options) ? q.options : [])
      .filter(isRec)
      .map((o) => ({ label: str(o.label) ?? '', ...(str(o.description) ? { description: str(o.description)! } : {}) }))
  }))
}

/** What a permission card says the tool wants to do. */
function detailOf(tool: string, input: Rec, description: string | undefined, cwd?: string): string {
  const command = str(input.command)
  if (tool === 'Bash' && command) return command
  const path = str(input.file_path)
  // Relative to the session's folder, as the tool row shows it.
  if (path && cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  return path ?? str(input.url) ?? str(input.pattern) ?? description ?? tool
}

export function promptOf(pending: ClaudePending, description?: string, cwd?: string): GuiPrompt {
  const id = pending.requestId
  if (pending.tool === 'AskUserQuestion') return { kind: 'question', id, questions: questionsOf(pending.input) }
  if (pending.tool === 'ExitPlanMode') return { kind: 'plan', id, plan: str(pending.input.plan) ?? '' }
  const options = pending.suggestions.length > 0 ? ANSWER_OPTIONS : ANSWER_OPTIONS.filter((o) => o.kind !== 'allow_always')
  return { kind: 'permission', id, tool: pending.tool, detail: detailOf(pending.tool, pending.input, description, cwd), options }
}

export function createClaudeStreamNormalizer(cwd: string, now: () => number = Date.now): ClaudeStreamNormalizer {
  const parser: ChatParser = createChatParser('claude', now)
  const waiting = new Map<string, ClaudePending>()
  let live: { kind: 'text' | 'thinking'; text: string } | null = null

  const parse = (message: Rec): GuiEvent[] => {
    const changed = parser.push(JSON.stringify(asTranscriptLine(message, cwd)))
    const events: GuiEvent[] = []
    if (message.type === 'assistant' && live && typeof message.parent_tool_use_id !== 'string') {
      live = null
      events.push({ type: 'live', live: null })
    }
    if (changed.length > 0) events.push({ type: 'items', changes: changed.map((index) => ({ index, item: parser.items[index]! })) })
    return events
  }

  function streamEvent(message: Rec): GuiEvent[] {
    // A subagent streams too; its text is not the conversation's.
    if (typeof message.parent_tool_use_id === 'string') return []
    const event = isRec(message.event) ? message.event : {}
    if (event.type === 'content_block_start') {
      const block = isRec(event.content_block) ? event.content_block : {}
      if (block.type !== 'text' && block.type !== 'thinking') return []
      live = { kind: block.type, text: '' }
      return [{ type: 'live', live: { ...live } }]
    }
    if (event.type === 'content_block_delta' && live) {
      const delta = isRec(event.delta) ? event.delta : {}
      const piece = delta.type === 'text_delta' ? str(delta.text) : delta.type === 'thinking_delta' ? str(delta.thinking) : undefined
      if (!piece) return []
      live = { ...live, text: live.text + piece }
      return [{ type: 'live', live: { ...live } }]
    }
    return []
  }

  return {
    push(message) {
      switch (message.type) {
        case 'stream_event':
          return streamEvent(message)
        case 'assistant':
        case 'user':
          return parse(message)
        case 'system': {
          if (message.subtype === 'commands_changed' && Array.isArray(message.commands)) return [{ type: 'commands', commands: commandsOf(message.commands) }]
          // compact_boundary, api_error, local_command … are conversation; hooks, status, init are not.
          return ['compact_boundary', 'api_error', 'local_command', 'informational', 'away_summary'].includes(str(message.subtype) ?? '') ? parse(message) : []
        }
        case 'control_request': {
          const request = isRec(message.request) ? message.request : {}
          const requestId = str(message.request_id)
          if (request.subtype !== 'can_use_tool' || !requestId) return []
          const pending: ClaudePending = {
            requestId,
            tool: str(request.tool_name) ?? 'Tool',
            input: isRec(request.input) ? request.input : {},
            // Filtered here, so 总是允许 is offered only when it would allow something (PRD §6.6).
            suggestions: safeSuggestions(request.permission_suggestions)
          }
          waiting.set(requestId, pending)
          return [{ type: 'prompt', prompt: promptOf(pending, str(request.description), cwd) }]
        }
        case 'control_cancel_request': {
          const id = str(message.request_id)
          return id && waiting.delete(id) ? [{ type: 'prompt-done', id }] : []
        }
        case 'result': {
          const events: GuiEvent[] = []
          if (live) {
            live = null
            events.push({ type: 'live', live: null })
          }
          for (const id of waiting.keys()) events.push({ type: 'prompt-done', id })
          waiting.clear()
          events.push({ type: 'busy', busy: false })
          return events
        }
        default:
          return []
      }
    },
    pending: (id) => waiting.get(id),
    settle(id) {
      return waiting.delete(id) ? [{ type: 'prompt-done', id }] : []
    }
  }
}

export function commandsOf(raw: unknown[]): GuiCommand[] {
  return raw.filter(isRec).flatMap((c) => {
    const name = str(c.name)
    if (!name) return []
    const description = (str(c.description) ?? '').replace(/\s*\((user|project|plugin[^)]*)\)\s*$/, '')
    const hint = str(c.argumentHint)
    return [{ name, description, ...(hint ? { argumentHint: hint } : {}) }]
  })
}

/** The pickers from `initialize` (models, their effort levels, permission modes) and `get_settings`' effort. */
export function claudeConfig(init: Rec, current: ClaudePickerState): GuiConfigOption[] {
  const models = (Array.isArray(init.models) ? init.models : []).filter(isRec)
  const values = models.flatMap((m) => {
    const value = str(m.value)
    return value ? [{ value, label: str(m.displayName) ?? value }] : []
  })
  // A resolved id (`claude-haiku-5-5`, as each turn's init reports it) maps back to its alias; `default` last, since
  // it resolves to the same model as another alias.
  const byResolved = current.model
    ? (models.find((m) => m.value !== 'default' && m.resolvedModel === current.model) ?? models.find((m) => m.resolvedModel === current.model))
    : undefined
  const model =
    current.model && values.some((v) => v.value === current.model) ? current.model : (str(byResolved?.value) ?? values[0]?.value ?? 'default')
  const config: GuiConfigOption[] = [{ id: 'model', category: 'model', label: '模型', current: model, values }]
  const chosen = models.find((m) => m.value === model)
  const levels = Array.isArray(chosen?.supportedEffortLevels) ? chosen.supportedEffortLevels.filter((l): l is string => typeof l === 'string') : []
  if (chosen?.supportsEffort === true && levels.length > 0) {
    config.push({
      id: 'effort',
      category: 'thought_level',
      label: '推理强度',
      current: current.effort && levels.includes(current.effort) ? current.effort : (levels.includes('high') ? 'high' : levels[0]!),
      values: levels.map((l) => ({ value: l, label: effortLabel(l) }))
    })
  }
  // 计划 is Claude's `plan` permission mode; the level it returns to is the one chosen before it.
  const mode = current.mode ?? str(init.current_permission_mode) ?? 'default'
  config.push(permissionOption(CLAUDE_LEVELS, claudeLevel(mode, current.level)), planOption(mode === 'plan'))
  return config
}

/** The control request that applies a picker change; `level` is the permission level 计划 off returns to. */
export function claudeConfigRequest(id: string, value: string, level: GuiPermission = 'ask'): Rec | null {
  if (id === 'model') return { subtype: 'set_model', model: value }
  if (id === 'permission') return isClaudeLevel(value) ? { subtype: 'set_permission_mode', mode: CLAUDE_MODE_OF[value] } : null
  if (id === 'plan') return { subtype: 'set_permission_mode', mode: value === 'on' ? 'plan' : CLAUDE_MODE_OF[level] }
  if (id === 'effort') return { subtype: 'apply_flag_settings', settings: { effortLevel: value } }
  return null
}

/** The `can_use_tool` response for an answer (§6.17: allow + updatedInput, deny + message). */
export function claudeAnswerResponse(pending: ClaudePending, answer: GuiAnswer): Rec {
  if (answer.kind === 'question') return { behavior: 'allow', updatedInput: { ...pending.input, answers: answer.answers } }
  if (answer.kind === 'plan') {
    if (answer.decision === 'keep-planning') return { behavior: 'deny', message: answer.message?.trim() || 'Keep planning.' }
    const mode = answer.decision === 'approve-auto' ? 'acceptEdits' : 'default'
    return { behavior: 'allow', updatedInput: pending.input, updatedPermissions: [{ type: 'setMode', mode, destination: 'session' }] }
  }
  if (answer.optionId === 'allow_once') return { behavior: 'allow', updatedInput: pending.input }
  // The same filter as the TUI's PermissionRequest: no silent mode switch, nothing written to ~/.claude (PRD §6.6).
  if (answer.optionId === 'allow_always') return { behavior: 'allow', updatedInput: pending.input, updatedPermissions: safeSuggestions(pending.suggestions) }
  return { behavior: 'deny', message: answer.message?.trim() || 'The user declined this.' }
}
