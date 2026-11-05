// A GUI session's conversation (PRD F23, Figma 49″): what main sends the renderer and how the renderer folds it.
// Main runs the agent headless (Claude `-p` stream-json, `codex app-server`, ACP) and turns its messages into
// `GuiEvent`s; `applyGuiEvent` folds them into a `GuiState` the chat view draws. Finished conversation items reuse
// the phone's `ChatItem` (@shared/transcript-chat), so history read back from a transcript and a live session look
// the same. Pure: no Electron, no Node.

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

/** A picker under the composer (Figma 49″C): model, mode, reasoning effort, as the agent offers them. */
export interface GuiConfigOption {
  id: string
  category: 'model' | 'mode' | 'thought_level' | 'other'
  label: string
  current: string
  values: { value: string; label: string }[]
}

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
  const order: GuiConfigOption['category'][] = ['model', 'thought_level', 'mode', 'other']
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
