import { useSyncExternalStore } from 'react'
import type { Session, SessionStatus } from '@shared/types'
import { subscribeClock } from './clock'
import { sessionTime } from './format-elapsed'

/**
 * The session's time label (see sessionTime). The snapshot is the formatted string, so on each shared clock
 * tick only labels whose text actually changed (once a minute) re-render.
 */
export function SessionTimeLabel({ session, status, className }: { session: Session; status: SessionStatus; className?: string }) {
  const snapshot = useSyncExternalStore(subscribeClock, () => {
    const time = sessionTime(session, status, Date.now())
    return `${time.emphasis ? '1' : '0'}${time.text}`
  })
  return (
    <span className={className} data-emphasis={snapshot[0] === '1'}>
      {snapshot.slice(1)}
    </span>
  )
}
