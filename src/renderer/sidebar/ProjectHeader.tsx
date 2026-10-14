import { Ellipsis, Plus } from 'lucide-react'
import type { MouseEvent } from 'react'
import styles from './ProjectHeader.module.css'

interface ProjectActions {
  /** ＋ — new session in this project. */
  onNewSession(): void
  /** … and right-click — the project menu. */
  onMenu(): void
}

/**
 * Figma component `ProjectHeader` (State=Default / Hover, 50:1473): group name left, session count
 * right. For a project, hover / keyboard focus swaps the count for ＋ and …. Also titles the "等你处理" queue.
 */
export function ProjectHeader({ name, count, actions }: { name: string; count: number; actions?: ProjectActions }) {
  const onContextMenu = actions
    ? (e: MouseEvent) => {
        e.preventDefault()
        actions.onMenu()
      }
    : undefined
  return (
    <div className={styles.header} data-actions={actions ? 'true' : undefined} onContextMenu={onContextMenu}>
      <h2 className={styles.name}>{name}</h2>
      {/* An empty group shows no count (Figma 09: docs-site). */}
      {count > 0 && <span className={styles.count}>{count}</span>}
      {actions && (
        <span className={styles.actions}>
          <button type="button" className={styles.action} aria-label={`在 ${name} 新建会话`} title="新建会话" onClick={actions.onNewSession}>
            <Plus size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className={styles.action} aria-label={`${name} 项目菜单`} title="项目菜单" onClick={actions.onMenu}>
            <Ellipsis size={16} strokeWidth={1.75} />
          </button>
        </span>
      )}
    </div>
  )
}
