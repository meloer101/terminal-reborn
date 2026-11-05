// A GUI session in the main area (PRD F23), the counterpart of TerminalArea's TerminalPane: it opens the session's
// agent the first time the session is wanted (shown in any window, kept running, or started eagerly) and again on
// every start (`generation`), and draws the chat where the terminal would be. A secondary window draws the same chat
// (PaneHosts) while this one keeps opening it.
import { memo, useEffect, useState, type CSSProperties } from 'react'
import type { Rect } from '@shared/split-layout'
import type { AgentKind, SessionId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { ChatPane } from './ChatPane'
import { openGuiSession } from './launch'
import styles from './Chat.module.css'

export interface GuiPaneProps {
  sessionId: SessionId
  cwd: string
  agent: AgentKind
  active: boolean
  /** Where it is shown in this window's area; undefined = not here. */
  rect: Rect | undefined
  /** Shown somewhere, kept running or started eagerly: its agent should be up. */
  wanted: boolean
  /** Restored and not started yet, or waiting for its worktree: nothing is opened until it is released. */
  held: boolean
  resumeAgentSessionId: string | undefined
  generation: number
}

const place = (rect: Rect | undefined): CSSProperties | undefined => rect && { left: rect.x, top: rect.y, width: rect.width, height: rect.height }

export const GuiPane = memo(function GuiPane({ sessionId, cwd, agent, active, rect, wanted, held, resumeAgentSessionId, generation }: GuiPaneProps) {
  const [everWanted, setEverWanted] = useState(wanted)
  if (wanted && !everWanted) setEverWanted(true)

  useEffect(() => {
    if (!everWanted || held || agent === 'shell') return
    void openGuiSession(sessionId, cwd, agent, resumeAgentSessionId)
  }, [everWanted, held, sessionId, cwd, agent, resumeAgentSessionId, generation])

  return <GuiCard sessionId={sessionId} cwd={cwd} agent={agent} active={active} rect={rect} />
}, sameProps)

/** The chat's card at `rect` (nothing when it is not shown here). */
export function GuiCard({ sessionId, cwd, agent, active, rect }: { sessionId: SessionId; cwd: string; agent: AgentKind; active: boolean; rect: Rect | undefined }) {
  return (
    <div
      className={styles.pane}
      data-active={active}
      data-shown={rect !== undefined}
      data-session-id={sessionId}
      style={place(rect)}
      // The keyboard went into this pane: its session becomes the active one (PRD F20).
      onFocus={() => useWorkspace.getState().focusPane(sessionId)}
    >
      {rect && <ChatPane sessionId={sessionId} agent={agent} cwd={cwd} />}
    </div>
  )
}

function sameProps(a: GuiPaneProps, b: GuiPaneProps): boolean {
  return (
    a.sessionId === b.sessionId &&
    a.cwd === b.cwd &&
    a.agent === b.agent &&
    a.active === b.active &&
    a.wanted === b.wanted &&
    a.held === b.held &&
    a.resumeAgentSessionId === b.resumeAgentSessionId &&
    a.generation === b.generation &&
    a.rect?.x === b.rect?.x &&
    a.rect?.y === b.rect?.y &&
    a.rect?.width === b.rect?.width &&
    a.rect?.height === b.rect?.height
  )
}
