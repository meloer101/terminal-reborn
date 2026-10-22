// Git · 变更 (PRD F17 13B2 / F5): the worktree's files grouped 未提交 (working tree) and 已提交 (vs the base branch),
// each expandable to a unified diff. Every row has a fixed height, so long diffs render only the visible window.
// Diff lines take inline review comments (F5): ＋ on a line opens an editor under it; saved comments stay there until
// the footer puts them into the agent's input line together. The footer also asks the session's agent to review (F13),
// creates or opens the branch's PR (F16) and opens the merge sheet (F4).
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitFileChange } from '@shared/git-graph/log'
import { SHORTCUTS } from '@shared/shortcuts'
import type { Worktree } from '@shared/types'
import type { DiffLayout } from '@shared/workspace-file'
import { severityCounts } from '@shared/background-review'
import { commentPicked } from '@shared/review-comments'
import { cancelBackgroundReview, loadSavedReview, reviewLine, useBackgroundReview } from '../../review/background'
import { ReviewButton } from '../../review/ReviewButton'
import { StatusGlyph } from '../../ui/StatusGlyph'
import { formatAccelerator } from '../../ui/menu-model'
import { useActiveSession, useWorkspace } from '../../state/workspace'
import { openMergeSheet, targetFor } from '../merge/store'
import { useReviewComments, type CommentDraft } from '../../state/review-comments'
import { agentLabel } from '../merge/model'
import { changeItems, itemHeight, placedThreadIds, rowAnchor, type ChangeGroup, type ChangeItem, type DraftPlace, type SplitRow } from './changes-model'
import { CommentAddButton, CommentEditor, CommentRow } from './CommentRows'
import { PrButton, PrStatusLine } from './PullRequest'
import { PrAutomationRow, PrNotes, PrThreadRow } from './PrRows'
import { setPrNotice, usePrStatus, usePullRequests } from '../../pull-requests/store'
import type { SessionId } from '@shared/types'
import type { PrReviewComment } from '@shared/pull-requests'
import { commentTarget, discardComments, sendComments } from './comments'
import { toggleFile, type RootGit } from './store'
import { offsetsOf, useViewport, visibleRange } from './virtual'
import styles from './GitView.module.css'

const STATUS_LABEL: Record<GitFileChange['status'], string> = { M: '已修改', A: '新增', D: '已删除', R: '重命名', U: '冲突' }
/** Items rendered beyond each edge of the viewport. */
const OVERSCAN = 20

export function ChangesView({ root, git, worktree, layout }: { root: string; git: RootGit; worktree: Worktree; layout: DiffLayout }) {
  const changes = git.changes
  const active = useActiveSession()
  const projectRoot = useWorkspace((s) => s.projects.find((p) => p.id === worktree.projectId)?.rootPath ?? null)
  const reviewer = active && active.session.worktreeId === worktree.id ? active.session.id : null
  const scroller = useRef<HTMLDivElement>(null)
  const comments = useReviewComments((s) => s.byRoot[root])
  const draft = useReviewComments((s) => (s.draft?.root === root ? s.draft : null))
  const opened = useReviewComments((s) => s.opened)
  const place: DraftPlace | null = useMemo(
    () => (draft ? { id: draft.id, group: draft.group, path: draft.path, side: draft.side, endLine: draft.endLine } : null),
    [draft?.id, draft?.group, draft?.path, draft?.side, draft?.endLine] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const prStatus = usePrStatus(worktree.path)
  const prLive = prStatus?.pr && (prStatus.pr.state === 'open' || prStatus.pr.state === 'draft') ? prStatus.pr : null
  const prThreads = prLive?.details?.threads
  const items = useMemo(
    () => (changes ? changeItems(changes, git.expanded, git.diffs, comments ?? [], place, opened, layout, prThreads ?? []) : []),
    [changes, git.expanded, git.diffs, comments, place, opened, layout, prThreads]
  )
  const placed = useMemo(() => placedThreadIds(items), [items])
  const unpicked = usePullRequests((s) => s.unpicked)
  const pickedThreads = (prThreads ?? []).filter((t) => placed.has(t.id) && !unpicked[t.id])
  const sessions = useWorkspace((s) => s.sessions)
  const worktrees = useWorkspace((s) => s.worktrees)
  const activeId = useWorkspace((s) => s.activeSessionId)
  const target = commentTarget(worktree, sessions, worktrees, activeId)
  const [sendError, setSendError] = useState<string | null>(null)
  const offsets = useMemo(() => offsetsOf(items.map(itemHeight)), [items])
  const viewport = useViewport(scroller, Boolean(changes))
  // Opening 变更 asks about the branch's PR now rather than at the next poll (main throttles it).
  useEffect(() => window.tr.pr.refresh(worktree.path), [worktree.path])

  if (changes === undefined) return <p className={styles.empty}>正在读取改动…</p>
  if (changes === null) return <p className={styles.empty}>{git.changesError ? `无法读取改动：${git.changesError}` : '不是 git 仓库'}</p>

  const own = comments?.length ?? 0
  const count = own + pickedThreads.length
  const picked = (comments?.filter(commentPicked).length ?? 0) + pickedThreads.length
  const sessionId = active?.session.id ?? null
  // Nothing to propose or merge (merged already, or no work yet): no 创建 PR, no 合并 — the PR line says what happened.
  const nothingToShip = !worktree.isMain && !prLive && changes.ahead === 0 && changes.uncommitted.length === 0 && changes.untrackedOmitted === 0
  const [first, last] = visibleRange(offsets, viewport.top, viewport.height, OVERSCAN)
  const rendered = []
  for (let i = first; i < last; i++) {
    rendered.push(<Item key={itemKey(items[i]!, i)} root={root} git={git} item={items[i]!} top={offsets[i]!} draft={draft} sessionId={sessionId} />)
  }
  return (
    <>
      <div ref={scroller} className={styles.files} role="list" aria-label="改动的文件" data-layout={layout}>
        <div className={styles.filesCanvas} style={{ height: offsets[items.length] }}>
          {rendered}
        </div>
      </div>
      <div className={styles.prBlock}>
        <ReviewStatus root={root} agent={target?.kind === 'claude' || target?.kind === 'codex' ? target.kind : undefined} prNumber={prLive?.number ?? null} />
        <PrStatusLine worktree={worktree} target={target} />
        {prStatus && <PrAutomationRow worktreePath={worktree.path} status={prStatus} />}
        {prLive?.details && (
          <PrNotes worktreePath={worktree.path} notes={prLive.details.notes} threads={prLive.details.threads.filter((t) => !placed.has(t.id))} sessionId={sessionId} />
        )}
      </div>
      <div className={styles.footer}>
        {count > 0 ? (
          <>
            <button
              type="button"
              className={styles.ghostButton}
              disabled={!target || picked === 0}
              title={
                !target
                  ? '这个 worktree 没有 agent 会话'
                  : picked === 0
                    ? '勾选要发送的审阅意见'
                    : `放进 ${agentLabel(target.kind)} 的输入行，看过后按回车发送`
              }
              onClick={() => {
                if (!target) return
                setSendError(null)
                sendComments(root, target, prLive ? { number: prLive.number, threads: pickedThreads } : null).catch((error: unknown) =>
                  setSendError(error instanceof Error ? error.message : String(error))
                )
              }}
            >
              <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
              {sendError ? '没能发送' : `发给 ${target ? agentLabel(target.kind) : 'agent'} · ${picked}`}
            </button>
            {own > 0 && (
              <button type="button" className={styles.ghostButton} onClick={() => void discardComments(root)}>
                放弃
              </button>
            )}
          </>
        ) : (
          reviewer && !nothingToShip && <ReviewButton sessionId={reviewer} className={styles.ghostButton} />
        )}
        <span className={styles.spacer} />
        {count === 0 && !nothingToShip && (
          <PrButton
            worktree={worktree}
            projectRoot={projectRoot}
            title={(active?.session.worktreeId === worktree.id ? active.session.title : target?.title) ?? ''}
            sessionId={active?.session.id ?? null}
            agent={target}
          />
        )}
        {!nothingToShip && (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={worktree.isMain || !projectRoot}
            title={worktree.isMain ? '项目主目录没有要合并到的分支' : undefined}
            onClick={() => projectRoot && openMergeSheet(targetFor(projectRoot, worktree))}
          >
            {prLive ? `合并 PR #${prLive.number}…` : `合并到 ${changes.base ?? 'main'}…`}
            <span className={styles.shortcut}>{formatAccelerator(SHORTCUTS['merge-worktree'])}</span>
          </button>
        )}
      </div>
    </>
  )
}

/** The worktree's latest background review (PRD F13): progress with 取消, the result, or why it failed. */
function ReviewStatus({ root, agent, prNumber }: { root: string; agent: 'claude' | 'codex' | undefined; prNumber: number | null }) {
  const status = useBackgroundReview((s) => s.byRoot[root])
  const comments = useReviewComments((s) => s.byRoot[root])
  const [posting, setPosting] = useState(false)
  useEffect(() => loadSavedReview(root), [root])
  if (!status) return null
  const findings = (comments ?? []).filter((c) => c.origin === 'review' && commentPicked(c))
  // 发到 PR (PRD F16 v1.63): the ticked findings as one COMMENT review on the PR, as the user (main asks first).
  const post = async (): Promise<void> => {
    const state = useWorkspace.getState()
    const record = state.worktrees.find((w) => w.path === root)
    const projectRoot = state.projects.find((p) => p.id === record?.projectId)?.rootPath
    if (!projectRoot || findings.length === 0) return
    setPosting(true)
    const list: PrReviewComment[] = findings.map((c) => ({
      path: c.path,
      side: c.side,
      line: c.line,
      endLine: c.endLine,
      body: `${c.severity ? `${c.severity} · ` : ''}${c.text}`
    }))
    const result = await window.tr.pr.postReview({ root: projectRoot, worktree: root, reviewer: status.agent === 'claude' ? 'Claude' : 'Codex', comments: list })
    setPosting(false)
    setPrNotice(root, { tone: result.ok || result.reason === 'declined' ? 'muted' : 'error', text: result.message })
  }
  const line = reviewLine(status, severityCounts((comments ?? []).filter((c) => c.origin === 'review')), agent)
  return (
    <p className={styles.reviewStatus} data-tone={line.tone} role="status" data-testid="review-status">
      {line.tone === 'working' && <StatusGlyph status="running" />}
      <span className={styles.reviewStatusText} title={line.detail ?? line.text}>
        {line.text}
      </span>
      {line.meta && <span className={styles.reviewStatusMeta}>{line.meta}</span>}
      {status.phase === 'running' && (
        <button type="button" className={styles.noteAction} onClick={() => cancelBackgroundReview(root)}>
          取消
        </button>
      )}
      {status.phase === 'done' && prNumber !== null && findings.length > 0 && (
        <button
          type="button"
          className={styles.noteAction}
          disabled={posting}
          title={`把勾选的 ${findings.length} 条发成 PR #${prNumber} 上的一次评论审阅（以你的 GitHub 账号，不批准也不要求修改）`}
          onClick={() => void post()}
        >
          {posting ? '正在发到 PR…' : '发到 PR'}
        </button>
      )}
    </p>
  )
}

function itemKey(item: ChangeItem, index: number): string {
  if (item.kind === 'group') return `group:${item.title}`
  if (item.kind === 'file') return `file:${item.key}`
  // Stable across items added above, so the editor keeps its focus.
  if (item.kind === 'editor') return 'editor'
  if (item.kind === 'split') return `split:${item.key}:${index}`
  if (item.kind === 'comment') return `comment:${item.comment.id}`
  if (item.kind === 'thread') return `thread:${item.thread.id}`
  return `${item.kind}:${item.key}:${index}`
}

function Item({ root, git, item, top, draft, sessionId }: { root: string; git: RootGit; item: ChangeItem; top: number; draft: CommentDraft | null; sessionId: SessionId | null }) {
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
    case 'split': {
      const view = git.diffs[item.key]
      const rows = () => (view?.kind === 'ready' ? view.rows : [])
      const inDraft = (row: DiffRow | null, side: 'old' | 'new') => {
        const anchor = row ? rowAnchor(row) : null
        return (
          draft !== null &&
          anchor !== null &&
          anchor.side === side &&
          draft.group === item.group &&
          draft.path === item.path &&
          draft.side === side &&
          anchor.line >= draft.line &&
          anchor.line <= draft.endLine
        )
      }
      const marked = item.row.kind === 'pair' && (inDraft(item.row.old, 'old') || inDraft(item.row.new, 'new'))
      return <SplitLine row={item.row} top={top} owner={item.key} root={root} group={item.group} path={item.path} rows={rows} marked={marked} />
    }
    case 'comment':
      return <CommentRow root={root} comment={item.comment} top={top} folded={item.folded} split={item.split === true} />
    case 'editor':
      return <CommentEditor top={top} split={item.split === true} />
    case 'thread':
      return <PrThreadRow worktreePath={root} thread={item.thread} changed={item.changed} top={top} split={item.split === true} sessionId={sessionId} />
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

/**
 * Figma DiffSplitRow (262:10029): base on the left, new on the right, a hairline between; a side without a line is a
 * quiet filler, and a hunk header spans both. ＋ to comment is on the new side only (F5).
 */
function SplitLine({
  row,
  top,
  owner,
  root,
  group,
  path,
  rows,
  marked
}: {
  row: SplitRow
  top: number
  owner: string
  root: string
  group: ChangeGroup
  path: string
  rows: () => readonly DiffRow[]
  marked: boolean
}) {
  if (row.kind === 'hunk') {
    return (
      <div className={styles.diffLine} style={{ top }} data-kind="hunk" data-split data-owner={owner}>
        <span className={styles.splitHunk}>{row.row.text}</span>
      </div>
    )
  }
  const line = row.new?.new ?? row.old?.old ?? undefined
  return (
    <div className={styles.splitLine} style={{ top }} data-owner={owner} data-line={line} data-marked={marked || undefined}>
      <SplitSide row={row.old} side="old" />
      <span className={styles.splitDivider} aria-hidden />
      <SplitSide row={row.new} side="new">
        {row.new && <CommentAddButton root={root} group={group} path={path} row={row.new} rows={rows} />}
      </SplitSide>
    </div>
  )
}

function SplitSide({ row, side, children }: { row: DiffRow | null; side: 'old' | 'new'; children?: ReactNode }) {
  if (!row) return <span className={styles.splitSide} data-kind="empty" data-side={side} />
  const kind = row.kind === 'context' ? 'context' : side === 'old' ? 'del' : 'add'
  return (
    <span className={styles.splitSide} data-kind={kind} data-side={side} data-line={(side === 'old' ? row.old : row.new) ?? undefined}>
      {children}
      <span className={styles.gutter}>{side === 'old' ? row.old : row.new}</span>
      <span className={styles.marker}>{kind === 'del' ? '−' : kind === 'add' ? '+' : ''}</span>
      <span className={styles.code}>{row.text}</span>
    </span>
  )
}
