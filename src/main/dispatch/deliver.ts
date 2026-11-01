// Putting a message into a session without typing into its terminal (PRD F21, §6.14): Claude's cross-session inbox
// socket, `codex queue`, or Wavi's Pi extension, which hands it to `pi.sendUserMessage`. Typing would land in the user's
// draft or answer an open question (Orca #21745 / #22651); the window does that only for the CLIs with none of these,
// and only when nobody is typing (renderer/dispatch/reports.ts).
import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import type { Inbox } from './requests'

/**
 * Newline-delimited JSON: the auth line, then the message (measured on Claude Code 2.1.306: an idle session starts a
 * turn, shown as "Another Claude session sent a message"). Resolves once the bytes are flushed and nothing went wrong.
 */
export function writeInbox(inbox: Inbox, text: string, timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(inbox.socket)
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), timeoutMs)
    socket.once('error', () => done(false))
    socket.once('connect', () => {
      const lines = `${JSON.stringify({ type: 'auth', token: inbox.token })}\n${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`
      // A refused auth closes the connection at once; give it a moment to say so before calling it delivered.
      socket.write(lines, () => setTimeout(() => done(true), 300))
    })
    socket.once('close', (hadError) => {
      if (hadError) done(false)
    })
  })
}

/** `codex queue --thread <id> --message <text>` with the codex the user's login shell finds. */
export function codexQueue(codex: string, path: string, threadId: string, text: string, timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(codex, ['queue', '--thread', threadId, '--message', text], { timeout: timeoutMs, env: { ...process.env, PATH: path } }, (error) => resolve(!error))
  })
}

/** A Pi session that asked within this long has Wavi's extension listening. */
const PI_LISTENING_MS = 5_000

/**
 * Messages for Pi sessions (PRD F21, §6.14 v1.104), handed to Wavi's extension when it asks over the hook socket
 * (`WaviMessages`, about once a second); it starts a turn with `pi.sendUserMessage(text, { deliverAs: "followUp" })`,
 * keeping the user's draft. Over the socket, not a file: an agent in Codex's sandbox may write files in /private/tmp
 * but cannot reach a unix socket, so it cannot put words into Pi's mouth. A session whose extension has not asked
 * lately (not loaded, or an older one) has no channel: the message waits for 送进去.
 */
export class PiInbox {
  private readonly waiting = new Map<string, { messages: string[]; askedAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  put(sessionId: string, text: string): boolean {
    const entry = this.waiting.get(sessionId)
    if (!entry || this.now() - entry.askedAt > PI_LISTENING_MS) return false
    entry.messages.push(text)
    return true
  }

  /** The extension asked: what waits for it, once. */
  take(sessionId: string): string[] {
    const messages = this.waiting.get(sessionId)?.messages ?? []
    this.waiting.set(sessionId, { messages: [], askedAt: this.now() })
    return messages
  }
}
