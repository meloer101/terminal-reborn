// Binds the pure sidebar shortcuts to the workspace store. Installed once at module load
// (imported by Sidebar.tsx) so ⌘1–9 / ⌘J keep working while the sidebar is collapsed.
import { useWorkspace } from '../state/workspace'
import { buildSidebarGroups, nextAttentionSessionId, sessionForShortcut } from './model'
import { installSidebarShortcuts } from './shortcuts'
import { toggleOverview } from '../overview/store'

function groupsNow() {
  const { projects, worktrees, sessions, collapsedProjectIds } = useWorkspace.getState()
  return buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds })
}

const dispose = installSidebarShortcuts(window, {
  selectNth(n) {
    const id = sessionForShortcut(groupsNow(), n)
    if (id) useWorkspace.getState().setActiveSession(id)
    return id
  },
  selectNextAttention() {
    const { sessions, activeSessionId } = useWorkspace.getState()
    const id = nextAttentionSessionId(sessions, activeSessionId)
    if (id) useWorkspace.getState().setActiveSession(id)
    return id
  },
  toggleOverview
})

if (import.meta.hot) import.meta.hot.dispose(dispose)
