import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './NavItem.module.css'

/** Figma component `NavItem` (11:81): 30px row, 16px icon, label, ⌘ hint on the right. */
export function NavItem({
  icon,
  label,
  shortcut,
  ...rest
}: { icon: ReactNode; label: string; shortcut: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={styles.item} aria-keyshortcuts={shortcut} {...rest}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{label}</span>
      <kbd className={styles.kbd}>{shortcut}</kbd>
    </button>
  )
}
