// Small review markers on diff lines (PRD F13 v1.78, Figma 29B2): the findings of the latest background review that
// point at a line, so Git · 变更 can tag it (`P1`) instead of showing the whole finding inline.
import type { CommentSide, ReviewSeverity } from '@shared/review-comments'

export interface ReviewMark {
  commentId: string
  severity: ReviewSeverity
}

export const markKey = (side: CommentSide, line: number): string => `${side}:${line}`

/** The marks of one file in the worktree `root`, keyed by markKey(side, line). */
export function useReviewMarks(root: string | null, path: string): ReadonlyMap<string, ReviewMark[]> {
  void root
  void path
  return EMPTY
}

const EMPTY: ReadonlyMap<string, ReviewMark[]> = new Map()
