// Board → session overlay (PRD F9 · Figma 11v2-D 108:4366, SessionOverlayBar 104:287): a centered modal over the
// whole window with the session's full, interactive terminal. Closes with Esc (outside the terminal), the scrim or ×.
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import { StatusGlyph } from '../ui/StatusGlyph'
import { BorrowedTerminal, TERMINAL_HOST_SELECTOR } from './BorrowedTerminal'
import { ReviewButton } from '../review/ReviewButton'
import { EnterButton } from './EnterButton'
import enterStyles from './EnterButton.module.css'
import type { OverviewRow } from './model'
import { enterSession } from './store'
import styles from './SessionOverlay.module.css'

export function SessionOverlay({ row, onClose }: { row: OverviewRow; onClose(): void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const id = row.session.id

  useEffect(() => panelRef.current?.focus(), [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return
    // Keys typed in the terminal are the session's (agents use Esc to interrupt or decline).
    if ((e.target as HTMLElement).closest(TERMINAL_HOST_SELECTOR)) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'Enter' && (e.target as HTMLElement).closest('button') === null) {
      e.preventDefault()
      enterSession(id)
    }
  }
  const onScrimMouseDown = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={styles.scrim} onMouseDown={onScrimMouseDown} data-region="overview-overlay">
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label={row.title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className={styles.bar}>
          <StatusGlyph status={row.status} />
          <span className={styles.title}>{row.title}</span>
          {row.where && <span className={styles.where}>{row.where}</span>}
          <span className={styles.spacer} />
          <span className={styles.status}>
            {[row.statusLabel, row.time].filter(Boolean).join(' · ')}
          </span>
          <span className={styles.divider} aria-hidden />
          {row.session.status === 'done_unread' && <ReviewButton sessionId={id} className={enterStyles.enter} />}
          <EnterButton sessionId={id} />
          <IconButton label="关闭" onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        </header>
        <div className={styles.terminal}>
          <BorrowedTerminal session={row.session} variant="overlay" />
        </div>
      </div>
    </div>
  )
}
