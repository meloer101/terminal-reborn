// The phone's chat view of a session (PRD F22, Figma 45C), read from the agent's own transcript line by line: Claude's
// JSONL in ~/.claude/projects, Codex's rollout. What each line holds is in PRD §6.16 (measured on Claude 2.1.286–2.1.316
// and Codex 0.142–0.166). Neither format is documented, so a line of a type not listed below becomes an `unknown` item
// instead of breaking the conversation. Pure and incremental: a parser takes lines as they are appended.

export interface DiffHunk {
  oldStart: number
  newStart: number
  /** ` ` / `+` / `-` prefixed, as git prints them. */
  lines: string[]
}

export type ToolState = 'running' | 'ok' | 'error'

/** One task of an agent's task list (Claude TodoWrite, Codex's plan, an ACP plan). */
export interface ChatTodo {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** One file's change as the chat draws it: its hunks (capped), and the counts of the whole change. */
export interface FileDiff {
  path: string
  hunks: DiffHunk[]
  added: number
  removed: number
  truncated: boolean
}

export type ChatItem =
  | {
      kind: 'user'
      id: string
      at: number
      text: string
      images: number
      /** The pictures sent with it as local files (Figma 71A), when they are known: drawn as thumbnails over the bubble. */
      attachments?: string[]
    }
  | {
      kind: 'text'
      id: string
      at: number
      text: string
      /** A subagent's words: the id of the Agent / Task call that started it (Figma 59J; the live Claude stream only). */
      parent?: string
    }
  | { kind: 'thinking'; id: string; at: number; text: string; ms?: number; parent?: string }
  | {
      kind: 'tool'
      id: string
      at: number
      /** A subagent's call: the id of the Agent / Task call that started it (the live Claude stream only). */
      parent?: string
      name: string
      /** The one thing worth showing after the name: a command, a path, a pattern. */
      arg: string
      state: ToolState
      /** Output (its end, when long). */
      output?: string
      /** A shell call's whole command, line breaks kept (clipped at CHAT_LIMITS.input); `arg` is its one-line form. */
      input?: string
      /** A shell call's exit code, when the agent reports one (Codex; Claude does not). */
      exit?: number
      /** Edit / Write; of a change to several files, the first file. */
      diff?: FileDiff
      /** A change to more than one file (Codex fileChange, ACP): every file, `diff` being the first. */
      files?: FileDiff[]
      /** A task list (Claude TodoWrite, Codex / ACP `Plan`): every task, as the agent last wrote it. */
      todos?: ChatTodo[]
      /** How long a subagent ran (Claude Agent / Task `totalDurationMs`, a Codex collab call's start to end). */
      ms?: number
    }
  | { kind: 'system'; id: string; at: number; text: string }
  | { kind: 'unknown'; id: string; at: number; type: string }

export const CHAT_LIMITS = {
  text: 20_000,
  thinking: 4_000,
  output: 2_000,
  input: 2_000,
  arg: 300,
  diffLines: 400
} as const

/** Claude line types that never show in the conversation (PRD §6.16). */
const CLAUDE_SKIP: ReadonlySet<string> = new Set([
  'attachment',
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'atis-latch',
  'mode',
  'permission-mode',
  'last-prompt',
  'ai-title',
  'custom-title',
  'agent-name',
  'bridge-session',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'cost-state',
  'tools-used',
  'worktree-state',
  'frame-link',
  'relocated',
  'summary',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor'
])

/** `system` subtypes that are bookkeeping, not conversation. */
const SYSTEM_SKIP: ReadonlySet<string> = new Set(['stop_hook_summary', 'turn_duration'])

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** The end of a long output (what a command printed last matters most). */
function tail(text: string, max: number): string {
  return text.length > max ? `…${text.slice(text.length - max)}` : text
}

function timeOf(line: Rec, fallback: number): number {
  const t = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN
  return Number.isFinite(t) ? t : fallback
}

/** A path under the session's folder, shown relative to it. */
export function rel(path: string, cwd: string | undefined): string {
  if (cwd && path.startsWith(cwd.endsWith('/') ? cwd : `${cwd}/`)) return path.slice(cwd.length + (cwd.endsWith('/') ? 0 : 1))
  return path
}

/** What follows a tool's name on its row (Figma 45C): `Bash pnpm test`, `Edit src/a.ts`. */
export function toolArg(name: string, input: unknown, cwd?: string): string {
  const v = isRec(input) ? input : {}
  const path = str(v.file_path) ?? str(v.notebook_path) ?? str(v.path)
  let arg: string | undefined
  switch (name) {
    case 'Bash':
      arg = str(v.command)
      break
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      arg = path ? rel(path, cwd) : undefined
      break
    case 'Grep':
    case 'Glob':
      arg = str(v.pattern)
      break
    case 'WebFetch':
      arg = str(v.url)
      break
    case 'WebSearch':
      arg = str(v.query)
      break
    case 'Agent':
    case 'Task':
      arg = str(v.description)
      break
    case 'TodoWrite':
      arg = Array.isArray(v.todos) ? `${v.todos.length} 项` : undefined
      break
    default:
      arg = path ? rel(path, cwd) : Object.values(v).find((x): x is string => typeof x === 'string' && x.trim() !== '')
  }
  return clip((arg ?? '').replace(/\s+/g, ' ').trim(), CHAT_LIMITS.arg)
}

/**
 * A task list as each agent writes it → tasks: Claude's `{ content, status }`, Codex's `{ step, status }` (`inProgress`
 * from the app-server, `in_progress` in a rollout), ACP's `{ content, status }`. Entries without text are left out.
 */
export function todosOf(raw: unknown): ChatTodo[] {
  return (Array.isArray(raw) ? raw : []).filter(isRec).flatMap((t): ChatTodo[] => {
    const text = str(t.content) ?? str(t.step)
    if (!text?.trim()) return []
    const status = t.status === 'completed' ? 'completed' : t.status === 'in_progress' || t.status === 'inProgress' ? 'in_progress' : 'pending'
    return [{ text: clip(text, CHAT_LIMITS.arg), status }]
  })
}

/** A task list's row target: 「N 项」. */
export const todosArg = (todos: readonly ChatTodo[]): string => `${todos.length} 项`

/** `mcp__server__tool` → `tool`; everything else as it is. */
export function toolLabel(name: string): string {
  const m = /^mcp__.+?__(.+)$/.exec(name)
  return m?.[1] ?? name
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is Rec => isRec(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}

function hunksOf(raw: unknown): DiffHunk[] {
  if (!Array.isArray(raw)) return []
  const out: DiffHunk[] = []
  for (const h of raw) {
    if (!isRec(h) || !Array.isArray(h.lines)) continue
    out.push({
      oldStart: typeof h.oldStart === 'number' ? h.oldStart : 0,
      newStart: typeof h.newStart === 'number' ? h.newStart : 0,
      lines: h.lines.filter((l): l is string => typeof l === 'string')
    })
  }
  return out
}

/**
 * Files' hunks → the diffs the chat draws: each file's counts, their lines capped at `budget` all together (a long
 * first file leaves the later ones their names and counts only).
 */
export function fileDiffs(files: readonly { path: string; hunks: readonly DiffHunk[] }[], budget: number = CHAT_LIMITS.diffLines): FileDiff[] {
  let left = budget
  return files.map(({ path, hunks }) => {
    let added = 0
    let removed = 0
    let truncated = false
    const kept: DiffHunk[] = []
    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.startsWith('+')) added++
        else if (l.startsWith('-')) removed++
      }
      if (left <= 0) {
        truncated = true
        continue
      }
      const lines = h.lines.slice(0, left)
      if (lines.length < h.lines.length) truncated = true
      left -= lines.length
      kept.push({ ...h, lines })
    }
    return { path, hunks: kept, added, removed, truncated }
  })
}

/** A unified diff (Codex's `fileChange.changes[].diff`, Pi's edit `details.patch`) → hunks with ` ` / `+` / `-` lines. */
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

/** A new file's whole text as one hunk of additions. */
export const addedFile = (text: string): DiffHunk => ({ oldStart: 0, newStart: 1, lines: text.replace(/\n$/, '').split('\n').map((l) => `+${l}`) })

const DIFF_CONTEXT = 3
/** Above this many line pairs the diff is shown as a whole replacement (the table would be too big). */
const DIFF_MAX_PAIRS = 4_000_000

/** Old / new text → hunks with three lines of context (longest common subsequence of lines). */
export function lineDiff(oldText: string, newText: string): DiffHunk[] {
  const a = oldText === '' ? [] : oldText.replace(/\n$/, '').split('\n')
  const b = newText === '' ? [] : newText.replace(/\n$/, '').split('\n')
  type Op = { op: ' ' | '-' | '+'; line: string; oldNo: number; newNo: number }
  const ops: Op[] = []
  if (a.length * b.length > DIFF_MAX_PAIRS) {
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
    const from = Math.max(0, k - DIFF_CONTEXT)
    let to = k
    let quiet = 0
    while (to < ops.length && quiet <= DIFF_CONTEXT * 2) {
      quiet = ops[to]!.op === ' ' ? quiet + 1 : 0
      to++
    }
    const end = Math.min(ops.length, to - Math.max(0, quiet - DIFF_CONTEXT))
    const slice = ops.slice(from, end)
    hunks.push({ oldStart: slice[0]!.oldNo, newStart: slice[0]!.newNo, lines: slice.map((o) => `${o.op}${o.line}`) })
    k = end
  }
  return hunks
}

/** Edit / Write results → a diff the phone can draw, capped at CHAT_LIMITS.diffLines lines. */
export function diffOf(result: unknown, cwd?: string): FileDiff | undefined {
  if (!isRec(result)) return undefined
  const path = str(result.filePath)
  if (!path) return undefined
  let hunks = hunksOf(result.structuredPatch)
  if (hunks.length === 0 && result.type === 'create' && typeof result.content === 'string') hunks = [addedFile(result.content)]
  return fileDiffs([{ path: rel(path, cwd), hunks }])[0]
}

function outputOf(result: Rec | undefined, block: Rec): string | undefined {
  if (result && (typeof result.stdout === 'string' || typeof result.stderr === 'string')) {
    const out = [str(result.stdout) ?? '', str(result.stderr) ?? ''].filter((s) => s.trim() !== '').join('\n')
    return out ? tail(out, CHAT_LIMITS.output) : undefined
  }
  const text = textOfContent(block.content)
  return text ? tail(text, CHAT_LIMITS.output) : undefined
}

/**
 * Claude records a slash command as a message of tags (a user line for skills and prompt commands, a `local_command`
 * system line for `/model`, `/login` …); show `/clear`, not the markup. What it printed is `localOutput`'s.
 */
function commandText(text: string): string | null {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]
  if (name) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1]?.trim()
    return args ? `${name} ${args}` : name
  }
  if (/^<local-command-(stdout|stderr|caveat)>/.test(text)) return ''
  return null
}

const TASK_STATUS: Record<string, string> = { completed: '已完成', failed: '失败', stopped: '已停止', killed: '已停止' }

/**
 * Claude Code's report that a background task (agent, command) ended. It is a user line that starts a turn
 * (`origin.kind: task-notification`, `promptSource: system`), but the user did not send it: one system line.
 * `null`: not a notification.
 */
function taskNotice(text: string): string | null {
  if (!text.startsWith('<task-notification>')) return null
  const status = /<status>([^<]*)<\/status>/.exec(text)?.[1]?.trim() ?? ''
  const name = /"([^"]+)"/.exec(/<summary>([^<]*)<\/summary>/.exec(text)?.[1] ?? '')?.[1]
  const word = TASK_STATUS[status] ?? '已结束'
  return name ? `后台任务「${name}」${word}` : `后台任务${word}`
}

/**
 * What a local command (/cost, /context, /model …) printed, as the transcript records it. The live stream sends the
 * same output as an assistant message of text, so history shows it as a reply too. `null`: not a local command's output.
 */
function localOutput(text: string): string | null {
  if (!/^<local-command-(stdout|stderr)>/.test(text)) return null
  const parts = [...text.matchAll(/<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/g)].map((m) => m[1]!.trim())
  return parts.filter((p) => p !== '').join('\n')
}

export interface ChatParser {
  /** Parses one appended line; returns the indexes of items it added or changed. */
  push(line: string): number[]
  readonly items: readonly ChatItem[]
}

/** A picture inside a message, as base64. */
export interface InlineImage {
  mediaType: string
  data: string
}

/**
 * Where a picture sent inline is kept as a file, for the chat to draw it (main writes it; null: not kept). Messages
 * carry only the bytes, so a resumed or replayed conversation finds its pictures through this.
 */
export type KeepImage = (image: InlineImage) => string | null

/** The kept files of a message's inline pictures, in order; undefined when none was kept. */
export function keptImages(images: readonly InlineImage[], keep: KeepImage | undefined): string[] | undefined {
  if (!keep) return undefined
  const paths = images.map((image) => keep(image)).filter((path): path is string => path !== null)
  return paths.length > 0 ? paths : undefined
}

/** A `data:<type>;base64,<data>` URL's picture (how Codex keeps one), or null. */
export function inlineOfDataUrl(url: unknown): InlineImage | null {
  if (typeof url !== 'string') return null
  const match = /^data:([\w/+.-]+);base64,/.exec(url)
  return match ? { mediaType: match[1]!, data: url.slice(match[0].length) } : null
}

/** A parser for one session's transcript. `agent` picks the format; `keep` keeps its inline pictures. */
export function createChatParser(agent: 'claude' | 'codex', now: () => number = Date.now, keep?: KeepImage): ChatParser {
  return agent === 'claude' ? claudeParser(now, keep) : codexParser(now, keep)
}

/** Claude's `image` blocks with base64 data. */
function claudeImages(content: unknown): InlineImage[] {
  if (!Array.isArray(content)) return []
  const out: InlineImage[] = []
  for (const block of content) {
    if (!isRec(block) || block.type !== 'image' || !isRec(block.source) || block.source.type !== 'base64') continue
    const { media_type: mediaType, data } = block.source
    if (typeof mediaType === 'string' && typeof data === 'string') out.push({ mediaType, data })
  }
  return out
}

function claudeParser(now: () => number, keep: KeepImage | undefined): ChatParser {
  const items: ChatItem[] = []
  const tools = new Map<string, number>()
  let seq = 0
  const nextId = (prefix: string): string => `${prefix}${seq++}`
  const add = (item: ChatItem): number => {
    items.push(item)
    return items.length - 1
  }

  function push(raw: string): number[] {
    if (!raw.trim()) return []
    let line: unknown
    try {
      line = JSON.parse(raw)
    } catch {
      return []
    }
    if (!isRec(line) || typeof line.type !== 'string') return []
    const type = line.type
    if (CLAUDE_SKIP.has(type)) return []
    // A subagent's own lines. The live stream names the Agent / Task call they belong to (`parentToolUseId`, from
    // claude-stream.ts): its calls, thinking and words go under that row. A transcript file does not: they stay out,
    // the work showing as the Agent call that started it.
    const parent = line.isSidechain === true ? str(line.parentToolUseId) : undefined
    if (line.isSidechain === true && !parent) return []
    const under = parent ? { parent } : {}
    const at = timeOf(line, now())
    const cwd = str(line.cwd)
    const message = isRec(line.message) ? line.message : undefined
    const changed: number[] = []

    if (type === 'assistant' && message) {
      const content = Array.isArray(message.content) ? message.content : []
      for (const block of content) {
        if (!isRec(block)) continue
        if (block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '') {
          changed.push(add({ kind: 'text', id: nextId('t'), at, text: clip(block.text, CHAT_LIMITS.text), ...under }))
        } else if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim() !== '') {
          // A signature-only block (display omitted, the default on current models) has nothing to show.
          const ms = typeof line.thinkingDurationMs === 'number' ? line.thinkingDurationMs : undefined
          changed.push(add({ kind: 'thinking', id: nextId('k'), at, text: clip(block.thinking, CHAT_LIMITS.thinking), ...(ms !== undefined ? { ms } : {}), ...under }))
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          const id = str(block.id) ?? nextId('u')
          const command = block.name === 'Bash' && isRec(block.input) ? str(block.input.command) : undefined
          const todos = block.name === 'TodoWrite' && isRec(block.input) ? todosOf(block.input.todos) : undefined
          const index = add({
            kind: 'tool',
            id,
            at,
            ...under,
            name: toolLabel(block.name),
            arg: todos ? todosArg(todos) : toolArg(block.name, block.input, cwd),
            state: 'running',
            ...(command ? { input: clip(command, CHAT_LIMITS.input) } : {}),
            ...(todos ? { todos } : {})
          })
          tools.set(id, index)
          changed.push(index)
        }
      }
      return changed
    }

    if (type === 'user' && message) {
      if (line.isMeta === true || line.isCompactSummary === true) return []
      const content = message.content
      if (Array.isArray(content) && content.some((b) => isRec(b) && b.type === 'tool_result')) {
        const result = isRec(line.toolUseResult) ? line.toolUseResult : undefined
        for (const block of content) {
          if (!isRec(block) || block.type !== 'tool_result') continue
          const index = tools.get(str(block.tool_use_id) ?? '')
          const item = index === undefined ? undefined : items[index]
          if (!item || item.kind !== 'tool') continue
          const output = outputOf(result, block)
          const diff = item.name === 'Edit' || item.name === 'MultiEdit' || item.name === 'Write' ? diffOf(result, cwd) : undefined
          const ms = (item.name === 'Agent' || item.name === 'Task') && typeof result?.totalDurationMs === 'number' ? result.totalDurationMs : undefined
          items[index!] = {
            ...item,
            state: block.is_error === true ? 'error' : 'ok',
            ...(output ? { output } : {}),
            ...(diff ? { diff } : {}),
            ...(ms !== undefined ? { ms } : {})
          }
          changed.push(index!)
        }
        return changed
      }
      // The prompt a subagent gets: its Agent call says it already.
      if (parent) return []
      const text = textOfContent(content).trim()
      const images = Array.isArray(content) ? content.filter((b) => isRec(b) && b.type === 'image').length : 0
      const notice = taskNotice(text)
      if (notice) return [add({ kind: 'system', id: nextId('s'), at, text: clip(notice, 300) })]
      const output = localOutput(text)
      if (output !== null) return output ? [add({ kind: 'text', id: nextId('t'), at, text: clip(output, CHAT_LIMITS.text) })] : []
      const command = commandText(text)
      // The user typed it: it is their message, like any other prompt.
      if (command !== null) return command ? [add({ kind: 'user', id: str(line.uuid) ?? nextId('m'), at, text: clip(command, CHAT_LIMITS.text), images: 0 })] : []
      if (/^\[Request interrupted by user/.test(text)) return [add({ kind: 'system', id: nextId('s'), at, text: '已中断' })]
      if (!text && images === 0) return []
      const attachments = images > 0 ? keptImages(claudeImages(content), keep) : undefined
      return [add({ kind: 'user', id: str(line.uuid) ?? nextId('m'), at, text: clip(text, CHAT_LIMITS.text), images, ...(attachments ? { attachments } : {}) })]
    }

    // Nothing else of a subagent's shows.
    if (parent) return []

    if (type === 'system') {
      const subtype = str(line.subtype) ?? ''
      if (SYSTEM_SKIP.has(subtype)) return []
      if (subtype === 'compact_boundary') return [add({ kind: 'system', id: nextId('s'), at, text: '对话已压缩' })]
      const content = str(line.content)
      if (subtype === 'api_error') return [add({ kind: 'system', id: nextId('s'), at, text: content ? clip(content, 300) : 'API 出错' })]
      if (content && (subtype === 'local_command' || subtype === 'informational' || subtype === 'away_summary')) {
        const output = localOutput(content)
        if (output !== null) return output ? [add({ kind: 'text', id: nextId('t'), at, text: clip(output, CHAT_LIMITS.text) })] : []
        const command = commandText(content)
        if (command === '') return []
        if (command !== null) return [add({ kind: 'user', id: str(line.uuid) ?? nextId('m'), at, text: clip(command, CHAT_LIMITS.text), images: 0 })]
        return [add({ kind: 'system', id: nextId('s'), at, text: clip(content, 500) })]
      }
      return []
    }

    return [add({ kind: 'unknown', id: nextId('x'), at, type })]
  }

  return { push, items }
}

/**
 * Whether a Codex tool output reports a failure, and the exit code when it gives one. A shell call's header (before
 * `Output:`) carries its exit code (`Exit code: N`, `Process exited with code N`) or `Script failed`; only without one
 * is the start of the text read.
 */
function codexOutcome(out: string): { failed: boolean; exit?: number } {
  const head = out.split(/^Output:$/m, 1)[0]!
  const code = /^(?:Exit code: |Process exited with code )(-?\d+)$/m.exec(head)?.[1]
  if (code !== undefined) return { failed: code !== '0', exit: Number(code) }
  if (/^Script failed$/m.test(head)) return { failed: true }
  if (/^Process running with session ID /m.test(head)) return { failed: false }
  return { failed: /aborted|error|failed/i.test(out.slice(0, 80)) }
}

/** Codex's own context it puts in user messages: not something the user typed. */
const CODEX_CONTEXT = /^\s*<(environment_context|user_instructions|permissions instructions|turn_aborted)>/

function codexParser(now: () => number, keep: KeepImage | undefined): ChatParser {
  const items: ChatItem[] = []
  const calls = new Map<string, number>()
  let seq = 0
  let cwd: string | undefined
  const nextId = (prefix: string): string => `${prefix}${seq++}`
  const add = (item: ChatItem): number => {
    items.push(item)
    return items.length - 1
  }

  function codexArgs(raw: unknown): Rec {
    if (isRec(raw)) return raw
    if (typeof raw !== 'string') return {}
    try {
      const parsed: unknown = JSON.parse(raw)
      return isRec(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }

  function push(raw: string): number[] {
    if (!raw.trim()) return []
    let line: unknown
    try {
      line = JSON.parse(raw)
    } catch {
      return []
    }
    if (!isRec(line) || !isRec(line.payload)) return []
    const p = line.payload
    const at = timeOf(line, now())
    if (line.type === 'session_meta' || line.type === 'turn_context') {
      cwd = str(p.cwd) ?? cwd
      return []
    }
    if (line.type === 'event_msg') {
      if (p.type === 'turn_aborted') return [add({ kind: 'system', id: nextId('s'), at, text: '已中断' })]
      return []
    }
    if (line.type !== 'response_item') return []
    switch (p.type) {
      case 'message': {
        const content = Array.isArray(p.content) ? p.content : []
        const text = content
          .filter((b): b is Rec => isRec(b) && (b.type === 'input_text' || b.type === 'output_text') && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join('\n')
          .trim()
        if (p.role === 'assistant') return text ? [add({ kind: 'text', id: str(p.id) ?? nextId('t'), at, text: clip(text, CHAT_LIMITS.text) })] : []
        if (p.role !== 'user' || CODEX_CONTEXT.test(text)) return []
        const inputs = content.filter((b): b is Rec => isRec(b) && b.type === 'input_image')
        const images = inputs.length
        if (!text && !images) return []
        const inline = inputs.map((b) => inlineOfDataUrl(b.image_url)).filter((i): i is InlineImage => i !== null)
        const attachments = keptImages(inline, keep)
        return [add({ kind: 'user', id: str(p.id) ?? nextId('m'), at, text: clip(text, CHAT_LIMITS.text), images, ...(attachments ? { attachments } : {}) })]
      }
      case 'reasoning': {
        const summary = Array.isArray(p.summary) ? p.summary.filter(isRec).map((s) => str(s.text) ?? '').join('\n').trim() : ''
        return summary ? [add({ kind: 'thinking', id: nextId('k'), at, text: clip(summary, CHAT_LIMITS.thinking) })] : []
      }
      case 'function_call':
      case 'custom_tool_call': {
        const name = str(p.name) ?? 'tool'
        const args = p.type === 'function_call' ? codexArgs(p.arguments) : { input: str(p.input) ?? '' }
        const isShell = name === 'exec_command' || name === 'shell' || name === 'local_shell'
        const command = isShell ? (Array.isArray(args.command) ? args.command.join(' ') : (str(args.cmd) ?? str(args.command))) : undefined
        // update_plan: the task list, as the live session's `turn/plan/updated` shows it (codex-app-server.ts).
        const todos = name === 'update_plan' ? todosOf(args.plan) : undefined
        const label = isShell ? 'Bash' : name === 'apply_patch' ? 'Edit' : todos ? 'Plan' : toolLabel(name)
        const arg = command !== undefined ? clip(command, CHAT_LIMITS.arg) : todos ? todosArg(todos) : toolArg(label, args, cwd)
        const id = str(p.call_id) ?? nextId('u')
        const index = add({ kind: 'tool', id, at, name: label, arg, state: 'running', ...(command ? { input: clip(command, CHAT_LIMITS.input) } : {}), ...(todos ? { todos } : {}) })
        calls.set(id, index)
        return [index]
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const index = calls.get(str(p.call_id) ?? '')
        const item = index === undefined ? undefined : items[index]
        if (!item || item.kind !== 'tool') return []
        const out = typeof p.output === 'string' ? p.output : textOfOutput(p.output)
        const { failed, exit } = codexOutcome(out)
        items[index!] = { ...item, state: failed ? 'error' : 'ok', ...(out ? { output: tail(out, CHAT_LIMITS.output) } : {}), ...(exit !== undefined ? { exit } : {}) }
        return [index!]
      }
      default:
        return []
    }
  }

  return { push, items }
}

function textOfOutput(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  return raw
    .filter((b): b is Rec => isRec(b) && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n')
}
