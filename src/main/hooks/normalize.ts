// Raw agent hook payload -> normalized AgentEvent / PendingPrompt parts (PRD §3, F3).
// Pure: no Electron, no I/O. Field names follow the Claude Code hooks reference and the payloads
// captured in PRD §6.6 (see ./fixtures.ts). Codex (0.142.5) payloads follow its hooks reference and
// the captures in PRD §6.7 (see ./codex-fixtures.ts); they are mapped onto Claude's tool vocabulary
// (Bash, Edit/Write, AskUserQuestion) so the status, prompt-bar and permission code stays agent-agnostic.
import { isSafeAgentSessionId } from '@shared/workspace-file'
import type { AgentEvent, AgentQuestion, HookAgent, QuestionOption } from '@shared/agent-events'
import { autoCompactRuleFromEnv, parseClaudeStatusLine, type VendorUsage } from '@shared/session-meta'
import { isTodoTool } from '@shared/todo-progress'

export interface PermissionDraft {
  tool: string
  input: Record<string, unknown>
  summary: string
  /** The agent offered `permission_suggestions` we can hand back as `updatedPermissions`. */
  suggestions: unknown[]
}

export interface NormalizedHook {
  events: AgentEvent[]
  /** A PermissionRequest the UI can answer. Absent for tools whose dialog must stay in the TUI. */
  permission?: PermissionDraft
  /** AskUserQuestion questions, from its PreToolUse. */
  questions?: AgentQuestion[]
  /**
   * What this event proves about prompts still pending for the session (the user answered them in
   * the TUI): 'tool' = only the prompt for this same tool call (tool-end; parallel tool calls
   * must not release each other), 'all' = the turn moved on, 'none' = nothing.
   */
  clears: 'none' | 'tool' | 'all'
  /** Plan usage read from this call (Claude statusLine); account-level, so it goes to every window (PRD F11). */
  usage?: VendorUsage
  /** A successful todo-tool call for the session's todo list (PRD F12); the bridge keeps the list. */
  todoCall?: { tool: string; input: unknown; response: unknown }
  /** The conversation was cleared (/clear): its todo list and context reading are gone. */
  cleared?: true
}

const MAX_SUMMARY = 160

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 ? value : undefined)

function truncate(text: string, max = MAX_SUMMARY): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Last two path segments: enough to tell `src/a/index.ts` from `src/b/index.ts`. */
function shortPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts.slice(-2).join('/') || path
}

/** One-line Chinese description of a tool call for the permission prompt, e.g. "运行 pnpm test". */
export function summarizeToolUse(tool: string, input: Rec): string {
  const file = str(input.file_path) ?? str(input.notebook_path) ?? str(input.path)
  switch (tool) {
    case 'Bash': {
      const command = str(input.command)
      return command ? `运行 ${truncate(command.split('\n')[0] ?? command)}` : '运行命令'
    }
    case 'Edit':
    case 'MultiEdit':
      return file ? `编辑 ${shortPath(file)}` : '编辑文件'
    case 'NotebookEdit':
      return file ? `编辑 ${shortPath(file)}` : '编辑 notebook'
    case 'Write':
      return file ? `写入 ${shortPath(file)}` : '写入文件'
    case 'Read':
      return file ? `读取 ${shortPath(file)}` : '读取文件'
    case 'WebFetch': {
      const url = str(input.url)
      return url ? `抓取 ${truncate(url)}` : '抓取网页'
    }
    case 'WebSearch': {
      const query = str(input.query)
      return query ? `搜索 ${truncate(query)}` : '联网搜索'
    }
    case 'Grep':
    case 'Glob': {
      const pattern = str(input.pattern)
      return pattern ? `搜索 ${truncate(pattern)}` : '搜索文件'
    }
    case 'Task':
    case 'Agent': {
      const description = str(input.description)
      return description ? `子任务 ${truncate(description)}` : '启动子任务'
    }
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
      return mcp ? `调用 ${mcp[1]} · ${mcp[2]}` : `使用 ${tool}`
    }
  }
}

function parseOptions(value: unknown): QuestionOption[] {
  if (!Array.isArray(value)) return []
  const options: QuestionOption[] = []
  for (const item of value) {
    if (!isRec(item)) continue
    const label = str(item.label)
    if (!label) continue
    const description = str(item.description)
    options.push(description ? { label, description } : { label })
  }
  return options
}

/** Parses AskUserQuestion's `tool_input.questions`. Malformed entries are dropped, not thrown on. */
export function parseQuestions(input: Rec): AgentQuestion[] {
  if (!Array.isArray(input.questions)) return []
  const questions: AgentQuestion[] = []
  for (const item of input.questions) {
    if (!isRec(item)) continue
    const question = str(item.question)
    if (!question) continue
    const header = str(item.header)
    questions.push({
      ...(header ? { header } : {}),
      question,
      multiSelect: item.multiSelect === true,
      options: parseOptions(item.options)
    })
  }
  return questions
}

export function classifyNotification(type: string | undefined, message: string): 'permission' | 'question' | 'idle' | 'other' {
  switch (type) {
    case 'permission_prompt':
      return 'permission'
    case 'elicitation_dialog':
    case 'elicitation_url_dialog':
      return 'question'
    case 'idle_prompt':
      return 'idle'
  }
  if (type === undefined || type === '') {
    if (/permission|approval|approve/i.test(message)) return 'permission'
    if (/question|elicitation/i.test(message)) return 'question'
    if (/waiting for your input|idle/i.test(message)) return 'idle'
  }
  return 'other'
}

/**
 * Which of Claude's `permission_suggestions` "allow always" may hand back as `updatedPermissions`.
 * `setMode` is dropped (spike §4: it silently switched the session to acceptEdits) and so is
 * anything persisted to `userSettings`, which would write the user's global config (PRD §6.2).
 */
export function safeSuggestions(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((s) => isRec(s) && s.type !== 'setMode' && s.destination !== 'userSettings')
}

/** Tools whose PermissionRequest dialog has no allow/deny meaning here: leave it to the TUI. */
const TUI_ONLY_PERMISSION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

const NONE: NormalizedHook = { events: [], clears: 'none' }

/** Only the end of a long reply is ever shown (its last line), so the tail is all that crosses IPC. */
const REPLY_TAIL_CHARS = 2_000

function stopEvent(payload: Rec): AgentEvent {
  const message = str(payload.last_assistant_message)
  return message ? { type: 'stop', message: message.slice(-REPLY_TAIL_CHARS) } : { type: 'stop' }
}

/** SessionStart for both agents: carries the conversation id (`session_id`) that `--resume` needs after a restart. */
function sessionStart(payload: Rec): AgentEvent {
  const id = str(payload.session_id)
  return id && isSafeAgentSessionId(id) ? { type: 'session-start', agentSessionId: id } : { type: 'session-start' }
}

/** Claude inherits Wavi's environment, so its auto-compaction rule is read from ours (PRD §6.6). */
const CLAUDE_COMPACT_RULE = autoCompactRuleFromEnv(process.env)

function normalizeClaude(event: string, payload: Rec, at: number): NormalizedHook {
  const tool = str(payload.tool_name) ?? 'unknown'
  const input = isRec(payload.tool_input) ? payload.tool_input : {}

  switch (event) {
    case 'SessionStart':
      return { events: [sessionStart(payload)], clears: 'none', ...(payload.source === 'clear' ? { cleared: true as const } : {}) }
    // Not a hook: our statusLine relay (resources/hooks/tr-statusline.sh) posts the statusLine JSON under this name.
    case 'StatusLine': {
      const reading = parseClaudeStatusLine(payload, at, CLAUDE_COMPACT_RULE)
      return {
        events: reading.context !== undefined ? [{ type: 'context', context: reading.context }] : [],
        clears: 'none',
        ...(reading.usage ? { usage: reading.usage } : {})
      }
    }
    case 'UserPromptSubmit':
      return { events: [{ type: 'prompt-submit', prompt: str(payload.prompt) ?? '' }], clears: 'all' }
    case 'PreToolUse': {
      const result: NormalizedHook = { events: [{ type: 'tool-start', tool, input }], clears: 'none' }
      if (tool === 'AskUserQuestion') {
        const questions = parseQuestions(input)
        if (questions.length > 0) result.questions = questions
      }
      return result
    }
    case 'PostToolUse':
      return {
        events: [{ type: 'tool-end', tool, input, ok: true }],
        clears: 'tool',
        ...(isTodoTool(tool) ? { todoCall: { tool, input, response: payload.tool_response } } : {})
      }
    case 'PostToolUseFailure':
      return { events: [{ type: 'tool-end', tool, input, ok: false }], clears: 'tool' }
    case 'PermissionRequest': {
      if (TUI_ONLY_PERMISSION_TOOLS.has(tool)) return NONE
      const suggestions = safeSuggestions(payload.permission_suggestions)
      return {
        events: [],
        permission: { tool, input, summary: summarizeToolUse(tool, input), suggestions },
        clears: 'none'
      }
    }
    case 'Notification': {
      const message = str(payload.message) ?? ''
      return {
        events: [{ type: 'notification', kind: classifyNotification(str(payload.notification_type), message), message }],
        clears: 'none'
      }
    }
    case 'Stop':
      return { events: [stopEvent(payload)], clears: 'all' }
    case 'StopFailure': {
      const message = str(payload.last_assistant_message) ?? str(payload.error)
      return { events: [{ type: 'stop-failure', ...(message ? { message } : {}) }], clears: 'all' }
    }
    case 'SessionEnd': {
      const reason = str(payload.reason)
      return { events: [{ type: 'session-end', ...(reason ? { reason } : {}) }], clears: 'all' }
    }
    default:
      return NONE
  }
}

// ---------------------------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------------------------

/** `*** Add File: x` / `*** Update File: x` / `*** Delete File: x` / `*** Move to: y` lines of an apply_patch body. */
const PATCH_FILE = /^\*\*\* (Add|Update|Delete) File: (.+?)\s*$/gm

/** Files an apply_patch body touches, in order, with whether every one of them is new. */
export function parsePatchFiles(patch: string): { files: string[]; allNew: boolean } {
  const files: string[] = []
  let allNew = true
  for (const match of patch.matchAll(PATCH_FILE)) {
    const path = match[2]
    if (!path) continue
    files.push(path)
    if (match[1] !== 'Add') allNew = false
  }
  return { files, allNew: files.length > 0 && allNew }
}

/**
 * Codex's tool vocabulary in Claude's terms. Shell -> Bash `{command}`; apply_patch -> Edit / Write `{file_path, files}`
 * (the patch text itself stays out: it can be huge and the status line only needs the file); request_user_input ->
 * AskUserQuestion. The result must be identical for PreToolUse, PermissionRequest and PostToolUse of the same call,
 * because prompts are matched to their tool-end by tool name + input.
 */
export function mapCodexTool(tool: string, rawInput: unknown): { tool: string; input: Rec } {
  const input: Rec = isRec(rawInput) ? rawInput : typeof rawInput === 'string' ? { command: rawInput } : {}
  switch (tool) {
    case 'Bash': {
      const command = str(input.command)
      return { tool: 'Bash', input: command ? { command } : {} }
    }
    case 'apply_patch': {
      const { files, allNew } = parsePatchFiles(str(input.command) ?? '')
      const first = files[0]
      return { tool: allNew ? 'Write' : 'Edit', input: first ? { file_path: first, files } : {} }
    }
    case 'request_user_input':
      return { tool: 'AskUserQuestion', input }
    default:
      return { tool, input }
  }
}

function normalizeCodex(event: string, payload: Rec): NormalizedHook {
  const mapped = mapCodexTool(str(payload.tool_name) ?? 'unknown', payload.tool_input)

  switch (event) {
    case 'SessionStart':
      return { events: [sessionStart(payload)], clears: 'none' }
    case 'UserPromptSubmit':
      return { events: [{ type: 'prompt-submit', prompt: str(payload.prompt) ?? '' }], clears: 'all' }
    case 'PreToolUse': {
      const result: NormalizedHook = { events: [{ type: 'tool-start', tool: mapped.tool, input: mapped.input }], clears: 'none' }
      if (mapped.tool === 'AskUserQuestion') {
        const questions = parseQuestions(mapped.input)
        if (questions.length > 0) result.questions = questions
      }
      return result
    }
    // The payload has no success flag (tool_response is the tool's text output), so every PostToolUse is `ok`.
    case 'PostToolUse':
      return { events: [{ type: 'tool-end', tool: mapped.tool, input: mapped.input, ok: true }], clears: 'tool' }
    case 'PermissionRequest':
      // No `permission_suggestions`: Codex's "don't ask again" would persist a rule in ~/.codex, so there is no allow-always.
      return {
        events: [],
        permission: { tool: mapped.tool, input: mapped.input, summary: summarizeToolUse(mapped.tool, mapped.input), suggestions: [] },
        clears: 'none'
      }
    case 'Stop':
      return { events: [stopEvent(payload)], clears: 'all' }
    default:
      return NONE
  }
}

/** Unknown events and non-object payloads normalize to nothing; they are never an error. */
export function normalizeHook(agent: HookAgent, event: string, payload: unknown, at = Date.now()): NormalizedHook {
  if (!isRec(payload)) return NONE
  return agent === 'codex' ? normalizeCodex(event, payload) : normalizeClaude(event, payload, at)
}
