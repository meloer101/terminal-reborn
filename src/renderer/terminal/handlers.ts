// What a terminal does with a link, a right-click and a Run start belongs to the features that own them (the 文件
// view and browser, 同任务多解, repository scripts). They are handed over here at startup (main.tsx), so the terminal
// does not import those features, which themselves reach terminals through the registry.
import type { SessionId } from '@shared/types'
import type { TerminalLink } from './links'

export interface TerminalHandlers {
  /** A link in the output was clicked. */
  link(sessionId: SessionId, link: TerminalLink): void
  /** Which of these printed paths are files of the session's worktree (relative to it), else null. */
  resolvePaths(sessionId: SessionId, paths: readonly string[]): Promise<(string | null)[]>
  /** The terminal was right-clicked. */
  contextMenu(sessionId: SessionId, at: { x: number; y: number }): void
  /** Whether this launch is the Run button's (it runs the repository's `run` script first); true at most once. */
  takeRunStart(sessionId: SessionId): boolean
}

/** Before main.tsx hands them over nothing happens; an entry point that forgot to says so once. */
let warned = false
const unset = (): void => {
  if (warned) return
  warned = true
  console.error('[terminal] no handlers for links, the menu and Run: call setTerminalHandlers at startup')
}

let handlers: TerminalHandlers = {
  link: unset,
  resolvePaths: async (_sessionId, paths) => paths.map(() => null),
  contextMenu: unset,
  takeRunStart: () => false
}

export function setTerminalHandlers(next: TerminalHandlers): void {
  handlers = next
}

export const terminalHandlers = (): TerminalHandlers => handlers
