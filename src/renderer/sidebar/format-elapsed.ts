import type { Session, SessionStatus } from '@shared/types'

/** Compact elapsed time for the SessionRow meta column: `<1m`, `4m`, `1h`, `2d`. */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** A wait this long is drawn heavier (PRD F10: weight, not color). */
export const LONG_WAIT_MS = 5 * 60_000

export interface SessionTime {
  text: string
  /** Waiting on the user for longer than LONG_WAIT_MS. */
  emphasis: boolean
}

type TimedSession = Pick<Session, 'startedAt' | 'lastActivityAt' | 'statusSince' | 'turnStartedAt' | 'finishedAt'>

/**
 * The time column, whose meaning follows the status (PRD F10): running shows this turn's time, `needs_you`
 * how long it has waited ("已等 3m"), everything else how long ago it got there ("5m 前"; idle and
 * done_unread count from when the last turn finished).
 */
export function sessionTime(session: TimedSession, status: SessionStatus, now: number): SessionTime {
  const since = session.statusSince ?? session.lastActivityAt
  switch (status) {
    case 'running':
      return { text: formatElapsed(now - (session.turnStartedAt ?? session.startedAt)), emphasis: false }
    case 'needs_you':
      return { text: `已等 ${formatElapsed(now - since)}`, emphasis: now - since >= LONG_WAIT_MS }
    case 'idle':
    case 'done_unread':
      return { text: `${formatElapsed(now - (session.finishedAt ?? since))} 前`, emphasis: false }
    default:
      return { text: `${formatElapsed(now - since)} 前`, emphasis: false }
  }
}

/** The sidebar stays quiet for exited sessions and for idle ones that never finished a turn (Figma `main` row). */
export function showsTime(session: Pick<Session, 'finishedAt'>, status: SessionStatus): boolean {
  if (status === 'exited') return false
  if (status === 'idle') return session.finishedAt !== undefined
  return true
}
