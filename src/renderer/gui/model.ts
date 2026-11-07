// A GUI session's chat view (PRD F23, Figma 49″C–F), the decisions behind it kept apart from React so they can be
// tested: how the feed groups items, what a tool row says, what each card's buttons and keys do, the composer's keys
// and the pickers under it. Pure.
import { Bot, Brain, ClipboardList, FilePlus, FileText, FolderSearch, Globe, ListTodo, MoveRight, Pencil, Search, Sparkles, Square, Terminal, ToggleLeft, Trash2, Wrench, type LucideIcon } from 'lucide-react'
import { looksLikeReport } from '@shared/dispatch'
import type { GuiCommand, GuiConfigOption, GuiPermissionOption, GuiPrompt, GuiQuestion } from '@shared/gui-chat'
import { composerPickers } from '@shared/gui-chat'
import type { ChatItem } from '@shared/transcript-chat'
import type { SessionStatus } from '@shared/types'
import { CUT_ESCAPE, ESCAPES } from './ansi'

// --- the feed (Figma 49″C) ----------------------------------------------------------------------------------------

export type StepItem = Extract<ChatItem, { kind: 'tool' | 'thinking' }>

/**
 * One block of the feed: a run of tool and thinking rows (8 apart inside, Figma `Steps`), or any other single item.
 * Blocks are 16 apart. `key` stays the same while a block grows, so React keeps its rows.
 */
export type FeedBlock = { kind: 'steps'; key: string; items: StepItem[] } | { kind: 'item'; key: string; item: Exclude<ChatItem, StepItem> }

const isStep = (item: ChatItem): item is StepItem => item.kind === 'tool' || item.kind === 'thinking'

export function feedBlocks(items: readonly ChatItem[]): FeedBlock[] {
  const blocks: FeedBlock[] = []
  for (const item of items) {
    if (item.kind === 'unknown') continue
    const last = blocks[blocks.length - 1]
    if (isStep(item)) {
      if (last?.kind === 'steps') last.items.push(item)
      else blocks.push({ kind: 'steps', key: item.id, items: [item] })
    } else {
      blocks.push({ kind: 'item', key: item.id, item })
    }
  }
  return blocks
}

const lastUserKey = (blocks: readonly FeedBlock[]): string | null => {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    if (block.kind === 'item' && block.item.kind === 'user') return block.key
  }
  return null
}

/**
 * The user message just sent: the feed's last user message changed (its reply may have come in the same batch). The
 * feed then follows the end again even if the user had scrolled up. Null on the first render and when a whole history
 * arrives at once.
 */
export function sentMessage(prev: readonly FeedBlock[] | null, next: readonly FeedBlock[]): string | null {
  if (!prev || (prev.length === 0 && next.length > 1)) return null
  const key = lastUserKey(next)
  return key !== null && key !== lastUserKey(prev) ? key : null
}


/** A message just sent, drawn at once while the agent has not echoed it yet (Claude replays it only once it takes it). */
export interface PendingSend {
  id: string
  text: string
  /** User messages in the feed when it was sent: one more means the agent's own copy arrived. */
  users: number
  at: number
}

export const userCount = (items: readonly ChatItem[]): number => items.reduce((n, item) => (item.kind === 'user' ? n + 1 : n), 0)

/** The feed's items with the message just sent at the end, until the agent's copy of it is there. */
export function withPendingSend(items: readonly ChatItem[], pending: PendingSend | null): readonly ChatItem[] {
  if (!pending || userCount(items) > pending.users) return items
  return [...items, { kind: 'user', id: pending.id, at: pending.at, text: pending.text, images: 0 }]
}

/**
 * The blocks that start the agent's part of a turn (Figma 51A): the first non-user block after a user message, or at
 * the top of the feed. The agent's mark sits beside it; the rest of the turn lines up after it.
 */
export function turnStarts(blocks: readonly FeedBlock[]): Set<string> {
  const starts = new Set<string>()
  let afterUser = true
  for (const block of blocks) {
    const user = block.kind === 'item' && block.item.kind === 'user'
    if (!user && afterUser) starts.add(block.key)
    afterUser = user
  }
  return starts
}

/**
 * Figma 54B: the last block of each finished agent turn that has words, with the turn's Markdown (its text blocks, a
 * blank line apart) and when its last block came. The turn still going on (`ongoing`) has none yet.
 */
export function turnEnds(blocks: readonly FeedBlock[], ongoing: boolean): Map<string, { text: string; at: number }> {
  const ends = new Map<string, { text: string; at: number }>()
  let texts: string[] = []
  let last: { key: string; at: number } | null = null
  const close = (): void => {
    if (last && texts.length > 0) ends.set(last.key, { text: texts.join('\n\n'), at: last.at })
    texts = []
    last = null
  }
  for (const block of blocks) {
    if (block.kind === 'item' && block.item.kind === 'user') {
      close()
      continue
    }
    if (block.kind === 'item' && block.item.kind === 'text') texts.push(block.item.text)
    last = { key: block.key, at: block.kind === 'steps' ? block.items[block.items.length - 1]!.at : block.item.at }
  }
  if (!ongoing) close()
  return ends
}

/** The streamed block starts the agent's part of the turn when nothing of it is in the feed yet. */
export function liveStartsTurn(blocks: readonly FeedBlock[]): boolean {
  const last = blocks[blocks.length - 1]
  return !last || (last.kind === 'item' && last.item.kind === 'user')
}

/**
 * A user message as the Markdown its bubble shows (Figma 51A): what the composer sent, with each line break kept — a
 * text area's lines are not paragraphs — except inside a fenced code block, where lines stay as they are.
 */
const BLOCK_START = /^\s*([-*+]\s|\d+[.)]\s|>|#{1,6}\s|`{3,}|~{3,})/

export function userMarkdown(text: string): string {
  let fence: string | null = null
  return text
    .split('\n')
    .map((line, i, lines) => {
      const open = /^\s*(`{3,}|~{3,})/.exec(line)
      if (fence === null && open) fence = open[1]!
      else if (fence !== null && line.trim().startsWith(fence)) {
        fence = null
        return line
      }
      const next = lines[i + 1]
      // A trailing backslash is a line break only when the next line goes on with the same paragraph.
      const goesOn = next !== undefined && next.trim() !== '' && !BLOCK_START.test(next)
      return fence === null && line.trim() !== '' && goesOn ? `${line}\\` : line
    })
    .join('\n')
}

/**
 * A user bubble. Wavi's own messages (`[Wavi 派活报告] …`, PRD F21) carry their header as a small first line
 * (Figma 49″C, the dispatch report).
 */
export function userBubble(text: string): { header: string | null; body: string } {
  if (!looksLikeReport(text)) return { header: null, body: text }
  const trimmed = text.trimStart()
  const end = trimmed.indexOf(']')
  if (end < 0) return { header: null, body: text }
  return { header: trimmed.slice(1, end), body: trimmed.slice(end + 1).replace(/^\s+/, '') }
}

/** 「思考了 8s」 (rounded up to whole seconds; minutes past a minute), or 「思考了」 when the agent gave no duration. */
export function thinkingLabel(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '思考了'
  const seconds = Math.max(1, Math.round(ms / 1000))
  return seconds < 60 ? `思考了 ${seconds}s` : `思考了 ${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/** Tools whose result line is worth a summary under the row (Figma: Grep's 「14 处 · 6 个文件」, Bash's last words). */
const SUMMARY_SKIP: ReadonlySet<string> = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite'])

/**
 * Figma 59J: what a tool row says — its icon and a Chinese verb, by the tool's name. Claude's tools; Codex's shell,
 * patch and search calls (named Bash / Edit / WebSearch by its parsers); the ACP tool kinds (acp.ts). Any other tool
 * (MCP, an agent's own) is a wrench with its own name.
 */
const TOOL_WORDS: Readonly<Record<string, readonly [LucideIcon, string]>> = {
  Read: [FileText, '读取'],
  Edit: [Pencil, '编辑'],
  MultiEdit: [Pencil, '编辑'],
  Write: [FilePlus, '写入'],
  NotebookEdit: [Pencil, '编辑'],
  Bash: [Terminal, '运行'],
  BashOutput: [Terminal, '读取输出'],
  KillShell: [Square, '停止'],
  Grep: [Search, '搜索'],
  Glob: [FolderSearch, '查找文件'],
  WebFetch: [Globe, '读取'],
  WebSearch: [Globe, '搜索网页'],
  Agent: [Bot, '子 agent'],
  Task: [Bot, '子 agent'],
  TodoWrite: [ListTodo, '任务'],
  Skill: [Sparkles, 'Skill'],
  ExitPlanMode: [ClipboardList, '计划'],
  Delete: [Trash2, '删除'],
  Move: [MoveRight, '移动'],
  Search: [Search, '搜索'],
  Think: [Brain, '思考'],
  Fetch: [Globe, '读取'],
  Mode: [ToggleLeft, '切换模式'],
  Tool: [Wrench, '工具']
}

export interface ToolView {
  status: SessionStatus
  name: string
  /** Figma 59J: icon · verb · target (`arg`). */
  icon: LucideIcon
  verb: string
  arg: string
  /** Edit / Write: `+N −M` (each part only when non-zero). */
  added?: number
  removed?: number
  /** 「等你确认」 at the row's end while the agent waits on a permission for it (Figma 49″E). */
  waiting: boolean
  /** The first line of what it printed, under the row (only once it finished). */
  summary?: string
  /** It has something to open: output or a diff. */
  expandable: boolean
  /** What it printed, as shown and copied: without terminal escape codes. */
  output?: string
  /** A shell call's whole command: the expanded output starts with `$ <command>` (Figma 59J). */
  command?: string
  /** `exit N` at the row's end: only a failed call with a non-zero code the agent reported (Codex). */
  exit?: number
}

// A command's output as text alone: shown in the summary and copied. The model keeps the escape codes; the expanded
// output draws their colors (ansi.ts).
export const plainOutput = (text: string): string => text.replace(ESCAPES, '').replace(CUT_ESCAPE, '…')

export function toolView(item: Extract<ChatItem, { kind: 'tool' }>, waiting: boolean): ToolView {
  const status: SessionStatus = waiting ? 'needs_you' : item.state === 'running' ? 'running' : item.state === 'error' ? 'error' : 'done_unread'
  const output = item.output === undefined ? undefined : plainOutput(item.output)
  const firstLine = output
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  // Own keys only: a tool named `constructor` is not Object's.
  const [icon, verb] = (Object.hasOwn(TOOL_WORDS, item.name) ? TOOL_WORDS[item.name] : undefined) ?? [Wrench, item.name]
  // Without output a command is worth opening only when the row shows less of it (its lines, its length).
  const hidden = item.input !== undefined && item.input.trim() !== item.arg
  // A change to several files counts all of them.
  const files = item.files ?? (item.diff ? [item.diff] : [])
  const added = files.reduce((n, f) => n + f.added, 0)
  const removed = files.reduce((n, f) => n + f.removed, 0)
  return {
    status,
    name: item.name,
    icon,
    verb,
    arg: item.arg,
    ...(added > 0 ? { added } : {}),
    ...(removed > 0 ? { removed } : {}),
    waiting,
    ...(item.state !== 'running' && firstLine && !SUMMARY_SKIP.has(item.name) ? { summary: firstLine } : {}),
    expandable: !!item.diff || !!output?.trim() || hidden,
    ...(output !== undefined ? { output } : {}),
    ...(item.input ? { command: item.input } : {}),
    ...(item.state === 'error' && item.exit !== undefined && item.exit !== 0 ? { exit: item.exit } : {})
  }
}

/** The tool row a pending permission belongs to: the last tool still running, while one is asked about. */
export function waitingToolId(items: readonly ChatItem[], prompts: readonly GuiPrompt[]): string | null {
  if (!prompts.some((p) => p.kind === 'permission')) return null
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'tool') return item.state === 'running' ? item.id : null
  }
  return null
}

// --- cards (Figma 49″D–F) ------------------------------------------------------------------------------------------

/** 49″E: 拒绝 (⎋) · 总是允许 · 允许 (↵), whatever the agent called its options. Absent ones are not drawn. */
export interface PermissionButtons {
  reject?: GuiPermissionOption
  always?: GuiPermissionOption
  allow?: GuiPermissionOption
}

export function permissionButtons(options: readonly GuiPermissionOption[]): PermissionButtons {
  const first = (kind: GuiPermissionOption['kind']) => options.find((o) => o.kind === kind)
  const reject = first('reject_once') ?? first('reject_always')
  const always = first('allow_always')
  const allow = first('allow_once')
  return { ...(reject ? { reject } : {}), ...(always ? { always } : {}), ...(allow ? { allow } : {}) }
}

/** What ↵ answers on a permission card: 允许, else 总是允许 when that is all the agent offers. */
export const permissionPrimary = (buttons: PermissionButtons): GuiPermissionOption | undefined => buttons.allow ?? buttons.always

/** The agent as a card names it (Figma 49″E 「Claude 要运行一条命令」): the product name without its CLI suffix. */
export const shortAgentName = (label: string): string => label.replace(/\s+(Code|CLI)$/i, '')

/** The permission card's title (「Claude 要运行一条命令」): what the tool does, by its name. */
export function permissionTitle(agentLabel: string, tool: string): string {
  switch (tool) {
    case 'Bash':
    case 'commandExecution':
    case 'execute':
      return `${agentLabel} 要运行一条命令`
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
    case 'fileChange':
    case 'edit':
      return `${agentLabel} 要修改文件`
    case 'Read':
    case 'read':
      return `${agentLabel} 要读取文件`
    case 'WebFetch':
    case 'WebSearch':
    case 'fetch':
      return `${agentLabel} 要访问网络`
    default:
      return tool ? `${agentLabel} 要使用 ${tool}` : `${agentLabel} 要你确认`
  }
}

/** 49″D: the plan's title (「计划：…」 from its first heading or line) and the rest as the body. */
export function planParts(plan: string): { title: string; body: string } {
  const lines = plan.replace(/\r\n/g, '\n').split('\n')
  const at = lines.findIndex((line) => line.trim() !== '')
  if (at < 0) return { title: '计划', body: '' }
  const first = lines[at]!.trim()
  const heading = /^#{1,6}\s+(.*)$/.exec(first)
  if (!heading) return { title: '计划', body: lines.slice(at).join('\n').trim() }
  const name = heading[1]!.replace(/^计划[:：]\s*/, '').trim()
  return { title: name ? `计划：${name}` : '计划', body: lines.slice(at + 1).join('\n').trim() }
}

/** A question card's choice: an option by index, or 其他… with what the user typed. */
export type QuestionChoice = { kind: 'option'; indexes: number[] } | { kind: 'other'; text: string }

/** The answer to one question: the option labels (several joined with 「, 」), or the text typed after 其他…. */
export function questionAnswer(question: GuiQuestion, choice: QuestionChoice | undefined): string | null {
  if (!choice) return null
  if (choice.kind === 'other') return choice.text.trim() || null
  const labels = choice.indexes
    .slice()
    .sort((a, b) => a - b)
    .map((i) => question.options[i]?.label)
    .filter((label): label is string => !!label)
  return labels.length > 0 ? labels.join(', ') : null
}

/** Picking option `index` (or 其他…, index = options.length): one question replaces, a multi-select toggles. */
export function pickChoice(question: GuiQuestion, current: QuestionChoice | undefined, index: number): QuestionChoice {
  if (index >= question.options.length) return { kind: 'other', text: current?.kind === 'other' ? current.text : '' }
  if (!question.multiSelect) return { kind: 'option', indexes: [index] }
  const picked = current?.kind === 'option' ? current.indexes : []
  return { kind: 'option', indexes: picked.includes(index) ? picked.filter((i) => i !== index) : [...picked, index] }
}

/** Every question's answer keyed by its text, as the agent asked (Claude's AskUserQuestion); null while one is open. */
export function questionAnswers(questions: readonly GuiQuestion[], choices: readonly (QuestionChoice | undefined)[]): Record<string, string> | null {
  const answers: Record<string, string> = {}
  for (const [i, question] of questions.entries()) {
    const answer = questionAnswer(question, choices[i])
    if (answer === null) return null
    answers[question.question] = answer
  }
  return answers
}

export type CardKey = { type: 'primary' } | { type: 'dismiss' } | { type: 'pick'; index: number } | { type: 'move'; delta: number } | null

/**
 * A key pressed while a card waits (it is answered from the keyboard wherever the focus is in the chat, except while
 * typing in the composer or 其他…): ↵ the primary button, ⎋ 拒绝 / 跳过, 1–9 an option, ↑↓ move between options.
 */
export function cardKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing: boolean }, typing: boolean): CardKey {
  if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return null
  if (event.key === 'Escape') return { type: 'dismiss' }
  if (typing) return null
  if (event.key === 'Enter') return { type: 'primary' }
  if (/^[1-9]$/.test(event.key)) return { type: 'pick', index: Number(event.key) - 1 }
  if (event.key === 'ArrowDown') return { type: 'move', delta: 1 }
  if (event.key === 'ArrowUp') return { type: 'move', delta: -1 }
  return null
}

// --- the composer (Figma 49″C, 49′C, 49′E) ------------------------------------------------------------------------

export type ComposerAction = 'send' | 'newline' | 'menu-up' | 'menu-down' | 'menu-pick' | 'menu-close' | 'stop' | null

/**
 * What a key in the composer does: ⏎ sends, ⇧⏎ is a newline (in a list a new item, Composer), ⎋ stops a running turn.
 * In a code block ⏎ is a newline too (Figma 50, as in Slack and T3 Code); ⌘⏎ sends from anywhere. While the `/` menu is open ↑↓ move, ⏎ / ⇥
 * pick, ⎋ closes it. A key that ends an input method's composition (keyCode 229, or `isComposing`) belongs to the input
 * method: the Enter that commits a pinyin word must not send.
 */
export function composerKey(
  event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; isComposing: boolean; keyCode: number },
  state: { menuOpen: boolean; busy: boolean; inCode?: boolean }
): ComposerAction {
  if (event.isComposing || event.keyCode === 229) return null
  if (state.menuOpen) {
    if (event.key === 'ArrowUp') return 'menu-up'
    if (event.key === 'ArrowDown') return 'menu-down'
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') return 'menu-pick'
    if (event.key === 'Escape') return 'menu-close'
  }
  if (event.key === 'Enter') {
    if (event.metaKey && !event.shiftKey) return 'send'
    if (event.shiftKey || event.altKey || state.inCode) return 'newline'
    if (event.ctrlKey) return null
    return 'send'
  }
  if (event.key === 'Escape' && state.busy) return 'stop'
  return null
}

/** What follows `/` while the draft is a command being typed (`/re`), else null: the menu shows only then. */
export function slashQuery(draft: string): string | null {
  const match = /^\/(\S*)$/.exec(draft)
  return match ? match[1]! : null
}

/** The draft once a command is picked: `/name ` (its argument follows). */
export const pickCommand = (command: GuiCommand): string => `/${command.name} `

/**
 * An attachment drawn as a 64 px thumbnail (Figma 50C): the `file://` URL of a picture the app can show (the types the
 * agents take as images, §6.9), else null and it stays a name. HEIC is neither.
 */
export function thumbnailUrl(path: string): string | null {
  if (!/\.(png|jpe?g|gif|webp)$/i.test(path)) return null
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

/** Appends inserted text to a draft on its own, separated by a space or newline from what is there. */
export function appendToDraft(draft: string, text: string): string {
  if (!draft) return text
  return /\s$/.test(draft) ? `${draft}${text}` : `${draft} ${text}`
}

/**
 * The pickers under the composer: model and reasoning effort share one button (「Sonnet 5 · 高」, Figma 49′E), every
 * other option (mode, …) has its own.
 */
export interface PickerButton {
  key: string
  label: string
  options: GuiConfigOption[]
  /** 计划 (Figma 56): a switch, pressed while on, not a menu. */
  toggle?: { on: boolean }
}

const currentLabel = (option: GuiConfigOption): string => option.values.find((v) => v.value === option.current)?.label ?? option.current

export function pickerButtons(config: readonly GuiConfigOption[]): PickerButton[] {
  const pickers = composerPickers(config)
  const model = pickers.find((o) => o.category === 'model')
  const effort = pickers.find((o) => o.category === 'thought_level')
  const buttons: PickerButton[] = []
  const joined = [model, effort].filter((o): o is GuiConfigOption => !!o)
  if (joined.length > 0) buttons.push({ key: joined.map((o) => o.id).join('+'), label: joined.map(currentLabel).join(' · '), options: joined })
  for (const option of pickers) {
    if (option === model || option === effort) continue
    if (option.category === 'plan') buttons.push({ key: option.id, label: option.label, options: [option], toggle: { on: option.current === 'on' } })
    else buttons.push({ key: option.id, label: currentLabel(option), options: [option] })
  }
  return buttons
}

/** 「模型」 / 「推理强度」 / 「模式」: the heading of each section of a picker's menu. */
export function pickerSectionTitle(option: GuiConfigOption): string {
  switch (option.category) {
    case 'model':
      return '模型'
    case 'thought_level':
      return '推理强度'
    case 'permission':
      return '权限'
    case 'mode':
      return '模式'
    default:
      return option.label
  }
}

/** Steps through a list of `length` items from `index` (wrapping); -1 = none highlighted yet. */
export function stepIndex(index: number, delta: number, length: number): number {
  if (length === 0) return -1
  if (index < 0) return delta > 0 ? 0 : length - 1
  return (index + delta + length) % length
}
