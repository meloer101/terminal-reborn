import { ChevronDown, ChevronRight, Ellipsis, Plus } from 'lucide-react'
import type { SessionStatus } from '@shared/types'
import { pointerAnchor, type MenuAnchor } from '../ui/menu'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './ProjectHeader.module.css'

const ICON = { size: 16, strokeWidth: 1.75 } as const

interface Props {
  name: string
  /** Sessions in the project — written only while it is collapsed, when its rows can't be counted (Figma 34P). */
  count: number
  collapsed: boolean
  /** Shown on a collapsed header so a folded project can't hide a session that needs you. */
  attention: SessionStatus | null
  onToggle(): void
  /** ＋ — the new-session sheet for this project (PRD F4). */
  onNewSession(): void
  /** … and right-click — the project menu, under the … or at the pointer. */
  onMenu(anchor: MenuAnchor): void
}

/**
 * Figma component `ProjectHeader` (50:1473; Figma 34P). The project is the parent of its sessions, so it carries the
 * strongest type in the list (Body/Heading, primary). Its chevron hangs in the same column as the rows' status glyphs
 * and the name starts on the sidebar's text line. Collapsed, it shows the most urgent status and the session count;
 * hover / keyboard focus swaps the count for ＋ and … (the status stays).
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
      {collapsed && count > 0 && <span className={styles.count}>{count}</span>}
      <span className={styles.actions}>
        <button type="button" className={styles.action} aria-label={`在 ${name} 新建会话`} title="新建会话 · ⌘N" aria-haspopup="dialog" onClick={() => onNewSession()}>
          <Plus {...ICON} />
        </button>
        <button type="button" className={styles.action} aria-label={`${name} 项目菜单`} title="项目菜单" aria-haspopup="menu" onClick={(e) => onMenu(e.currentTarget)}>
          <Ellipsis {...ICON} />
        </button>
      </span>
    </div>
  )
}
