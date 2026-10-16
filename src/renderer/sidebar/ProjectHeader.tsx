import { ChevronDown, ChevronRight, Ellipsis, Plus } from 'lucide-react'
import type { SessionStatus } from '@shared/types'
import { pointerAnchor, type MenuAnchor } from '../ui/menu'
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
  /** ＋ — new session in this project; the menu drops down from `anchor`. */
  onNewSession(anchor: MenuAnchor): void
  /** … and right-click — the project menu, under the … or at the pointer. */
  onMenu(anchor: MenuAnchor): void
}

/**
 * Figma component `ProjectHeader` (State=Default / Hover / Collapsed, 50:1473). The project is the parent of
 * its sessions, so it carries the strongest type in the list (Body/Heading, primary) and a disclosure chevron;
 * session rows are indented under the name. Hover / keyboard focus swaps the count for ＋ and ….
 */
export function ProjectHeader({ name, count, collapsed, attention, onToggle, onNewSession, onMenu }: Props) {
  return (
    <div
      className={styles.header}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(pointerAnchor(e))
      }}
    >
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
        <button type="button" className={styles.action} aria-label={`在 ${name} 新建会话`} title="新建会话" aria-haspopup="menu" onClick={(e) => onNewSession(e.currentTarget)}>
          <Plus {...ICON} />
        </button>
        <button type="button" className={styles.action} aria-label={`${name} 项目菜单`} title="项目菜单" aria-haspopup="menu" onClick={(e) => onMenu(e.currentTarget)}>
          <Ellipsis {...ICON} />
        </button>
      </span>
    </div>
  )
}
