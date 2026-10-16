import { ChevronDown, ChevronRight, Ellipsis, Plus } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { SessionStatus } from '@shared/types'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './ProjectHeader.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

interface Props {
  name: string
  /** Sessions in the project; an empty project shows no count (Figma 09: docs-site). */
  count: number
  collapsed: boolean
  /** Shown on a collapsed header so a folded project can't hide a session that needs you. */
  attention: SessionStatus | null
  onToggle(): void
  /** ＋ — new session in this project. */
  onNewSession(): void
  /** … and right-click — the project menu. */
  onMenu(): void
}

/**
 * Figma component `ProjectHeader` (State=Default / Hover / Collapsed, 50:1473). The project is the parent of
 * its sessions, so it carries the strongest type in the list (Body/Heading, primary) and a disclosure chevron;
 * session rows are indented under the name. Hover / keyboard focus swaps the count for ＋ and ….
 */
export function ProjectHeader({ name, count, collapsed, attention, onToggle, onNewSession, onMenu }: Props) {
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    onMenu()
  }
  return (
    <div className={styles.header} onContextMenu={onContextMenu}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={!collapsed}
        title={collapsed ? '展开' : '折叠'}
        onClick={onToggle}
      >
        <span className={styles.chevron}>{collapsed ? <ChevronRight {...ICON} /> : <ChevronDown {...ICON} />}</span>
        <h2 className={styles.name}>{name}</h2>
      </button>
      {collapsed && attention && (
        <span className={styles.hint}>
          <StatusGlyph status={attention} />
        </span>
      )}
      {count > 0 && <span className={styles.count}>{count}</span>}
      <span className={styles.actions}>
        <button type="button" className={styles.action} aria-label={`在 ${name} 新建会话`} title="新建会话" onClick={onNewSession}>
          <Plus {...ICON} />
        </button>
        <button type="button" className={styles.action} aria-label={`${name} 项目菜单`} title="项目菜单" onClick={onMenu}>
          <Ellipsis {...ICON} />
        </button>
      </span>
    </div>
  )
}
