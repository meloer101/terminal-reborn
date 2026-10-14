// Module-level registry of live terminals, keyed by session id. Terminals outlive React
// re-renders; the integrator wires the composer's send executor to getSendIo().
import type { SendIo } from '@shared/send-protocol'
import type { AgentKind, SessionId } from '@shared/types'
import { SessionTerminal } from './session-terminal'
import type { TerminalSurface } from './surface'
import type { XtermSurface } from './xterm-surface'

const terminals = new Map<SessionId, SessionTerminal>()

/** Creates the terminal for a session on first call; later calls return the same one. */
export function ensureTerminal(sessionId: SessionId, cwd: string, agent: AgentKind = 'shell'): SessionTerminal {
  let terminal = terminals.get(sessionId)
  if (!terminal) {
    terminal = new SessionTerminal(sessionId, cwd, agent)
    terminals.set(sessionId, terminal)
  }
  return terminal
}

/** The session's surface, or undefined until the session has been viewed once. */
export function getSurface(sessionId: SessionId): TerminalSurface | undefined {
  return terminals.get(sessionId)?.surface
}

/** Same surface with the xterm-specific controls (visibility); TerminalArea only. */
export function getXtermSurface(sessionId: SessionId): XtermSurface | undefined {
  return terminals.get(sessionId)?.surface
}

/**
 * What the send executor needs for a session. Safe to call before the terminal exists:
 * writes go straight to the PTY and readScreen() is empty until a surface is created.
 */
export function getSendIo(sessionId: SessionId): SendIo {
  return {
    write: (data) => window.tr.pty.write(sessionId, data),
    readScreen: () => terminals.get(sessionId)?.surface.readScreen(200) ?? ''
  }
}

/** Only the visible viewport: for detecting full-screen dialogs that are on screen right now. */
export function readViewport(sessionId: SessionId): string {
  return terminals.get(sessionId)?.surface.readScreen(0) ?? ''
}

export function disposeTerminal(sessionId: SessionId): void {
  terminals.get(sessionId)?.dispose()
  terminals.delete(sessionId)
}

/** Disposes terminals whose sessions no longer exist. */
export function pruneTerminals(liveSessionIds: ReadonlySet<SessionId>): void {
  for (const id of [...terminals.keys()]) {
    if (!liveSessionIds.has(id)) disposeTerminal(id)
  }
}

// End-to-end tests read the screen through this hook; it only exists when they opt in.
interface E2eGlobal {
  __TR_E2E__?: boolean
  __trTerminals?: {
    readScreen(sessionId: SessionId, scrollbackLines?: number): string
    size(sessionId: SessionId): { cols: number; rows: number } | null
  }
}
const e2e = globalThis as unknown as E2eGlobal
if (e2e.__TR_E2E__) {
  e2e.__trTerminals = {
    readScreen: (sessionId, scrollbackLines) => terminals.get(sessionId)?.surface.readScreen(scrollbackLines) ?? '',
    size: (sessionId) => terminals.get(sessionId)?.surface.size ?? null
  }
}
