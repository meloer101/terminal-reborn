// PLACEHOLDER — owned by the `sidebar-ui` track (docs/tasks/m1-sidebar-ui.md).
// Minimal stand-in so the shell is navigable; replace wholesale.
import { PanelLeft, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../state/workspace'
import { IconButton } from '../ui/IconButton'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const { projects, worktrees, sessions, activeSessionId, setActiveSession, toggleSidebar } = useWorkspace(
    useShallow((s) => ({
      projects: s.projects,
      worktrees: s.worktrees,
      sessions: s.sessions,
      activeSessionId: s.activeSessionId,
      setActiveSession: s.setActiveSession,
      toggleSidebar: s.toggleSidebar
    }))
  )

  return (
    <>
      <div className={styles.titlebar}>
        <IconButton label="隐藏侧栏" onClick={toggleSidebar}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      <nav className={styles.nav}>
        <button type="button" className={styles.navItem}>
          <Plus size={16} strokeWidth={1.75} /> 新任务 <kbd>⌘N</kbd>
        </button>
        <button type="button" className={styles.navItem}>
          <Search size={16} strokeWidth={1.75} /> 跳转到… <kbd>⌘K</kbd>
        </button>
      </nav>
      <div className={styles.sessions}>
        {projects.map((project) => (
          <section key={project.id}>
            <h2 className={styles.project}>{project.name}</h2>
            {sessions
              .filter((s) => worktrees.find((w) => w.id === s.worktreeId)?.projectId === project.id)
              .map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className={styles.row}
                  data-selected={s.id === activeSessionId}
                  onClick={() => setActiveSession(s.id)}
                >
                  <StatusGlyph status={s.status} />
                  {s.title}
                </button>
              ))}
          </section>
        ))}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.navItem}>
          <SlidersHorizontal size={16} strokeWidth={1.75} /> 设置 <kbd>⌘,</kbd>
        </button>
      </div>
    </>
  )
}
