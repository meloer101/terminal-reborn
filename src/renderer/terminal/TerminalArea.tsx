// One xterm-backed terminal per session. Terminals are created the first time a session is
// viewed and then stay mounted (display:none) so scrollback and running programs survive
// switching sessions.
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentKind, SessionId } from '@shared/types'
import { useWorktreeCreations } from '../new-session/creation'
import { runSessionWaits, useRunScripts } from '../scripts/run-script'
import { useSessionStartup, useStartRequests } from '../state/session-start'
import { launchKind, useWorkspace } from '../state/workspace'
import { useBorrowedTerminal } from './borrow'
import { useLiveSessions } from './live-sessions'
import { ensureTerminal, getSurface, getXtermSurface, pruneTerminals, resyncTerminal } from './registry'
import { closeTerminalSearch } from './search-store'
import { TerminalSearch } from './TerminalSearch'
import styles from './TerminalArea.module.css'

interface PaneProps {
  sessionId: SessionId
  cwd: string
  agent: AgentKind
  active: boolean
  /** Restored from disk and not started yet: no terminal until startSession() (state/session-start.ts). */
  held: boolean
  /** Its process kept running in the pty daemon: attach now, viewed or not (status and notifications need it). */
  live: boolean
  /** Earlier conversation to continue; `generation` changes whenever the session is started again. */
  resumeAgentSessionId: string | undefined
  generation: number
}

function TerminalPane({ sessionId, cwd, agent, active, held, live, resumeAgentSessionId, generation }: PaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // The overview may show this terminal in its own host for a while (borrow.ts).
  const borrowedHost = useBorrowedTerminal((s) => (s.sessionId === sessionId ? s.host : null))
  const shown = active || borrowedHost !== null
  // Spawn lazily: nothing is created until the session has been shown once (a live process is attached at once).
  const [everActive, setEverActive] = useState(active || live)
  if ((shown || live) && !everActive) setEverActive(true)

  useEffect(() => {
    const host = borrowedHost ?? hostRef.current
    if (!everActive || held || !host) return
    ensureTerminal(sessionId, cwd, agent, resumeAgentSessionId).attach(host)
  }, [everActive, held, sessionId, cwd, agent, resumeAgentSessionId, generation, borrowedHost])

  // Refit + resize on show (and on moving between hosts), and release the WebGL context while hidden.
  useEffect(() => {
    if (!everActive) return
    const surface = getXtermSurface(sessionId)
    if (!shown) {
      surface?.setVisible(false)
      return
    }
    const frame = requestAnimationFrame(() => getXtermSurface(sessionId)?.setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [shown, everActive, sessionId, borrowedHost])

  useEffect(() => {
    const host = borrowedHost ?? hostRef.current
    if (!everActive || !host) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (host.offsetParent !== null) getSurface(sessionId)?.fit()
      })
    })
    observer.observe(host)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [everActive, sessionId, borrowedHost])

  return (
    <div
      className={styles.pane}
      data-active={active}
      data-session-id={sessionId}
      onClick={() => getSurface(sessionId)?.focus()}
    >
      <div ref={hostRef} className={styles.host} />
    </div>
  )
}

/** Whether moving the keyboard focus now would take it from something the user is typing in. */
function canStealFocus(): boolean {
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return false
  const active = document.activeElement
  if (!active || active === document.body) return true
  const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active as HTMLElement).isContentEditable
  return !typing || active.matches('.xterm-helper-textarea')
}

/** How long to wait for a terminal to exist: a restored agent spawns only after the daemon listing (~10 s at 60 fps). */
const FOCUS_WAIT_FRAMES = 600

/**
 * The keyboard follows the active session into its terminal (B7) — on every selection or explicit request
 * (`focusRequest`), not only when the active id changes. The terminal can appear frames or seconds later.
 */
function useFocusActiveTerminal(sessionId: SessionId | null, request: number): void {
  useEffect(() => {
    if (!sessionId) return
    let frame = 0
    let tries = 0
    let cancelled = false
    const attempt = (): void => {
      const surface = getXtermSurface(sessionId)
      if (!surface) {
        if (tries++ < FOCUS_WAIT_FRAMES) frame = requestAnimationFrame(attempt)
        return
      }
      // xterm ignores focus() until it is open (fonts loaded, attached to the DOM).
      void surface.whenOpen().then(() => {
        if (!cancelled && canStealFocus()) surface.focus()
      })
    }
    // Never within the event that asked: the keypress / keyup of an ↵ that picked the session must not reach xterm.
    frame = requestAnimationFrame(attempt)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [sessionId, request])
}

/**
 * Waking from sleep, refocusing the window or moving it to a screen with another pixel ratio can leave the
 * visible terminal with stale glyphs or a grid the PTY does not know about: redraw it and resend its size.
 */
function useResyncOnWake(sessionId: SessionId | null): void {
  useEffect(() => {
    if (!sessionId) return
    let frame = 0
    const resync = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => resyncTerminal(sessionId))
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') resync()
    }
    let ratio: MediaQueryList | null = null
    const watchRatio = (): void => {
      ratio?.removeEventListener('change', onRatio)
      ratio = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      ratio.addEventListener('change', onRatio)
    }
    function onRatio(): void {
      watchRatio()
      resync()
    }
    watchRatio()
    window.addEventListener('focus', resync)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(frame)
      ratio?.removeEventListener('change', onRatio)
      window.removeEventListener('focus', resync)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sessionId])
}

export function TerminalArea() {
  const { sessions, worktrees, activeSessionId } = useWorkspace(
    useShallow((s) => ({ sessions: s.sessions, worktrees: s.worktrees, activeSessionId: s.activeSessionId }))
  )

  const requests = useStartRequests((s) => s.requests)
  const live = useLiveSessions((s) => s.live)
  // A session whose new worktree is still being created (or failed) has no folder to start in yet (PRD F4).
  const waitingForWorktree = useWorktreeCreations((s) => s.held)
  // The Run button's terminal starts its script only when the button is pressed (PRD F4).
  const runStarts = useRunScripts((s) => s.started)
  useSessionStartup()
  const focusRequest = useWorkspace((s) => s.focusRequest)
  useFocusActiveTerminal(activeSessionId, focusRequest)
  useResyncOnWake(activeSessionId)

  useEffect(() => {
    pruneTerminals(new Set(sessions.map((s) => s.id)))
  }, [sessions])

  // A find belongs to one terminal's buffer.
  useEffect(() => closeTerminalSearch(), [activeSessionId])

  return (
    <div className={styles.area}>
      {sessions.map((session) => (
        <TerminalPane
          key={session.id}
          sessionId={session.id}
          cwd={worktrees.find((w) => w.id === session.worktreeId)?.path ?? window.tr.homeDir}
          agent={launchKind(session)}
          active={session.id === activeSessionId}
          held={
            (session.phase === 'not-started' && !live[session.id]) ||
            waitingForWorktree[session.id] !== undefined ||
            runSessionWaits(session, runStarts, live[session.id] !== undefined)
          }
          live={live[session.id] !== undefined}
          resumeAgentSessionId={requests[session.id]?.resumeAgentSessionId}
          generation={requests[session.id]?.generation ?? 0}
        />
      ))}
      {activeSessionId && <TerminalSearch key={activeSessionId} sessionId={activeSessionId} />}
    </div>
  )
}
