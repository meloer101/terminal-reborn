import { CircleAlert, Ellipsis, GitBranch, PanelLeft, PanelRight } from 'lucide-react'
import { STATUS_LABEL } from '@shared/session-status'
import { useHooksHealth } from '../lifecycle/hooks-health'
import { AGENT_NAME, glyphStatus, phaseLabel } from '../lifecycle/present'
import { useActiveSession, useWorkspace } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import { IconButton } from '../ui/IconButton'
import styles from './SessionHeader.module.css'

/** Figma component `SessionHeader` (11:86). Doubles as the window drag region. */
export function SessionHeader() {
  const active = useActiveSession()
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const rightPanel = useWorkspace((s) => s.rightPanel)
  const setRightPanel = useWorkspace((s) => s.setRightPanel)
  const hooks = useHooksHealth(active?.session.id ?? null)
  const agentUp = active !== null && active.session.kind !== 'shell' && active.session.phase !== 'not-started' && active.session.phase !== 'exited'

  return (
    <header className={styles.header} data-sidebar-collapsed={sidebarCollapsed}>
      {sidebarCollapsed && (
        <IconButton label="显示侧栏" onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </IconButton>
      )}
      {active && (
        <>
          <h1 className={styles.title}>{active.session.title}</h1>
          {active.worktree?.branch && (
            <span className={styles.branch}>
              <GitBranch size={16} strokeWidth={1.75} />
              {active.worktree.branch}
            </span>
          )}
          <span className={styles.spacer} />
          {agentUp && hooks === 'unavailable' && (
            <span className={styles.hooks} data-testid="hooks-unavailable" title="hooks 不可用，状态只能按终端标题判断">
              <CircleAlert size={16} strokeWidth={1.75} />
              状态仅按标题判断
            </span>
          )}
          <span className={styles.status}>
            <StatusGlyph status={glyphStatus(active.session)} />
            {AGENT_NAME[active.session.kind]} · {phaseLabel(active.session, STATUS_LABEL[active.session.status])}
          </span>
        </>
      )}
      {/* Without a session there is no status to push the tools right. */}
      {!active && <span className={styles.spacer} />}
      <span className={styles.tools}>
        <IconButton
          label="变更面板"
          active={rightPanel !== null}
          onClick={() => setRightPanel(rightPanel ? null : 'changes')}
        >
          <PanelRight size={16} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="更多">
          <Ellipsis size={16} strokeWidth={1.75} />
        </IconButton>
      </span>
    </header>
  )
}
