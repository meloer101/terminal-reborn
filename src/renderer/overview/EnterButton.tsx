// 进入会话 ↵ — Figma Button (9:33), ghost with its shortcut inline: the expanded list row and the overlay bar.
import type { SessionId } from '@shared/types'
import { enterSession } from './store'
import styles from './EnterButton.module.css'

export function EnterButton({ sessionId }: { sessionId: SessionId }) {
  return (
    <button
      type="button"
      className={styles.enter}
      onClick={(e) => {
        e.stopPropagation()
        enterSession(sessionId)
      }}
    >
      进入会话
      <span className={styles.key} aria-hidden>
        ↵
      </span>
    </button>
  )
}
