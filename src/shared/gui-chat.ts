// A GUI session's conversation (PRD F23, Figma 49″): what main sends the renderer and how the renderer folds it.
// Main runs the agent headless (Claude `-p` stream-json, `codex app-server`, ACP) and turns its messages into
// `GuiEvent`s; `applyGuiEvent` folds them into a `GuiState` the chat view draws. Finished conversation items reuse
// the phone's `ChatItem` (@shared/transcript-chat), so history read back from a transcript and a live session look
// the same. Pure: no Electron, no Node.

import type { CliAgent } from './agents'
import type { ChatItem } from './transcript-chat'

export type GuiProtocol = 'claude-stream' | 'codex-app-server' | 'acp'

/** The block being streamed right now; replaced by a finished `ChatItem` when the agent completes it. */
export interface GuiLive {
  kind: 'text' | 'thinking'
  text: string
}

export interface GuiQuestion {
  /** Shown as the card's title; also the key the answer goes back under (Claude's AskUserQuestion). */
  question: string
  header?: string
  options: { label: string; description?: string }[]
  multiSelect: boolean
}

/** One way to answer a permission request, as the agent offers it (ACP options; Claude / Codex mapped onto these). */
export interface GuiPermissionOption {
  id: string
  label: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

/** Something the agent waits on (Figma 49″D–F). Answered with `GuiAnswer`. */
export type GuiPrompt =
  | {
      kind: 'permission'
      id: string
      /** The tool's name, e.g. `Bash`, `Edit`. */
      tool: string
      /** What it wants to do: a command, a path, the agent's own description. */
      detail: string
      options: GuiPermissionOption[]
    }
  | { kind: 'question'; id: string; questions: GuiQuestion[] }
  | { kind: 'plan'; id: string; plan: string }

export type GuiAnswer =
  | { kind: 'permission'; id: string; optionId: string; message?: string }
  | { kind: 'question'; id: string; answers: Record<string, string> }
  | { kind: 'plan'; id: string; decision: 'keep-planning' | 'approve-ask' | 'approve-auto'; message?: string }

/**
 * A picker under the composer (Figma 49″C, 56): model and reasoning effort as the agent offers them; `permission` and
 * `plan` are Wavi's own (one set of names for every agent, each driver lays them onto its protocol); `mode` is the
 * agent's own mode list (an ACP agent's, without its plan mode); `other` anything else it offers.
 */
export interface GuiConfigOption {
  id: string
  category: 'model' | 'mode' | 'thought_level' | 'permission' | 'plan' | 'other'
  label: string
  current: string
  values: { value: string; label: string }[]
}

/**
 * Figma 56: how far an agent goes before asking. 询问 asks before edits and commands; 接受编辑 edits without asking;
 * 自动 lets the agent judge each step itself (Claude `auto`, Codex `auto_review`, Grok `auto`) — offered only by an
 * agent that can. There is no level that never asks.
 */
export type GuiPermission = 'ask' | 'accept-edits' | 'auto'
export const GUI_PERMISSION_LABELS: Readonly<Record<GuiPermission, string>> = { ask: '询问', 'accept-edits': '接受编辑', auto: '自动' }

export function permissionOption(levels: readonly GuiPermission[], current: GuiPermission): GuiConfigOption {
  return {
    id: 'permission',
    category: 'permission',
    label: '权限',
    current: levels.includes(current) ? current : levels[0]!,
    values: levels.map((level) => ({ value: level, label: GUI_PERMISSION_LABELS[level] }))
  }
}

/** Figma 56: the 计划 switch, for an agent with a plan mode. */
export const planOption = (on: boolean): GuiConfigOption => ({
  id: 'plan',
  category: 'plan',
  label: '计划',
  current: on ? 'on' : 'off',
  values: [
    { value: 'off', label: '关' },
    { value: 'on', label: '开' }
  ]
})

/** Figma 56: reasoning effort in the same words for every agent; a level not listed keeps the agent's own name. */
const EFFORT_LABELS: Readonly<Record<string, string>> = { minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高' }
export const effortLabel = (value: string, own?: string): string => EFFORT_LABELS[value.toLowerCase()] ?? own ?? value

/** An entry of the `/` menu (Figma 49C), as the agent lists it. */
export interface GuiCommand {
  name: string
  description: string
  argumentHint?: string
}

export interface GuiState {
  items: ChatItem[]
  live: GuiLive | null
  prompts: GuiPrompt[]
  /** A turn is running (the stop button, the queue). */
  busy: boolean
  config: GuiConfigOption[]
  commands: GuiCommand[]
  /** Messages the user sent while a turn ran; sent, in order, when it ends (Figma 49″C). */
  queued: { id: string; text: string }[]
  /** The agent process could not start or died; shown above the composer. */
  failure: string | null
}

export type GuiEvent =
  /** Items added or changed, by index (the parser's indexes; new indexes append). */
  | { type: 'items'; changes: { index: number; item: ChatItem }[] }
  | { type: 'reset'; items: ChatItem[] }
  | { type: 'live'; live: GuiLive | null }
  | { type: 'prompt'; prompt: GuiPrompt }
  | { type: 'prompt-done'; id: string }
  | { type: 'busy'; busy: boolean }
  | { type: 'config'; config: GuiConfigOption[] }
  | { type: 'commands'; commands: GuiCommand[] }
  | { type: 'queued'; queued: GuiState['queued'] }
  | { type: 'failure'; failure: string | null }

/** What the renderer asks main to start or reattach (like `pty.spawn`, without a terminal size). */
export interface GuiLaunch {
  sessionId: string
  cwd: string
  agent: CliAgent
  /** Continue this earlier conversation (`agentSessionId`): Claude `--resume`, Codex `thread/resume`, ACP `session/load`. */
  resumeAgentSessionId?: string
  model?: string
  /** Sent as the first message once the agent is up (new session panel, F21 dispatch). */
  initialPrompt?: string
  /** Launched by F21 dispatch: `wavi` on PATH like a dispatched TUI. */
  dispatched?: boolean
  /**
   * Main only (an edit, never from a renderer): Claude resumes `resumeAgentSessionId` up to this message
   * (`--resume-session-at`), dropping what came after it.
   */
  resumeAt?: string
  /** Main only (a restart for a launch-argument permission, Figma 56): the level and 计划 to start with. */
  permission?: GuiPermission
  plan?: boolean
}

export type GuiOpenResult =
  /** `exited`: a reattach found the process already ended (while no app was attached); `state` shows why. */
  | { ok: true; state: GuiState; exited?: boolean }
  | { ok: false; reason: string }

/** An agent process the pipe host still holds: from before a restart (the pty daemon kept it) or a reload. */
export interface GuiLiveSession {
  sessionId: string
  /** It ended while no app was attached; opening it shows why. */
  exited: boolean
}

export type GuiSendResult = { ok: true; queued: boolean } | { ok: false; reason: string }

/** `window.tr.gui` (preload). Every call is checked in main: payload shape and that this window owns the session. */
export interface GuiApi {
  /** Starts the agent if it is not running (or reattaches to it) and returns the state to draw. */
  open(launch: GuiLaunch): Promise<GuiOpenResult>
  /** Text and attachment paths; queued while a turn runs (Figma 49″C). */
  send(sessionId: string, message: { text: string; attachments: string[] }): Promise<GuiSendResult>
  answer(sessionId: string, answer: GuiAnswer): Promise<boolean>
  interrupt(sessionId: string): Promise<boolean>
  setConfig(sessionId: string, optionId: string, value: string): Promise<boolean>
  /** Edits a queued message; an empty text removes it. */
  editQueued(sessionId: string, queuedId: string, text: string): Promise<boolean>
  /**
   * Asks again from an earlier message of yours (Figma 54C): the conversation after it is dropped and `text` is sent
   * in its place. Claude only (`guiCanEdit`); not while a turn runs. The state to draw comes back.
   */
  edit(sessionId: string, messageId: string, text: string): Promise<GuiOpenResult>
  /** Ends the agent process (closing the session), also one this app run never opened. */
  stop(sessionId: string): Promise<void>
  /** Agent processes the pipe host holds that no other window owns (to adopt, or end, at load). */
  live(): Promise<GuiLiveSession[]>
  /** Events for sessions this window owns, batched per session. */
  onEvents(listener: (sessionId: string, events: GuiEvent[]) => void): () => void
}

export const GUI_IPC = {
  open: 'gui:open',
  send: 'gui:send',
  answer: 'gui:answer',
  interrupt: 'gui:interrupt',
  setConfig: 'gui:set-config',
  editQueued: 'gui:edit-queued',
  edit: 'gui:edit',
  stop: 'gui:stop',
  live: 'gui:live',
  /** main → renderer */
  events: 'gui:events'
} as const

/** An agent whose earlier messages can be edited (PRD F23 编辑): Claude resumes up to a message; Codex and ACP not yet. */
export const guiCanEdit = (agent: string): boolean => agent === 'claude'

export function emptyGuiState(): GuiState {
  return { items: [], live: null, prompts: [], busy: false, config: [], commands: [], queued: [], failure: null }
}

/** Folds one event into the state. Returns a new state object; unchanged parts keep their identity (cheap renders). */
export function applyGuiEvent(state: GuiState, event: GuiEvent): GuiState {
  switch (event.type) {
    case 'items': {
      if (event.changes.length === 0) return state
      const items = state.items.slice()
      for (const { index, item } of event.changes) {
        if (index < 0 || index > items.length) continue
        items[index] = item
      }
      return { ...state, items }
    }
    case 'reset':
      return { ...state, items: event.items.slice(), live: null }
    case 'live':
      return { ...state, live: event.live }
    case 'prompt':
      return { ...state, prompts: [...state.prompts.filter((p) => p.id !== event.prompt.id), event.prompt] }
    case 'prompt-done':
      return state.prompts.some((p) => p.id === event.id) ? { ...state, prompts: state.prompts.filter((p) => p.id !== event.id) } : state
    case 'busy':
      // A turn that ends takes its stream and its questions with it.
      return event.busy ? { ...state, busy: true } : { ...state, busy: false, live: null, prompts: [] }
    case 'config':
      return { ...state, config: event.config }
    case 'commands':
      return { ...state, commands: event.commands }
    case 'queued':
      return { ...state, queued: event.queued }
    case 'failure':
      return { ...state, failure: event.failure }
  }
}

/** The pickers shown under the composer, in a fixed order whatever order the agent lists them in. */
export function composerPickers(config: readonly GuiConfigOption[]): GuiConfigOption[] {
  // Figma 56: model · effort, 权限, 计划, then the agent's own mode and anything else.
  const order: GuiConfigOption['category'][] = ['model', 'thought_level', 'permission', 'plan', 'mode', 'other']
  return config.filter((o) => o.values.length > 1).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category))
}

/** `/` menu entries matching what is typed after the slash; prefix matches first, then the rest that contain it. */
export function matchCommands(commands: readonly GuiCommand[], typed: string, limit = 50): GuiCommand[] {
  const q = typed.replace(/^\//, '').toLowerCase()
  if (!q) return commands.slice(0, limit)
  const prefix: GuiCommand[] = []
  const rest: GuiCommand[] = []
  for (const c of commands) {
    const name = c.name.toLowerCase()
    if (name.startsWith(q)) prefix.push(c)
    else if (name.includes(q)) rest.push(c)
  }
  return [...prefix, ...rest].slice(0, limit)
}
