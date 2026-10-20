// What a session's visible terminal screen says about the agent's startup and dialogs (phase 2 · A6/A7).
// Pure text matching on `readViewport` output; the status controller feeds the result to the state machine.
import { detectBlockingDialog, type BlockingDialog } from './send-protocol'
import type { AgentKind } from './types'

export interface ScreenReading {
  /** A first-run dialog that swallows keystrokes (trust, update). */
  dialog: BlockingDialog | null
  /** A shell / rc-file question waits for an answer (e.g. oh-my-zsh "Would you like to update? [Y/n]"). */
  prompt: boolean
  /** The agent's own UI (banner, input box footer) is on screen. */
  agentUi: boolean
  /** Nothing but whitespace is on screen. */
  blank: boolean
  /** Claude's idle input footer is showing, i.e. no permission / question dialog covers it. */
  idleFooter: boolean
  /** Claude's permission / question dialog is up: a numbered choice above its `Esc to cancel` footer. */
  askDialog: boolean
}

/** Question markers at the end of a shell startup (rc files, version managers, oh-my-zsh). */
const SHELL_PROMPT = /\[[Yy]\/[Nn]\]|\[[Nn]\/[Yy]\]|\([Yy]\/[Nn]\)|\(yes\/no\)|Would you like to update|Press (?:any key|enter) to continue/i
const TAIL_LINES = 6
/** A dialog with many options pushes its selected first one further up. */
const DIALOG_TAIL_LINES = 12
const CLAUDE_CHOICE = /❯\s*\d+\.\s/

const CLAUDE_UI = /Claude Code v\d|\? for shortcuts|\bmode on\b|bypass permissions on|esc to interrupt/
const CODEX_UI = /OpenAI Codex|^\s*›/m
/** What Claude draws in place of the mode footer while a permission / question dialog is up. */
const CLAUDE_DIALOG_FOOTER = /Esc to cancel|Do you want to|Enter to (?:select|confirm)/

function tail(screen: string, count = TAIL_LINES): string {
  const lines = screen.split('\n').filter((line) => line.trim() !== '')
  return lines.slice(-count).join('\n')
}

export function readScreen(kind: AgentKind, screen: string): ScreenReading {
  const dialog = detectBlockingDialog(screen)
  const claude = kind === 'claude'
  return {
    dialog,
    prompt: dialog === null && SHELL_PROMPT.test(tail(screen)),
    agentUi: kind === 'shell' ? false : (claude ? CLAUDE_UI : CODEX_UI).test(screen),
    blank: screen.trim() === '',
    idleFooter: claude && /\? for shortcuts|\bmode on\b|bypass permissions on/.test(tail(screen)) && !CLAUDE_DIALOG_FOOTER.test(tail(screen)),
    askDialog: claude && /Esc to cancel/.test(tail(screen)) && CLAUDE_CHOICE.test(tail(screen, DIALOG_TAIL_LINES))
  }
}

/** What the session is blocked on, for the status line and the Blocked card. */
export type BlockedReason = { kind: 'dialog'; dialog: BlockingDialog } | { kind: 'prompt' }

export function blockedReasonOf(reading: ScreenReading): BlockedReason | null {
  if (reading.dialog) return { kind: 'dialog', dialog: reading.dialog }
  if (reading.prompt) return { kind: 'prompt' }
  return null
}

/** Sidebar / status text, in the style of `等你确认：…`. */
export function blockedAction(reason: BlockedReason): string {
  if (reason.kind === 'dialog') return reason.dialog === 'codex-update' ? '等你确认：更新提示' : '等你确认：信任此文件夹'
  return '等你回答：终端里的提示'
}
