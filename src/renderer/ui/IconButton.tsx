import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './IconButton.module.css'

/** 28×28 ghost button with a 16px icon — Figma component `IconButton` (9:42). */
export function IconButton({
  label,
  active = false,
  children,
  ...rest
}: { label: string; active?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={styles.button} aria-label={label} title={label} data-active={active} {...rest}>
      {children}
    </button>
  )
}
