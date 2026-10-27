// Pure parts of Git · 变更 (PRD F17 13B2 / F5): which diffs are worth fetching, and the flat list of fixed-height rows
// (group headers, files, diff lines, notes, review comments and the comment editor) the view renders through a window.
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitChanges, GitFileChange } from '@shared/git-graph/log'
import type { PrThread } from '@shared/pull-requests'
import { reviewCommentFolded, type CommentSide, type ReviewComment } from '@shared/review-comments'
import type { DiffLayout } from '@shared/workspace-file'

export type ChangeGroup = 'uncommitted' | 'committed'

/** Files with more changed lines than this are not diffed in the panel (open them in an editor instead). */
export const MAX_DIFF_LINES = 20_000

/**
 * Figma 13B2 heights: group header 12 + 16 + 4, file row 8 + 16 + 8, DiffLine 20, a note line 4 + 16 + 8. Figma 03:
 * a saved comment 8 + 16 (location) + 2 × 18 (text, clamped) + 8; the editor 8 + 72 (text) + 8 + 28 (buttons) + 8.
 * A folded review comment (P2 / P3, PRD F13) is its head line only: 8 + 16 + 8. A PR thread (Figma 22B PrThread
 * 366:14568, PRD F16 v1.63): 12 + 20 (head) + 8 + 2 × 20 (body, clamped) + 8 + 24 (actions) + 12.
 */
export const ITEM_HEIGHT = { group: 32, file: 32, diff: 20, split: 20, note: 28, comment: 68, commentFolded: 32, editor: 124, thread: 124 } as const

export const changeKey = (group: ChangeGroup, path: string): string => `${group}:${path}`

export type NoDiffReason = 'nested' | 'large' | 'binary'

/** Why a file gets no inline diff, or null when it can have one. */
export function noDiffReason(change: GitFileChange): NoDiffReason | null {
  if (change.nested) return 'nested'
  if (change.tooLarge) return 'large'
  if (change.added === null || change.removed === null) return 'binary'
  return change.added + change.removed > MAX_DIFF_LINES ? 'large' : null
}

/** Whether a file's diff must be fetched again after the lists reloaded. */
export function changedSince(before: GitFileChange | undefined, after: GitFileChange): boolean {
  return (
    !before ||
    before.added !== after.added ||
    before.removed !== after.removed ||
    before.status !== after.status ||
    before.oldPath !== after.oldPath
  )
}

export type DiffView = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; rows: DiffRow[]; binary: boolean; truncated: number }

/** The comment being written, as the list needs it: where it goes and which saved comment (if any) it replaces. */
export interface DraftPlace {
  id: string | null
  group: ChangeGroup
  path: string
  side: CommentSide
  endLine: number
}

/**
 * One row of the 并排 layout (PRD F5, Figma DiffSplitRow 262:10029): base on the left, new on the right. A changed block
 * pairs its i-th removed line with its i-th added line; the side without a counterpart is null (drawn as a filler).
 * Context lines sit on both sides; a hunk header spans both.
 */
export type SplitRow = { kind: 'hunk'; row: DiffRow } | { kind: 'pair'; old: DiffRow | null; new: DiffRow | null }

export function splitRows(rows: readonly DiffRow[]): SplitRow[] {
  const out: SplitRow[] = []
  let dels: DiffRow[] = []
  let adds: DiffRow[] = []
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ kind: 'pair', old: dels[i] ?? null, new: adds[i] ?? null })
    dels = []
    adds = []
  }
  for (const row of rows) {
    if (row.kind === 'del') {
      // A removal after additions starts a new block: git never interleaves, but keep pairs in order if it did.
      if (adds.length > 0) flush()
      dels.push(row)
    } else if (row.kind === 'add') adds.push(row)
    else {
      flush()
      out.push(row.kind === 'hunk' ? { kind: 'hunk', row } : { kind: 'pair', old: row, new: row })
    }
  }
  flush()
  return out
}

/** The lines a split row carries comments for: its removed line (old side) and its new line. */
export function splitAnchors(row: SplitRow): Array<{ side: CommentSide; line: number }> {
  if (row.kind === 'hunk') return []
  const anchors: Array<{ side: CommentSide; line: number }> = []
  const old = row.old && row.old.kind === 'del' ? rowAnchor(row.old) : null
  if (old) anchors.push(old)
  const added = row.new ? rowAnchor(row.new) : null
  if (added) anchors.push(added)
  return anchors
}

export type ChangeItem =
  | { kind: 'group'; title: string; meta: string }
  | { kind: 'file'; group: ChangeGroup; change: GitFileChange; key: string; open: boolean; comments: number }
  | { kind: 'diff'; key: string; group: ChangeGroup; path: string; row: DiffRow }
  | { kind: 'split'; key: string; group: ChangeGroup; path: string; row: SplitRow }
  /** `split`: drawn on the new (right) half of a 并排 diff. */
  | { kind: 'comment'; key: string; comment: ReviewComment; folded: boolean; split?: true }
  | { kind: 'editor'; key: string; split?: true }
  /** An unresolved GitHub review thread on this line of the 已提交 diff. `changed`: the file has uncommitted edits since. */
  | { kind: 'thread'; key: string; thread: PrThread; changed: boolean; split?: true }
  /** `open`: offer to open the file in the default editor. */
  | { kind: 'note'; key: string; text: string; open?: string }

const NO_DIFF_TEXT: Record<NoDiffReason, string> = {
  nested: '嵌套的 git 仓库，不显示 diff',
  large: '文件太大，用编辑器打开',
  binary: '二进制文件，不显示 diff'
}

/** The line a comment on this diff row is anchored to; null for hunk headers. */
export function rowAnchor(row: DiffRow): { side: CommentSide; line: number } | null {
  if (row.kind === 'hunk') return null
  if (row.kind === 'del') return row.old === null ? null : { side: 'old', line: row.old }
  return row.new === null ? null : { side: 'new', line: row.new }
}

/** The text of the diff rows of one side between two lines (the code a comment quotes). */
export function codeBetween(rows: readonly DiffRow[], side: CommentSide, from: number, to: number): string[] {
  return rows
    .filter((row) => {
      const anchor = rowAnchor(row)
      return anchor !== null && anchor.side === side && anchor.line >= from && anchor.line <= to
    })
    .map((row) => row.text)
}

export function changeItems(
  changes: GitChanges,
  expanded: ReadonlySet<string>,
  diffs: Readonly<Record<string, DiffView>>,
  comments: readonly ReviewComment[] = [],
  draft: DraftPlace | null = null,
  opened: Readonly<Record<string, true>> = {},
  layout: DiffLayout = 'unified',
  threads: readonly PrThread[] = []
): ChangeItem[] {
  const dirty = new Set(changes.uncommitted.map((c) => c.path))
  const split = layout === 'split' ? ({ split: true } as const) : {}
  const items: ChangeItem[] = []
  const files = (group: ChangeGroup, list: GitFileChange[]) => {
    for (const change of list) {
      const key = changeKey(group, change.path)
      const open = expanded.has(key)
      const own = comments.filter((c) => c.group === group && c.path === change.path)
      // PR threads sit on the PR's diff: the 已提交 group, on the line GitHub still places them.
      const prHere = group === 'committed' ? threads.filter((t) => t.path === change.path && t.line !== null && !t.outdated) : []
      const draftHere = draft && draft.group === group && draft.path === change.path ? draft : null
      const fileItem: Extract<ChangeItem, { kind: 'file' }> = { kind: 'file', group, change, key, open, comments: own.length + prHere.length }
      items.push(fileItem)
      if (!open) continue
      const reason = noDiffReason(change)
      if (reason) {
        items.push({ kind: 'note', key, text: NO_DIFF_TEXT[reason], ...(reason === 'large' ? { open: change.path } : {}) })
        continue
      }
      const diff = diffs[key]
      if (!diff || diff.kind === 'loading') items.push({ kind: 'note', key, text: '正在读取 diff…' })
      else if (diff.kind === 'error') items.push({ kind: 'note', key, text: '无法读取 diff' })
      else if (diff.binary) items.push({ kind: 'note', key, text: NO_DIFF_TEXT.binary })
      else if (diff.rows.length === 0) items.push({ kind: 'note', key, text: '没有文本改动' })
      else {
        const placed = new Set<string>()
        let draftPlaced = false
        let placedHere = 0
        const commentItem = (comment: ReviewComment) => {
          placed.add(comment.id)
          if (draftHere?.id === comment.id) {
            draftPlaced = true
            items.push({ kind: 'editor', key, ...split })
          } else items.push({ kind: 'comment', key, comment, folded: reviewCommentFolded(comment, opened), ...split })
        }
        const commentsAt = (anchor: { side: CommentSide; line: number }) => {
          for (const thread of prHere) {
            if (thread.side !== anchor.side || thread.line !== anchor.line) continue
            items.push({ kind: 'thread', key, thread, changed: dirty.has(change.path), ...split })
            placedHere++
          }
          for (const comment of own) if (comment.side === anchor.side && comment.endLine === anchor.line) commentItem(comment)
          if (draftHere && draftHere.id === null && draftHere.side === anchor.side && draftHere.endLine === anchor.line) {
            draftPlaced = true
            items.push({ kind: 'editor', key, ...split })
          }
        }
        if (layout === 'split') {
          for (const row of splitRows(diff.rows)) {
            items.push({ kind: 'split', key, group, path: change.path, row })
            for (const anchor of splitAnchors(row)) commentsAt(anchor)
          }
        } else {
          for (const row of diff.rows) {
            items.push({ kind: 'diff', key, group, path: change.path, row })
            const anchor = rowAnchor(row)
            if (anchor) commentsAt(anchor)
          }
        }
        // Threads GitHub places on lines this diff does not show are listed under the PR line, not counted here.
        fileItem.comments = own.length + placedHere
        // Comments whose line is no longer in the diff (the file changed since) still count; they go last.
        for (const comment of own) if (!placed.has(comment.id)) commentItem(comment)
        if (draftHere && !draftPlaced) items.push({ kind: 'editor', key, ...split })
        if (diff.truncated > 0) items.push({ kind: 'note', key, text: `还有 ${diff.truncated} 行没有显示`, open: change.path })
      }
    }
  }
  const count = changes.uncommitted.length + changes.untrackedOmitted
  items.push({ kind: 'group', title: '未提交', meta: count > 0 ? `${count} 个文件` : '没有改动' })
  files('uncommitted', changes.uncommitted)
  if (changes.untrackedOmitted > 0) {
    items.push({ kind: 'note', key: 'untracked-omitted', text: `还有 ${changes.untrackedOmitted} 个未跟踪文件没有列出` })
  }
  items.push({
    kind: 'group',
    title: '已提交',
    meta: changes.base ? `${changes.ahead} 个提交 · 对比 ${changes.base}` : '没有可对比的基线分支'
  })
  files('committed', changes.committed)
  return items
}

export const itemHeight = (item: ChangeItem): number =>
  item.kind === 'comment' && item.folded ? ITEM_HEIGHT.commentFolded : ITEM_HEIGHT[item.kind]

/**
 * Whether the worktree has no branch of its own to merge or propose: the project's main checkout while it has its base
 * out (on the base itself the base is its upstream), no base, or a detached HEAD. A feature branch checked out in the
 * main checkout merges and opens PRs like any worktree's (PRD F4 / F16).
 */
export function onOwnBase(isMain: boolean, changes: Pick<GitChanges, 'branch' | 'base'>): boolean {
  if (!isMain) return false
  const { branch, base } = changes
  return !branch || !base || base === branch || base === `origin/${branch}`
}

/** PR threads the list placed on a diff line; the rest are listed under the PR line (PRD F16 v1.63). */
export function placedThreadIds(items: readonly ChangeItem[]): Set<string> {
  return new Set(items.flatMap((item) => (item.kind === 'thread' ? [item.thread.id] : [])))
}
