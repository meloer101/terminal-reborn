// Inline review comments in Git · 变更 (PRD F5, Figma 03): the ＋ on a diff line, a saved comment under its line,
// and the editor (⌘↵ 添加评论 · Esc 取消). The text being written lives in the store, so scrolling the editor out of the
// rendered window and back keeps it.
import { Check, ChevronDown, ChevronRight, MessageSquarePlus, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { clipCode, commentLocation, commentPicked, type ReviewComment } from '@shared/review-comments'
import type { DiffRow } from '@shared/git-graph/diff'
import {
  cancelDraft,
  editComment,
  removeComment,
  saveDraft,
  setCommentPicked,
  setDraftText,
  startComment,
  toggleCommentFolded,
  useReviewComments
} from '../../state/review-comments'
import { codeBetween, rowAnchor, type ChangeGroup } from './changes-model'
import styles from './GitView.module.css'

const ICON = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const

/** ＋ at the start of a diff line; ⇧-click extends the open editor's range to this line. */
export function CommentAddButton({
  root,
  group,
  path,
  row,
  rows
}: {
  root: string
  group: ChangeGroup
  path: string
  row: DiffRow
  rows: () => readonly DiffRow[]
}) {
  const anchor = rowAnchor(row)
  if (!anchor) return null
  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    const codeFor = (from: number, to: number) => clipCode(codeBetween(rows(), anchor.side, from, to))
    startComment(root, { group, path, side: anchor.side, line: anchor.line, endLine: anchor.line, code: codeFor(anchor.line, anchor.line) }, event.shiftKey, codeFor)
  }
  return (
    <button type="button" className={styles.commentAdd} aria-label={`评论第 ${anchor.line} 行`} title="评论这一行（⇧ 点击扩展到多行）" onClick={onClick}>
      <MessageSquarePlus {...ICON} />
    </button>
  )
}

export function CommentRow({ root, comment, top, folded }: { root: string; comment: ReviewComment; top: number; folded: boolean }) {
  const review = comment.origin === 'review'
  const foldable = comment.severity === 'P2' || comment.severity === 'P3'
  const title = comment.text.split('\n')[0] ?? ''
  const Chevron = folded ? ChevronRight : ChevronDown
  return (
    <div
      className={styles.comment}
      style={{ top }}
      data-comment-id={comment.id}
      data-folded={folded || undefined}
      data-severity={comment.severity}
      role="note"
      aria-label={`${review ? `审阅 ${comment.severity} ` : '评论 '}${commentLocation(comment)}`}
    >
      <div className={styles.commentHead}>
        {review && <PickBox root={root} comment={comment} />}
        {comment.severity && <span className={styles.commentSeverity}>{comment.severity}</span>}
        {folded ? (
          <button type="button" className={styles.commentFoldedTitle} title={comment.text} onClick={() => toggleCommentFolded(comment.id)}>
            {title}
          </button>
        ) : (
          <>
            <span className={styles.commentWhere}>{lineLabel(comment)}</span>
            {comment.confidence !== undefined && <span className={styles.commentWhere}>置信度 {Math.round(comment.confidence * 100)}%</span>}
          </>
        )}
        <span className={styles.spacer} />
        {foldable && (
          <button type="button" className={styles.commentFold} aria-label={folded ? '展开' : '收起'} aria-expanded={!folded} onClick={() => toggleCommentFolded(comment.id)}>
            <Chevron {...ICON} />
          </button>
        )}
        {!folded && (
          <>
            <button type="button" className={styles.commentIcon} aria-label="编辑评论" onClick={() => editComment(root, comment.id)}>
              <Pencil {...ICON} />
            </button>
            <button type="button" className={styles.commentIcon} aria-label="删除评论" onClick={() => removeComment(root, comment.id)}>
              <Trash2 {...ICON} />
            </button>
          </>
        )}
      </div>
      {!folded && (
        <p className={styles.commentText} title={comment.text} onDoubleClick={() => editComment(root, comment.id)}>
          {comment.text}
        </p>
      )}
    </div>
  )
}

/** Whether 发给 … takes this review comment (PRD F13: the user ticks what goes to the agent). */
function PickBox({ root, comment }: { root: string; comment: ReviewComment }) {
  const picked = commentPicked(comment)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={picked}
      aria-label={picked ? '发送时包含这条' : '发送时不包含这条'}
      title={picked ? '发送时包含这条' : '勾选后随评论一起发送'}
      className={styles.commentPick}
      onClick={() => setCommentPicked(root, comment.id, !picked)}
    >
      {picked && <Check size={10} strokeWidth={2.5} aria-hidden />}
    </button>
  )
}

export function CommentEditor({ top }: { top: number }) {
  const draft = useReviewComments((s) => s.draft)
  const ref = useRef<HTMLTextAreaElement>(null)
  // The keyboard comes back here when the editor opens and whenever ⇧-click on a ＋ changes its range.
  const range = draft ? `${draft.id}:${draft.path}:${draft.line}:${draft.endLine}` : ''
  useEffect(() => {
    const area = ref.current
    if (!area) return
    area.focus()
    area.setSelectionRange(area.value.length, area.value.length)
  }, [range])
  if (!draft) return null

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelDraft()
    } else if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault()
      event.stopPropagation()
      saveDraft()
    }
  }

  return (
    <div className={styles.editor} style={{ top }} role="group" aria-label="写评论">
      <textarea
        ref={ref}
        className={styles.editorText}
        aria-label={`评论 ${lineLabel(draft)}`}
        placeholder={`${lineLabel(draft)} · 要改什么？`}
        value={draft.text}
        spellCheck={false}
        onChange={(event) => setDraftText(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.editorButtons}>
        <span className={styles.commentWhere}>{lineLabel(draft)}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghostButton} onClick={cancelDraft}>
          取消
        </button>
        <button type="button" className={styles.commentSave} disabled={draft.id === null && draft.text.trim() === ''} onClick={() => saveDraft()}>
          {draft.id === null ? '添加评论' : '保存'}
          <span className={styles.shortcut}>⌘↵</span>
        </button>
      </div>
    </div>
  )
}

function lineLabel(c: Pick<ReviewComment, 'line' | 'endLine' | 'side'>): string {
  const lines = c.endLine > c.line ? `第 ${c.line}–${c.endLine} 行` : `第 ${c.line} 行`
  return c.side === 'old' ? `${lines}（删除的行）` : lines
}
