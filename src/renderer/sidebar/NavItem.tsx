import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import styles from './NavItem.module.css'

/**
 * Figma component `NavItem` (11:81): 30px row, 16px icon, label, ⌘ hint on the right (none for 更新). `badge` (Figma
 * `Show count`) replaces the hint, e.g. 总览's glyph + count of sessions that need the user.
 */
export function NavItem({
  icon,
  label,
  shortcut,
  selected = false,
  badge,
  ...rest
}: { icon: ReactNode; label: string; shortcut?: string; selected?: boolean; badge?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button type="button" className={styles.item} aria-keyshortcuts={shortcut} aria-current={selected ? 'page' : undefined} data-selected={selected} {...rest}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{label}</span>
      {badge ? <span className={styles.badge}>{badge}</span> : shortcut && <kbd className={styles.kbd}>{shortcut}</kbd>}
    </button>
  )
}
