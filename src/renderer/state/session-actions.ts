// User-facing workspace commands (M1: manual projects and sessions, no worktrees yet).
// Menus are native so they look and behave like the rest of macOS.
import type { MenuEntry } from '@shared/ipc'
import type { AgentKind, ProjectId, SessionId } from '@shared/types'
import { useWorkspace } from './workspace'
import { DEFAULT_SESSION_TITLE, projectOfSession } from './workspace-model'

const KINDS: AgentKind[] = ['claude', 'codex', 'shell']
const ADD_PROJECT = 'add-project'

function kindItems(projectId: ProjectId): MenuEntry[] {
  return KINDS.map((kind) => ({ type: 'item', id: `new:${projectId}:${kind}`, label: DEFAULT_SESSION_TITLE[kind] }))
}

/** Menu for "新任务": the current project first, other projects as submenus, then "添加项目…". */
export function newSessionMenu(): MenuEntry[] {
  const state = useWorkspace.getState()
  const current = projectOfSession(state, state.activeSessionId) ?? state.projects[0]?.id ?? null
  const entries: MenuEntry[] = []
  const currentProject = state.projects.find((p) => p.id === current)
  if (currentProject) {
    entries.push({ type: 'item', id: 'heading', label: currentProject.name, enabled: false }, ...kindItems(currentProject.id))
  }
  const others = state.projects.filter((p) => p.id !== current)
  if (others.length > 0) {
    entries.push({ type: 'separator' })
    for (const p of others) entries.push({ type: 'submenu', label: p.name, items: kindItems(p.id) })
  }
  if (entries.length > 0) entries.push({ type: 'separator' })
  entries.push({ type: 'item', id: ADD_PROJECT, label: '添加项目…' })
  return entries
}

/** Picks a folder, adds it as a project and opens a Claude Code session in it. */
export async function addProjectInteractive(): Promise<SessionId | null> {
  const path = await window.tr.ui.pickFolder()
  if (!path) return null
  const { addProject, addSession } = useWorkspace.getState()
  return addSession(addProject(path), 'claude')
}

async function runMenuChoice(id: string | null): Promise<void> {
  if (!id) return
  if (id === ADD_PROJECT) {
    await addProjectInteractive()
    return
  }
  const match = /^new:(.+):(claude|codex|shell)$/.exec(id)
  if (match) useWorkspace.getState().addSession(match[1]!, match[2] as AgentKind)
}

export async function openNewSessionMenu(): Promise<void> {
  await runMenuChoice(await window.tr.ui.popupMenu(newSessionMenu()))
}

/** ⌘N: a Claude Code session in the current project; with no project yet, add one first. */
export async function quickNewSession(): Promise<void> {
  const state = useWorkspace.getState()
  const projectId = projectOfSession(state, state.activeSessionId) ?? state.projects[0]?.id
  if (projectId) state.addSession(projectId, 'claude')
  else await addProjectInteractive()
}

export async function openSessionContextMenu(sessionId: SessionId): Promise<void> {
  const state = useWorkspace.getState()
  const projectId = projectOfSession(state, sessionId)
  const entries: MenuEntry[] = [{ type: 'item', id: 'close', label: '关闭会话' }]
  if (projectId) entries.push({ type: 'separator' }, { type: 'submenu', label: '在此项目新建', items: kindItems(projectId) })
  const choice = await window.tr.ui.popupMenu(entries)
  if (choice === 'close') useWorkspace.getState().closeSession(sessionId)
  else await runMenuChoice(choice)
}

function isNewSessionShortcut(e: KeyboardEvent): boolean {
  return e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'n'
}

// Capture phase so ⌘N works while the terminal or composer has focus.
const onKeyDown = (e: KeyboardEvent) => {
  if (!isNewSessionShortcut(e)) return
  e.preventDefault()
  e.stopPropagation()
  void quickNewSession()
}
window.addEventListener('keydown', onKeyDown, true)
if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('keydown', onKeyDown, true))
