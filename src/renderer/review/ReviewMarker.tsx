// The `P1` tag on a diff line a review finding points at (PRD F13 v1.78, Figma 29B2). Clicking it reveals the finding
// in the review block at the top of Git · 变更.
import type { MouseEvent } from 'react'
import type { ReviewMark } from './marks'
import { revealFinding, useReviewFlash } from './reveal'
import styles from './ReviewBlock.module.css'

/** The most severe finding of the line (marks come sorted); the others are named in the tooltip. */
export function ReviewMarker({ marks }: { marks: readonly ReviewMark[] }) {
  const flashing = useReviewFlash((s) => s.marker)
  const first = marks[0]
  if (!first) return null
  const onClick = (event: MouseEvent): void => {
    event.stopPropagation()
    revealFinding(first.commentId)
  }
  return (
    <button
      type="button"
      className={styles.marker}
      data-tone={first.severity === 'P0' || first.severity === 'P1' ? 'attention' : 'quiet'}
      data-flash={marks.some((m) => m.commentId === flashing) || undefined}
      data-review-mark={marks.map((m) => m.commentId).join(' ')}
      aria-label={`审阅 ${marks.map((m) => m.severity).join('、')}，在审阅结果里查看`}
      title={marks.length > 1 ? marks.map((m) => m.severity).join(' · ') : undefined}
      onClick={onClick}
    >
      {first.severity}
    </button>
  )
}
