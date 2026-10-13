// One xterm-backed terminal per session. Terminals are created the first time a session is
// viewed and then stay mounted (display:none) so scrollback and running programs survive
// switching sessions.
import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { ensureTerminal, getSurface, getXtermSurface, pruneTerminals } from './registry'
import styles from './TerminalArea.module.css'

interface PaneProps {
  sessionId: SessionId
  cwd: string
  active: boolean
}

function TerminalPane({ sessionId, cwd, active }: PaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  // Spawn lazily: nothing is created until the session has been active once.
  const [everActive, setEverActive] = useState(active)
  if (active && !everActive) setEverActive(true)

  useEffect(() => {
    const host = hostRef.current
    if (!everActive || !host) return
    ensureTerminal(sessionId, cwd).attach(host)
  }, [everActive, sessionId, cwd])

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
          active={session.id === activeSessionId}
        />
      ))}
    </div>
  )
}
