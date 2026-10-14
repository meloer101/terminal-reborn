// Pure per-session status reducer (PRD §3.1). No timers, no store: the renderer's StatusBridge feeds
// it signals and a clock. Hooks can drop events, so the reducer also knows how to self-heal.
import { currentAction } from './current-action'
import type { AgentEvent } from './agent-events'
import type { AgentKind, SessionStatus } from './types'

/** `running` with no hook event for this long, and an idle title, is treated as finished. */
export const SELF_HEAL_AFTER_MS = 3 * 60_000
/** A busy title right after an event is the tail of that event, not new work. */
const TITLE_SETTLE_MS = 2_000
const MESSAGE_MAX_CHARS = 80

export type Signal =
  | { type: 'event'; event: AgentEvent }
  /** The PTY process is gone. */
  | { type: 'pty-exit'; code: number }
  /** Terminal title (OSC 0/2). */
  | { type: 'title'; title: string }
  /** The session became visible with the window focused. */
  | { type: 'viewed' }
  /** The session is no longer being looked at (another session selected, or the window lost focus). */
  | { type: 'unviewed' }
  | { type: 'tick' }

export interface SessionState {
  kind: AgentKind
  status: SessionStatus
  /** Shown in the sidebar / header; cleared when the turn stops. */
  currentAction?: string
  /** Epoch ms of the last agent event; drives self-heal. */
  lastEventAt: number
  /** Epoch ms of the last sign of life; drives sorting. */
  lastActivityAt: number
  /** The user is looking at this session right now. */
  viewing: boolean
  /** The terminal title says the agent is idle (Claude: `✳` prefix). */
  titleIdle: boolean
  /** The action of the latest tool call, kept so `needs_you` can say what is being asked. */
  toolAction?: string
  /** The process has exited; nothing can change the state any more. */
  ended: boolean
}

export function initialState(
  kind: AgentKind,
  now: number,
  options: { status?: SessionStatus; currentAction?: string; viewing?: boolean; lastActivityAt?: number } = {}
): SessionState {
  const status = options.status ?? 'idle'
  return {
    kind,
    status: kind === 'shell' && status !== 'exited' ? 'idle' : status,
    currentAction: options.currentAction,
    lastEventAt: now,
    lastActivityAt: options.lastActivityAt ?? now,
    viewing: options.viewing ?? false,
    titleIdle: false,
    toolAction: options.currentAction,
    ended: status === 'exited'
  }
}

const IDLE_TITLE = /^✳/
const BUSY_TITLE = /^[⠀-⣿]/

function clip(text: string | undefined): string | undefined {
  if (!text) return undefined
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return undefined
  return flat.length > MESSAGE_MAX_CHARS ? `${flat.slice(0, MESSAGE_MAX_CHARS)}…` : flat
}

function running(state: SessionState, now: number, action: string | undefined): SessionState {
  return { ...state, status: 'running', currentAction: action, toolAction: action, lastEventAt: now, lastActivityAt: now }
}

function waiting(state: SessionState, now: number, action: string): SessionState {
  return { ...state, status: 'needs_you', currentAction: action, lastEventAt: now, lastActivityAt: now }
}

function reduceEvent(state: SessionState, event: AgentEvent, now: number): SessionState {
  const touched: SessionState = { ...state, lastEventAt: now, lastActivityAt: now }
  switch (event.type) {
    case 'session-start':
      // A fresh agent is idle; a restart after a failure clears the error. Compaction mid-turn stays running.
      return state.status === 'error' ? { ...touched, status: 'idle', currentAction: undefined, toolAction: undefined } : touched

    case 'prompt-submit':
      return running(state, now, undefined)

    case 'tool-start': {
      const action = currentAction(event.tool, event.input)
      if (event.tool === 'AskUserQuestion') return { ...waiting(state, now, action), toolAction: action }
      return running(state, now, action)
    }

    case 'tool-end':
      return running(state, now, state.toolAction)

    case 'notification':
      if (event.kind === 'permission') {
        return waiting(state, now, state.toolAction ? `等你确认：${state.toolAction}` : '等你确认')
      }
      if (event.kind === 'question') return waiting(state, now, state.toolAction ?? '等你回答')
      return touched

    case 'stop':
      return {
        ...touched,
        status: state.viewing ? 'idle' : 'done_unread',
        currentAction: undefined,
        toolAction: undefined
      }

    case 'stop-failure': {
      const message = clip(event.message)
      return { ...touched, status: 'error', currentAction: message, toolAction: undefined }
    }

    case 'session-end':
      return { ...touched, status: 'exited', currentAction: undefined, toolAction: undefined, ended: true }
  }
}

/** Next state for a signal at time `now` (epoch ms). Returns the same object when nothing changed. */
export function reduce(state: SessionState, signal: Signal, now: number): SessionState {
  if (state.ended) return state
  const agent = state.kind !== 'shell'

  switch (signal.type) {
    case 'event':
      return agent ? reduceEvent(state, signal.event, now) : state

    case 'pty-exit': {
      const crashed = signal.code !== 0 && agent && ['running', 'needs_you', 'error'].includes(state.status)
      return {
        ...state,
        status: crashed ? 'error' : 'exited',
        currentAction: crashed ? `进程异常退出，退出码 ${signal.code}` : undefined,
        toolAction: undefined,
        lastActivityAt: now,
        ended: true
      }
    }

    case 'title': {
      if (!agent) return state
      const titleIdle = IDLE_TITLE.test(signal.title)
      // Lowest-priority signal for "working": only when hooks have been quiet and we think we are idle.
      if (BUSY_TITLE.test(signal.title) && state.status === 'idle' && now - state.lastEventAt > TITLE_SETTLE_MS) {
        return { ...state, titleIdle: false, status: 'running', lastActivityAt: now }
      }
      return titleIdle === state.titleIdle ? state : { ...state, titleIdle }
    }

    case 'viewed': {
      const next = state.status === 'done_unread' ? { ...state, status: 'idle' as const } : state
      return next.viewing ? next : { ...next, viewing: true }
    }

    case 'unviewed':
      return state.viewing ? { ...state, viewing: false } : state

    case 'tick':
      if (state.status === 'running' && state.titleIdle && now - state.lastEventAt >= SELF_HEAL_AFTER_MS) {
        return { ...state, status: 'idle', currentAction: undefined, toolAction: undefined }
      }
      return state
  }
}
