// Raw agent hook payload -> normalized AgentEvent / PendingPrompt parts (PRD §3, F3).
// Pure: no Electron, no I/O. Field names follow the Claude Code hooks reference and the payloads
// captured in docs/spikes/hooks.md (see ./fixtures.ts). Codex hooks arrive in M3; `HookAgent` is
// carried through so the server does not have to change then.
import type { AgentEvent, AgentQuestion, HookAgent, QuestionOption } from '@shared/agent-events'

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

/** Tools whose PermissionRequest dialog has no allow/deny meaning here: leave it to the TUI. */
const TUI_ONLY_PERMISSION_TOOLS: ReadonlySet<string> = new Set(['AskUserQuestion', 'ExitPlanMode'])

const NONE: NormalizedHook = { events: [], clears: 'none' }

function normalizeClaude(event: string, payload: Rec): NormalizedHook {
  const tool = str(payload.tool_name) ?? 'unknown'
  const input = isRec(payload.tool_input) ? payload.tool_input : {}

  switch (event) {
    case 'SessionStart':
      return { events: [{ type: 'session-start' }], clears: 'none' }
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
      return { events: [{ type: 'tool-end', tool, input, ok: true }], clears: 'tool' }
    case 'PostToolUseFailure':
      return { events: [{ type: 'tool-end', tool, input, ok: false }], clears: 'tool' }
    case 'PermissionRequest': {
      if (TUI_ONLY_PERMISSION_TOOLS.has(tool)) return NONE
      const suggestions = Array.isArray(payload.permission_suggestions) ? payload.permission_suggestions : []
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
      return { events: [{ type: 'stop' }], clears: 'all' }
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

/** Unknown events and non-object payloads normalize to nothing; they are never an error. */
export function normalizeHook(agent: HookAgent, event: string, payload: unknown): NormalizedHook {
  if (!isRec(payload)) return NONE
  // Codex hooks are M3; until then they yield nothing rather than being misread as Claude's.
  if (agent !== 'claude') return NONE
  return normalizeClaude(event, payload)
}
