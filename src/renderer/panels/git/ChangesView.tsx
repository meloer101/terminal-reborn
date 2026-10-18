// Git · 变更 (PRD F17 13B2 / F5): the worktree's files grouped 未提交 (working tree) and 已提交 (vs the base branch),
// each expandable to a unified diff. Every row has a fixed height, so long diffs render only the visible window.
// Diff lines take inline review comments (F5): ＋ on a line opens an editor under it; saved comments stay there until
// the footer puts them into the agent's input line together. The footer also asks the session's agent to review (F13)
// and opens the merge sheet (F4).
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitFileChange } from '@shared/git-graph/log'
import { SHORTCUTS } from '@shared/shortcuts'
import type { Worktree } from '@shared/types'
import { ReviewButton } from '../../review/ReviewButton'
import { formatAccelerator } from '../../ui/menu-model'
import { useActiveSession, useWorkspace } from '../../state/workspace'
import { openMergeSheet, targetFor } from '../merge/store'
import { useReviewComments, type CommentDraft } from '../../state/review-comments'
import { agentLabel } from '../merge/model'
import { changeItems, itemHeight, rowAnchor, type ChangeGroup, type ChangeItem, type DraftPlace } from './changes-model'
import { CommentAddButton, CommentEditor, CommentRow } from './CommentRows'
import { commentTarget, discardComments, sendComments } from './comments'
import { toggleFile, type RootGit } from './store'
import { offsetsOf, useViewport, visibleRange } from './virtual'
import styles from './GitView.module.css'

const STATUS_LABEL: Record<GitFileChange['status'], string> = { M: '已修改', A: '新增', D: '已删除', R: '重命名', U: '冲突' }
/** Items rendered beyond each edge of the viewport. */
const OVERSCAN = 20

export function ChangesView({ root, git, worktree }: { root: string; git: RootGit; worktree: Worktree }) {
  const changes = git.changes
  const active = useActiveSession()
  const projectRoot = useWorkspace((s) => s.projects.find((p) => p.id === worktree.projectId)?.rootPath ?? null)
  const reviewer = active && active.session.worktreeId === worktree.id ? active.session.id : null
  const scroller = useRef<HTMLDivElement>(null)
  const comments = useReviewComments((s) => s.byRoot[root])
  const draft = useReviewComments((s) => (s.draft?.root === root ? s.draft : null))
  const place: DraftPlace | null = useMemo(
    () => (draft ? { id: draft.id, group: draft.group, path: draft.path, side: draft.side, endLine: draft.endLine } : null),
    [draft?.id, draft?.group, draft?.path, draft?.side, draft?.endLine] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const items = useMemo(
    () => (changes ? changeItems(changes, git.expanded, git.diffs, comments ?? [], place) : []),
    [changes, git.expanded, git.diffs, comments, place]
  )
  const sessions = useWorkspace((s) => s.sessions)
  const worktrees = useWorkspace((s) => s.worktrees)
  const activeId = useWorkspace((s) => s.activeSessionId)
  const target = commentTarget(worktree, sessions, worktrees, activeId)
  const [sendError, setSendError] = useState<string | null>(null)
  const offsets = useMemo(() => offsetsOf(items.map(itemHeight)), [items])
  const viewport = useViewport(scroller, Boolean(changes))

  if (changes === undefined) return <p className={styles.empty}>正在读取改动…</p>
  if (changes === null) return <p className={styles.empty}>{git.changesError ? `无法读取改动：${git.changesError}` : '不是 git 仓库'}</p>

  const count = comments?.length ?? 0
  const [first, last] = visibleRange(offsets, viewport.top, viewport.height, OVERSCAN)
  const rendered = []
  for (let i = first; i < last; i++) {
    rendered.push(<Item key={itemKey(items[i]!, i)} root={root} git={git} item={items[i]!} top={offsets[i]!} draft={draft} />)
  }
  return (
    <>
      <div ref={scroller} className={styles.files} role="list" aria-label="改动的文件">
        <div className={styles.filesCanvas} style={{ height: offsets[items.length] }}>
          {rendered}
        </div>
      </div>
      <div className={styles.footer}>
        {count > 0 ? (
          <>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={!target}
              title={target ? `放进 ${agentLabel(target.kind)} 的输入行，看过后按回车发送` : '这个 worktree 没有 agent 会话'}
              onClick={() => {
                if (!target) return
                setSendError(null)
                sendComments(root, target).catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))
              }}
            >
              <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
              {sendError ? '没能发送' : `发给 ${target ? agentLabel(target.kind) : 'agent'} · ${count}`}
            </button>
            <button type="button" className={styles.ghostButton} onClick={() => void discardComments(root)}>
              放弃
            </button>
          </>
        ) : (
          reviewer && <ReviewButton sessionId={reviewer} className={styles.ghostButton} />
        )}
        <span className={styles.spacer} />
        {count === 0 && (
          // PRs wait for F16; disabled with a reason rather than hidden.
          <button type="button" className={styles.ghostButton} disabled title="即将支持">
            创建 PR
          </button>
        )}
        <button
          type="button"
          className={styles.primaryButton}
          disabled={worktree.isMain || !projectRoot}
          title={worktree.isMain ? '项目主目录没有要合并到的分支' : undefined}
          onClick={() => projectRoot && openMergeSheet(targetFor(projectRoot, worktree))}
        >
          合并到 {changes.base ?? 'main'}…
          <span className={styles.shortcut}>{formatAccelerator(SHORTCUTS['merge-worktree'])}</span>
        </button>
      </div>
    </>
  )
}

function itemKey(item: ChangeItem, index: number): string {
  if (item.kind === 'group') return `group:${item.title}`
  if (item.kind === 'file') return `file:${item.key}`
  // Stable across items added above, so the editor keeps its focus.
  if (item.kind === 'editor') return 'editor'
  if (item.kind === 'comment') return `comment:${item.comment.id}`
  return `${item.kind}:${item.key}:${index}`
}

function Item({ root, git, item, top, draft }: { root: string; git: RootGit; item: ChangeItem; top: number; draft: CommentDraft | null }) {
  const style = { top }
  switch (item.kind) {
    case 'group':
      return (
        <div className={styles.groupHeader} style={style} role="presentation">
          <span className={styles.groupTitle}>{item.title}</span>
          <span className={styles.groupMeta}>{item.meta}</span>
        </div>
      )
    case 'file': {
      const { change, open } = item
      const Chevron = open ? ChevronDown : ChevronRight
      return (
        <div role="listitem" className={styles.fileItem} style={style} data-path={change.path} data-group={item.group}>
          <button
            type="button"
            className={styles.fileRow}
            aria-expanded={open}
            title={`${STATUS_LABEL[change.status]}${change.untracked ? '（未跟踪）' : ''}${change.oldPath ? ` · 原 ${change.oldPath}` : ''}`}
            onClick={() => toggleFile(root, item.key)}
          >
            <Chevron size={16} strokeWidth={1.75} className={styles.fileChevron} />
            <span className={styles.filePath}>{change.path}</span>
            {item.comments > 0 && (
              <span className={styles.fileComments} aria-label={`${item.comments} 条评论`}>
                <MessageSquare size={12} strokeWidth={1.75} aria-hidden />
                {item.comments}
              </span>
            )}
            <FileCounts change={change} />
          </button>
        </div>
      )
    }
    case 'diff': {
      const view = git.diffs[item.key]
      const rows = () => (view?.kind === 'ready' ? view.rows : [])
      const anchor = rowAnchor(item.row)
      // The lines the comment being written covers.
      const marked =
        draft !== null &&
        anchor !== null &&
        draft.group === item.group &&
        draft.path === item.path &&
        draft.side === anchor.side &&
        anchor.line >= draft.line &&
        anchor.line <= draft.endLine
      return <DiffLine row={item.row} top={top} owner={item.key} root={root} group={item.group} path={item.path} rows={rows} marked={marked} />
    }
    case 'comment':
      return <CommentRow root={root} comment={item.comment} top={top} />
    case 'editor':
      return <CommentEditor top={top} />
    case 'note':
      return (
        <p className={styles.diffNote} style={style} data-owner={item.key}>
          {item.text}
          {item.open && (
            <button type="button" className={styles.noteAction} onClick={() => void window.tr.worktree.open(root, item.open!)}>
              用默认编辑器打开
            </button>
          )}
        </p>
      )
  }
}

function FileCounts({ change }: { change: GitFileChange }) {
  if (change.nested) return <span className={styles.binary}>嵌套仓库</span>
  if (change.tooLarge) return <span className={styles.binary}>文件太大</span>
  if (change.added === null) return <span className={styles.binary}>二进制</span>
  return (
    <>
      <span className={styles.added}>+{change.added}</span>
      <span className={styles.removed}>−{change.removed ?? 0}</span>
    </>
  )
}

const MARKER: Record<DiffRow['kind'], string> = { hunk: '', context: '', add: '+', del: '−' }

/** Figma DiffLine (12:91): old · new gutters, marker, code; ＋ to comment shows on hover (F5). */
function DiffLine({
  row,
  top,
  owner,
  root,
  group,
  path,
  rows,
  marked
}: {
  row: DiffRow
  top: number
  owner: string
  root: string
  group: ChangeGroup
  path: string
  rows: () => readonly DiffRow[]
  marked: boolean
}) {
  return (
    <div
      className={styles.diffLine}
      style={{ top }}
      data-kind={row.kind}
      data-owner={owner}
      data-line={row.new ?? row.old ?? undefined}
      data-marked={marked || undefined}
    >
      <CommentAddButton root={root} group={group} path={path} row={row} rows={rows} />
      <span className={styles.gutter}>{row.old ?? ''}</span>
      <span className={styles.gutter}>{row.new ?? ''}</span>
      <span className={styles.marker}>{MARKER[row.kind]}</span>
      <span className={styles.code}>{row.text}</span>
    </div>
  )
}
