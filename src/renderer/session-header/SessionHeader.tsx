import { CircleAlert, Ellipsis, GitBranch, PanelLeft, PanelRight } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { STATUS_LABEL } from '@shared/session-status'
import { useHooksHealth } from '../lifecycle/hooks-health'
import { AGENT_NAME, glyphStatus, phaseLabel } from '../lifecycle/present'
import { RIGHT_PANEL_AVAILABLE } from '../panels/availability'
import { openSessionHeaderMenu, renameSession } from '../state/session-actions'
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
  // Inline rename from the … menu: the session being renamed (so switching sessions ends it).
  const [renaming, setRenaming] = useState<string | null>(null)
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
          {renaming === active.session.id ? (
            <TitleEditor
              key={active.session.id}
              initial={active.session.title}
              onDone={(value) => {
                if (value !== null) renameSession(active.session.id, value)
                setRenaming(null)
              }}
            />
          ) : (
            <h1 className={styles.title} onDoubleClick={() => setRenaming(active.session.id)}>
              {active.session.title}
            </h1>
          )}
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
        {RIGHT_PANEL_AVAILABLE && (
          <IconButton
            label="变更面板"
            active={rightPanel !== null}
            onClick={() => setRightPanel(rightPanel ? null : 'changes')}
          >
            <PanelRight size={16} strokeWidth={1.75} />
          </IconButton>
        )}
        {active && (
          <IconButton
            label="会话菜单"
            onClick={() => {
              const id = active.session.id
              void openSessionHeaderMenu(id).then((choice) => {
                if (choice === 'rename') setRenaming(id)
              })
            }}
          >
            <Ellipsis size={16} strokeWidth={1.75} />
          </IconButton>
        )}
      </span>
    </header>
  )
}

/** The title as a text field: ↵ or leaving it saves, Esc cancels (IME composition keeps its own ↵ / Esc). */
function TitleEditor({ initial, onDone }: { initial: string; onDone(value: string | null): void }) {
  const [value, setValue] = useState(initial)
  const [done, setDone] = useState(false)
  const finish = (result: string | null) => {
    if (done) return
    setDone(true)
    onDone(result)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(null)
    }
  }
  return (
    <input
      className={styles.titleInput}
      aria-label="会话名称"
      value={value}
      maxLength={200}
      spellCheck={false}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(value)}
    />
  )
}
