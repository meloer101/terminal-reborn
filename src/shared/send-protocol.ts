// How composer text gets into an agent's TUI. See docs/PRD.md §4 F1.
// Evidence for every constant below: docs/spikes/send-protocol.md (Claude Code 2.1.296, Codex 0.142.5).
// Pure and synchronous: this file only decides WHAT to write; send-executor.ts performs it.

import type { AgentKind } from './types'

export type SendStep =
  /** Raw bytes to the PTY. */
  | { type: 'write'; data: string }
  /**
   * Block until any needle is visible in the terminal buffer, or fail after timeoutMs.
   * "Visible" means: the number of occurrences of some needle in `SendIo.readScreen()` is higher than it
   * was when the plan started (so stale copies of the same text in the scrollback do not count).
   */
  | { type: 'waitForText'; needles: string[]; timeoutMs: number }
  | { type: 'delay'; ms: number }

/** Planner signature: pure, unit-testable. */
export type PlanSend = (text: string, agent: AgentKind) => SendStep[]

/** What the executor needs from a live session. */
export interface SendIo {
  write(data: string): void
  /** Visible screen text (and recent scrollback) of the session's terminal. */
  readScreen(): string
}

// ---------------------------------------------------------------------------------------------
// Constants (measured, see the spike doc)
// ---------------------------------------------------------------------------------------------

export const PASTE_START = '\x1b[200~'
export const PASTE_END = '\x1b[201~'

/** Per-agent facts about how the TUI composer reacts to pasted text. */
export interface AgentSendProfile {
  /** A paste with MORE chars (UTF-16 length) than this collapses into a placeholder. */
  placeholderOverChars: number
  /** A paste with at least this many `\n` collapses into a placeholder (null = line count is irrelevant). */
  placeholderAtNewlines: number | null
  /** Text of the placeholder, e.g. `[Pasted text #3 +4 lines]` starts with this. */
  placeholderNeedle: string
  /** Wait between "paste is visible" and the submitting `\r`. */
  preEnterDelayMs: number
}

export const AGENT_PROFILES: Record<'claude' | 'codex', AgentSendProfile> = {
  // Claude Code 2.1.296: >800 chars or >=3 newlines -> `[Pasted text #N]` / `[Pasted text #N +K lines]`.
  // A placeholder paste reaches the model wrapped in `<pasted_content id="…">…</pasted_content id="…">`.
  claude: { placeholderOverChars: 800, placeholderAtNewlines: 3, placeholderNeedle: '[Pasted text', preEnterDelayMs: 60 },
  // Codex 0.142.5: >1000 chars -> `[Pasted Content N chars]`; the model gets the text verbatim.
  // 0 ms already worked with bracketed paste; 150 ms is cheap insurance against its 120 ms paste-burst window.
  codex: { placeholderOverChars: 1000, placeholderAtNewlines: null, placeholderNeedle: '[Pasted Content', preEnterDelayMs: 150 }
}

/** Gap between the `/` keystroke and the bracketed paste carrying the rest of a slash command. */
export const SLASH_KEY_GAP_MS = 150

/** "Typed" delivery (no bracketed paste), used for Claude `/cmd` text that would otherwise become a placeholder. */
export const TYPED_CHUNK_CHARS = 100
export const TYPED_CHUNK_GAP_MS = 15
/** Alt+Enter: inserts a newline in Claude Code's composer without submitting. */
export const NEWLINE_KEY = '\x1b\r'

export const SUBMIT_KEY = '\r'

const NEEDLE_MAX_CHARS = 20
const WAIT_BASE_MS = 2000
const WAIT_MS_PER_KB = 25
const WAIT_MAX_MS = 20_000
const SHELL_ENTER_DELAY_MS = 20

// ---------------------------------------------------------------------------------------------
// Helpers (exported for tests and for the composer's UI hints)
// ---------------------------------------------------------------------------------------------

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * Timeout for "the pasted text shows up in the terminal". Scales with UTF-8 BYTES, not JS string length:
 * CJK is 3 bytes per char, so a char-based budget is 3x too small (Nimbalyst #1387).
 */
export function pasteTimeoutMs(byteLength: number): number {
  return Math.min(WAIT_MAX_MS, WAIT_BASE_MS + Math.ceil((byteLength / 1024) * WAIT_MS_PER_KB))
}

/**
 * Canonical form of composer text before it is sent: LF newlines, and no control characters that could
 * terminate the bracketed paste early or be interpreted by the TUI (ESC, Ctrl+C, …). Tabs and newlines stay.
 */
export function normalizeSendText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

/** Wrap text in bracketed-paste markers. The text must already be normalized. */
export function bracketedPaste(text: string): string {
  return PASTE_START + text + PASTE_END
}

function countChar(text: string, ch: string): number {
  let n = 0
  for (const c of text) if (c === ch) n++
  return n
}

/** Will the agent collapse this text into a `[Pasted …]` placeholder when it is pasted? */
export function becomesPlaceholder(text: string, agent: AgentKind): boolean {
  if (agent === 'shell') return false
  const p = AGENT_PROFILES[agent]
  if (text.length > p.placeholderOverChars) return true
  return p.placeholderAtNewlines !== null && countChar(text, '\n') >= p.placeholderAtNewlines
}

/**
 * A short, whitespace-free-ish prefix of `line` that is guaranteed to sit on one terminal row
 * (the composer never wraps before column ~24). Returns '' when the line has nothing printable.
 */
function linePrefixNeedle(line: string): string {
  const trimmed = line.trimStart()
  const cut = trimmed.search(/\s{2,}|\t/)
  const head = cut >= 0 ? trimmed.slice(0, cut) : trimmed
  return [...head].slice(0, NEEDLE_MAX_CHARS).join('').trimEnd()
}

/** Needles that prove the pasted text arrived: its visible echo and/or the agent's placeholder. */
export function echoNeedles(text: string, agent: AgentKind): string[] {
  const needles: string[] = []
  if (agent !== 'shell') {
    if (!becomesPlaceholder(text, agent)) {
      const firstLine = text.split('\n').find((l) => l.trim() !== '') ?? ''
      const n = linePrefixNeedle(firstLine)
      if (n) needles.push(n)
    }
    needles.push(AGENT_PROFILES[agent].placeholderNeedle)
  }
  return needles
}

/** `/word` with nothing after it: an argument-less slash command. */
export function isBareSlashCommand(text: string): boolean {
  return /^\/[^\s/]+$/.test(text)
}

export function isSlashText(text: string): boolean {
  return /^\/[^\s/]/.test(text)
}

// ---------------------------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------------------------

function planShell(text: string): SendStep[] {
  // A plain shell has no placeholder and no echo guarantee: write, give the line editor a moment, press Enter.
  const body = text.includes('\n') ? bracketedPaste(text) : text
  return [
    { type: 'write', data: body },
    { type: 'delay', ms: SHELL_ENTER_DELAY_MS },
    { type: 'write', data: SUBMIT_KEY }
  ]
}

/** Claude `/cmd` text that a paste would turn into a placeholder (which kills command parsing): type it. */
function planTyped(text: string, agent: AgentKind): SendStep[] {
  const steps: SendStep[] = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) steps.push({ type: 'write', data: NEWLINE_KEY }, { type: 'delay', ms: TYPED_CHUNK_GAP_MS })
    const chars = [...line]
    for (let at = 0; at < chars.length; at += TYPED_CHUNK_CHARS) {
      steps.push({ type: 'write', data: chars.slice(at, at + TYPED_CHUNK_CHARS).join('') })
      steps.push({ type: 'delay', ms: TYPED_CHUNK_GAP_MS })
    }
  })
  // Typed text is echoed 1:1, so wait for the start of the LAST line (guaranteed to be at the start of a row).
  const last = linePrefixNeedle(lines[lines.length - 1] ?? '')
  if (last) steps.push({ type: 'waitForText', needles: [last], timeoutMs: pasteTimeoutMs(utf8ByteLength(text)) })
  steps.push({ type: 'delay', ms: AGENT_PROFILES[agent === 'codex' ? 'codex' : 'claude'].preEnterDelayMs })
  steps.push({ type: 'write', data: SUBMIT_KEY })
  return steps
}

/**
 * Decide the byte-level steps that deliver `text` to `agent` and submit it.
 *
 *  1. normalize; nothing to send -> [];
 *  2. shell: plain write + Enter;
 *  3. `/` first char is written as its own keystroke (opens the slash menu), the rest follows as a paste;
 *     an argument-less `/cmd` gets a trailing space (Codex then refuses to fuzzy-run a half-typed name);
 *  4. body goes in as a bracketed paste;
 *  5. closed loop: wait until the echo or the placeholder is on screen (byte-scaled timeout);
 *  6. Enter is a separate write, after the agent's pre-Enter delay.
 *
 * Sending while the agent is busy needs no special plan: both CLIs queue the message.
 */
export const planSend: PlanSend = (rawText, agent) => {
  const text = normalizeSendText(rawText)
  if (text.trim() === '') return []
  if (agent === 'shell') return planShell(text)

  const profile = AGENT_PROFILES[agent]
  const slash = isSlashText(text)

  // A pasted `/cmd …` that becomes a placeholder is no longer parsed as a command by Claude (it is sent to
  // the model as `<pasted_content>/cmd …`). Typing it is the only way to keep it a command.
  if (agent === 'claude' && slash && becomesPlaceholder(text, agent)) return planTyped(text, agent)

  const body = slash && isBareSlashCommand(text) ? `${text} ` : text
  const needles = echoNeedles(body, agent)
  const timeoutMs = pasteTimeoutMs(utf8ByteLength(body))

  const steps: SendStep[] = []
  if (slash && !becomesPlaceholder(body, agent)) {
    steps.push({ type: 'write', data: '/' }, { type: 'delay', ms: SLASH_KEY_GAP_MS })
    steps.push({ type: 'write', data: bracketedPaste(body.slice(1)) })
  } else {
    steps.push({ type: 'write', data: bracketedPaste(body) })
  }
  steps.push({ type: 'waitForText', needles, timeoutMs })
  steps.push({ type: 'delay', ms: profile.preEnterDelayMs })
  steps.push({ type: 'write', data: SUBMIT_KEY })
  return steps
}

// ---------------------------------------------------------------------------------------------
// Startup blockers: do not send while one of these dialogs is on screen
// ---------------------------------------------------------------------------------------------

export type BlockingDialog = 'claude-trust' | 'codex-trust' | 'codex-update'

/** The first-run dialogs that swallow keystrokes. Match on the rendered screen text. */
export function detectBlockingDialog(screen: string): BlockingDialog | null {
  if (screen.includes('Yes, I trust this folder')) return 'claude-trust'
  if (screen.includes('Do you trust the contents of this directory?')) return 'codex-trust'
  if (screen.includes('Update available!') && screen.includes('Skip until next version')) return 'codex-update'
  return null
}
