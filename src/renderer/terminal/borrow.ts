// The overview (PRD F9) shows a session's own terminal — the same xterm on the same PTY, never a second
// process — inside itself: the list's in-place tray or the board's overlay. While a host borrows it,
// TerminalPane mounts the terminal there instead of in its own pane; giving it back moves the DOM home.
// One borrowed terminal at a time: a new borrow replaces the previous one.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'

interface BorrowedTerminal {
  sessionId: SessionId | null
  host: HTMLElement | null
}

export const useBorrowedTerminal = create<BorrowedTerminal>(() => ({ sessionId: null, host: null }))

/** Shows the session's terminal in `host` (creating it on first view); returns the function that gives it back. */
export function borrowTerminal(sessionId: SessionId, host: HTMLElement): () => void {
  useBorrowedTerminal.setState({ sessionId, host })
  return () => {
    if (useBorrowedTerminal.getState().host === host) useBorrowedTerminal.setState({ sessionId: null, host: null })
  }
}
