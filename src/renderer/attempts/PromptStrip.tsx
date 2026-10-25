// The two-line bar under a session's terminal that asks for the user's move (Figma PromptBar 11:173, 26C / 26J): the
// waiting mark, what happened and a mono detail, then the actions. Status is the mark's shape plus the text.
import type { ReactNode } from 'react'
import { StatusGlyph } from '../ui/StatusGlyph'
import styles from './PromptStrip.module.css'

export interface PromptAction {
  label: string
  /** Its shortcut, drawn before the label (Figma OptionItem). */
  keys?: string
  disabled?: boolean
  onClick: () => void
}

export function PromptStrip({ question, detail, actions, testId }: { question: ReactNode; detail?: string; actions: readonly PromptAction[]; testId: string }) {
  return (
    <div className={styles.bar} role="status" data-testid={testId}>
      <div className={styles.head}>
        <StatusGlyph status="needs_you" />
        <p className={styles.question}>{question}</p>
        {detail && (
          <span className={styles.detail} title={detail}>
            {detail}
          </span>
        )}
      </div>
      <div className={styles.options}>
        {actions.map((action) => (
          <button key={action.label} type="button" className={styles.option} disabled={action.disabled} onClick={action.onClick}>
            {action.keys && <span className={styles.key}>{action.keys}</span>}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}
