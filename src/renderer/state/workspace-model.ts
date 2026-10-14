// Pure workspace mutations and persistence format. The zustand store in ./workspace applies these.
// M1 has no git integration: a project is a folder with a single "main" worktree.
import type { AgentKind, Project, ProjectId, Session, SessionId, Worktree } from '@shared/types'

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
// Persistence
// ---------------------------------------------------------------------------------------------

export const WORKSPACE_STORAGE_KEY = 'tr.workspace.v1'

/** Only what defines the workspace; live status is rebuilt at runtime. */
export function serializeWorkspace(data: WorkspaceData): string {
  return JSON.stringify({
    projects: data.projects,
    worktrees: data.worktrees.map(({ id, projectId, branch, path, isMain }) => ({ id, projectId, branch, path, isMain })),
    sessions: data.sessions.map(({ id, worktreeId, kind, title }) => ({ id, worktreeId, kind, title })),
    activeSessionId: data.activeSessionId
  })
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const KINDS: ReadonlySet<unknown> = new Set<AgentKind>(['claude', 'codex', 'shell'])

/**
 * Restores a saved workspace, dropping anything malformed or orphaned. Processes do not survive
 * a restart (M6), so every session comes back as a fresh `idle` one.
 */
export function restoreWorkspace(raw: string | null, now: number): WorkspaceData {
  if (!raw) return EMPTY_WORKSPACE
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return EMPTY_WORKSPACE
  }
  if (!isRecord(value)) return EMPTY_WORKSPACE
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : [])

  const projects: Project[] = list(value.projects)
    .filter((p) => isString(p.id) && isString(p.name) && isString(p.rootPath))
    .map((p) => ({ id: p.id as string, name: p.name as string, rootPath: p.rootPath as string }))
  const projectIds = new Set(projects.map((p) => p.id))

  const worktrees: Worktree[] = list(value.worktrees)
    .filter((w) => isString(w.id) && isString(w.projectId) && projectIds.has(w.projectId) && isString(w.branch) && isString(w.path))
    .map((w) => ({
      id: w.id as string,
      projectId: w.projectId as string,
      branch: w.branch as string,
      path: w.path as string,
      isMain: w.isMain === true
    }))
  const worktreeIds = new Set(worktrees.map((w) => w.id))

  const sessions: Session[] = list(value.sessions)
    .filter((s) => isString(s.id) && isString(s.worktreeId) && worktreeIds.has(s.worktreeId) && KINDS.has(s.kind) && isString(s.title))
    .map((s) => ({
      id: s.id as string,
      worktreeId: s.worktreeId as string,
      kind: s.kind as AgentKind,
      title: s.title as string,
      status: 'idle',
      startedAt: now,
      lastActivityAt: now
    }))

  const active = isString(value.activeSessionId) && sessions.some((s) => s.id === value.activeSessionId)
  return { projects, worktrees, sessions, activeSessionId: active ? (value.activeSessionId as string) : (sessions[0]?.id ?? null) }
}
