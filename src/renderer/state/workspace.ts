// Workspace-wide state: what exists and what is selected.
// Feature-specific state (drafts, terminal instances, panel internals) lives in each
// feature's own store, not here — keeps parallel work from colliding on this file.
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { Project, Session, SessionId, Worktree } from '@shared/types'
import { mockProjects, mockSessions, mockWorktrees } from './mock-data'

export type RightPanelTab = 'changes' | 'graph'

interface WorkspaceState {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  activeSessionId: SessionId | null
  sidebarCollapsed: boolean
  /** null = right panel closed */
  rightPanel: RightPanelTab | null

  setActiveSession(id: SessionId): void
  toggleSidebar(): void
  setRightPanel(tab: RightPanelTab | null): void
}

export const useWorkspace = create<WorkspaceState>()((set) => ({
  projects: mockProjects,
  worktrees: mockWorktrees,
  sessions: mockSessions,
  activeSessionId: mockSessions[0]?.id ?? null,
  sidebarCollapsed: false,
  rightPanel: null,

  setActiveSession: (id) => set({ activeSessionId: id }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setRightPanel: (tab) => set({ rightPanel: tab })
}))

export function useActiveSession(): { session: Session; worktree: Worktree | undefined } | null {
  const { session, worktree } = useWorkspace(
    useShallow((s) => {
      const session = s.sessions.find((x) => x.id === s.activeSessionId)
      return { session, worktree: session && s.worktrees.find((w) => w.id === session.worktreeId) }
    })
  )
  return session ? { session, worktree } : null
}
