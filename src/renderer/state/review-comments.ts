// Inline review comments (PRD F5) by worktree root, and the one comment being written. Saved with the workspace
// (`workspace.json`, see ./persistence) until they are sent to the agent or discarded.
import { create } from 'zustand'
import { commentDismissKey } from '@shared/background-review'
import {
  MAX_COMMENT_TEXT,
  MAX_COMMENTS_PER_WORKTREE,
  replaceReviewComments,
  type CommentGroup,
  type CommentSide,
  type ReviewComment
} from '@shared/review-comments'
import { initialWorkspaceFile, requestSave } from './persistence'

/** Where a comment is anchored, with the code it quotes. */
export interface CommentAnchor {
  group: CommentGroup
  path: string
  side: CommentSide
  line: number
  endLine: number
  code: string
}

/** The comment being written: a new one at `anchor`, or an existing one (`id`) being edited. */
export interface CommentDraft extends CommentAnchor {
  root: string
  id: string | null
  text: string
}

interface State {
  byRoot: Record<string, ReviewComment[]>
  draft: CommentDraft | null
  /** Folded (P2 / P3) review comments the user opened. Not saved: they start folded again next launch. */
  opened: Record<string, true>
}

export const useReviewComments = create<State>()(() => ({
  byRoot: initialWorkspaceFile()?.reviewComments ?? {},
  draft: null,
  opened: {}
}))

/** For the workspace snapshot. */
export const reviewCommentsSnapshot = (): Record<string, ReviewComment[]> => useReviewComments.getState().byRoot

useReviewComments.subscribe((state, prev) => {
  if (state.byRoot !== prev.byRoot) requestSave()
})

let counter = 0
const newId = (): string => `c${Date.now().toString(36)}${(counter++).toString(36)}`

export const commentsOf = (root: string): ReviewComment[] => useReviewComments.getState().byRoot[root] ?? []

function setComments(root: string, comments: ReviewComment[]): void {
  useReviewComments.setState((s) => {
    const byRoot = { ...s.byRoot }
    if (comments.length > 0) byRoot[root] = comments
    else delete byRoot[root]
    return { byRoot }
  })
}

/** Opens the editor on a line. With `extend` and an editor open on the same file and side, the range grows to it. */
export function startComment(root: string, anchor: CommentAnchor, extend = false, codeFor?: (from: number, to: number) => string): void {
  const draft = useReviewComments.getState().draft
  if (
    extend &&
    draft &&
    draft.id === null &&
    draft.root === root &&
    draft.group === anchor.group &&
    draft.path === anchor.path &&
    draft.side === anchor.side
  ) {
    const line = Math.min(draft.line, anchor.line)
    const endLine = Math.max(draft.endLine, anchor.endLine)
    useReviewComments.setState({ draft: { ...draft, line, endLine, code: codeFor?.(line, endLine) ?? draft.code } })
    return
  }
  useReviewComments.setState({ draft: { ...anchor, root, id: null, text: '' } })
}

export function editComment(root: string, id: string): void {
  const comment = commentsOf(root).find((c) => c.id === id)
  if (!comment) return
  const { group, path, side, line, endLine, code, text } = comment
  useReviewComments.setState({ draft: { root, id, group, path, side, line, endLine, code, text } })
}

export function setDraftText(text: string): void {
  const draft = useReviewComments.getState().draft
  if (draft) useReviewComments.setState({ draft: { ...draft, text: text.slice(0, MAX_COMMENT_TEXT) } })
}

export function cancelDraft(): void {
  useReviewComments.setState({ draft: null })
}

/** Saves the draft (an empty text deletes an edited comment); false when there was nothing to save. */
export function saveDraft(): boolean {
  const draft = useReviewComments.getState().draft
  if (!draft) return false
  const text = draft.text.trim()
  const list = commentsOf(draft.root)
  if (draft.id !== null) {
    setComments(
      draft.root,
      text ? list.map((c) => (c.id === draft.id ? { ...c, text } : c)) : list.filter((c) => c.id !== draft.id)
    )
  } else {
    if (!text) return false
    if (list.length >= MAX_COMMENTS_PER_WORKTREE) return false
    const { group, path, side, line, endLine, code } = draft
    setComments(draft.root, [...list, { id: newId(), group, path, side, line, endLine, code, text, createdAt: Date.now() }])
  }
  useReviewComments.setState({ draft: null })
  return true
}

/** A review finding the user deleted or unticked is not landed again in this worktree (PRD F13 v1.63). */
function rememberDismissed(root: string, comment: ReviewComment | undefined, undo = false): void {
  if (comment?.origin === 'review') window.tr.review.dismiss(root, [commentDismissKey(comment)], undo)
}

export function removeComment(root: string, id: string): void {
  rememberDismissed(
    root,
    commentsOf(root).find((c) => c.id === id)
  )
  setComments(
    root,
    commentsOf(root).filter((c) => c.id !== id)
  )
  const draft = useReviewComments.getState().draft
  if (draft?.id === id) cancelDraft()
}

/** After sending or 放弃: every comment of the worktree goes. */
export function clearComments(root: string): void {
  setComments(root, [])
  if (useReviewComments.getState().draft?.root === root) cancelDraft()
}

/** A background review landed (PRD F13): its comments replace the previous review's; the user's own stay. */
export function landReviewComments(root: string, comments: readonly ReviewComment[]): void {
  setComments(root, replaceReviewComments(commentsOf(root), comments))
}

/** Whether 发给 … includes this review comment. */
export function setCommentPicked(root: string, id: string, picked: boolean): void {
  rememberDismissed(
    root,
    commentsOf(root).find((c) => c.id === id),
    picked
  )
  setComments(
    root,
    commentsOf(root).map((c) => (c.id === id ? { ...c, picked } : c))
  )
}

export function toggleCommentFolded(id: string): void {
  useReviewComments.setState((s) => {
    const opened = { ...s.opened }
    if (opened[id]) delete opened[id]
    else opened[id] = true
    return { opened }
  })
}

/** After sending: only the comments that went. */
export function removeComments(root: string, ids: ReadonlySet<string>): void {
  setComments(
    root,
    commentsOf(root).filter((c) => !ids.has(c.id))
  )
  const draft = useReviewComments.getState().draft
  if (draft?.id && ids.has(draft.id)) cancelDraft()
}
