import { memo, useEffect, useRef } from 'react'
import { glyphStatus } from '../lifecycle/present'
import { PortTags } from '../panels/browser/PortTags'
import { pointerAnchor, type MenuAnchor } from '../ui/menu'
import { StatusGlyph } from '../ui/StatusGlyph'
import { showsTime } from './format-elapsed'
import { SessionTimeLabel } from './SessionTimeLabel'
import type { SessionRowModel } from './model'
import styles from './SessionRow.module.css'

interface Props {
  row: SessionRowModel
  selected: boolean
  /** Roving tabindex: exactly one row in the list is reachable with Tab. */
  tabStop: boolean
  onSelect(id: string): void
  onContextMenu?(id: string, anchor: MenuAnchor): void
}

/** Figma component `SessionRow` (11:51): 52px, glyph · title/activity · time/diff. */
export const SessionRow = memo(function SessionRow({ row, selected, tabStop, onSelect, onContextMenu }: Props) {
  const { session, secondary, attention, stat } = row
  const ref = useRef<HTMLDivElement>(null)
  const status = glyphStatus(session)

  // Keep the selection visible when it changes from elsewhere (⌘1–9, ⌘J).
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={ref}
      role="button"
      className={styles.row}
      data-selected={selected}
      data-attention={attention}
      data-session-id={session.id}
      aria-current={selected ? 'true' : undefined}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => onSelect(session.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        onSelect(session.id)
      }}
      onContextMenu={
        onContextMenu &&
        ((e) => {
          e.preventDefault()
          onSelect(session.id)
          onContextMenu(session.id, pointerAnchor(e))
        })
      }
    >
      <span className={styles.glyph}>
        <StatusGlyph status={status} />
      </span>
      <span className={styles.main}>
        <span className={styles.title}>{session.title}</span>
        <span className={styles.activityLine}>
          <span className={styles.activity}>{secondary}</span>
          <PortTags sessionId={session.id} />
        </span>
      </span>
      <span className={styles.meta}>
        {showsTime(session, status) ? (
          <SessionTimeLabel session={session} status={status} className={styles.metaLine} />
        ) : (
          <span className={styles.metaLine} />
        )}
        <span className={styles.metaLine}>{stat && `+${stat.added} −${stat.removed}`}</span>
      </span>
    </div>
  )
})
