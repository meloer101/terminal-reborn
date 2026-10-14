// Workspace-wide state: what exists and what is selected.
// Feature-specific state (drafts, terminal instances, panel internals) lives in each
// feature's own store, not here — keeps parallel work from colliding on this file.
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { AgentKind, ProjectId, Session, SessionId, Worktree } from '@shared/types'
import { mockProjects, mockSessions, mockWorktrees } from './mock-data'
import {
  addProject,
  addSession,
  closeSession,
  removeProject,
  restoreWorkspace,
  serializeWorkspace,
  WORKSPACE_STORAGE_KEY,
  type WorkspaceData
} from './workspace-model'

export type RightPanelTab = 'changes' | 'graph'

interface WorkspaceState extends WorkspaceData {
  sidebarCollapsed: boolean
  /** null = right panel closed */
  rightPanel: RightPanelTab | null

  setActiveSession(id: SessionId): void
  toggleSidebar(): void
  setRightPanel(tab: RightPanelTab | null): void
  /** Adds (or finds) the project for a folder. */
  addProject(rootPath: string): ProjectId
  removeProject(id: ProjectId): void
  /** Starts a session in the project and selects it; null if the project is gone. */
  addSession(projectId: ProjectId, kind: AgentKind): SessionId | null
  closeSession(id: SessionId): void
}

// End-to-end tests opt in to the Figma 01 fixtures and never touch the saved workspace.
const fixtures = (globalThis as { __TR_E2E__?: boolean }).__TR_E2E__ === true

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (fixtures) return null
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function initialData(): WorkspaceData {
  if (fixtures) {
    return { projects: mockProjects, worktrees: mockWorktrees, sessions: mockSessions, activeSessionId: mockSessions[0]?.id ?? null }
  }
  let raw: string | null = null
  try {
    raw = storage()?.getItem(WORKSPACE_STORAGE_KEY) ?? null
  } catch {
    // Unavailable storage: start empty.
  }
  return restoreWorkspace(raw, Date.now())
}

const pick = (s: WorkspaceState): WorkspaceData => ({
  projects: s.projects,
  worktrees: s.worktrees,
  sessions: s.sessions,
  activeSessionId: s.activeSessionId
})

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  ...initialData(),
  sidebarCollapsed: false,
  rightPanel: null,

  setActiveSession: (id) => set({ activeSessionId: id }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setRightPanel: (tab) => set({ rightPanel: tab }),

  addProject(rootPath) {
    const result = addProject(pick(get()), rootPath)
    set(result.data)
    return result.projectId
  },
  removeProject: (id) => set(removeProject(pick(get()), id)),
  addSession(projectId, kind) {
    const result = addSession(pick(get()), projectId, kind, Date.now())
    if (!result) return null
    set(result.data)
    return result.sessionId
  },
  closeSession: (id) => set(closeSession(pick(get()), id))
}))

// Persist structural changes (not live status, which changes constantly).
useWorkspace.subscribe((state, prev) => {
  if (
    state.projects === prev.projects &&
    state.worktrees === prev.worktrees &&
    state.sessions.length === prev.sessions.length &&
    state.sessions.every((s, i) => s.id === prev.sessions[i]?.id && s.title === prev.sessions[i]?.title) &&
    state.activeSessionId === prev.activeSessionId
  ) {
    return
  }
  try {
    storage()?.setItem(WORKSPACE_STORAGE_KEY, serializeWorkspace(pick(state)))
  } catch {
    // Quota or privacy mode: the workspace still works for this run.
  }
})

if (fixtures) (globalThis as { __trWorkspace?: typeof useWorkspace }).__trWorkspace = useWorkspace

export function useActiveSession(): { session: Session; worktree: Worktree | undefined } | null {
  const { session, worktree } = useWorkspace(
    useShallow((s) => {
      const session = s.sessions.find((x) => x.id === s.activeSessionId)
      return { session, worktree: session && s.worktrees.find((w) => w.id === session.worktreeId) }
    })
  )
  return session ? { session, worktree } : null
}

const fixtureSessionIds = new Set(mockSessions.map((s) => s.id))

/** What to start in the session's terminal. Fixture sessions are plain shells: they only stand in for agents. */
export function launchKind(session: Session): AgentKind {
  return fixtures && fixtureSessionIds.has(session.id) ? 'shell' : session.kind
}
