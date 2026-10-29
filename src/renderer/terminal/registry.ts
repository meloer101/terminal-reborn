// Module-level registry of live terminals, keyed by session id. Terminals outlive React re-renders.
import type { SendIo } from '@shared/send-protocol'
import { LIMITS } from '@shared/settings'
import type { FontSizeStep } from '@shared/shortcuts'
import type { AgentKind, SessionId } from '@shared/types'
import { SessionTerminal } from './session-terminal'
import type { TerminalAppearance, TerminalSurface } from './surface'
import type { SurfaceDebugInfo, XtermSurface } from './xterm-surface'

const terminals = new Map<SessionId, SessionTerminal>()
/** Latest appearance from settings; new terminals start with it, existing ones are updated in place. */
let appearance: TerminalAppearance | null = null
/** Font size steps of single panes of a split (PRD F20), on top of the setting; gone when the split ends. */
const zoom = new Map<SessionId, number>()

/** The appearance of one session's terminal: the setting's, with its pane's font size step. */
function appearanceFor(sessionId: SessionId, base: TerminalAppearance): TerminalAppearance {
  const step = zoom.get(sessionId) ?? 0
  if (step === 0) return base
  return { ...base, fontSize: Math.min(LIMITS.fontSize.max, Math.max(LIMITS.fontSize.min, base.fontSize + step)) }
}

/** Applies the appearance to every live terminal and remembers it for terminals created later. */
export function setTerminalAppearance(next: TerminalAppearance): void {
  appearance = next
  for (const [id, terminal] of terminals) terminal.surface.setAppearance(appearanceFor(id, next))
}

/** ⌘+ / ⌘- / ⌘0 in a split: only the focused pane's terminal gets bigger, smaller or back to the setting. */
export function stepTerminalZoom(sessionId: SessionId, step: FontSizeStep): void {
  if (!appearance) return
  const base = appearance.fontSize
  const wanted = step === 'reset' ? base : base + (zoom.get(sessionId) ?? 0) + (step === 'bigger' ? 1 : -1)
  // Within the setting's limits.
  const next = Math.min(LIMITS.fontSize.max, Math.max(LIMITS.fontSize.min, wanted)) - base
  if (next === 0) zoom.delete(sessionId)
  else zoom.set(sessionId, next)
  terminals.get(sessionId)?.surface.setAppearance(appearanceFor(sessionId, appearance))
}

/** The split ended: every terminal goes back to the setting's font size. */
export function clearTerminalZoom(): void {
  if (zoom.size === 0) return
  const ids = [...zoom.keys()]
  zoom.clear()
  if (!appearance) return
  for (const id of ids) terminals.get(id)?.surface.setAppearance(appearance)
}

/** Creates the terminal for a session on first call; later calls return the same one. */
export function ensureTerminal(
  sessionId: SessionId,
  cwd: string,
  agent: AgentKind = 'shell',
  resumeAgentSessionId?: string
): SessionTerminal {
  let terminal = terminals.get(sessionId)
  if (!terminal) {
    terminal = new SessionTerminal(sessionId, cwd, agent, resumeAgentSessionId)
    if (appearance) terminal.surface.setAppearance(appearanceFor(sessionId, appearance))
    terminals.set(sessionId, terminal)
  }
  return terminal
}

/** Whether the session's PTY is running right now. */
export function isTerminalAlive(sessionId: SessionId): boolean {
  return terminals.get(sessionId)?.alive ?? false
}

/** The session's surface, or undefined until the session has been viewed once. */
export function getSurface(sessionId: SessionId): TerminalSurface | undefined {
  return terminals.get(sessionId)?.surface
}

/** Same surface with the xterm-specific controls (visibility); TerminalArea only. */
export function getXtermSurface(sessionId: SessionId): XtermSurface | undefined {
  return terminals.get(sessionId)?.surface
}

/** A pane started or stopped showing the session's terminal (flow control; see SessionTerminal.setShown). */
export function setTerminalShown(sessionId: SessionId, shown: boolean): void {
  terminals.get(sessionId)?.setShown(shown)
}

/** Redraws a session's terminal and re-sends its size to the PTY (after sleep, a display change, refocus). */
export function resyncTerminal(sessionId: SessionId): void {
  terminals.get(sessionId)?.resync()
}

/**
 * Plain-text tail of a session's terminal (screen plus a little scrollback) for read-only previews such as
 * the overview peek. Null when the session's terminal was never created (it spawns on first view).
 */
export function readSnapshot(sessionId: SessionId, scrollbackLines = 40): string | null {
  const terminal = terminals.get(sessionId)
  return terminal ? terminal.surface.readScreen(scrollbackLines) : null
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

/** Whether the session's program takes bracketed paste; false until its terminal exists (the safe answer). */
export function acceptsBracketedPaste(sessionId: SessionId): boolean {
  return terminals.get(sessionId)?.surface.bracketedPasteMode() ?? false
}

/** Only the visible viewport: for detecting full-screen dialogs that are on screen right now. */
export function readViewport(sessionId: SessionId): string {
  return terminals.get(sessionId)?.surface.readScreen(0) ?? ''
}

const restartListeners = new Set<(sessionId: SessionId) => void>()

/** Fires after a terminal's process was started again in place (see restartTerminal). */
export function onTerminalRestarted(listener: (sessionId: SessionId) => void): () => void {
  restartListeners.add(listener)
  return () => {
    restartListeners.delete(listener)
  }
}

/**
 * Starts a new process in an existing terminal whose process is gone, keeping its scrollback.
 * With `resumeAgentSessionId` an agent picks its previous conversation back up. False if there is
 * no such terminal or the process could not start.
 */
export async function restartTerminal(sessionId: SessionId, resumeAgentSessionId?: string): Promise<boolean> {
  const terminal = terminals.get(sessionId)
  if (!terminal || !(await terminal.restart(resumeAgentSessionId))) return false
  for (const listener of [...restartListeners]) listener(sessionId)
  return true
}

export function disposeTerminal(sessionId: SessionId, forget = false): void {
  terminals.get(sessionId)?.dispose(forget)
  terminals.delete(sessionId)
}

/** Disposes terminals whose sessions no longer exist, with their saved screens. */
export function pruneTerminals(liveSessionIds: ReadonlySet<SessionId>): void {
  for (const id of [...terminals.keys()]) {
    if (!liveSessionIds.has(id)) disposeTerminal(id, true)
  }
}

// Quitting or reloading: save every terminal's screen so the next launch paints it at once.
window.addEventListener('beforeunload', () => {
  for (const terminal of terminals.values()) terminal.saveSnapshot()
})

// End-to-end tests read the screen through this hook; it only exists when they opt in.
interface E2eGlobal {
  __TR_E2E__?: boolean
  /** Screen reading only, with persistence left on (terminal-restore.spec.ts). */
  __TR_TERMINAL_PROBE__?: boolean
  __trTerminals?: {
    readScreen(sessionId: SessionId, scrollbackLines?: number): string
    size(sessionId: SessionId): { cols: number; rows: number } | null
    info(sessionId: SessionId): SurfaceDebugInfo | null
    redraw(sessionId: SessionId, mode: 'rebind' | 'rebuild'): void
    renderer(sessionId: SessionId, mode: 'auto' | 'dom'): void
  }
}
const e2e = globalThis as unknown as E2eGlobal
if (e2e.__TR_E2E__ || e2e.__TR_TERMINAL_PROBE__) {
  e2e.__trTerminals = {
    readScreen: (sessionId, scrollbackLines) => terminals.get(sessionId)?.surface.readScreen(scrollbackLines) ?? '',
    size: (sessionId) => terminals.get(sessionId)?.surface.size ?? null,
    info: (sessionId) => terminals.get(sessionId)?.surface.debugInfo() ?? null,
    redraw: (sessionId, mode) => terminals.get(sessionId)?.surface.debugRedraw(mode),
    renderer: (sessionId, mode) => terminals.get(sessionId)?.surface.debugRenderer(mode)
  }
}
