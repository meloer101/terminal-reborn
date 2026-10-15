// Pure workspace mutations and persistence format. The zustand store in ./workspace applies these.
// M1 has no git integration: a project is a folder with a single "main" worktree.
import type { AgentKind, Project, ProjectId, Session, SessionId, Worktree } from '@shared/types'
import { MAX_RECENT_PROJECTS, WORKSPACE_FILE_VERSION, type PersistedRightPanel, type WorkspaceFile } from '@shared/workspace-file'

export interface WorkspaceData {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  activeSessionId: SessionId | null
}

export const EMPTY_WORKSPACE: WorkspaceData = { projects: [], worktrees: [], sessions: [], activeSessionId: null }

export const DEFAULT_SESSION_TITLE: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', shell: '终端' }

export type MakeId = (prefix: string) => string

export const randomId: MakeId = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || trimmed || '/'
}

/** Adds a folder as a project, or returns the existing project for that folder. */
export function addProject(
  data: WorkspaceData,
  rootPath: string,
  makeId: MakeId = randomId
): { data: WorkspaceData; projectId: ProjectId } {
  const existing = data.projects.find((p) => p.rootPath === rootPath)
  if (existing) return { data, projectId: existing.id }
  const project: Project = { id: makeId('p'), name: basename(rootPath), rootPath }
  // Branch stays empty until git integration (M4) can read it.
  const worktree: Worktree = { id: makeId('w'), projectId: project.id, branch: '', path: rootPath, isMain: true }
  return {
    data: { ...data, projects: [...data.projects, project], worktrees: [...data.worktrees, worktree] },
    projectId: project.id
  }
}

/** Puts a folder at the front of the recently opened projects (first-run screen, B10). */
export function rememberRecentProject(recent: readonly string[], rootPath: string): string[] {
  if (recent[0] === rootPath) return recent as string[]
  return [rootPath, ...recent.filter((p) => p !== rootPath)].slice(0, MAX_RECENT_PROJECTS)
}

/** Starts a session in the project's main checkout and selects it. */
export function addSession(
  data: WorkspaceData,
  projectId: ProjectId,
  kind: AgentKind,
  now: number,
  makeId: MakeId = randomId
): { data: WorkspaceData; sessionId: SessionId } | null {
  const worktree = data.worktrees.find((w) => w.projectId === projectId && w.isMain)
  if (!worktree) return null
  const session: Session = {
    id: makeId('s'),
    worktreeId: worktree.id,
    kind,
    title: DEFAULT_SESSION_TITLE[kind],
    status: 'idle',
    startedAt: now,
    lastActivityAt: now
  }
  return { data: { ...data, sessions: [...data.sessions, session], activeSessionId: session.id }, sessionId: session.id }
}

/** Removes a session; if it was selected, selects its neighbour (next, else previous). */
export function closeSession(data: WorkspaceData, sessionId: SessionId): WorkspaceData {
  const at = data.sessions.findIndex((s) => s.id === sessionId)
  if (at === -1) return data
  const sessions = data.sessions.filter((s) => s.id !== sessionId)
  const activeSessionId =
    data.activeSessionId === sessionId ? (sessions[at]?.id ?? sessions[at - 1]?.id ?? null) : data.activeSessionId
  return { ...data, sessions, activeSessionId }
}

/** Removes a project with its worktrees and sessions. */
export function removeProject(data: WorkspaceData, projectId: ProjectId): WorkspaceData {
  const worktreeIds = new Set(data.worktrees.filter((w) => w.projectId === projectId).map((w) => w.id))
  let next: WorkspaceData = data
  for (const s of data.sessions) if (worktreeIds.has(s.worktreeId)) next = closeSession(next, s.id)
  return {
    ...next,
    projects: next.projects.filter((p) => p.id !== projectId),
    worktrees: next.worktrees.filter((w) => !worktreeIds.has(w.id))
  }
}

export function projectOfSession(data: WorkspaceData, sessionId: SessionId | null): ProjectId | null {
  const session = data.sessions.find((s) => s.id === sessionId)
  return data.worktrees.find((w) => w.id === session?.worktreeId)?.projectId ?? null
}

// ---------------------------------------------------------------------------------------------
// Persistence (the file format and its sanitizer live in @shared/workspace-file)
// ---------------------------------------------------------------------------------------------

/** UI state saved next to the workspace. */
export interface WorkspaceUi {
  sidebarCollapsed: boolean
  rightPanel: PersistedRightPanel | null
  recentProjects: readonly string[]
}

/** Only what defines the workspace; live status is rebuilt at runtime. */
export function serializeWorkspace(data: WorkspaceData, ui: WorkspaceUi, drafts: Readonly<Record<string, string>>): WorkspaceFile {
  return {
    version: WORKSPACE_FILE_VERSION,
    projects: data.projects.map(({ id, name, rootPath }) => ({ id, name, rootPath })),
    worktrees: data.worktrees.map(({ id, projectId, branch, path, isMain, baseBranch }) => ({
      id,
      projectId,
      branch,
      path,
      isMain,
      ...(baseBranch ? { baseBranch } : {})
    })),
    sessions: data.sessions.map(({ id, worktreeId, kind, title, agentSessionId, startedAt, lastActivityAt }) => ({
      id,
      worktreeId,
      kind,
      title,
      ...(agentSessionId ? { agentSessionId } : {}),
      startedAt,
      lastActivityAt
    })),
    activeSessionId: data.activeSessionId,
    sidebarCollapsed: ui.sidebarCollapsed,
    rightPanel: ui.rightPanel,
    ...(ui.recentProjects.length > 0 ? { recentProjects: [...ui.recentProjects] } : {}),
    drafts: Object.fromEntries(
      Object.entries(drafts).filter(([id, text]) => text.length > 0 && data.sessions.some((s) => s.id === id))
    )
  }
}

/**
 * Workspace from a saved file. Processes do not survive a restart, so agent sessions come back
 * `not-started` (spawned, and resumed when they have a conversation id, the first time they are
 * viewed); shells have no phase. `startedAt` is kept, not reset.
 */
export function restoreWorkspace(file: WorkspaceFile | null): WorkspaceData {
  if (!file) return EMPTY_WORKSPACE
  return {
    projects: file.projects,
    worktrees: file.worktrees.map((w) => ({ ...w })),
    sessions: file.sessions.map((s) => ({
      id: s.id,
      worktreeId: s.worktreeId,
      kind: s.kind,
      title: s.title,
      status: 'idle',
      startedAt: s.startedAt,
      lastActivityAt: s.lastActivityAt,
      ...(s.agentSessionId ? { agentSessionId: s.agentSessionId } : {}),
      ...(s.kind === 'shell' ? {} : { phase: 'not-started' as const })
    })),
    activeSessionId: file.activeSessionId
  }
}

type PersistedView = WorkspaceData & WorkspaceUi

/** Whether anything that is saved changed. Live status and activity times change constantly and do not count. */
export function persistedStateChanged(next: PersistedView, prev: PersistedView): boolean {
  if (
    next.projects !== prev.projects ||
    next.worktrees !== prev.worktrees ||
    next.activeSessionId !== prev.activeSessionId ||
    next.sidebarCollapsed !== prev.sidebarCollapsed ||
    next.rightPanel !== prev.rightPanel ||
    next.recentProjects !== prev.recentProjects ||
    next.sessions.length !== prev.sessions.length
  ) {
    return true
  }
  return next.sessions.some((s, i) => {
    const before = prev.sessions[i]
    return !before || s.id !== before.id || s.title !== before.title || s.agentSessionId !== before.agentSessionId || s.worktreeId !== before.worktreeId
  })
}

/** Sessions in `prev` that are gone in `next`. */
export function removedSessionIds(next: WorkspaceData, prev: WorkspaceData): SessionId[] {
  const alive = new Set(next.sessions.map((s) => s.id))
  return prev.sessions.filter((s) => !alive.has(s.id)).map((s) => s.id)
}

const TITLE_MAX_CHARS = 40

/**
 * Title for a session still carrying its default name, taken from the first prompt (PRD F2).
 * Returns null when the session already has a real title or the prompt has nothing usable.
 */
export function titleFromFirstPrompt(session: Pick<Session, 'kind' | 'title'>, prompt: string): string | null {
  if (session.title !== DEFAULT_SESSION_TITLE[session.kind]) return null
  const line = prompt
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('/'))
  if (!line) return null
  const chars = [...line.replace(/\s+/g, ' ')]
  return chars.length > TITLE_MAX_CHARS ? `${chars.slice(0, TITLE_MAX_CHARS).join('')}…` : chars.join('')
}
