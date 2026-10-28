// User-facing workspace commands: opening projects and creating sessions in them (Figma 09).
// Menus are the app's own (ui/MenuHost.tsx), anchored to the control or pointer that opened them.
import { agentName } from '@shared/agents'
import {
  closeSessionConfirmation,
  countActive,
  removeProjectConfirmation,
  removeProjectMenuLabel
} from '@shared/lifecycle'
import type { AgentKind, ProjectId, SessionId } from '@shared/types'
import { canRunSameTask, closeSameTask, isSameTaskOpen, openSameTask } from '../attempts/same-task-store'
import { closeNewSessionSheet, isNewSessionSheetOpen, openNewSessionSheet } from '../new-session/sheet-store'
import { closeArchiveSheet, openArchiveSheet, useArchiveSheet } from '../archive/store'
import { closeMergeSheet, isMergeSheetOpen } from '../panels/merge/store'
import { popupMenu, type MenuAnchor, type MenuEntry } from '../ui/menu'
import { everyWindow, windowOf } from '../app-shell/windows-runtime'
import { moveSessionToNewWindow } from '../split/commands'
import { noteKeyCommand } from './key-commands'
import { useWorkspace, windowEffects } from './workspace'
import { projectOfSession } from './workspace-model'

const KINDS: AgentKind[] = ['claude', 'codex', 'shell']

/**
 * Opens a folder as a project: a known one selects its latest session (or starts `kind` when it has none),
 * a new one starts with a `kind` session. Used by ⌘O, the first-run screen's recent list and folder drop.
 */
export function openProjectPath(path: string, kind: AgentKind = 'claude'): SessionId | null {
  const state = useWorkspace.getState()
  const projectId = state.addProject(path)
  const worktreeIds = new Set(state.worktrees.filter((w) => w.projectId === projectId).map((w) => w.id))
  const latest = state.sessions.filter((s) => worktreeIds.has(s.worktreeId)).sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
  if (latest) {
    state.setActiveSession(latest.id)
    return latest.id
  }
  return useWorkspace.getState().addSession(projectId, kind)
}

/** "打开项目… ⌘O": pick a folder, then openProjectPath. */
export async function openProjectInteractive(kind: AgentKind = 'claude'): Promise<SessionId | null> {
  if (isNewSessionSheetOpen()) return null
  const path = await window.tr.ui.pickFolder()
  return path ? openProjectPath(path, kind) : null
}

/**
 * 在新窗口中打开 (F20 · 多窗口): the project's own window — brought forward when it has one, else a new window beside the
 * current one, showing the first of its sessions no window shows (a new Claude Code session when it has none at all).
 */
export function openProjectInNewWindow(projectId: ProjectId): void {
  const state = useWorkspace.getState()
  if (!state.projects.some((p) => p.id === projectId)) return
  const existing = state.windows.find((w) => w.projectId === projectId)
  if (existing) {
    state.focusWindow(existing.key)
    windowEffects.reveal(existing.key)
    return
  }
  const source = windowOf(state.keyWindow) ?? window
  const key = state.openWindow({ projectId, bounds: { x: source.screenX + 48, y: source.screenY + 48, width: 1100, height: 760 } })
  if (!key) return
  const worktreeIds = new Set(state.worktrees.filter((w) => w.projectId === projectId).map((w) => w.id))
  if (!state.sessions.some((s) => worktreeIds.has(s.worktreeId))) useWorkspace.getState().addSession(projectId, 'claude')
}

/** 文件 › 在新窗口中打开项目… (⇧⌘O): pick a folder, then openProjectInNewWindow. */
export async function openProjectInNewWindowInteractive(): Promise<void> {
  if (isNewSessionSheetOpen()) return
  const path = await window.tr.ui.pickFolder()
  if (!path) return
  openProjectInNewWindow(useWorkspace.getState().addProject(path))
}

/** The project header's ＋, the empty project's 新建会话 row and the Worktree view's ＋: the sheet, with that project chosen (PRD F4). */
export function newSessionInProject(projectId: ProjectId): void {
  openNewSessionSheet(projectId)
}

/** Right-click on a project header, or its … button. */
export async function openProjectMenu(projectId: ProjectId, anchor: MenuAnchor): Promise<void> {
  const state = useWorkspace.getState()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return
  const worktreeIds = new Set(state.worktrees.filter((w) => w.projectId === projectId).map((w) => w.id))
  const sessionCount = state.sessions.filter((s) => worktreeIds.has(s.worktreeId)).length
  const entries: MenuEntry[] = [
    { type: 'item', id: 'new', label: '新建会话…', accelerator: 'CmdOrCtrl+N' },
    { type: 'item', id: 'window', label: '在新窗口中打开' },
    { type: 'item', id: 'reveal', label: '在 Finder 中显示' },
    { type: 'item', id: 'copy-path', label: '复制路径' },
    { type: 'item', id: 'remove', label: removeProjectMenuLabel(sessionCount) }
  ]
  const choice = await popupMenu(entries, anchor)
  if (choice === 'reveal') window.tr.ui.revealInFinder(project.rootPath)
  else if (choice === 'copy-path') void navigator.clipboard.writeText(project.rootPath).catch(() => {})
  else if (choice === 'remove') await removeProjectInteractive(projectId)
  else if (choice === 'new') openNewSessionSheet(projectId)
  else if (choice === 'window') openProjectInNewWindow(projectId)
}

/** Closes a session; asks first while its agent is running or waiting for the user. Resolves to whether it closed. */
export async function closeSessionInteractive(sessionId: SessionId): Promise<boolean> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session) return false
  const prompt = closeSessionConfirmation(session.title, session.status)
  if (prompt && !(await window.tr.ui.confirm(prompt))) return false
  useWorkspace.getState().closeSession(sessionId)
  return true
}

/** Removes a project and its sessions; asks first when any of them is running or waiting. */
export async function removeProjectInteractive(projectId: ProjectId): Promise<boolean> {
  const state = useWorkspace.getState()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return false
  const worktreeIds = new Set(state.worktrees.filter((w) => w.projectId === projectId).map((w) => w.id))
  const active = countActive(state.sessions.filter((s) => worktreeIds.has(s.worktreeId)).map((s) => s.status))
  const prompt = removeProjectConfirmation(project.name, active)
  if (prompt && !(await window.tr.ui.confirm(prompt))) return false
  useWorkspace.getState().removeProject(projectId)
  return true
}

/** ⌘N: the new-session sheet for the current project (PRD F4); with no project yet, open one first. */
export async function quickNewSession(): Promise<void> {
  if (isNewSessionSheetOpen()) return
  const state = useWorkspace.getState()
  const projectId = projectOfSession(state, state.activeSessionId) ?? state.projects[0]?.id
  if (projectId) openNewSessionSheet(projectId)
  else await openProjectInteractive()
}

/**
 * Right-click on a session: 关闭会话, 在此新建会话 — another session in the same worktree folder, started directly
 * without the sheet (PRD F4) — and, in a linked worktree, 归档 worktree… (PRD F15).
 */
export async function openSessionContextMenu(sessionId: SessionId, anchor: MenuAnchor): Promise<void> {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === sessionId)
  const worktree = state.worktrees.find((w) => w.id === session?.worktreeId)
  const entries: MenuEntry[] = [
    { type: 'item', id: 'window', label: '移到新窗口' },
    { type: 'item', id: 'close', label: '关闭会话', accelerator: 'CmdOrCtrl+W' }
  ]
  if (worktree) {
    entries.push(
      { type: 'submenu', label: '在此新建会话', items: KINDS.map((kind) => ({ type: 'item', id: `here:${kind}`, label: agentName(kind) })) }
    )
    if (!worktree.isMain) entries.push({ type: 'item', id: 'archive', label: '归档 worktree…' })
  }
  const choice = await popupMenu(entries, anchor)
  if (choice === 'close') await closeSessionInteractive(sessionId)
  if (choice === 'window') moveSessionToNewWindow(sessionId)
  if (choice === 'archive' && worktree) openArchiveSheet(worktree.id)
  const kind = choice?.startsWith('here:') ? (choice.slice('here:'.length) as AgentKind) : null
  if (!kind || !worktree || !KINDS.includes(kind)) return
  const workspace = useWorkspace.getState()
  if (worktree.isMain) {
    const id = workspace.addSession(worktree.projectId, kind)
    if (id) useWorkspace.getState().setActiveSession(id)
  } else {
    workspace.addSessionInWorktree(worktree.projectId, { path: worktree.path, branch: worktree.branch }, kind)
  }
}

/**
 * The session header's … (B11): 重命名 · 在 Finder 中显示 · 复制路径 · 同任务多解… · 移到新窗口 · 关闭会话 (Figma 26A).
 * Renaming is inline in the header, so that choice is handed back to it.
 */
export async function openSessionHeaderMenu(sessionId: SessionId, anchor: MenuAnchor): Promise<'rename' | null> {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return null
  const path = state.worktrees.find((w) => w.id === session.worktreeId)?.path
  const entries: MenuEntry[] = [
    { type: 'item', id: 'rename', label: '重命名…' },
    { type: 'item', id: 'reveal', label: '在 Finder 中显示', enabled: path !== undefined },
    { type: 'item', id: 'copy-path', label: '复制路径', enabled: path !== undefined },
    { type: 'item', id: 'same-task', label: '同任务多解…', accelerator: 'Shift+CmdOrCtrl+N', enabled: canRunSameTask(sessionId) },
    { type: 'item', id: 'window', label: '移到新窗口' },
    { type: 'item', id: 'close', label: '关闭会话', accelerator: 'CmdOrCtrl+W' }
  ]
  const choice = await popupMenu(entries, anchor)
  if (choice === 'rename') return 'rename'
  if (choice === 'same-task') openSameTask(sessionId)
  if (choice === 'window') moveSessionToNewWindow(sessionId)
  if (choice === 'reveal' && path) window.tr.ui.revealInFinder(path)
  else if (choice === 'copy-path' && path) void navigator.clipboard.writeText(path).catch(() => {})
  else if (choice === 'close') await closeSessionInteractive(sessionId)
  return null
}

const MAX_TITLE_CHARS = 200

/** Renames a session; blank or unchanged input keeps the old title. */
export function renameSession(sessionId: SessionId, input: string): void {
  const title = [...input.replace(/\s+/g, ' ').trim()].slice(0, MAX_TITLE_CHARS).join('')
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session || title === '' || title === session.title) return
  // From now on the agent's own title never replaces it (PRD F2).
  useWorkspace.getState().patchSession(sessionId, { title, titleSource: 'user' })
}

const plainCmd = (e: KeyboardEvent, key: string) =>
  e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key

/** ⌘W: close the active session (with the running-session confirmation); with a sheet open, close that. */
export async function closeActiveSession(): Promise<void> {
  if (isNewSessionSheetOpen()) {
    closeNewSessionSheet(true)
    return
  }
  if (isMergeSheetOpen()) {
    closeMergeSheet(true)
    return
  }
  if (isSameTaskOpen()) {
    closeSameTask(true)
    return
  }
  if (useArchiveSheet.getState().target) {
    closeArchiveSheet(true)
    return
  }
  const id = useWorkspace.getState().activeSessionId
  if (id) await closeSessionInteractive(id)
}

// Capture phase so ⌘N / ⌘O / ⌘W work while the terminal or composer has focus.
const onKeyDown = (e: KeyboardEvent) => {
  const command = plainCmd(e, 'n') ? 'new-session' : plainCmd(e, 'o') ? 'open-project' : plainCmd(e, 'w') ? 'close-session' : null
  if (!command) return
  e.preventDefault()
  e.stopPropagation()
  noteKeyCommand(command)
  void (command === 'new-session' ? quickNewSession() : command === 'open-project' ? openProjectInteractive() : closeActiveSession())
}
// In every window (F20 · 多窗口).
const uninstall = everyWindow((win) => {
  win.addEventListener('keydown', onKeyDown, true)
  return () => win.removeEventListener('keydown', onKeyDown, true)
})
if (import.meta.hot) import.meta.hot.dispose(uninstall)
