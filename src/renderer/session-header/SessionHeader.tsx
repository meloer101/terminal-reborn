import { CircleAlert, Ellipsis, Folder, GitBranch, GitFork, Globe, PanelLeft, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent } from 'react'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { useHooksHealth } from '../lifecycle/hooks-health'
import { PANEL_VIEW_LABEL } from '../panels/RightPanel'
import { openSessionHeaderMenu, renameSession } from '../state/session-actions'
import { useActiveSession, useWorkspace, type PanelView } from '../state/workspace'
import { StatusGlyph } from '../ui/StatusGlyph'
import { IconButton } from '../ui/IconButton'
import styles from './SessionHeader.module.css'
import { formatAccelerator } from '../ui/menu-model'
import { SHORTCUTS } from '@shared/shortcuts'

/** Right panel switcher (Figma 13 "Pane switcher" 149:6398): one icon per view, the open one in Active. */
const PANE_ICONS: { view: PanelView; icon: LucideIcon }[] = [
  { view: 'browser', icon: Globe },
  { view: 'git', icon: GitBranch },
  { view: 'worktree', icon: GitFork },
  { view: 'files', icon: Folder }
]

/** Figma component `SessionHeader` (11:86). Doubles as the window drag region. */
export function SessionHeader() {
  const active = useActiveSession()
  const sidebarCollapsed = useWorkspace((s) => s.sidebarCollapsed)
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const waiting = useWorkspace((s) => s.sessions.filter((x) => needsAttention(x.status)).length)
  const mostUrgent = useWorkspace((s) => s.sessions.filter((x) => needsAttention(x.status)).sort(compareByUrgency)[0]?.status)
  const setMainView = useWorkspace((s) => s.setMainView)
  const rightPanel = useWorkspace((s) => s.rightPanel)
  const togglePanelView = useWorkspace((s) => s.togglePanelView)
  const hooks = useHooksHealth(active?.session.id ?? null)
  // Inline rename from the … menu: the session being renamed (so switching sessions ends it).
  const [renaming, setRenaming] = useState<string | null>(null)
  // 会话 › 重命名会话 in the app menu: each new request starts renaming the active session.
  useEffect(
    () =>
      useWorkspace.subscribe((next, prev) => {
        if (next.renameRequest !== prev.renameRequest && next.activeSessionId) setRenaming(next.activeSessionId)
      }),
    []
  )
  const agentUp = active !== null && active.session.kind !== 'shell' && active.session.phase !== 'not-started' && active.session.phase !== 'exited'
  // The status is in the sidebar row already (F17 dropped the copy here); only a hooks problem is worth repeating.

  return (
    <header className={styles.header} data-sidebar-collapsed={sidebarCollapsed}>
      {sidebarCollapsed && (
        <IconButton label="显示侧栏" title={`显示侧栏 · ${formatAccelerator(SHORTCUTS['toggle-sidebar'])}`} onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </IconButton>
      )}
      {/* With the sidebar hidden nothing else says another session is waiting (B9). */}
      {sidebarCollapsed && waiting > 0 && mostUrgent && (
        <button type="button" className={styles.waiting} title="打开总览 · ⇧⌘A" onClick={() => setMainView('overview')}>
          <span aria-hidden className={styles.waitingGlyph}>
            <StatusGlyph status={mostUrgent} />
          </span>
          {waiting} 个会话需要你
        </button>
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
        </>
      )}
      {/* Without a session there is no status to push the tools right. */}
      {!active && <span className={styles.spacer} />}
      <span className={styles.tools}>
        {active && (
          <span className={styles.panes} role="group" aria-label="右侧栏">
            {PANE_ICONS.map(({ view, icon: Icon }) => (
              <IconButton
                key={view}
                label={PANEL_VIEW_LABEL[view]}
                active={rightPanel === view}
                aria-pressed={rightPanel === view}
                onClick={() => togglePanelView(view)}
              >
                <Icon size={16} strokeWidth={1.75} />
              </IconButton>
            ))}
          </span>
        )}
        {active && (
          <IconButton
            label="会话菜单"
            aria-haspopup="menu"
            onClick={(e) => {
              const id = active.session.id
              void openSessionHeaderMenu(id, e.currentTarget).then((choice) => {
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
