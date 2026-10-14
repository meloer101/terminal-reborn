// One xterm-backed terminal per session. Terminals are created the first time a session is
// viewed and then stay mounted (display:none) so scrollback and running programs survive
// switching sessions.
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AgentKind, SessionId } from '@shared/types'
import { useSessionStartup, useStartRequests } from '../state/session-start'
import { launchKind, useWorkspace } from '../state/workspace'
import { ensureTerminal, getSurface, getXtermSurface, pruneTerminals } from './registry'
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

export function TerminalArea() {
  const { sessions, worktrees, activeSessionId } = useWorkspace(
    useShallow((s) => ({ sessions: s.sessions, worktrees: s.worktrees, activeSessionId: s.activeSessionId }))
  )

  const requests = useStartRequests((s) => s.requests)
  useSessionStartup()

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
