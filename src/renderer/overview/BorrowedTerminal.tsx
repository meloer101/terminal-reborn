// A session's own terminal shown inside the overview — the list's in-place tray and the board's overlay. It is
// the same xterm on the same PTY as in the main area (terminal/borrow.ts), fully interactive, never a copy.
import { useEffect, useRef } from 'react'
import type { Session } from '@shared/types'
import { borrowTerminal } from '../terminal/borrow'
import { useLiveSessions } from '../terminal/live-sessions'
import { getSurface } from '../terminal/registry'
import styles from './BorrowedTerminal.module.css'

/** The host: the overview leaves every key typed in there to the terminal (Esc included). */
export const TERMINAL_HOST_SELECTOR = '[data-overview-terminal]'

export function BorrowedTerminal({ session, variant }: { session: Session; variant: 'tray' | 'overlay' }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const live = useLiveSessions((s) => s.live[session.id] !== undefined)
  // Restored from disk and not started: there is no process to show until the session is entered.
  const held = session.phase === 'not-started' && !live

  useEffect(() => {
    const host = hostRef.current
    if (held || !host) return
    return borrowTerminal(session.id, host)
  }, [session.id, held])

  if (held) return <p className={styles.held}>这个会话还没有启动。进入会话（↵）后启动。</p>
  return (
    <div
      ref={hostRef}
      className={styles.host}
      data-variant={variant}
      data-overview-terminal=""
      onClick={() => getSurface(session.id)?.focus()}
    />
  )
}
