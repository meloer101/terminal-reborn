// User-facing workspace commands: opening projects and creating sessions in them (Figma 09).
// Menus are native so they look and behave like the rest of macOS.
import type { MenuEntry } from '@shared/ipc'
import type { AgentKind, ProjectId, SessionId } from '@shared/types'
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

/** "打开项目… ⌘O": pick a folder; a new project starts with a Claude Code session, a known one is selected. */
export async function openProjectInteractive(): Promise<SessionId | null> {
  const path = await window.tr.ui.pickFolder()
  if (!path) return null
  const state = useWorkspace.getState()
  const known = state.projects.find((p) => p.rootPath === path)
  if (known) {
    const worktreeIds = new Set(state.worktrees.filter((w) => w.projectId === known.id).map((w) => w.id))
    const latest = state.sessions.filter((s) => worktreeIds.has(s.worktreeId)).sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0]
    if (latest) state.setActiveSession(latest.id)
    return latest?.id ?? null
  }
  return state.addSession(state.addProject(path), 'claude')
}

/** @deprecated Use openProjectInteractive. Kept for the command palette. */
export const addProjectInteractive = openProjectInteractive

/** The project header's ＋ and the empty project's 新建会话 row. */
export async function openNewSessionMenu(projectId: ProjectId): Promise<void> {
  await runNewSessionChoice(await window.tr.ui.popupMenu(kindItems(projectId, NEW_SESSION_LABEL)))
}

/** Right-click on a project header, or its … button. */
export async function openProjectMenu(projectId: ProjectId): Promise<void> {
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
    { type: 'item', id: 'remove', label: sessionCount > 0 ? `从侧栏移除项目（关闭 ${sessionCount} 个会话）` : '从侧栏移除项目' }
  ]
  const choice = await window.tr.ui.popupMenu(entries)
  if (choice === 'reveal') window.tr.ui.revealInFinder(project.rootPath)
  else if (choice === 'copy-path') void navigator.clipboard.writeText(project.rootPath).catch(() => {})
  else if (choice === 'remove') useWorkspace.getState().removeProject(projectId)
  else await runNewSessionChoice(choice)
}

/** ⌘N: a Claude Code session in the current project; with no project yet, open one first. */
export async function quickNewSession(): Promise<void> {
  const state = useWorkspace.getState()
  const projectId = projectOfSession(state, state.activeSessionId) ?? state.projects[0]?.id
  if (projectId) state.addSession(projectId, 'claude')
  else await openProjectInteractive()
}

export async function openSessionContextMenu(sessionId: SessionId): Promise<void> {
  const state = useWorkspace.getState()
  const projectId = projectOfSession(state, sessionId)
  const entries: MenuEntry[] = [{ type: 'item', id: 'close', label: '关闭会话' }]
  if (projectId) {
    entries.push({ type: 'separator' }, { type: 'submenu', label: '在此项目新建', items: kindItems(projectId, NEW_SESSION_LABEL) })
  }
  const choice = await window.tr.ui.popupMenu(entries)
  if (choice === 'close') useWorkspace.getState().closeSession(sessionId)
  else await runNewSessionChoice(choice)
}

const plainCmd = (e: KeyboardEvent, key: string) =>
  e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key

// Capture phase so ⌘N / ⌘O work while the terminal or composer has focus.
const onKeyDown = (e: KeyboardEvent) => {
  const action = plainCmd(e, 'n') ? quickNewSession : plainCmd(e, 'o') ? openProjectInteractive : null
  if (!action) return
  e.preventDefault()
  e.stopPropagation()
  void action()
}
window.addEventListener('keydown', onKeyDown, true)
if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('keydown', onKeyDown, true))
