// Putting a report into a dispatcher without typing into its terminal (PRD F21, §6.14): Claude's cross-session inbox
// socket, or `codex queue`. Typing would land in the user's draft or answer an open question (Orca #21745 / #22651).
import { execFile } from 'node:child_process'
import { connect } from 'node:net'
import type { Inbox } from './broker'

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
