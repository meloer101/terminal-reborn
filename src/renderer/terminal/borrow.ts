// The overview (PRD F9) shows a session's own terminal — the same xterm on the same PTY, never a second
// process — inside itself: the list's in-place tray or the board's overlay (up to four at once). A secondary window's
// pane (F20 · 多窗口) borrows the terminal the same way. While a host borrows it, TerminalPane mounts the terminal
// there instead of in its own pane; giving it back moves the DOM home.
// The latest borrow wins; giving it back shows the terminal in the host that had it before (the overview opened over
// a window's pane, then closed), else at home.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'

interface BorrowedTerminals {
  /** The host each borrowed terminal is in now. */
  hosts: Readonly<Record<SessionId, HTMLElement>>
}

export const useBorrowedTerminal = create<BorrowedTerminals>(() => ({ hosts: {} }))

/** Every host that borrows a session, oldest first; the last one has the terminal. */
const stacks = new Map<SessionId, HTMLElement[]>()

function publish(sessionId: SessionId): void {
  const top = stacks.get(sessionId)?.at(-1)
  const hosts = { ...useBorrowedTerminal.getState().hosts }
  if (top) hosts[sessionId] = top
  else delete hosts[sessionId]
  useBorrowedTerminal.setState({ hosts })
}

/** Shows the session's terminal in `host` (creating it on first view); returns the function that gives it back. */
export function borrowTerminal(sessionId: SessionId, host: HTMLElement): () => void {
  const stack = (stacks.get(sessionId) ?? []).filter((h) => h !== host)
  stack.push(host)
  stacks.set(sessionId, stack)
  publish(sessionId)
  return () => {
    const current = stacks.get(sessionId)
    if (!current?.includes(host)) return
    const rest = current.filter((h) => h !== host)
    if (rest.length > 0) stacks.set(sessionId, rest)
    else stacks.delete(sessionId)
    publish(sessionId)
  }
}
