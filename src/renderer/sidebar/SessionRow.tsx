import { memo, useEffect, useRef, type PointerEvent } from 'react'
import { agentName } from '@shared/agents'
import { glyphStatus } from '../lifecycle/present'
import { PortTags } from '../panels/browser/PortTags'
import { useBrowser } from '../panels/browser/store'
import { SessionPrTag } from '../pull-requests/PrTag'
import { TodoLine } from '../session-meta/MetaChips'
import { AgentIcon } from '../ui/AgentIcon'
import { pointerAnchor, type MenuAnchor } from '../ui/menu'
import { StatusGlyph } from '../ui/StatusGlyph'
import { showsTime } from './format-elapsed'
import { SessionTimeLabel } from './SessionTimeLabel'
import { sameRow, type SessionRowModel } from './model'
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

/**
 * Figma 34P (SessionRow, third round): status glyph · title · time / activity (+ ports) / branch (+ PR) · agent mark.
 * The glyph hangs in a 16px column so every line starts on the nav labels' text line. A line with nothing to say is not
 * drawn (no activity yet, no branch outside git), and the agent mark always closes the last line.
 */
export const SessionRow = memo(function SessionRow({ row, selected, shown = false, onPress, tabStop, onSelect, onContextMenu }: Props) {
  const { session, secondary, attention, branch } = row
  const ref = useRef<HTMLDivElement>(null)
  const status = glyphStatus(session)
  const hasPorts = useBrowser((s) => (s.ports[session.id]?.length ?? 0) > 0)
  const activity = secondary !== '' || hasPorts

  const mark = (
    <span className={styles.mark} title={branch ? `${agentName(session.kind)} · ${branch}` : agentName(session.kind)}>
      <AgentIcon kind={session.kind} size={12} />
    </span>
  )

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
      <span className={styles.line}>
        <span className={styles.glyph}>
          <StatusGlyph status={status} />
        </span>
        <span className={styles.title}>{row.title}</span>
        {showsTime(session, status) && <SessionTimeLabel session={session} status={status} className={styles.time} />}
        {!activity && !branch && mark}
      </span>
      {activity && (
        <span className={styles.line}>
          {secondary && <span className={styles.activity}>{secondary}</span>}
          <PortTags sessionId={session.id} />
          {!branch && mark}
        </span>
      )}
      {branch && (
        <span className={styles.line}>
          <span className={styles.branch}>{branch}</span>
          <SessionPrTag sessionId={session.id} />
          {mark}
        </span>
      )}
      <TodoLine sessionId={session.id} />
    </div>
  )
}, sameProps)

/** The row model is rebuilt on every store change; compare what it draws (`sameRow`), the rest by identity. */
function sameProps(a: Props, b: Props): boolean {
  return (
    sameRow(a.row, b.row) &&
    a.selected === b.selected &&
    a.shown === b.shown &&
    a.onPress === b.onPress &&
    a.tabStop === b.tabStop &&
    a.onSelect === b.onSelect &&
    a.onContextMenu === b.onContextMenu
  )
}
