// The overview (PRD F9) shows a session's own terminal — the same xterm on the same PTY, never a second
// process — inside itself: the list's in-place tray or the board's overlay (up to four at once). While a host
// borrows it, TerminalPane mounts the terminal there instead of in its own pane; giving it back moves the DOM home.
// One host per session: a new borrow of the same session replaces the previous one.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'

interface BorrowedTerminals {
  hosts: Readonly<Record<SessionId, HTMLElement>>
}

export const useBorrowedTerminal = create<BorrowedTerminals>(() => ({ hosts: {} }))

/** Shows the session's terminal in `host` (creating it on first view); returns the function that gives it back. */
export function borrowTerminal(sessionId: SessionId, host: HTMLElement): () => void {
  useBorrowedTerminal.setState((s) => ({ hosts: { ...s.hosts, [sessionId]: host } }))
  return () => {
    const hosts = useBorrowedTerminal.getState().hosts
    if (hosts[sessionId] !== host) return
    const rest = { ...hosts }
    delete rest[sessionId]
    useBorrowedTerminal.setState({ hosts: rest })
  }
}
