import type { SessionStatus } from '@shared/types'
import { STATUS_LABEL } from '@shared/session-status'
import styles from './StatusGlyph.module.css'

/** 14×14 status mark — Figma component `StatusGlyph` (9:14). Shape carries meaning, not just color. */
export function StatusGlyph({ status }: { status: SessionStatus }) {
  return (
    <svg className={styles.glyph} width="14" height="14" viewBox="0 0 14 14" role="img" aria-label={STATUS_LABEL[status]}>
      {status === 'running' && (
        <g className={styles.spin}>
          <circle cx="7" cy="7" r="5.1" fill="none" stroke="var(--border-strong)" strokeWidth="1.8" />
          {/* 153° arc starting at 12 o'clock */}
          <path d="M7 1.9 A5.1 5.1 0 0 1 9.32 11.54" fill="none" stroke="var(--status-working)" strokeWidth="1.8" />
        </g>
      )}
      {status === 'needs_you' && (
        <>
          <circle cx="7" cy="7" r="7" fill="var(--status-attention-bg)" />
          <circle cx="7" cy="7" r="4" fill="var(--status-attention)" />
        </>
      )}
      {status === 'done_unread' && <circle cx="7" cy="7" r="4" fill="var(--status-done)" />}
      {status === 'error' && <circle cx="7" cy="7" r="4" fill="var(--status-error)" />}
      {(status === 'idle' || status === 'exited') && (
        <circle
          cx="7"
          cy="7"
          r="3.25"
          fill="none"
          stroke={status === 'idle' ? 'var(--status-idle)' : 'var(--text-disabled)'}
          strokeWidth="1.5"
        />
      )}
    </svg>
  )
}
