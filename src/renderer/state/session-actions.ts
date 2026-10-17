// User-facing workspace commands: opening projects and creating sessions in them (Figma 09).
// Menus are the app's own (ui/MenuHost.tsx), anchored to the control or pointer that opened them.
import {
  closeSessionConfirmation,
  countActive,
  removeProjectConfirmation,
  removeProjectMenuLabel
} from '@shared/lifecycle'
import type { AgentKind, ProjectId, SessionId } from '@shared/types'
import { popupMenu, type MenuAnchor, type MenuEntry } from '../ui/menu'
import { noteKeyCommand } from './key-commands'
import { useWorkspace } from './workspace'
import { projectOfSession } from './workspace-model'

const NEW_SESSION_LABEL: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', shell: '终端' }
const NEW_SESSION_IN_PROJECT_LABEL: Record<AgentKind, string> = {
  claude: '新建 Claude Code 会话',
  codex: '新建 Codex 会话',
  shell: '新建终端'
}
const KINDS: AgentKind[] = ['claude', 'codex', 'shell']

function kindItems(projectId: ProjectId, labels: Record<AgentKind, string>): MenuEntry[] {
  return KINDS.map((kind) => ({
    type: 'item',
    id: `new:${projectId}:${kind}`,
    label: labels[kind],
    // ⌘N always means "Claude Code in the current project".
    ...(kind === 'claude' ? { accelerator: 'CmdOrCtrl+N' } : {})
  }))
}

async function runNewSessionChoice(id: string | null): Promise<void> {
  const match = id ? /^new:(.+):(claude|codex|shell)$/.exec(id) : null
  if (match) useWorkspace.getState().addSession(match[1]!, match[2] as AgentKind)
}

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
  const path = await window.tr.ui.pickFolder()
  return path ? openProjectPath(path, kind) : null
}

/** @deprecated Use openProjectInteractive. Kept for the command palette. */
export const addProjectInteractive = openProjectInteractive

/** The project header's ＋ and the empty project's 新建会话 row. */
export async function openNewSessionMenu(projectId: ProjectId, anchor: MenuAnchor): Promise<void> {
  await runNewSessionChoice(await popupMenu(kindItems(projectId, NEW_SESSION_LABEL), anchor))
}

/** Right-click on a project header, or its … button. */
export async function openProjectMenu(projectId: ProjectId, anchor: MenuAnchor): Promise<void> {
  const state = useWorkspace.getState()
  const project = state.projects.find((p) => p.id === projectId)
  if (!project) return
  const worktreeIds = new Set(state.worktrees.filter((w) => w.projectId === projectId).map((w) => w.id))
  const sessionCount = state.sessions.filter((s) => worktreeIds.has(s.worktreeId)).length
  const entries: MenuEntry[] = [
    ...kindItems(projectId, NEW_SESSION_IN_PROJECT_LABEL),
    { type: 'separator' },
    { type: 'item', id: 'reveal', label: '在 Finder 中显示' },
    { type: 'item', id: 'copy-path', label: '复制路径' },
    { type: 'separator' },
    { type: 'item', id: 'remove', label: removeProjectMenuLabel(sessionCount) }
  ]
  const choice = await popupMenu(entries, anchor)
  if (choice === 'reveal') window.tr.ui.revealInFinder(project.rootPath)
  else if (choice === 'copy-path') void navigator.clipboard.writeText(project.rootPath).catch(() => {})
  else if (choice === 'remove') await removeProjectInteractive(projectId)
  else await runNewSessionChoice(choice)
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

/** ⌘N: a Claude Code session in the current project; with no project yet, open one first. */
export async function quickNewSession(): Promise<void> {
  const state = useWorkspace.getState()
  const projectId = projectOfSession(state, state.activeSessionId) ?? state.projects[0]?.id
  if (projectId) state.addSession(projectId, 'claude')
  else await openProjectInteractive()
}

export async function openSessionContextMenu(sessionId: SessionId, anchor: MenuAnchor): Promise<void> {
  const state = useWorkspace.getState()
  const projectId = projectOfSession(state, sessionId)
  const entries: MenuEntry[] = [{ type: 'item', id: 'close', label: '关闭会话', accelerator: 'CmdOrCtrl+W' }]
  if (projectId) {
    entries.push({ type: 'separator' }, { type: 'submenu', label: '在此项目新建', items: kindItems(projectId, NEW_SESSION_LABEL) })
  }
  const choice = await popupMenu(entries, anchor)
  if (choice === 'close') await closeSessionInteractive(sessionId)
  else await runNewSessionChoice(choice)
}

/**
 * The session header's … (B11): 重命名 · 在 Finder 中显示 · 复制路径 · 关闭会话. Renaming is inline in the header,
 * so that choice is handed back to it.
 */
export async function openSessionHeaderMenu(sessionId: SessionId, anchor: MenuAnchor): Promise<'rename' | null> {
  const state = useWorkspace.getState()
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session) return null
  const path = state.worktrees.find((w) => w.id === session.worktreeId)?.path
  const entries: MenuEntry[] = [
    { type: 'item', id: 'rename', label: '重命名…' },
    { type: 'separator' },
    { type: 'item', id: 'reveal', label: '在 Finder 中显示', enabled: path !== undefined },
    { type: 'item', id: 'copy-path', label: '复制路径', enabled: path !== undefined },
    { type: 'separator' },
    { type: 'item', id: 'close', label: '关闭会话', accelerator: 'CmdOrCtrl+W' }
  ]
  const choice = await popupMenu(entries, anchor)
  if (choice === 'rename') return 'rename'
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
  useWorkspace.getState().patchSession(sessionId, { title })
}

const plainCmd = (e: KeyboardEvent, key: string) =>
  e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key

/** ⌘W: close the active session (with the running-session confirmation). */
export async function closeActiveSession(): Promise<void> {
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
window.addEventListener('keydown', onKeyDown, true)
if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('keydown', onKeyDown, true))
