import type { MouseEvent } from 'react'
import { Check } from 'lucide-react'
import styles from './PromptBar.module.css'

/** Keep the composer's focus and caret when a bar button is pressed with the mouse. */
export const keepFocus = (e: MouseEvent) => e.preventDefault()

/**
 * One answer — Figma component `OptionItem` (9:61). The number is the keyboard shortcut; `focused` mirrors the
 * row the TUI highlights; `selected` is a ticked multi-select row (a check mark, so it is not colour-only).
 */
export function OptionItem({
  number,
  label,
  description,
  focused = false,
  selected,
  onClick
}: {
  number: number
  label: string
  description?: string
  focused?: boolean
  /** undefined = not a multi-select row */
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={styles.option}
      data-focused={focused}
      data-selected={selected === true}
      role={selected === undefined ? undefined : 'checkbox'}
      aria-checked={selected}
      aria-keyshortcuts={number <= 9 ? `${number} Alt+${number}` : undefined}
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      <span className={styles.optionKey} aria-hidden="true">
        {number}
      </span>
      <span className={styles.optionLabel}>{label}</span>
      {description && <span className={styles.optionDescription}>{description}</span>}
      {selected === true && <Check size={16} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  )
}
