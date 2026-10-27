// Small review markers on diff lines (PRD F13 v1.78, Figma 29B2): the findings of the latest background review that
// point at a line, so Git · 变更 can tag it (`P1`) instead of showing the whole finding inline. Pure mapping first,
// then the hook the diff lines call.
import { useMemo } from 'react'
import type { CommentGroup, CommentSide, ReviewComment, ReviewSeverity } from '@shared/review-comments'
import { rowAnchor, splitAnchors, type ChangeItem } from '../panels/git/changes-model'
import { useReviewComments } from '../state/review-comments'

export interface ReviewMark {
  commentId: string
  severity: ReviewSeverity
}

export const markKey = (side: CommentSide, line: number): string => `${side}:${line}`

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/**
 * The marks of one file, keyed by markKey(side, line) of the line a finding starts at; the most severe finding of a
 * line first. Only findings of a background review count (the user's own comments have their own rows), and with
 * `group` only those of that group (a file can be in both 未提交 and 已提交, with different line numbers).
 */
export function marksByLine(comments: readonly ReviewComment[] | undefined, path: string, group?: CommentGroup): Map<string, ReviewMark[]> {
  const marks = new Map<string, ReviewMark[]>()
  for (const comment of comments ?? []) {
    if (comment.origin !== 'review' || comment.severity === undefined || comment.path !== path) continue
    if (group !== undefined && comment.group !== group) continue
    const key = markKey(comment.side, comment.line)
    const list = marks.get(key) ?? []
    list.push({ commentId: comment.id, severity: comment.severity })
    marks.set(key, list)
  }
  for (const list of marks.values()) list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return marks
}

/** The marks of one file in the worktree `root`, keyed by markKey(side, line). `group` narrows them to 未提交 / 已提交. */
export function useReviewMarks(root: string | null, path: string, group?: CommentGroup): ReadonlyMap<string, ReviewMark[]> {
  const comments = useReviewComments((s) => (root ? s.byRoot[root] : undefined))
  return useMemo(() => marksByLine(comments, path, group), [comments, path, group])
}

/**
 * Index of the list item to scroll to for a finding: its diff line, or the file's row when that line is not in the
 * diff. -1 when the file is not in the list.
 */
export function findMarkItem(items: readonly ChangeItem[], key: string, side: CommentSide, line: number): number {
  let fileRow = -1
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.kind === 'file' && item.key === key) fileRow = i
    else if (item.kind === 'diff' && item.key === key) {
      const anchor = rowAnchor(item.row)
      if (anchor && anchor.side === side && anchor.line === line) return i
    } else if (item.kind === 'split' && item.key === key) {
      if (splitAnchors(item.row).some((anchor) => anchor.side === side && anchor.line === line)) return i
    }
  }
  return fileRow
}
