// Pure per-session status reducer (PRD §3.1). No timers, no store: the renderer's StatusBridge feeds
// it signals and a clock. Hooks can drop events, so the reducer also knows how to self-heal.
import type { ProgramStatus } from './program-status'
import { currentAction } from './current-action'
import type { AgentEvent } from './agent-events'
import type { AgentMarker } from './agent-launch'
import { blockedAction, blockedReasonOf, readScreen, type BlockedReason } from './startup-screen'
import { toolCallKey } from './tool-call'
import type { AgentKind, AgentPhase, SessionStatus } from './types'

/**
 * Claude: `running` with an idle `✳` title and no hook event for this long is a turn that ended without a Stop
 * (Esc / Ctrl+C send no hook at all, verified against Claude Code 2.1.299). While a permission dialog is up the
 * title is idle too, but that state is `needs_you`, not `running`, so it is not touched.
 */
export const CLAUDE_IDLE_HEAL_MS = 6_000
/** An agent that shows nothing recognisable for this long after launch is handed to the user anyway. */
export const STARTUP_TIMEOUT_MS = 6_000
/** `needs_you` whose dialog is gone from the screen (answered in the TUI) for this long goes back to idle. */
export const NEEDS_YOU_HEAL_MS = 2_000
/** A busy title right after an event is the tail of that event, not new work. */
const TITLE_SETTLE_MS = 2_000
const MESSAGE_MAX_CHARS = 80
/**
 * Codex has no Interrupt / failure hook in 0.142.5: after Esc, Ctrl+C or a failed model request there is no
 * Stop. A turn whose title went idle and that has been silent this long is over (PRD §6.7).
 */
export const CODEX_IDLE_HEAL_MS = 4_000
/**
 * An agent that starts another tool call this long after asking about one has had that ask settled. A denial in the
 * TUI sends no PostToolUse (Claude 2.1.304: the call never runs) and the agent carries on after one with feedback, as
 * a subagent always does; the next call needs the user to answer and the model to reply, so it comes seconds later.
 * Calls of one batch start together: their PreToolUse hooks arrive within a few hook round trips (tens of ms).
 */
export const ASK_SETTLE_MS = 1_500

/**
 * Something the agent waits on the user for: a permission dialog or a question for one tool call (`key` =
 * toolCallKey), or a Notification that names no call (`key` = ''). `agent` is the subagent that asked, '' for the
 * main thread. The TUI queues them and shows the oldest first.
 */
export interface Ask {
  key: string
  agent: string
  label: string
  at: number
}

/** What a session does apart from its asks: its status once the last ask is answered. */
export interface Underneath {
  status: SessionStatus
  action?: string
}

export type Signal =
  | { type: 'event'; event: AgentEvent }
  /** The PTY process is gone. */
  | { type: 'pty-exit'; code: number }
  /** Terminal title (OSC 0/2). */
  | { type: 'title'; title: string }
  /** The program's own state on the terminal (OSC 7501 Program Status, src/shared/program-status.ts). */
  | { type: 'program-status'; status: ProgramStatus }
  /** The session became visible with the window focused. */
  | { type: 'viewed' }
  /** The session is no longer being looked at (another session selected, or the window lost focus). */
  | { type: 'unviewed' }
  | { type: 'tick' }
  /** The agent is (re)started in this session: fresh state, phase `starting`. No-op for sessions without a phase. */
  | { type: 'launch' }
  /** The PTY could not be started at all (missing directory, spawn error). */
  | { type: 'launch-failed' }
  /** The launch script's OSC marker: the agent process ended, or the CLI is not installed. */
  | { type: 'agent-marker'; marker: AgentMarker }
  /** The session's visible terminal text, fed while the screen can change the state (startup, dialogs). */
  | { type: 'screen'; text: string }
  /** The hook watchdog reports silence after launch (the agent may be blocked, or hooks cannot reach us). */
  | { type: 'hooks-silent' }
  /**
   * After an app restart the session's agent was still in the pty daemon: it is up (`ready`), or its terminal ended
   * while the app was closed (`exited`). Only moves a `not-started` session.
   */
  | { type: 'reattached'; exited: boolean }

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
  /** The PTY has exited; nothing can change the state any more (except a new launch). */
  ended: boolean
  /** Agent process lifecycle (undefined = not tracked: shells and fixture sessions). */
  phase?: AgentPhase
  /** Epoch ms when the phase last changed; the startup timeout counts from here. */
  phaseSince: number
  /** What `blocked` is waiting for. */
  blocked?: BlockedReason
  /** Some hook event has arrived since the launch. */
  hooksSeen: boolean
  /** The agent is up but its hooks never reported (Claude): status can only follow the terminal title. */
  hooksSilent: boolean
  /** Since when a `needs_you` session's input footer has been back on screen (it was answered in the TUI). */
  footerSince?: number
  /** Codex and the CLIs without hooks: `running` was inferred from a busy title alone (no hook event has confirmed it since). */
  titleRun?: boolean
  /** The CLI reports its state with OSC 7501: that wins over its title (hooks still win over both). */
  programStatus?: boolean
  /** Codex only: `needs_you` was inferred from the `Action Required` title (its own approval dialog is up). */
  titleAction?: boolean
  /** One line of the agent's last reply (see replyLine); cleared when a new prompt starts a turn. */
  lastReply?: string
  /** Epoch ms the last turn finished (Stop). */
  finishedAt?: number
  /** Epoch ms `status` last changed. */
  statusSince: number
  /** Epoch ms the current turn began: `running` entered from anything but `needs_you`. */
  turnStartedAt?: number
  /** Pending asks, oldest first; `needs_you` holds while any is left (PRD §3.1). */
  asks: Ask[]
  /** While asks are pending: what the session goes back to once they are answered. */
  under?: Underneath
  /**
   * The TUI's title showed a dialog since the newest ask (Claude's `✳`, Codex's `Action Required`). A busy title
   * after that means every dialog was answered: Claude 2.1.304 animates its title only while it works with no
   * dialog up, and runs an approved tool without a hook until its PostToolUse (a long build would stay needs_you).
   * A busy frame from before the dialog, parsed late, comes before this is set and is ignored.
   */
  dialogSeen?: boolean
}

export function initialState(
  kind: AgentKind,
  now: number,
  options: {
    status?: SessionStatus
    currentAction?: string
    viewing?: boolean
    lastActivityAt?: number
    phase?: AgentPhase
    lastReply?: string
    finishedAt?: number
    statusSince?: number
  } = {}
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
    ended: status === 'exited',
    ...(kind !== 'shell' && options.phase ? { phase: options.phase } : {}),
    phaseSince: now,
    hooksSeen: false,
    hooksSilent: false,
    ...(options.lastReply ? { lastReply: options.lastReply } : {}),
    ...(options.finishedAt !== undefined ? { finishedAt: options.finishedAt } : {}),
    statusSince: options.statusSince ?? options.lastActivityAt ?? now,
    asks: []
  }
}

const IDLE_TITLE = /^✳/
/** Braille frames (older Claude / Codex) and the quarter-circle frames Claude Code 2.1.x animates. */
const BUSY_TITLE = /^[⠀-⣿◐◑◒◓]/
/** Codex blinks `[ . ] Action Required | <dir>` / `[ ! ] …` while its own approval or question dialog is up. */
const CODEX_ACTION_TITLE = /^\[ [.!] \] Action Required/

function clip(text: string | undefined): string | undefined {
  if (!text) return undefined
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return undefined
  return flat.length > MESSAGE_MAX_CHARS ? `${flat.slice(0, MESSAGE_MAX_CHARS)}…` : flat
}

/**
 * The line of a reply worth showing in one row: its last non-empty line, without Markdown markers
 * (headings, list bullets, quotes, emphasis), whitespace collapsed and clipped.
 */
export function replyLine(text: string | undefined): string | undefined {
  if (!text) return undefined
  const line = text
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+[.)]\s+)/, '')
        .replace(/(\*\*|__|`)/g, '')
        .trim()
    )
    .filter((l) => l !== '' && !/^[-*_=`~]{3,}$/.test(l))
    .pop()
  return clip(line)
}

function running(state: SessionState, now: number, action: string | undefined): SessionState {
  return { ...state, status: 'running', currentAction: action, toolAction: action, lastEventAt: now, lastActivityAt: now, asks: NO_ASKS, under: undefined }
}

const NO_ASKS: Ask[] = []

/** `needs_you` names the oldest ask (the one the TUI shows) and how many wait. */
function askLabel(asks: Ask[]): string {
  const first = asks[0]
  if (!first) return '等你确认'
  return asks.length > 1 ? `${first.label}（共 ${asks.length} 项）` : first.label
}

/** What the session is doing apart from its asks. */
function underneath(state: SessionState): Underneath {
  if (state.status !== 'needs_you') return { status: state.status, action: state.currentAction }
  return state.under ?? { status: 'running', action: state.toolAction }
}

/**
 * Adds an ask (once per call). A main-thread call that asks proves the main turn runs; a subagent's or an unnamed
 * one keeps whatever the session was doing, so a background agent asking after the turn ended returns it there.
 */
function addAsk(state: SessionState, ask: Ask, now: number): SessionState {
  const known = ask.key !== '' ? state.asks.some((a) => a.agent === ask.agent && a.key === ask.key) : state.asks.some((a) => a.agent === ask.agent && a.key === '')
  const asks = known ? state.asks : [...state.asks, ask]
  const under: Underneath = ask.key !== '' && ask.agent === '' ? { status: 'running', action: state.toolAction } : underneath(state)
  // Claude's title is `✳` while a dialog is up; one already idle may be that dialog's.
  const dialogSeen = known ? state.dialogSeen : state.kind === 'claude' && state.titleIdle
  return { ...state, status: 'needs_you', asks, under, dialogSeen, currentAction: askLabel(asks), lastEventAt: now, lastActivityAt: now }
}

/** A busy title after the dialog was seen: every ask was answered and the agent works again. */
function dialogsAnswered(state: SessionState, now: number): SessionState | null {
  if (state.status !== 'needs_you' || state.asks.length === 0 || !state.dialogSeen) return null
  const under = state.under?.status === 'running' ? state.under.action : undefined
  return { ...state, status: 'running', currentAction: under ?? state.toolAction, asks: NO_ASKS, under: undefined, dialogSeen: false, titleIdle: false, lastActivityAt: now }
}

/** The asks left after some were answered: still `needs_you`, or back to what the session does underneath. */
function withAsks(state: SessionState, asks: Ask[]): SessionState {
  if (asks.length > 0) return { ...state, status: 'needs_you', asks, currentAction: askLabel(asks) }
  if (state.status !== 'needs_you') return state.asks.length === 0 ? state : { ...state, asks: NO_ASKS, under: undefined }
  const under = underneath(state)
  return { ...state, status: under.status, currentAction: under.action, asks: NO_ASKS, under: undefined }
}

/**
 * Nothing waits on the user and no turn runs (the idle footer is back, Claude's idle_prompt, Codex's idle title):
 * idle, or what a finished turn left underneath its asks (unread reply, error).
 */
function settledIdle(state: SessionState): SessionState {
  const under = state.status === 'needs_you' ? state.under : undefined
  const status: SessionStatus = under && (under.status === 'done_unread' || under.status === 'error') ? under.status : 'idle'
  return { ...state, status, currentAction: status === 'error' ? under?.action : undefined, toolAction: undefined, asks: NO_ASKS, under: undefined }
}

/** Asks the agent's own calls no longer back: the oldest ask of this call, else (input rewritten) of this tool. */
function answered(asks: Ask[], agent: string, tool: string, input: Record<string, unknown>): Ask[] {
  if (asks.length === 0) return asks
  const key = toolCallKey(tool, input)
  let at = asks.findIndex((a) => a.agent === agent && a.key === key)
  if (at < 0) at = asks.findIndex((a) => a.agent === agent && a.key.startsWith(`${tool}:`))
  const left = at < 0 ? asks : asks.filter((_, i) => i !== at)
  // A main-thread call also answers what a Notification asked without naming a call.
  return agent === '' ? left.filter((a) => !(a.agent === '' && a.key === '')) : left
}

function reduceEvent(state: SessionState, event: AgentEvent, now: number): SessionState {
  const touched: SessionState = { ...state, lastEventAt: now, lastActivityAt: now }
  switch (event.type) {
    case 'session-start':
      // A fresh agent is idle; a restart after a failure clears the error. Compaction mid-turn stays running.
      return state.status === 'error' || state.status === 'exited'
        ? { ...touched, status: 'idle', currentAction: undefined, toolAction: undefined, asks: NO_ASKS, under: undefined }
        : touched

    case 'prompt-submit': {
      // A new turn: a dialog of the main thread cannot be up while a prompt is sent. A subagent's still may be.
      const asks = state.asks.filter((a) => a.agent !== '')
      if (asks.length === 0) return { ...running(state, now, undefined), lastReply: undefined }
      return { ...touched, status: 'needs_you', asks, currentAction: askLabel(asks), under: { status: 'running' }, toolAction: undefined, lastReply: undefined }
    }

    case 'tool-start': {
      const action = currentAction(event.tool, event.input)
      const agent = event.agentId ?? ''
      // Its own earlier asks are settled now (see ASK_SETTLE_MS); an unnamed one by any main-thread call.
      const asks = state.asks.filter((a) => a.agent !== agent || (a.key !== '' && now - a.at < ASK_SETTLE_MS))
      if (event.tool === 'AskUserQuestion') {
        return { ...addAsk({ ...withAsks(state, asks), lastEventAt: now }, { key: toolCallKey(event.tool, event.input), agent, label: action, at: now }, now), toolAction: action }
      }
      // A subagent's work says nothing about the main turn (it runs on after the turn ended); only its asks count.
      if (agent !== '') return asks.length === state.asks.length ? state : withAsks(state, asks)
      if (asks.length > 0) return { ...touched, asks, status: 'needs_you', currentAction: askLabel(asks), under: { status: 'running', action }, toolAction: action }
      return running(state, now, action)
    }

    case 'tool-end': {
      const agent = event.agentId ?? ''
      const asks = answered(state.asks, agent, event.tool, event.input)
      if (agent !== '') return asks.length === state.asks.length ? state : withAsks(state, asks)
      // Another ask still waits (a parallel call's, a subagent's): needs_you stays, the main turn runs underneath.
      if (asks.length > 0) return { ...touched, asks, status: 'needs_you', currentAction: askLabel(asks), under: { status: 'running', action: state.toolAction } }
      return running(state, now, state.toolAction)
    }

    case 'permission-request': {
      const label = `等你确认：${currentAction(event.tool, event.input)}`
      return addAsk(state, { key: toolCallKey(event.tool, event.input), agent: event.agentId ?? '', label, at: now }, now)
    }

    case 'subagent-stop': {
      const asks = state.asks.filter((a) => a.agent !== event.agentId)
      return asks.length === state.asks.length ? state : withAsks(state, asks)
    }

    case 'notification':
      if (event.kind === 'permission' || event.kind === 'question') {
        // Its PermissionRequest (about 6 s earlier) already named what is asked.
        if (state.asks.length > 0) return touched
        const label = event.kind === 'permission' ? (state.toolAction ? `等你确认：${state.toolAction}` : '等你确认') : (state.toolAction ?? '等你回答')
        return addAsk(state, { key: '', agent: '', label, at: now }, now)
      }
      // Claude sends idle_prompt only while its prompt is idle: no turn, no dialog up, no background agent (PRD §6.6).
      if (event.kind === 'idle' && (state.status === 'running' || state.status === 'needs_you')) return settledIdle(touched)
      return touched

    case 'stop': {
      const finished = { ...touched, currentAction: undefined, toolAction: undefined, lastReply: replyLine(event.message), finishedAt: now }
      const status: SessionStatus = state.viewing ? 'idle' : 'done_unread'
      // A background subagent may still wait on the user after the main turn ended.
      const asks = state.asks.filter((a) => a.agent !== '')
      if (asks.length > 0) return { ...finished, status: 'needs_you', asks, currentAction: askLabel(asks), under: { status } }
      return { ...finished, status, asks: NO_ASKS, under: undefined }
    }

    case 'stop-failure': {
      const message = clip(event.message)
      const asks = state.asks.filter((a) => a.agent !== '')
      if (asks.length > 0) return { ...touched, status: 'needs_you', asks, currentAction: askLabel(asks), under: { status: 'error', action: message }, toolAction: undefined }
      return { ...touched, status: 'error', currentAction: message, toolAction: undefined, asks: NO_ASKS, under: undefined }
    }

    case 'session-end':
      // /clear and /resume end the old conversation and start another a moment later (SessionStart revives it).
      if (event.reason === 'clear' || event.reason === 'resume') {
        return { ...touched, status: 'idle', currentAction: undefined, toolAction: undefined, asks: NO_ASKS, under: undefined }
      }
      // Only the PTY exiting is final: a SessionStart after this (a new agent in the same shell) revives the session.
      return {
        ...touched,
        status: 'exited',
        currentAction: undefined,
        toolAction: undefined,
        asks: NO_ASKS,
        under: undefined,
        ...(state.phase ? { phase: 'exited' as const, phaseSince: now, blocked: undefined } : {})
      }

    case 'agent-title':
    case 'context':
    case 'todos':
    case 'checks':
    case 'agent-exit':
    case 'billing':
      // A name or a metric, not activity: it can arrive well after the turn ended (and statusLine runs on its own).
      return state
  }
}

function launched(state: SessionState, now: number): SessionState {
  if (state.phase === undefined) return state
  return {
    ...state,
    status: 'idle',
    currentAction: undefined,
    toolAction: undefined,
    ended: false,
    phase: 'starting',
    phaseSince: now,
    blocked: undefined,
    hooksSeen: false,
    hooksSilent: false,
    footerSince: undefined,
    titleIdle: false,
    titleRun: false,
    titleAction: false,
    lastEventAt: now,
    lastActivityAt: now,
    asks: NO_ASKS,
    under: undefined
  }
}

function ready(state: SessionState, now: number): SessionState {
  return { ...state, phase: 'ready', phaseSince: now, blocked: undefined }
}

function sameReason(a: BlockedReason | undefined, b: BlockedReason): boolean {
  if (!a || a.kind !== b.kind) return false
  return a.kind === 'dialog' && b.kind === 'dialog' ? a.dialog === b.dialog : true
}

function blockedBy(state: SessionState, reason: BlockedReason, now: number): SessionState {
  if (state.phase === 'blocked' && sameReason(state.blocked, reason)) return state
  return {
    ...state,
    phase: 'blocked',
    phaseSince: now,
    blocked: reason,
    status: 'needs_you',
    currentAction: blockedAction(reason),
    lastActivityAt: now
  }
}

/** The agent's screen while it starts, is blocked by a first-run dialog, or waits on a dialog the TUI may have answered. */
function reduceScreen(state: SessionState, text: string, now: number): SessionState {
  const reading = readScreen(state.kind, text)
  const claude = state.kind === 'claude'

  if (state.phase === 'starting' || state.phase === 'blocked') {
    const reason = blockedReasonOf(reading)
    if (reason) return blockedBy(state, reason, now)
    const settled: SessionState =
      state.phase === 'blocked' ? { ...state, status: 'idle', currentAction: undefined, lastActivityAt: now } : state
    if (reading.agentUi) return ready(settled, now)
    if (state.phase === 'blocked') return { ...settled, phase: 'starting', phaseSince: now, blocked: undefined }
    // Nothing recognisable after a while: it is the user's terminal, so hand it over rather than lock the composer.
    if (!reading.blank && now - state.phaseSince >= STARTUP_TIMEOUT_MS) {
      return { ...ready(settled, now), hooksSilent: claude && !state.hooksSeen }
    }
    return state
  }

  if (state.phase === 'ready' || state.phase === undefined) {
    let next = state
    // A dialog no hook announced (its PermissionRequest and the Notification after it both lost, or hooks silent):
    // the title went idle mid-turn and the screen shows the dialog. Without hooks also a background agent's, after it.
    if (claude && state.titleIdle && reading.askDialog && (state.status === 'running' || (state.hooksSilent && (state.status === 'idle' || state.status === 'done_unread')))) {
      return addAsk(state, { key: '', agent: '', label: state.toolAction ? `等你确认：${state.toolAction}` : '等你确认', at: now }, now)
    }
    // Claude is up and its hooks stayed silent: the header says status follows the title only.
    if (claude && state.phase === 'ready' && !state.hooksSeen && !state.hooksSilent && now - state.phaseSince >= STARTUP_TIMEOUT_MS) {
      next = { ...next, hooksSilent: true }
    }
    // Claude: the dialog behind `needs_you` was answered in the TUI (no hook says so). The title is idle both while
    // the dialog is up and after it, so only the dialog's footer being replaced by the input footer is proof.
    if (claude && next.status === 'needs_you' && next.titleIdle && !next.titleAction) {
      if (reading.idleFooter) {
        if (next.footerSince === undefined) return { ...next, footerSince: now }
        if (now - next.footerSince >= NEEDS_YOU_HEAL_MS && now - next.lastEventAt >= NEEDS_YOU_HEAL_MS) {
          return { ...settledIdle(next), footerSince: undefined }
        }
      } else if (next.footerSince !== undefined) {
        return { ...next, footerSince: undefined }
      }
    }
    return next
  }
  return state
}

/** A finished-looking Codex turn (idle title, silent) that hooks never closed: back to idle. */
function healCodex(state: SessionState, now: number): SessionState {
  if (!state.titleIdle) return state
  const active = state.status === 'running' || state.status === 'needs_you'
  if (!active || now - state.lastEventAt < CODEX_IDLE_HEAL_MS) return state
  return { ...settledIdle(state), titleRun: false, titleAction: false }
}

/**
 * Codex title rules (PRD §6.7): braille spinner = busy, `Action Required` = its own dialog is up,
 * any other title = idle. Hooks stay authoritative; the title only fills their gaps (startup spinner, interrupts,
 * the TUI dialog after a hook hold timed out).
 */
function reduceCodexTitle(state: SessionState, title: string, now: number): SessionState {
  if (CODEX_ACTION_TITLE.test(title)) {
    if (state.status === 'needs_you' && state.asks.length > 0 && !state.dialogSeen) return { ...state, titleIdle: false, dialogSeen: true }
    if (state.status === 'needs_you' || state.status === 'exited') return state.titleIdle ? { ...state, titleIdle: false } : state
    if (state.status === 'error') return state
    return {
      ...state,
      titleIdle: false,
      status: 'needs_you',
      currentAction: state.toolAction ? `等你确认：${state.toolAction}` : '等你确认',
      under: underneath(state),
      titleAction: true,
      titleRun: false,
      lastActivityAt: now
    }
  }

  if (BUSY_TITLE.test(title)) {
    const answered = dialogsAnswered(state, now)
    if (answered) return answered
    // The dialog was answered (in the TUI): the turn goes on.
    if (state.titleAction && state.status === 'needs_you') {
      return { ...state, titleIdle: false, status: 'running', currentAction: state.toolAction, titleAction: false, lastActivityAt: now, asks: NO_ASKS, under: undefined }
    }
    if (state.status === 'idle' && now - state.lastEventAt > TITLE_SETTLE_MS) {
      return { ...state, titleIdle: false, status: 'running', titleRun: true, lastActivityAt: now }
    }
    return state.titleIdle ? { ...state, titleIdle: false } : state
  }

  // Idle title.
  const idle: SessionState = state.titleIdle ? state : { ...state, titleIdle: true }
  if (idle.titleRun && idle.status === 'running') {
    return { ...idle, status: 'idle', currentAction: undefined, toolAction: undefined, titleRun: false }
  }
  if (idle.titleAction && idle.status === 'needs_you') {
    return { ...settledIdle(idle), titleAction: false }
  }
  return healCodex(idle, now)
}

/**
 * Every CLI but Claude and Codex (an estimate, 设置 · 智能体 says 估计): a braille / circle spinner first in the title is
 * a turn running, the spinner going away ends it. Their titles say nothing about dialogs. A CLI that reports OSC 7501,
 * or whose hooks reported lately, is not second-guessed by its title.
 */
function reduceOtherTitle(state: SessionState, title: string, now: number): SessionState {
  if (state.programStatus) return state
  if (BUSY_TITLE.test(title)) {
    if ((state.status === 'idle' || state.status === 'done_unread') && now - state.lastEventAt > TITLE_SETTLE_MS) {
      return { ...state, titleIdle: false, status: 'running', titleRun: true, lastActivityAt: now, lastReply: undefined }
    }
    return state.titleIdle ? { ...state, titleIdle: false } : state
  }
  const idle: SessionState = state.titleIdle ? state : { ...state, titleIdle: true }
  if (idle.titleRun && idle.status === 'running') {
    return { ...idle, status: idle.viewing ? 'idle' : 'done_unread', currentAction: undefined, toolAction: undefined, titleRun: false, finishedAt: now, lastActivityAt: now }
  }
  return idle
}

/**
 * OSC 7501: the CLI says what it is doing. `working` runs a turn, `blocked` waits on the user (its own dialog),
 * `done` finished one (unread unless looked at), `error` failed it, `idle` / `clear` is nothing going on. Hook events
 * stay authoritative for the CLIs that have both; this only moves a session whose hooks have been quiet.
 */
function reduceProgramStatus(state: SessionState, status: ProgramStatus, now: number): SessionState {
  const marked: SessionState = state.programStatus ? state : { ...state, programStatus: true }
  const up = marked.phase === 'starting' || marked.phase === 'blocked' ? ready(marked, now) : marked
  if (state.hooksSeen && now - state.lastEventAt < TITLE_SETTLE_MS) return up
  switch (status.state) {
    case 'working':
      if (up.status === 'running' && !up.asks.length) return up
      return { ...up, status: 'running', currentAction: status.message ?? up.toolAction, asks: NO_ASKS, under: undefined, titleRun: false, lastActivityAt: now, ...(up.status === 'needs_you' ? {} : { lastReply: undefined }) }
    case 'blocked': {
      const label = status.message ?? (status.kind === 'question' ? '等你回答' : status.kind === 'auth' ? '等你登录' : up.toolAction ? `等你确认：${up.toolAction}` : '等你确认')
      if (up.status === 'needs_you' && up.currentAction === label) return up
      return { ...up, status: 'needs_you', currentAction: label, under: up.status === 'needs_you' ? up.under : underneath(up), lastActivityAt: now }
    }
    case 'done':
      return { ...up, status: up.viewing ? 'idle' : 'done_unread', currentAction: undefined, toolAction: undefined, asks: NO_ASKS, under: undefined, titleRun: false, finishedAt: now, lastActivityAt: now }
    case 'error':
      return { ...up, status: 'error', currentAction: status.message ?? '出错了', asks: NO_ASKS, under: undefined, titleRun: false, lastActivityAt: now }
    case 'idle':
    case 'clear':
      if (up.status === 'idle' || up.status === 'done_unread' || up.status === 'error') return up
      return { ...up, status: 'idle', currentAction: undefined, toolAction: undefined, asks: NO_ASKS, under: undefined, titleRun: false }
    default:
      return up
  }
}

/** Next state for a signal at time `now` (epoch ms). Returns the same object when nothing changed. */
export function reduce(state: SessionState, signal: Signal, now: number): SessionState {
  const next = reduceSignal(state, signal, now)
  if (next === state || next.status === state.status) return next
  // Answering a question resumes the same turn; anything else entering `running` starts a new one.
  const turn = next.status === 'running' && state.status !== 'needs_you' ? { turnStartedAt: now } : {}
  return { ...next, statusSince: now, ...turn }
}

function reduceSignal(state: SessionState, signal: Signal, now: number): SessionState {
  if (signal.type === 'launch') return launched(state, now)
  if (state.ended) return state
  const agent = state.kind !== 'shell'

  switch (signal.type) {
    case 'event': {
      if (!agent) return state
      // Nothing is running yet; a stale event must not start a session that has not been started.
      if (state.phase === 'not-started') return state
      // After the agent exited only a SessionStart (a new agent in the same shell) means anything.
      if (state.phase === 'exited' && signal.event.type !== 'session-start') return state
      const waking = state.phase === 'starting' || state.phase === 'blocked' || state.phase === 'exited'
      const base: SessionState = waking
        ? {
            ...ready(state, now),
            ...(state.phase !== 'starting' && state.status !== 'error' ? { status: 'idle' as const, currentAction: undefined, asks: NO_ASKS, under: undefined } : {})
          }
        : state
      const reduced = reduceEvent(base, signal.event, now)
      // A subagent's call that changed nothing (it does not wait on the user) leaves the session untouched.
      if (reduced === base && !waking) return state
      const next = { ...reduced, hooksSeen: true, hooksSilent: false, footerSince: undefined }
      // A hook event is authoritative: whatever the title alone had inferred is settled now.
      return state.titleRun || state.titleAction ? { ...next, titleRun: false, titleAction: false } : next
    }

    case 'launch-failed':
      return state.phase === undefined
        ? state
        : { ...state, status: 'exited', currentAction: undefined, toolAction: undefined, phase: 'exited', phaseSince: now, blocked: undefined, asks: NO_ASKS, under: undefined }

    case 'agent-marker': {
      if (!agent || state.phase === undefined) return state
      const { marker } = signal
      const crashed =
        marker.type === 'exit' &&
        marker.code !== 0 &&
        (['running', 'needs_you', 'error'].includes(state.status) || state.phase === 'starting' || state.phase === 'blocked')
      return {
        ...state,
        status: crashed ? 'error' : 'exited',
        currentAction: crashed && marker.type === 'exit' ? `进程异常退出，退出码 ${marker.code}` : undefined,
        toolAction: undefined,
        phase: 'exited',
        phaseSince: now,
        blocked: undefined,
        lastActivityAt: now,
        asks: NO_ASKS,
        under: undefined
      }
    }

    case 'screen':
      return agent ? reduceScreen(state, signal.text, now) : state

    case 'reattached':
      if (state.phase !== 'not-started') return state
      return signal.exited
        ? { ...state, status: 'exited', currentAction: undefined, toolAction: undefined, ended: true, phase: 'exited', phaseSince: now, blocked: undefined, asks: NO_ASKS, under: undefined }
        : // Its hooks reported in the run that launched it; a quiet idle agent is not a silent-hooks one.
          { ...state, phase: 'ready', phaseSince: now, hooksSeen: true }

    case 'hooks-silent':
      return state.kind === 'claude' && state.phase === 'ready' && !state.hooksSeen && !state.hooksSilent
        ? { ...state, hooksSilent: true }
        : state

    case 'pty-exit': {
      const crashed = signal.code !== 0 && agent && ['running', 'needs_you', 'error'].includes(state.status)
      return {
        ...state,
        status: crashed ? 'error' : 'exited',
        currentAction: crashed ? `进程异常退出，退出码 ${signal.code}` : undefined,
        toolAction: undefined,
        lastActivityAt: now,
        ended: true,
        asks: NO_ASKS,
        under: undefined,
        ...(state.phase ? { phase: 'exited' as const, phaseSince: now, blocked: undefined } : {})
      }
    }

    case 'title': {
      if (!agent) return state
      // Before the agent is up (or after it left) titles come from the shell around it.
      if (state.phase === 'not-started' || state.phase === 'exited') return state
      if (state.phase === 'starting' || state.phase === 'blocked') {
        // Claude's own title (`✳` idle, a spinner frame busy) proves its UI is up. Codex titles are not distinctive.
        if (state.kind === 'claude' && state.phase === 'starting' && (IDLE_TITLE.test(signal.title) || BUSY_TITLE.test(signal.title))) {
          return { ...ready(state, now), titleIdle: IDLE_TITLE.test(signal.title) }
        }
        return state
      }
      if (state.kind === 'codex') return reduceCodexTitle(state, signal.title, now)
      if (state.kind !== 'claude') return reduceOtherTitle(state, signal.title, now)
      const titleIdle = IDLE_TITLE.test(signal.title)
      if (BUSY_TITLE.test(signal.title)) {
        const answered = dialogsAnswered(state, now)
        if (answered) return answered
      } else if (titleIdle && state.asks.length > 0 && !state.dialogSeen) {
        return { ...state, titleIdle, dialogSeen: true }
      }
      // Lowest-priority signal for "working": only when hooks have been quiet and we think we are idle.
      if (BUSY_TITLE.test(signal.title) && state.status === 'idle' && now - state.lastEventAt > TITLE_SETTLE_MS) {
        return { ...state, titleIdle: false, status: 'running', lastActivityAt: now }
      }
      return titleIdle === state.titleIdle ? state : { ...state, titleIdle }
    }

    case 'program-status':
      if (!agent || state.ended || state.phase === 'not-started' || state.phase === 'exited') return state
      return reduceProgramStatus(state, signal.status, now)

    case 'viewed': {
      // A reply the user now sees is read, also one waiting underneath a background agent's ask.
      const next =
        state.status === 'done_unread'
          ? { ...state, status: 'idle' as const }
          : state.under?.status === 'done_unread'
            ? { ...state, under: { status: 'idle' as const } }
            : state
      return next.viewing ? next : { ...next, viewing: true }
    }

    case 'unviewed':
      return state.viewing ? { ...state, viewing: false } : state

    case 'tick':
      if (state.kind === 'codex') {
        const healed = healCodex(state, now)
        if (healed !== state) return healed
      }
      if (state.status === 'running' && state.titleIdle && now - state.lastEventAt >= CLAUDE_IDLE_HEAL_MS) {
        return { ...state, status: 'idle', currentAction: undefined, toolAction: undefined, asks: NO_ASKS, under: undefined }
      }
      return state
  }
}

/** A tick can heal the session: a running turn (Claude's idle-title heal), a Codex wait (Esc on its own dialog). */
export function healsOnTick(state: SessionState): boolean {
  return state.status === 'running' || (state.kind === 'codex' && state.status === 'needs_you')
}

/** Whether the session needs the 1 s tick: a tick can heal it, or its screen can change its state. */
export function ticksFast(state: SessionState): boolean {
  return healsOnTick(state) || watchesScreen(state)
}

/** Whether the session's terminal screen can change its state right now (the controller reads it only then). */
export function watchesScreen(state: SessionState): boolean {
  if (state.phase === 'starting' || state.phase === 'blocked') return true
  if (state.kind !== 'claude') return false
  if (state.phase === 'ready' && !state.hooksSeen && !state.hooksSilent) return true
  if (!state.titleIdle) return false
  // An idle title while waiting (has the dialog gone?) or mid-turn (is a dialog up that no hook announced?); with
  // silent hooks also between turns (a background agent's dialog).
  if (state.status === 'needs_you' || state.status === 'running') return true
  return state.hooksSilent && (state.status === 'idle' || state.status === 'done_unread')
}
