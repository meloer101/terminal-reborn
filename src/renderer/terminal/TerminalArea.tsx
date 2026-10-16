// One xterm-backed terminal per session. Terminals are created the first time a session is
// viewed and then stay mounted (display:none) so scrollback and running programs survive
// switching sessions.
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentKind, SessionId } from '@shared/types'
import { useSessionStartup, useStartRequests } from '../state/session-start'
import { launchKind, useWorkspace } from '../state/workspace'
import { ensureTerminal, getSurface, getXtermSurface, pruneTerminals, resyncTerminal } from './registry'
import styles from './TerminalArea.module.css'

interface PaneProps {
  sessionId: SessionId
  cwd: string
  agent: AgentKind
  active: boolean
  /** Restored from disk and not started yet: no terminal until startSession() (state/session-start.ts). */
  held: boolean
  /** Earlier conversation to continue; `generation` changes whenever the session is started again. */
  resumeAgentSessionId: string | undefined
  generation: number
}

function TerminalPane({ sessionId, cwd, agent, active, held, resumeAgentSessionId, generation }: PaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Spawn lazily: nothing is created until the session has been active once.
  const [everActive, setEverActive] = useState(active)
  if (active && !everActive) setEverActive(true)

  useEffect(() => {
    const host = hostRef.current
    if (!everActive || held || !host) return
    ensureTerminal(sessionId, cwd, agent, resumeAgentSessionId).attach(host)
  }, [everActive, held, sessionId, cwd, agent, resumeAgentSessionId, generation])

  // Refit + resize on show, and release the WebGL context while hidden.
  useEffect(() => {
    if (!everActive) return
    const surface = getXtermSurface(sessionId)
    if (!active) {
      surface?.setVisible(false)
      return
    }
    const frame = requestAnimationFrame(() => getXtermSurface(sessionId)?.setVisible(true))
    return () => cancelAnimationFrame(frame)
  }, [active, everActive, sessionId])

  useEffect(() => {
    const host = hostRef.current
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
  }, [everActive, sessionId])

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

/** The keyboard follows the active session into its terminal (which appears a few frames after the session). */
function useFocusActiveTerminal(sessionId: SessionId | null): void {
  useEffect(() => {
    if (!sessionId) return
    let frame = 0
    let tries = 0
    let cancelled = false
    const attempt = (): void => {
      const surface = getXtermSurface(sessionId)
      if (!surface) {
        if (tries++ < 90) frame = requestAnimationFrame(attempt)
        return
      }
      // xterm ignores focus() until it is open (fonts loaded, attached to the DOM).
      void surface.whenOpen().then(() => {
        if (!cancelled && canStealFocus()) surface.focus()
      })
    }
    attempt()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [sessionId])
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
  useSessionStartup()
  useFocusActiveTerminal(activeSessionId)
  useResyncOnWake(activeSessionId)

  useEffect(() => {
    pruneTerminals(new Set(sessions.map((s) => s.id)))
  }, [sessions])

  return (
    <div className={styles.area}>
      {sessions.map((session) => (
        <TerminalPane
          key={session.id}
          sessionId={session.id}
          cwd={worktrees.find((w) => w.id === session.worktreeId)?.path ?? window.tr.homeDir}
          agent={launchKind(session)}
          active={session.id === activeSessionId}
          held={session.phase === 'not-started'}
          resumeAgentSessionId={requests[session.id]?.resumeAgentSessionId}
          generation={requests[session.id]?.generation ?? 0}
        />
      ))}
    </div>
  )
}
