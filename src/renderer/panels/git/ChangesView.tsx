// Git · 变更 (PRD F17 13B2 / F5 / F13 v1.78 / F16 v1.78, Figma 29R): the review block, then the worktree's files grouped
// 未提交 (working tree) and 已提交 (vs the base branch), each expandable to a unified diff. Every row has a fixed height, so
// long diffs render only the visible window; an open file's row and its diff are one block inset 6 from the card, and
// once its row scrolls away it is pinned to the top of the list, where one click folds it. Diff lines take inline
// review comments (F5): ＋ on a line opens an editor under it; saved comments stay there until the footer puts them into
// the agent's input line together. Below: the ship zone (a block of its own fill, no dividers, every row 28 high): the
// base's CI, the PR headline with PR #N, one facts line (this turn's checks, risk markers, the PR's facts, what its
// switches do), the switches, then either the decision surface of a stopped 自动修复 (29G / 29J) or the footer —
// 审阅全部改动 on the left while no review shows, the two exits on the right (合并到 base 并推送 / 创建 PR, or for a
// branch whose PR is open, 合并 PR…). An exit opens the Ship block; ⇧⌘M runs the primary exit (merge/store.ts), or
// opens the PR merge sheet when the primary is 合并 PR #N….
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitFileChange } from '@shared/git-graph/log'
import type { PrTarget } from '@shared/pull-requests'
import { checksText } from '@shared/turn-checks'
import type { ShipPreflight } from '@shared/ship'
import { SHORTCUTS } from '@shared/shortcuts'
import type { Worktree } from '@shared/types'
import type { DiffLayout } from '@shared/workspace-file'
import { commentPicked } from '@shared/review-comments'
import { loadSavedReview } from '../../review/background'
import { ReviewBlock, useReviewShown } from '../../review/ReviewBlock'
import { ReviewButton } from '../../review/ReviewButton'
import { ReviewMarker } from '../../review/ReviewMarker'
import { markKey, useReviewMarks } from '../../review/marks'
import { openPullRequest } from '../../pull-requests/actions'
import { shipExits, type ShipExit } from '../../pull-requests/exit-model'
import { readRemembered, startShip, useShips } from '../../pull-requests/ship-runner'
import { ShipBlock } from '../../pull-requests/ShipBlock'
import { formatAccelerator } from '../../ui/menu-model'
import { useActiveSession, useWorkspace } from '../../state/workspace'
import { useSettings } from '../../settings/useSettings'
import { useTurnCheckView } from '../../turn-checks/TurnChecksTag'
import { openMergeSheet, registerPrimaryExit, targetFor } from '../merge/store'
import { useReviewComments, type CommentDraft } from '../../state/review-comments'
import { agentLabel } from '../merge/model'
import { changeItems, endsOpenFile, itemHeight, onOwnBase, rowAnchor, stickyFileIndex, type ChangeGroup, type ChangeItem, type DraftPlace, type SplitRow } from './changes-model'
import { CommentAddButton, CommentEditor, CommentRow } from './CommentRows'
import { FactsLine, useRisks } from './FactsRows'
import { BaseCiRows } from './BaseCiRow'
import { PrStatusLine, usePrLines } from './PullRequest'
import { FixStopFooter, PrAutomationRow, useAgentOf, usePrAutomationWords, useStoppedFix } from './PrRows'
import { agentName } from '../../pull-requests/auto-fix'
import { usePrStatus } from '../../pull-requests/store'
import { commentTarget, discardComments, sendComments } from './comments'
import { toggleFile, type RootGit } from './store'
import { offsetsOf, useViewport, visibleRange } from './virtual'
import styles from './GitView.module.css'

const STATUS_LABEL: Record<GitFileChange['status'], string> = { M: '已修改', A: '新增', D: '已删除', R: '重命名', U: '冲突' }
/** Items rendered beyond each edge of the viewport. */
const OVERSCAN = 20

/** The exits' preflight (Figma 29A): asked on mount and again whenever `key` (the git state and the PR's) changes. */
function usePreflight(target: PrTarget | null, key: string): ShipPreflight | null {
  const [preflight, setPreflight] = useState<ShipPreflight | null>(null)
  const root = target?.root
  const worktree = target?.worktree
  useEffect(() => {
    if (!root || !worktree) return
    let live = true
    window.tr.ship
      .preflight({ root, worktree })
      .then((next) => live && setPreflight(next))
      .catch((error: unknown) => live && setPreflight({ ok: false, message: error instanceof Error ? error.message : String(error) }))
    return () => {
      live = false
    }
  }, [root, worktree, key])
  return root && worktree ? preflight : null
}

export function ChangesView({ root, git, worktree, layout }: { root: string; git: RootGit; worktree: Worktree; layout: DiffLayout }) {
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
  const prStatus = usePrStatus(worktree.path)
  const prLive = prStatus?.pr && (prStatus.pr.state === 'open' || prStatus.pr.state === 'draft') ? prStatus.pr : null
  const items = useMemo(
    () => (changes ? changeItems(changes, git.expanded, git.diffs, comments ?? [], place, layout) : []),
    [changes, git.expanded, git.diffs, comments, place, layout]
  )
  const sessions = useWorkspace((s) => s.sessions)
  const worktrees = useWorkspace((s) => s.worktrees)
  const activeId = useWorkspace((s) => s.activeSessionId)
  const target = commentTarget(worktree, sessions, worktrees, activeId)
  const [sendError, setSendError] = useState<string | null>(null)
  const offsets = useMemo(() => offsetsOf(items.map(itemHeight)), [items])
  const viewport = useViewport(scroller, Boolean(changes))
  const { settings } = useSettings()
  const turnChecks = useTurnCheckView(target?.id)
  const shipping = useShips((s) => s.byWorktree[worktree.path] !== undefined)
  const reviewShown = useReviewShown(root)
  const stopped = useStoppedFix(worktree.path, prLive?.number ?? null)
  const fixAgent = agentName(useAgentOf(worktree.path))
  const prLines = usePrLines(worktree)
  const prWords = usePrAutomationWords(worktree.path, prStatus)
  // Opening 变更 asks about the branch's PR now rather than at the next poll (main throttles it).
  useEffect(() => window.tr.pr.refresh(worktree.path), [worktree.path])
  useEffect(() => loadSavedReview(root), [root])

  // The preflight and the risk markers follow the change list and the PR.
  const prTarget: PrTarget | null = projectRoot ? { root: projectRoot, worktree: worktree.path } : null
  const local = prStatus?.local
  const unpushed = Boolean(prLive?.details && local && !local.remoteAhead && local.head !== prLive.details.headOid)
  const gitKey = [changes?.base, changes?.ahead, changes?.behind, changes?.uncommitted.length, prLive?.number, prLive?.state, local?.head, prLive?.details?.headOid].join(':')
  const changeKey = changes ? [...changes.committed, ...changes.uncommitted].map((c) => `${c.path}:${c.added}:${c.removed}`).join('|') : ''
  const preflight = usePreflight(prTarget, gitKey)
  const risks = useRisks(prTarget, changeKey)
  const remembered = useMemo(() => (projectRoot ? readRemembered(projectRoot) : null), [projectRoot, shipping]) // eslint-disable-line react-hooks/exhaustive-deps

  if (changes === undefined) return <p className={styles.empty}>正在读取改动…</p>
  if (changes === null) return <p className={styles.empty}>{git.changesError ? `无法读取改动：${git.changesError}` : '不是 git 仓库'}</p>

  // The footer's 发给 / 放弃 are for the user's own comments; review findings are sent from the review block.
  const mine = comments?.filter((c) => c.origin !== 'review') ?? []
  const count = mine.length
  const picked = mine.filter(commentPicked).length
  const sessionId = active?.session.id ?? null
  const uncommittedPaths = changes.uncommitted.filter((c) => !c.nested).map((c) => c.path)
  // Nothing to propose or merge (merged already, or no work yet): no exits — the PR line says what happened.
  // The main checkout with a feature branch out ships like a worktree; on its base it has nothing of its own.
  const onBase = onOwnBase(worktree.isMain, changes)
  // A squash merge leaves the branch ahead by its commits; the preflight sees their work is in the base.
  const noNewCommits = changes.ahead === 0 || (preflight?.ok === true && preflight.merged)
  const nothingToShip = !onBase && !prLive && noNewCommits && changes.uncommitted.length === 0 && changes.untrackedOmitted === 0
  const [first, last] = visibleRange(offsets, viewport.top, viewport.height, OVERSCAN)
  const rendered = []
  for (let i = first; i < last; i++) {
    rendered.push(<Item key={itemKey(items[i]!, i)} root={root} git={git} item={items[i]!} top={offsets[i]!} draft={draft} end={endsOpenFile(items, i)} />)
  }
  // The open file whose row scrolled away is pinned to the top: one click folds it and lands on its row (Figma 29L).
  const sticky = stickyFileIndex(items, offsets, viewport.top)
  const stickyItem = sticky === null ? null : items[sticky]
  let blockEnd = sticky ?? 0
  while (sticky !== null && blockEnd < items.length - 1 && !endsOpenFile(items, blockEnd)) blockEnd++
  // Near the end of its block the pinned row slides up with it instead of covering the next row.
  const stickyShift = sticky === null ? 0 : Math.min(0, offsets[blockEnd + 1]! - viewport.top - itemHeight(items[sticky]!))
  const fold = (index: number, key: string): void => {
    toggleFile(root, key)
    if (scroller.current) scroller.current.scrollTop = offsets[index]!
  }

  const exits = shipExits({ preflight, remembered, unpushed })
  // A PR is open and there is nothing to push: open it, or merge it.
  const idlePr = prLive && !unpushed && changes.uncommitted.length === 0 && changes.untrackedOmitted === 0 ? prLive : null
  const reviewSession = target?.id ?? reviewer
  const baseName = preflight?.ok ? preflight.base : (changes.base ?? 'main')
  const exitBlocker = (exit: ShipExit): string | null => {
    if (onBase) return '项目主目录检出的是基线分支，没有要合并的分支'
    if (!projectRoot) return '找不到这个 worktree 的项目'
    if (!preflight) return '正在检查…'
    if (!preflight.ok) return preflight.message
    return exit.blocker
  }
  const go = (exit: ShipExit): void => {
    if (exit.kind === 'open-pr') {
      if (prLive) openPullRequest(sessionId, prLive.url)
      return
    }
    if (!projectRoot || !preflight?.ok) return
    startShip(
      {
        root: projectRoot,
        worktree: worktree.path,
        sessionId: target?.id ?? null,
        base: preflight.base,
        branch: preflight.branch,
        remote: preflight.remote,
        paths: uncommittedPaths.length > 0 ? uncommittedPaths : null,
        openPr: prLive ? { number: prLive.number, url: prLive.url } : null,
        checksLine: turnChecks ? `这一轮的检查：${checksText(turnChecks)}` : null,
        settings: { review: settings.review, pr: settings.pr },
        openIn: sessionId
      },
      exit.kind,
      exit.label
    )
  }
  const exitButton = (exit: ShipExit, primary: boolean) => {
    const blocker = exitBlocker(exit)
    return (
      <button
        key={exit.kind}
        type="button"
        className={primary ? styles.primaryButton : styles.ghostButton}
        disabled={blocker !== null}
        title={blocker ?? undefined}
        onClick={() => go(exit)}
      >
        {exit.label}
        {primary && <span className={styles.shortcut}>{formatAccelerator(SHORTCUTS['merge-worktree'])}</span>}
      </button>
    )
  }

  // ⇧⌘M runs the primary exit while it is on screen; a PR to merge keeps the PR merge sheet (its button opens it). A
  // stopped fix's answers replace the exits, so the shortcut does nothing until it is answered.
  const shortcutExit = shipping || stopped
    ? () => undefined
    : !nothingToShip && !idlePr && !onBase
      ? () => (exitBlocker(exits.primary) === null ? go(exits.primary) : undefined)
      : null

  return (
    <>
      <PrimaryExitShortcut worktreePath={worktree.path} run={shortcutExit} />
      {reviewSession && <ReviewBlock sessionId={reviewSession} root={root} />}
      <div ref={scroller} className={styles.files} role="list" aria-label="改动的文件" data-layout={layout}>
        {stickyItem?.kind === 'file' && (
          <div className={styles.stickyFile} data-testid="sticky-file" role="presentation" style={{ transform: `translateY(${stickyShift}px)` }}>
            <FileRow item={stickyItem} pinned onToggle={() => fold(sticky!, stickyItem.key)} />
          </div>
        )}
        <div className={styles.filesCanvas} style={{ height: offsets[items.length] }}>
          {rendered}
        </div>
      </div>
      <div className={styles.shipZone}>
        <BaseCiRows worktree={worktree} openIn={sessionId} />
        <PrStatusLine worktree={worktree} onBase={onBase} target={target} openIn={sessionId} />
        {/* While shipping, the change's own facts give way to the Ship block; the PR's stay. */}
        <FactsLine
          risks={shipping ? [] : risks}
          checks={shipping ? null : turnChecks}
          more={[...(prLines?.facts ?? []), ...(prWords?.text ? [prWords.text] : [])]}
          note={prWords?.note ?? null}
        />
        {prStatus && <PrAutomationRow worktreePath={worktree.path} status={prStatus} />}
        {shipping ? (
          <ShipBlock worktree={worktree.path} base={baseName} hasSession={target !== null} />
        ) : stopped ? (
          <FixStopFooter scope={stopped.scope} worktreePath={worktree.path} run={stopped.run} agent={fixAgent} note={stopped.note} attempts={stopped.attempts} />
        ) : (
          (count > 0 || !nothingToShip) && (
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
                      sendComments(root, target).catch((error: unknown) => setSendError(error instanceof Error ? error.message : String(error)))
                    }}
                  >
                    <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
                    {sendError ? '没能发送' : `发给 ${target ? agentLabel(target.kind) : 'agent'} · ${picked}`}
                  </button>
                  <button type="button" className={styles.ghostButton} onClick={() => void discardComments(root)}>
                    放弃
                  </button>
                </>
              ) : (
                // 审阅全部改动 would repeat the block's 重审; the agent's own command (让 agent 审阅) is another action.
                reviewer &&
                (!reviewShown || settings.review.mode === 'agent-command') && <ReviewButton sessionId={reviewer} className={styles.ghostButton} />
              )}
              <span className={styles.spacer} />
              {!nothingToShip &&
                (idlePr ? (
                  <>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={onBase || !projectRoot}
                      title={onBase ? '项目主目录检出的是基线分支，没有要合并的分支' : undefined}
                      onClick={() => projectRoot && openMergeSheet(targetFor(projectRoot, worktree))}
                    >
                      合并 PR #{idlePr.number}…<span className={styles.shortcut}>{formatAccelerator(SHORTCUTS['merge-worktree'])}</span>
                    </button>
                  </>
                ) : (
                  <>
                    {exits.secondary && exitButton(exits.secondary, false)}
                    {exitButton(exits.primary, true)}
                  </>
                ))}
            </div>
          )
        )}
      </div>
    </>
  )
}

/** Registers what ⇧⌘M does while this view is open on the worktree: the primary exit button (merge/store.ts). */
function PrimaryExitShortcut({ worktreePath, run }: { worktreePath: string; run: (() => void) | null }) {
  useEffect(() => (run ? registerPrimaryExit(worktreePath, run) : undefined), [worktreePath, run])
  return null
}

function itemKey(item: ChangeItem, index: number): string {
  if (item.kind === 'group') return `group:${item.title}`
  if (item.kind === 'file') return `file:${item.key}`
  // Stable across items added above, so the editor keeps its focus.
  if (item.kind === 'editor') return 'editor'
  if (item.kind === 'split') return `split:${item.key}:${index}`
  if (item.kind === 'comment') return `comment:${item.comment.id}`
  return `${item.kind}:${item.key}:${index}`
}

function Item({ root, git, item, top, draft, end }: { root: string; git: RootGit; item: ChangeItem; top: number; draft: CommentDraft | null; end: boolean }) {
  const style = { top }
  const edge = end || undefined
  switch (item.kind) {
    case 'group':
      return (
        <div className={styles.groupHeader} style={style} role="presentation">
          <span className={styles.groupTitle}>{item.title}</span>
          <span className={styles.groupMeta}>{item.meta}</span>
        </div>
      )
    case 'file':
      return (
        <div role="listitem" className={styles.fileItem} style={style} data-path={item.change.path} data-group={item.group} data-end={edge}>
          <FileRow item={item} onToggle={() => toggleFile(root, item.key)} />
        </div>
      )
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
      return <DiffLine row={item.row} top={top} owner={item.key} root={root} group={item.group} path={item.path} rows={rows} marked={marked} end={end} />
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
      return <SplitLine row={item.row} top={top} owner={item.key} root={root} group={item.group} path={item.path} rows={rows} marked={marked} end={end} />
    }
    case 'comment':
      return <CommentRow root={root} comment={item.comment} top={top} split={item.split === true} end={end} />
    case 'editor':
      return <CommentEditor top={top} split={item.split === true} end={end} />
    case 'note':
      return (
        <p className={styles.diffNote} style={style} data-owner={item.key} data-end={edge}>
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

/** A file's row (Figma FileRow 12:79 / 12:85): chevron, path, comment count, +/−. Also drawn pinned (sticky). */
function FileRow({ item, onToggle, pinned = false }: { item: Extract<ChangeItem, { kind: 'file' }>; onToggle: () => void; pinned?: boolean }) {
  const { change, open } = item
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <button
      type="button"
      className={styles.fileRow}
      aria-expanded={open}
      aria-label={pinned ? `收起 ${change.path}` : undefined}
      title={`${STATUS_LABEL[change.status]}${change.untracked ? '（未跟踪）' : ''}${change.oldPath ? ` · 原 ${change.oldPath}` : ''}`}
      onClick={onToggle}
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
  )
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
  marked,
  end
}: {
  row: DiffRow
  top: number
  owner: string
  root: string
  group: ChangeGroup
  path: string
  rows: () => readonly DiffRow[]
  marked: boolean
  end: boolean
}) {
  const marks = useReviewMarks(root, path, group)
  const anchor = rowAnchor(row)
  const found = anchor ? marks.get(markKey(anchor.side, anchor.line)) : undefined
  return (
    <div
      className={styles.diffLine}
      style={{ top }}
      data-kind={row.kind}
      data-owner={owner}
      data-line={row.new ?? row.old ?? undefined}
      data-marked={marked || undefined}
      data-end={end || undefined}
    >
      <CommentAddButton root={root} group={group} path={path} row={row} rows={rows} />
      <span className={styles.gutter}>{row.old ?? ''}</span>
      <span className={styles.gutter}>{row.new ?? ''}</span>
      <span className={styles.marker}>{MARKER[row.kind]}</span>
      <span className={styles.code}>{row.text}</span>
      {found && found.length > 0 && (
        <span className={styles.reviewMark}>
          <ReviewMarker marks={found} />
        </span>
      )}
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
  marked,
  end
}: {
  row: SplitRow
  top: number
  owner: string
  root: string
  group: ChangeGroup
  path: string
  rows: () => readonly DiffRow[]
  marked: boolean
  end: boolean
}) {
  if (row.kind === 'hunk') {
    return (
      <div className={styles.diffLine} style={{ top }} data-kind="hunk" data-split data-owner={owner} data-end={end || undefined}>
        <span className={styles.splitHunk}>{row.row.text}</span>
      </div>
    )
  }
  const line = row.new?.new ?? row.old?.old ?? undefined
  return (
    <div className={styles.splitLine} style={{ top }} data-owner={owner} data-line={line} data-marked={marked || undefined} data-end={end || undefined}>
      <SplitSide row={row.old} side="old" root={root} group={group} path={path} />
      <span className={styles.splitDivider} aria-hidden />
      <SplitSide row={row.new} side="new" root={root} group={group} path={path}>
        {row.new && <CommentAddButton root={root} group={group} path={path} row={row.new} rows={rows} />}
      </SplitSide>
    </div>
  )
}

function SplitSide({ row, side, root, group, path, children }: { row: DiffRow | null; side: 'old' | 'new'; root: string; group: ChangeGroup; path: string; children?: ReactNode }) {
  const marks = useReviewMarks(root, path, group)
  if (!row) return <span className={styles.splitSide} data-kind="empty" data-side={side} />
  const kind = row.kind === 'context' ? 'context' : side === 'old' ? 'del' : 'add'
  const number = side === 'old' ? row.old : row.new
  const found = number === null ? undefined : marks.get(markKey(side, number))
  return (
    <span className={styles.splitSide} data-kind={kind} data-side={side} data-line={(side === 'old' ? row.old : row.new) ?? undefined}>
      {children}
      <span className={styles.gutter}>{side === 'old' ? row.old : row.new}</span>
      <span className={styles.marker}>{kind === 'del' ? '−' : kind === 'add' ? '+' : ''}</span>
      <span className={styles.code}>{row.text}</span>
      {kind !== 'context' && found && found.length > 0 && (
        <span className={styles.reviewMark}>
          <ReviewMarker marks={found} />
        </span>
      )}
    </span>
  )
}
