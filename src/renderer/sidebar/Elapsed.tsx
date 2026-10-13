import { useSyncExternalStore } from 'react'
import { subscribeClock } from './clock'
import { formatElapsed } from './format-elapsed'

/**
 * Elapsed-time label. The snapshot is the formatted string, so on each shared clock tick
 * only labels whose text actually changed (once a minute) re-render.
 */
export function Elapsed({ since }: { since: number }) {
  const text = useSyncExternalStore(subscribeClock, () => formatElapsed(Date.now() - since))
  return <>{text}</>
}
