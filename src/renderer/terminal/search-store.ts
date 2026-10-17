// Find in the active terminal (B18): whether the find bar is open, and ⌘F to open it.
import { create } from 'zustand'
import { useWorkspace } from '../state/workspace'
import { noteKeyCommand } from '../state/key-commands'
import { isFindShortcut } from './find'

interface TerminalSearchState {
  open: boolean
  /** Bumped on every ⌘F so a find bar that is already open takes the keyboard again. */
  focusToken: number
}

export const useTerminalSearch = create<TerminalSearchState>()(() => ({ open: false, focusToken: 0 }))

/** Opens the find bar over the active session's terminal (or focuses it again). False when there is no terminal to search. */
export function openTerminalSearch(): boolean {
  const { activeSessionId, mainView } = useWorkspace.getState()
  if (!activeSessionId || mainView !== 'session') return false
  useTerminalSearch.setState((s) => ({ open: true, focusToken: s.focusToken + 1 }))
  return true
}

export function closeTerminalSearch(): void {
  useTerminalSearch.setState({ open: false })
}

// Capture phase on window: wins over xterm, which would otherwise swallow the key.
const onKeyDown = (e: KeyboardEvent): void => {
  if (!isFindShortcut(e) || document.querySelector('[role="dialog"][aria-modal="true"]')) return
  if (!openTerminalSearch()) return
  e.preventDefault()
  e.stopPropagation()
  noteKeyCommand('find')
}
window.addEventListener('keydown', onKeyDown, true)
if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('keydown', onKeyDown, true))
