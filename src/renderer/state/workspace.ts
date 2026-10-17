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
  persistedStateChanged,
  rememberRecentProject,
  removedSessionIds,
  removeProject,
  restoreWorkspace,
  serializeWorkspace,
  type WorkspaceData
} from './workspace-model'
import { drafts, initialWorkspaceFile, requestSave, setSnapshotProvider } from './persistence'

export type RightPanelTab = 'changes' | 'graph'

/** What the main area shows: the active session's terminal, or the cross-project overview (PRD F9). */
export type MainView = 'session' | 'overview'

interface WorkspaceState extends WorkspaceData {
  sidebarCollapsed: boolean
  /** null = right panel closed */
  rightPanel: RightPanelTab | null
  /** Projects folded in the sidebar. */
  collapsedProjectIds: ProjectId[]
  mainView: MainView
  /** Folders opened as projects, most recent first (first-run screen). */
  recentProjects: readonly string[]
  /** Bumped whenever the keyboard should go to the active session's terminal (B7), even if it is already active. */
  focusRequest: number
  /** Bumped by 会话 › 重命名会话: the header starts renaming the active session. */
  renameRequest: number

  /** Selects a session, shows its terminal (leaves the overview) and gives that terminal the keyboard. */
  setActiveSession(id: SessionId): void
  /** Gives the active session's terminal the keyboard once it can take it. */
  requestTerminalFocus(): void
  requestRename(): void
  setMainView(view: MainView): void
  toggleSidebar(): void
  setRightPanel(tab: RightPanelTab | null): void
  toggleProjectCollapsed(id: ProjectId): void
  /** Adds (or finds) the project for a folder. */
  addProject(rootPath: string): ProjectId
  removeProject(id: ProjectId): void
  /** Starts a session in the project and selects it; null if the project is gone. */
  addSession(projectId: ProjectId, kind: AgentKind): SessionId | null
  closeSession(id: SessionId): void
  /** Live, non-persisted fields driven by agent signals (status track, M2). */
  patchSession(id: SessionId, patch: SessionPatch): void
}

export type SessionPatch = Partial<
  Pick<
    Session,
    | 'status'
    | 'currentAction'
    | 'title'
    | 'lastActivityAt'
    | 'agentSessionId'
    | 'phase'
    | 'lastReply'
    | 'finishedAt'
    | 'statusSince'
    | 'turnStartedAt'
  >
>

// End-to-end tests opt in to the Figma 01 fixtures and never touch the saved workspace.
const fixtures = (globalThis as { __TR_E2E__?: boolean }).__TR_E2E__ === true

const saved = fixtures ? null : initialWorkspaceFile()

function initialData(): WorkspaceData {
  if (fixtures) {
    return { projects: mockProjects, worktrees: mockWorktrees, sessions: mockSessions, activeSessionId: mockSessions[0]?.id ?? null }
  }
  return restoreWorkspace(saved)
}

const pick = (s: WorkspaceState): WorkspaceData => ({
  projects: s.projects,
  worktrees: s.worktrees,
  sessions: s.sessions,
  activeSessionId: s.activeSessionId
})

export const useWorkspace = create<WorkspaceState>()((set, get) => ({
  ...initialData(),
  sidebarCollapsed: saved?.sidebarCollapsed ?? false,
  rightPanel: saved?.rightPanel ?? null,
  collapsedProjectIds: saved?.collapsedProjectIds ?? [],
  mainView: 'session',
  recentProjects: saved?.recentProjects ?? [],
  focusRequest: 0,
  renameRequest: 0,

  setActiveSession: (id) => set((s) => ({ activeSessionId: id, mainView: 'session', focusRequest: s.focusRequest + 1 })),
  requestTerminalFocus: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
  requestRename: () => set((s) => ({ renameRequest: s.renameRequest + 1 })),
  setMainView: (view) => set({ mainView: view }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setRightPanel: (tab) => set({ rightPanel: tab }),
  toggleProjectCollapsed: (id) =>
    set((s) => ({
      collapsedProjectIds: s.collapsedProjectIds.includes(id)
        ? s.collapsedProjectIds.filter((x) => x !== id)
        : [...s.collapsedProjectIds, id]
    })),

  addProject(rootPath) {
    const result = addProject(pick(get()), rootPath)
    set({ ...result.data, recentProjects: rememberRecentProject(get().recentProjects, rootPath) })
    return result.projectId
  },
  removeProject: (id) => set(removeProject(pick(get()), id)),
  addSession(projectId, kind) {
    const result = addSession(pick(get()), projectId, kind, Date.now())
    if (!result) return null
    set(result.data)
    return result.sessionId
  },
  closeSession: (id) => set(closeSession(pick(get()), id)),
  patchSession: (id, patch) =>
    set((s) => {
      const index = s.sessions.findIndex((x) => x.id === id)
      const current = s.sessions[index]
      if (!current) return {}
      const keys = Object.keys(patch) as (keyof SessionPatch)[]
      if (keys.every((k) => current[k] === patch[k])) return {}
      const sessions = s.sessions.slice()
      sessions[index] = { ...current, ...patch }
      return { sessions }
    })
}))

// Persist what defines the workspace (not live status, which changes constantly). The store in main
// debounces and writes atomically; a closed session's draft goes with it.
setSnapshotProvider(() => {
  const state = useWorkspace.getState()
  return serializeWorkspace(
    pick(state),
    {
      sidebarCollapsed: state.sidebarCollapsed,
      rightPanel: state.rightPanel,
      collapsedProjectIds: state.collapsedProjectIds,
      recentProjects: state.recentProjects
    },
    drafts.snapshot()
  )
})
useWorkspace.subscribe((state, prev) => {
  if (!persistedStateChanged(state, prev)) return
  for (const id of removedSessionIds(state, prev)) drafts.remove(id)
  requestSave()
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
