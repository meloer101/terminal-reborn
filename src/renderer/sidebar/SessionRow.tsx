import { GitBranch } from 'lucide-react'
import { memo, useEffect, useRef, type PointerEvent } from 'react'
import { agentName } from '@shared/agents'
import { glyphStatus } from '../lifecycle/present'
import { PortTags } from '../panels/browser/PortTags'
import { SessionPrTag } from '../pull-requests/PrTag'
import { TodoLine } from '../session-meta/MetaChips'
import { AgentIcon } from '../ui/AgentIcon'
import { pointerAnchor, type MenuAnchor } from '../ui/menu'
import { StatusGlyph } from '../ui/StatusGlyph'
import { showsTime } from './format-elapsed'
import { SessionTimeLabel } from './SessionTimeLabel'
import type { SessionRowModel } from './model'
import styles from './SessionRow.module.css'

interface Props {
  row: SessionRowModel
  selected: boolean
  /** Shown in another pane of the main area's split (PRD F20): a hairline outline, lighter than `selected`. */
  shown?: boolean
  /** A press that may become a drag into the terminal area (PRD F20). */
  onPress?(e: PointerEvent<HTMLElement>, id: string): void
  /** Roving tabindex: exactly one row in the list is reachable with Tab. */
  tabStop: boolean
  onSelect(id: string): void
  onContextMenu?(id: string, anchor: MenuAnchor): void
}

/** Figma component `SessionRow` (11:51, 27A): glyph · title / activity (+ ports, PR) / agent mark · branch · time / diff. */
export const SessionRow = memo(function SessionRow({ row, selected, shown = false, onPress, tabStop, onSelect, onContextMenu }: Props) {
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
      data-shown={shown}
      data-attention={attention}
      data-depth={row.depth}
      data-session-id={session.id}
      aria-current={selected ? 'true' : undefined}
      tabIndex={tabStop ? 0 : -1}
      onClick={() => onSelect(session.id)}
      onPointerDown={onPress && ((e) => onPress(e, session.id))}
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
        <span className={styles.title}>{row.title}</span>
        <span className={styles.activityLine}>
          <span className={styles.activity}>{secondary}</span>
          <PortTags sessionId={session.id} />
          <SessionPrTag sessionId={session.id} />
        </span>
        <span className={styles.whereLine} title={row.branch ? `${agentName(session.kind)} · ${row.branch}` : agentName(session.kind)}>
          <AgentIcon kind={session.kind} size={12} />
          {row.branch && (
            <>
              <GitBranch className={styles.branchIcon} size={12} strokeWidth={1.75} aria-hidden />
              <span className={styles.branch}>{row.branch}</span>
            </>
          )}
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
      <TodoLine sessionId={session.id} />
    </div>
  )
})
