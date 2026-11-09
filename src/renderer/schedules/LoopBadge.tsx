// Claude's own `/loop` in this session (PRD F24, Figma 67I′): a mark in the session header, its timers listed on hover.
// Display only — Wavi never changes them; they end with the session. Only Claude reports them (Stop hook
// `session_crons`), so no other agent shows one.
import { RotateCw } from 'lucide-react'
import { cronLabel } from '@shared/agent-events'
import type { SessionId } from '@shared/types'
import { useSessionMeta } from '../session-meta/store'
import styles from './LoopBadge.module.css'

export function LoopBadge({ sessionId }: { sessionId: SessionId }) {
  const crons = useSessionMeta((s) => s.bySession[sessionId]?.crons)
  if (!crons || crons.length === 0) return null
  const first = crons[0]!
  return (
    <span className={styles.badge} tabIndex={0} data-testid="loop-badge">
      <RotateCw size={14} strokeWidth={1.75} aria-hidden />
      <span>
        {cronLabel(first.schedule)} · Claude 的 /loop{crons.length > 1 ? ` · ${crons.length} 条` : ''}
      </span>
      <span className={styles.popover} role="tooltip">
        <span className={styles.heading}>Claude 的 /loop · {crons.length} 条</span>
        {crons.map((c, i) => (
          <span key={`${c.schedule}-${i}`} className={styles.item}>
            <span className={styles.when}>{c.recurring ? cronLabel(c.schedule) : `一次 · ${cronLabel(c.schedule)}`}</span>
            <span className={styles.prompt}>{c.prompt}</span>
          </span>
        ))}
      </span>
    </span>
  )
}
