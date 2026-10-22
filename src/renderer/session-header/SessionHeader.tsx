import { CircleAlert, Ellipsis, Folder, GitBranch, GitFork, Globe, PanelLeft, Paperclip, Play, Square, X, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { useHooksHealth } from '../lifecycle/hooks-health'
import { useWorktreeCreations } from '../new-session/creation'
import { PANEL_VIEW_LABEL } from '../panels/RightPanel'
import { pressRun, runAction, runSessionOf, useRepoScripts, useRunRunning, type RunAction } from '../scripts/run-script'
import { openSessionHeaderMenu, renameSession } from '../state/session-actions'
import { MAIN_WINDOW } from '@shared/window-layout'
import { useSessionView, useWorkspace, windowEffects, type PanelView } from '../state/workspace'
import { useSidebarCollapsed, useWindowKey } from '../state/window-scope'
import { StatusGlyph } from '../ui/StatusGlyph'
import { IconButton } from '../ui/IconButton'
import { SessionMetaChips } from '../session-meta/MetaChips'
import { LimitResumeButton, useLimitResumeShown } from '../limit-resume/LimitResumeButton'
import { addFiles } from '../terminal/file-input'
import { useSessionMeta } from '../session-meta/store'
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

/** A pane of the main area's split (PRD F20 · Figma 21 PaneHeader): one header per pane. */
export interface PaneChrome {
  /** The keyboard is in this pane: primary title, the paperclip and the right panel's icons. */
  focused: boolean
  /** The top-left pane: room for the traffic lights and the sidebar button when the sidebar is hidden. */
  lead: boolean
  /** Touches the window's top edge, so it is part of the window drag region. */
  top: boolean
  /** The × that closes only this pane (absent with a single pane). */
  onClose?: () => void
  /** A press on the session name, which drags the pane elsewhere. */
  onTitlePointerDown?: (e: PointerEvent<HTMLElement>) => void
}

/**
 * Figma component `SessionHeader` (11:86). Doubles as the window drag region. Without a `sessionId` it shows the
 * active session; in a split each pane has its own (`pane`).
 */
export function SessionHeader({ sessionId, pane }: { sessionId?: string; pane?: PaneChrome } = {}) {
  const active = useSessionView(sessionId)
  const focused = pane?.focused ?? true
  const lead = pane?.lead ?? true
  const windowKey = useWindowKey()
  const sidebarCollapsed = useSidebarCollapsed() && lead
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar)
  const waiting = useWorkspace((s) => s.sessions.filter((x) => needsAttention(x.status)).length)
  const mostUrgent = useWorkspace((s) => s.sessions.filter((x) => needsAttention(x.status)).sort(compareByUrgency)[0]?.status)
  // The overview is the main window's: from another window (F20 · 多窗口) that one comes forward.
  const openOverview = (): void => {
    if (windowKey !== MAIN_WINDOW) {
      useWorkspace.getState().focusWindow(MAIN_WINDOW)
      windowEffects.reveal(MAIN_WINDOW)
    }
    useWorkspace.getState().setMainView('overview')
  }
  const rightPanel = useWorkspace((s) => s.rightPanel)
  const togglePanelView = useWorkspace((s) => s.togglePanelView)
  const hooks = useHooksHealth(active?.session.id ?? null)
  const shellAgent = useSessionMeta((s) => (active ? s.bySession[active.session.id]?.agent : undefined))
  const limitResume = useLimitResumeShown(active?.session.id ?? '')
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
  // The worktree's `run` script (PRD F4): the button only exists when `.tr/settings.toml` has one.
  // A new worktree's folder appears after its session does: read again once it is there.
  const creating = useWorktreeCreations((s) => (active ? s.held[active.session.id] : undefined))
  const scripts = useRepoScripts(active?.worktree?.path, creating)
  const worktreeId = active?.worktree?.id
  const runSession = useWorkspace((s) => (worktreeId ? runSessionOf(s.sessions, worktreeId) : undefined))
  const running = useRunRunning(runSession?.id)
  const agentUp = active !== null && active.session.kind !== 'shell' && active.session.phase !== 'not-started' && active.session.phase !== 'exited'
  // The status is in the sidebar row already (F17 dropped the copy here); only a hooks problem is worth repeating.

  return (
    <header className={styles.header} data-sidebar-collapsed={sidebarCollapsed} data-focused={focused} data-drag-region={pane?.top ?? true}>
      {sidebarCollapsed && (
        <IconButton label="显示侧栏" title={`显示侧栏 · ${formatAccelerator(SHORTCUTS['toggle-sidebar'])}`} onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </IconButton>
      )}
      {/* With the sidebar hidden nothing else says another session is waiting (B9). */}
      {sidebarCollapsed && waiting > 0 && mostUrgent && (
        <button type="button" className={styles.waiting} title="打开总览 · ⇧⌘A" onClick={openOverview}>
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
            <h1
              className={styles.title}
              data-movable={pane?.onTitlePointerDown !== undefined}
              title={pane?.onTitlePointerDown ? '拖动到别的格或边上 · 双击重命名' : undefined}
              onPointerDown={pane?.onTitlePointerDown}
              onDoubleClick={() => setRenaming(active.session.id)}
            >
              {active.session.title}
            </h1>
          )}
          {active.worktree?.branch && (
            <span className={styles.branch}>
              <GitBranch size={16} strokeWidth={1.75} />
              {active.worktree.branch}
            </span>
          )}
          {active.session.dispatchedBy && <DispatchedBy parentId={active.session.dispatchedBy} />}
          <span className={styles.spacer} />
          {/* Figma 17A: todo · context · usage, after the branch and before the pane icons (PRD F11 / F12). */}
          {/* A plain terminal shows the agent started in it by hand, while it runs. */}
          <SessionMetaChips sessionId={active.session.id} vendor={active.session.kind === 'shell' ? shellAgent ?? null : active.session.kind}>
            {/* After the used-up UsageChip: type 继续 once the plan limit resets (PRD F11). */}
            {limitResume && <LimitResumeButton sessionId={active.session.id} />}
          </SessionMetaChips>
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
        {/* The run script, paperclip and right panel act on the focused pane's session (PRD F20). */}
        {focused && active?.worktree && scripts?.scripts.run && (
          <RunButton
            action={runAction(running, runSession?.id === active.session.id)}
            command={scripts.scripts.run}
            port={scripts.port}
            onPress={(action) => {
              if (active.worktree) void pressRun(active.worktree, action)
            }}
          />
        )}
        {/* PRD F19: the files' paths go into the input line; the agent makes images attachments. */}
        {focused && active && (
          <IconButton
            label="添加文件或文件夹"
            title="添加文件或文件夹 · 也可以拖进终端，或 ⌘V 粘贴截图"
            data-testid="add-files"
            onClick={() => {
              const id = active.session.id
              void window.tr.ui.pickFiles(active.worktree?.path).then((paths) => addFiles(id, paths))
            }}
          >
            <Paperclip size={16} strokeWidth={1.75} />
          </IconButton>
        )}
        {/* The right panel is the main window's (F20 · 多窗口: not in other windows yet). */}
        {focused && active && windowKey === MAIN_WINDOW && (
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
        {pane?.onClose && (
          <IconButton label="关掉这一格" title={`关掉这一格，会话继续运行 · ${formatAccelerator(SHORTCUTS['close-pane'])}`} onClick={pane.onClose}>
            <X size={16} strokeWidth={1.75} />
          </IconButton>
        )}
      </span>
    </header>
  )
}

const RUN_LABEL: Record<RunAction, string> = { start: '运行 run 脚本', show: '显示正在运行的 run', stop: '停止 run 脚本' }

/** Play starts the worktree's run script (or shows it while it runs elsewhere); in the run session itself, Square stops it. */
function RunButton({ action, command, port, onPress }: { action: RunAction; command: string; port: number | null; onPress(action: RunAction): void }) {
  const firstLine = command.split('\n')[0] ?? ''
  const title = [RUN_LABEL[action], firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine, port !== null ? `TR_PORT ${port}` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <IconButton label={RUN_LABEL[action]} title={title} active={action !== 'start'} data-testid="run-script" onClick={() => onPress(action)}>
      {action === 'stop' ? <Square size={16} strokeWidth={1.75} /> : <Play size={16} strokeWidth={1.75} />}
    </IconButton>
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

/** 由「…」派出 (PRD F21): the session whose agent started this one; a click goes there. */
function DispatchedBy({ parentId }: { parentId: string }) {
  const title = useWorkspace((s) => s.sessions.find((x) => x.id === parentId)?.title)
  if (title === undefined) return null
  return (
    <button
      type="button"
      className={styles.dispatchedBy}
      title={`这个会话是「${title}」里的 agent 开的，它做完的结果会报告给那边 · 点击前往`}
      onClick={() => useWorkspace.getState().setActiveSession(parentId)}
      data-testid="dispatched-by"
    >
      由「<span className={styles.dispatchedByName}>{title}</span>」派出
    </button>
  )
}
