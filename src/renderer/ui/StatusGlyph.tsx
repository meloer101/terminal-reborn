import type { SessionStatus } from '@shared/types'
import { STATUS_LABEL } from '@shared/session-status'
import styles from './StatusGlyph.module.css'

/**
 * 14×14 status mark — Figma 34L · L3 (component StatusGlyph v3, 627:27332). Each state has its own shape, not just its
 * own colour: a turning arc, the halo dot (needs you), a check, a warning triangle, a ring, a dash.
 */
export function StatusGlyph({ status }: { status: SessionStatus }) {
  return (
    <svg className={styles.glyph} width="14" height="14" viewBox="0 0 14 14" fill="none" role="img" aria-label={STATUS_LABEL[status]}>
      {status === 'running' && (
        <g className={styles.spin}>
          {/* 270° from 12 o'clock to 9 o'clock */}
          <path d="M7 2.5A4.5 4.5 0 1 1 2.5 7" stroke="var(--status-working)" strokeWidth="1.75" strokeLinecap="round" />
        </g>
      )}
      {status === 'needs_you' && (
        <>
          <circle cx="7" cy="7" r="7" fill="var(--status-attention-bg)" />
          <circle cx="7" cy="7" r="4" fill="var(--status-attention)" />
        </>
      )}
      {status === 'done_unread' && (
        <path d="M3.2 7.3 5.9 10l4.9-5.6" stroke="var(--status-done)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {status === 'error' && (
        <g stroke="var(--status-error)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 2.1 12.3 11.4H1.7Z" />
          <path d="M7 5.6V8" />
          <circle cx="7" cy="9.75" r="0.7" fill="var(--status-error)" stroke="none" />
        </g>
      )}
      {status === 'idle' && <circle cx="7" cy="7" r="3.25" stroke="var(--status-idle)" strokeWidth="1.5" />}
      {status === 'exited' && <path d="M4.25 7h5.5" stroke="var(--text-disabled)" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  )
}
