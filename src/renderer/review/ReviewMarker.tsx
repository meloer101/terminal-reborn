// The `P1` tag on a diff line a review finding points at (PRD F13 v1.78, Figma 29B2). Clicking it reveals the finding
// in the review block at the top of Git · 变更.
import type { ReviewMark } from './marks'

export function ReviewMarker({ marks }: { marks: readonly ReviewMark[] }) {
  if (marks.length === 0) return null
  return <span>{marks[0]!.severity}</span>
}
