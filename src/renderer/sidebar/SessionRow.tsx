import { memo, useEffect, useRef } from 'react'
import { StatusGlyph } from '../ui/StatusGlyph'
import { Elapsed } from './Elapsed'
import { showsElapsed } from './format-elapsed'
import type { SessionRowModel } from './model'
import styles from './SessionRow.module.css'

interface Props {
  row: SessionRowModel
  selected: boolean
  /** Roving tabindex: exactly one row in the list is reachable with Tab. */
  tabStop: boolean
  onSelect(id: string): void
  onContextMenu?(id: string): void
}

/** Figma component `SessionRow` (11:51): 52px, glyph · title/activity · time/diff. */
export const SessionRow = memo(function SessionRow({ row, selected, tabStop, onSelect, onContextMenu }: Props) {
  const { session, secondary, attention, stat } = row
  const ref = useRef<HTMLButtonElement>(null)

  // Keep the selection visible when it changes from elsewhere (⌘1–9, ⌘J).
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      className={styles.row}
      data-selected={selected}
      data-attention={attention}
      data-session-id={session.id}
      aria-current={selected ? 'true' : undefined}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => onSelect(session.id)}
      onContextMenu={
        onContextMenu &&
        ((e) => {
          e.preventDefault()
          onSelect(session.id)
          onContextMenu(session.id)
        })
      }
    >
      <span className={styles.glyph}>
        <StatusGlyph status={session.status} />
      </span>
      <span className={styles.main}>
        <span className={styles.title}>{session.title}</span>
        <span className={styles.activity}>{secondary}</span>
      </span>
      <span className={styles.meta}>
        <span className={styles.metaLine}>{showsElapsed(session.status) && <Elapsed since={session.startedAt} />}</span>
        <span className={styles.metaLine}>{stat && `+${stat.added} −${stat.removed}`}</span>
      </span>
    </button>
  )
})
