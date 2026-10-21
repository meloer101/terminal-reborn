// 额度恢复后继续 (PRD F11): a plan limit stopped an agent's turn, and the user asked Wavi to type 继续 into that session
// once the limit resets. Pure: which sessions the limit stopped, when the send is due, whether the usage and the screen
// allow it, and the copy. The renderer's limit-resume bridge owns the timer and the send. Measurements: PRD §6.6 / §6.7.
import { formatClock, VENDOR_LABEL, type UsageVendor, type UsageWindow, type VendorUsage } from './session-meta'
import type { AgentKind, AgentPhase, SessionStatus } from './types'

/** What Wavi types (then Enter), the same word as the error bar's 重试这一轮. */
export const RESUME_PROMPT = '继续'

export interface ResumeTiming {
  /** The send is due this long after the reset: the vendor's clock against ours, and the agent's own continue goes first. */
  marginMs: number
  /** Once due, how long to wait for a usage reading taken after the reset before trusting the reset time alone. */
  freshWaitMs: number
  /** How often to look again while waiting for that reading. */
  pollMs: number
}

export const RESUME_TIMING: ResumeTiming = { marginMs: 60_000, freshWaitMs: 45_000, pollMs: 5_000 }

/** The parts of a session the stop is read from. */
export interface StopView {
  kind: AgentKind
  status: SessionStatus
  phase?: AgentPhase
  finishedAt?: number
  turnStartedAt?: number
}

/** The StopFailure that ended the session's current turn (Claude), as the bridge saw it. */
export interface StopFailure {
  reason?: string
  message?: string
}

/**
 * Whether the session stopped the way a plan limit stops it, whatever the usage says now:
 * - Claude: in `error` from a StopFailure whose error is `rate_limit` (it also covers transient 429s: hence the usage);
 * - Codex: no Stop for a failed turn (§6.7), so the turn began, never finished, and the title went back to idle.
 */
export function stoppedLikeLimit(session: StopView, failure: StopFailure | undefined): boolean {
  if (session.phase !== undefined && session.phase !== 'ready') return false
  if (session.kind === 'claude') return session.status === 'error' && failure?.reason === 'rate_limit'
  if (session.kind === 'codex') {
    if (session.status !== 'idle' && session.status !== 'done_unread') return false
    return session.turnStartedAt !== undefined && (session.finishedAt ?? 0) < session.turnStartedAt
  }
  return false
}

/** Used-up windows that still hold: at 100 % and not reset yet (without a reset time it holds until a reading says otherwise). */
function usedUp(usage: VendorUsage | undefined, now: number): UsageWindow[] {
  if (!usage) return []
  return usage.windows.filter((w) => w.percent >= 100 && (w.resetsAt === undefined || w.resetsAt > now))
}

/**
 * The used-up windows that stopped the session. A per-model weekly limit (`7 天 · Sonnet`) only counts when Claude named
 * it (`You've hit your Sonnet limit`) or no account-wide window is used up: another model's limit does not stop this one.
 */
export function bindingWindows(usage: VendorUsage | undefined, message: string | undefined, now: number): UsageWindow[] {
  const all = usedUp(usage, now)
  const wide = all.filter((w) => w.scope === undefined)
  const named = all.filter((w) => w.scope !== undefined && message !== undefined && message.toLowerCase().includes(`${w.scope.toLowerCase()} limit`))
  const binding = [...wide, ...named]
  return binding.length > 0 ? binding : all
}

/** The latest reset among `windows` (the session can only go on once all of them reset); null if one has no reset time. */
function latestReset(windows: readonly UsageWindow[]): { at: number; window: UsageWindow } | null {
  let latest: { at: number; window: UsageWindow } | null = null
  for (const w of windows) {
    if (w.resetsAt === undefined) return null
    if (!latest || w.resetsAt > latest.at) latest = { at: w.resetsAt, window: w }
  }
  return latest
}

export interface LimitStopInput {
  session: StopView
  failure?: StopFailure
  /** The session runs off its vendor's plan (a third-party endpoint, PRD v1.46): the account's usage is not its own. */
  offPlan: boolean
  /** The account's usage for the session's vendor. */
  usage: VendorUsage | undefined
  now: number
}

/** A session the plan limit stopped, and when the limit lets it go on. */
export interface LimitStop {
  vendor: UsageVendor
  /** Epoch ms when the windows that stopped it have all reset. */
  resetsAt: number
  /** The window that resets last (the one the copy names). */
  window: UsageWindow
}

export function limitStop(input: LimitStopInput): LimitStop | null {
  const { session } = input
  if (input.offPlan || (session.kind !== 'claude' && session.kind !== 'codex')) return null
  if (!stoppedLikeLimit(session, input.failure)) return null
  const reset = latestReset(bindingWindows(input.usage, input.failure?.message, input.now))
  if (!reset) return null
  return { vendor: session.kind, resetsAt: reset.at, window: reset.window }
}

// ---------------------------------------------------------------------------------------------
// The scheduled send
// ---------------------------------------------------------------------------------------------

/** The user's request for one session. */
export interface ResumePlan {
  vendor: UsageVendor
  /** Epoch ms of the reset the send waits for (moves later when a reading says the limit still holds). */
  resetsAt: number
  /** Epoch ms of the click. */
  armedAt: number
}

/** When the send is due (what the armed button shows). */
export function resumeDueAt(plan: Pick<ResumePlan, 'resetsAt'>, timing: ResumeTiming = RESUME_TIMING): number {
  return plan.resetsAt + timing.marginMs
}

/**
 * What the bottom of the agent's screen allows:
 * - ready: its plain input line (Claude `❯`, Codex `›`) and nothing over it;
 * - dialog: a menu or confirmation over it — Claude's `/rate-limit-options` ("What do you want to do?") or a permission
 *   dialog, Codex's "Switch to a cheaper model?" pop-up. Typing 继续 + Enter there picks an option instead (§6.7: it
 *   switched the model);
 * - agent-continues: Claude counts down to continuing by itself (`autoContinueAtUsageLimit`, §6.6);
 * - unknown: no input line in sight.
 */
export type ResumeScreen = 'ready' | 'dialog' | 'agent-continues' | 'unknown'

const SCREEN_TAIL_LINES = 12
// Footers of Claude's dialogs (not "Do you want to…": a reply in prose says that too) and the limit dialog's title.
const CLAUDE_DIALOG = /What do you want to do\?|Esc to cancel|Enter to (?:select|confirm)/
const CODEX_DIALOG = /Press enter to confirm|esc to go back|Enter to confirm/i
const AGENT_CONTINUES = /continuing automatically|will continue automatically|Continuing shortly/i
const INPUT_LINE = /^\s*[❯>›](?:\s|$)/m

export function resumeScreen(kind: AgentKind, viewport: string): ResumeScreen {
  const tail = viewport
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-SCREEN_TAIL_LINES)
    .join('\n')
  if ((kind === 'codex' ? CODEX_DIALOG : CLAUDE_DIALOG).test(tail)) return 'dialog'
  if (kind === 'claude' && AGENT_CONTINUES.test(tail)) return 'agent-continues'
  return INPUT_LINE.test(tail) ? 'ready' : 'unknown'
}

export type HoldReason = 'dialog' | 'agent-continues' | 'still-limited'

export type ResumeDecision =
  /** Look again at `at`; `refresh` = ask main for the account's usage now (it keeps its own minimum gaps). */
  | { kind: 'wait'; at: number; refresh: boolean }
  /** A reading taken after the reset says the limit still holds until `resetsAt`: wait for that one. */
  | { kind: 'postpone'; resetsAt: number }
  | { kind: 'send' }
  /** The session left the limit stop (it went on, was answered, restarted): the request is void. */
  | { kind: 'cancel' }
  /** Due, but sending now would not do what the button said: drop the request and tell the user. */
  | { kind: 'hold'; reason: HoldReason }

export interface ResumeCheck {
  now: number
  /** stoppedLikeLimit() now. */
  stopped: boolean
  usage: VendorUsage | undefined
  /** The StopFailure text (Claude), to tell which windows stopped it. */
  message?: string
  screen: ResumeScreen
}

export function decideResume(plan: ResumePlan, check: ResumeCheck, timing: ResumeTiming = RESUME_TIMING): ResumeDecision {
  if (!check.stopped) return { kind: 'cancel' }
  const due = resumeDueAt(plan, timing)
  if (check.now < due) return { kind: 'wait', at: due, refresh: false }
  const still = bindingWindows(check.usage, check.message, check.now)
  if (still.length > 0) {
    const later = latestReset(still)
    return later ? { kind: 'postpone', resetsAt: later.at } : { kind: 'hold', reason: 'still-limited' }
  }
  // The reset time has passed; a reading from after it confirms the limit is really gone. Without one for a while
  // (the account is not polled, the CLI is logged in with an API key), the passed reset time is all there is.
  const fresh = check.usage !== undefined && check.usage.at >= plan.resetsAt
  const deadline = due + timing.freshWaitMs
  if (!fresh && check.now < deadline) return { kind: 'wait', at: Math.min(check.now + timing.pollMs, deadline), refresh: true }
  if (check.screen === 'agent-continues') return { kind: 'hold', reason: 'agent-continues' }
  if (check.screen !== 'ready') return { kind: 'hold', reason: 'dialog' }
  return { kind: 'send' }
}

// ---------------------------------------------------------------------------------------------
// Typing
// ---------------------------------------------------------------------------------------------

/**
 * What xterm sends on its own, not the user's keys: focus in / out, mouse reports (a wheel scroll is not typing),
 * cursor position and device attribute replies, OSC / DCS replies.
 */
// eslint-disable-next-line no-control-regex
const TERMINAL_REPLIES = /\x1b\[[IO]|\x1b\[<[\d;]*[Mm]|\x1b\[M[\s\S]{3}|\x1b\[\d+;\d+R|\x1b\[[?>][\d;]*c|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[\s\S]*?\x1b\\/g

/** Whether terminal input is the user typing (any key, paste or Esc) — which cancels the scheduled send. */
export function isTypedInput(data: string): boolean {
  return data.replace(TERMINAL_REPLIES, '') !== ''
}

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

/** The button before the click. */
export const RESUME_BUTTON = `恢复后发送“${RESUME_PROMPT}”`

/** The armed button: when it will type 继续. */
export function armedLabel(plan: Pick<ResumePlan, 'resetsAt'>, now: number, timing: ResumeTiming = RESUME_TIMING): string {
  return `${formatClock(resumeDueAt(plan, timing), now)} 发送“${RESUME_PROMPT}”`
}

/** One line for the overview row and the error bar: `Claude 额度用完 · 17:22 恢复`. */
export function stopNote(stop: Pick<LimitStop, 'vendor' | 'resetsAt'>, now: number): string {
  return `${VENDOR_LABEL[stop.vendor]} 额度用完 · ${formatClock(stop.resetsAt, now)} 恢复`
}

/** The button's tooltip: exactly what it will do, and what calls it off. */
export function resumeHint(stop: Pick<LimitStop, 'resetsAt'>, now: number, timing: ResumeTiming = RESUME_TIMING): string {
  return `额度 ${formatClock(stop.resetsAt, now)} 恢复；约 ${formatClock(resumeDueAt(stop, timing), now)} 在终端里输入“${RESUME_PROMPT}”并回车。你在终端里打字、会话自己继续了，或再点一次，就取消`
}

/** Notification body when the due send was not made. */
export function holdText(reason: HoldReason, vendor: UsageVendor): string {
  if (reason === 'agent-continues') return `额度已恢复，${VENDOR_LABEL[vendor]} 会自己继续，Wavi 没有发送“${RESUME_PROMPT}”`
  if (reason === 'still-limited') return `额度还没有恢复，没有发送“${RESUME_PROMPT}”`
  return `额度已恢复，但终端里有选择框，没有发送“${RESUME_PROMPT}”，请在终端里处理`
}
