// Pure parts of Git · 变更 (PRD F17 13B2 / F5): which diffs are worth fetching, and the flat list of fixed-height rows
// (group headers, files, diff lines, notes, the user's comments and the comment editor) the view renders through a window.
// Background-review findings are not rows here: they live in the review block above the list and as a tag on their diff
// line (PRD F13 v1.78, Figma 29B2).
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitChanges, GitFileChange } from '@shared/git-graph/log'
import type { ShipOperation } from '@shared/ship'
import type { CommentSide, ReviewComment } from '@shared/review-comments'
import type { DiffLayout } from '@shared/workspace-file'

import { changeKey, fileStamp, toggleViewed, type ChangeGroup, type ReviewFile, type ViewedMarks } from '@shared/review-progress'

/** Moved to src/shared/review-progress.ts (已看 marks key rows the same way); kept here for the panel's imports. */
export { changeKey, type ChangeGroup }

/** Files with more changed lines than this are not diffed in the panel (open them in an editor instead). */
export const MAX_DIFF_LINES = 20_000

/**
 * Figma 13B2 heights: group header 12 + 16 + 4, file row 8 + 16 + 8, DiffLine 20, a note line 4 + 16 + 8. Figma 03:
 * a saved comment 8 + 16 (location) + 2 × 18 (text, clamped) + 8; the editor 8 + 72 (text) + 8 + 28 (buttons) + 8.
 * A folded comment is its head line only: 8 + 16 + 8 (only background-review findings fold, and they are not rows
 * any more, so no row is folded today).
 */
export const ITEM_HEIGHT = { group: 32, file: 32, diff: 20, split: 20, note: 28, comment: 68, editor: 124 } as const

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
  /** `group` on 未提交 while its files can be ticked: the header's checkbox ticks or clears them all. */
  | { kind: 'group'; title: string; meta: string; group?: ChangeGroup }
  /** `mark`: the row's 已看 mark (合入链路 v2, Figma 73A). */
  | { kind: 'file'; group: ChangeGroup; change: GitFileChange; key: string; open: boolean; comments: number; mark: ViewMark }
  | { kind: 'diff'; key: string; group: ChangeGroup; path: string; row: DiffRow }
  | { kind: 'split'; key: string; group: ChangeGroup; path: string; row: SplitRow }
  /** A comment the user wrote. `split`: drawn on the new (right) half of a 并排 diff. */
  | { kind: 'comment'; key: string; comment: ReviewComment; split?: true }
  | { kind: 'editor'; key: string; split?: true }
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

/** A row's 已看 mark: ○ not viewed, ✓ viewed at its current diff, ◉ viewed before its diff changed (看过后又改了). */
export type ViewMark = 'unviewed' | 'viewed' | 'stale'

/** The 已看 marks the list draws, and the header's 未看 filter (only unviewed and stale rows are listed). */
export interface ReviewView {
  marks: Readonly<ViewedMarks>
  unviewedOnly: boolean
}

export function viewMarkOf(marks: Readonly<ViewedMarks>, key: string, stamp: string): ViewMark {
  const mark = marks[key]
  return mark === undefined ? 'unviewed' : mark === stamp ? 'viewed' : 'stale'
}

/**
 * The mark button of a row: marks it at its current diff (folding it when it is open; it can still be opened) or, when
 * it is viewed, unmarks it. `expanded` is the same set when nothing folds.
 */
export function toggleMark(
  marks: Readonly<ViewedMarks>,
  expanded: ReadonlySet<string>,
  file: ReviewFile
): { marks: ViewedMarks; expanded: ReadonlySet<string> } {
  const next = toggleViewed(marks, file)
  if (next[file.key] !== file.stamp || !expanded.has(file.key)) return { marks: next, expanded }
  const folded = new Set(expanded)
  folded.delete(file.key)
  return { marks: next, expanded: folded }
}

export function changeItems(
  changes: GitChanges,
  expanded: ReadonlySet<string>,
  diffs: Readonly<Record<string, DiffView>>,
  comments: readonly ReviewComment[] = [],
  draft: DraftPlace | null = null,
  layout: DiffLayout = 'unified',
  /** 未提交 paths left out of the next commit (合入链路 v2, Figma 73A / 73F1); null: the rows have no checkboxes. */
  unticked: ReadonlySet<string> | null = null,
  /** 已看 marks and the 未看 filter; null: no marks (every row unviewed). */
  review: ReviewView | null = null
): ChangeItem[] {
  const split = layout === 'split' ? ({ split: true } as const) : {}
  const items: ChangeItem[] = []
  const files = (group: ChangeGroup, list: GitFileChange[]) => {
    for (const change of list) {
      const key = changeKey(group, change.path)
      const mark = review ? viewMarkOf(review.marks, key, fileStamp(change)) : 'unviewed'
      // 未看 lists what is left to read: unviewed rows and those that changed since.
      if (review?.unviewedOnly && mark === 'viewed') continue
      const open = expanded.has(key)
      // Review findings are not list rows (see the header); only what the user wrote sits under a line.
      const own = comments.filter((c) => c.origin !== 'review' && c.group === group && c.path === change.path)
      const draftHere = draft && draft.group === group && draft.path === change.path ? draft : null
      items.push({ kind: 'file', group, change, key, open, comments: own.length, mark })
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
        const commentItem = (comment: ReviewComment) => {
          placed.add(comment.id)
          if (draftHere?.id === comment.id) {
            draftPlaced = true
            items.push({ kind: 'editor', key, ...split })
          } else items.push({ kind: 'comment', key, comment, ...split })
        }
        const commentsAt = (anchor: { side: CommentSide; line: number }) => {
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
        // Comments whose line is no longer in the diff (the file changed since) still count; they go last.
        for (const comment of own) if (!placed.has(comment.id)) commentItem(comment)
        if (draftHere && !draftPlaced) items.push({ kind: 'editor', key, ...split })
        if (diff.truncated > 0) items.push({ kind: 'note', key, text: `还有 ${diff.truncated} 行没有显示`, open: change.path })
      }
    }
  }
  // An empty 未提交 is not shown: nothing to say there.
  const count = changes.uncommitted.length + changes.untrackedOmitted
  if (count > 0) {
    const ticked = unticked ? tickedPaths(changes.uncommitted, unticked).length : count
    const meta = `${count} 个文件${unticked && ticked < count ? ` · 勾选 ${ticked} 个` : ''}`
    items.push({ kind: 'group', title: '未提交', meta, ...(unticked ? { group: 'uncommitted' as const } : {}) })
  }
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

// --- which 未提交 files go into the next commit (合入链路 v2) ---------------------------------------------------------
// Every row starts ticked; the panel keeps the paths the user unticked (so a file that appears is ticked), per worktree.

/** A row that can be ticked: a nested repository is not committed from here. */
export const tickable = (change: Pick<GitFileChange, 'nested'>): boolean => !change.nested

/** The paths 提交… and the exits commit: the tickable rows that are not unticked. */
export function tickedPaths(uncommitted: readonly GitFileChange[], unticked: ReadonlySet<string>): string[] {
  return uncommitted.filter((c) => tickable(c) && !unticked.has(c.path)).map((c) => c.path)
}

/** While a Ship run that commits is open its checkboxes show what it commits: the tickable rows not among its `paths`. */
export function runUnticked(uncommitted: readonly GitFileChange[], paths: readonly string[]): ReadonlySet<string> {
  const committing = new Set(paths)
  return new Set(uncommitted.filter((c) => tickable(c) && !committing.has(c.path)).map((c) => c.path))
}

/**
 * Whether the change list shows the branch as it is, so 已看 marks of rows that left it can go: not while a merge,
 * rebase or cherry-pick is stopped (a rebase's detached HEAD lists only the commits replayed so far). `operation`: what
 * the worktree's last preflight saw stopped, or null.
 */
export function marksSettled(changes: Pick<GitChanges, 'branch' | 'uncommitted'>, operation: ShipOperation | null | undefined): boolean {
  return changes.branch !== null && !operation && !changes.uncommitted.some((c) => c.status === 'U')
}

/**
 * When Git · 变更 asks for the exits' preflight again: gh, the counts, the PR, the branch head (an amend or a reset that
 * keeps every count still moves it; null until the graph's first page names it), and a run opening or ending.
 */
export function preflightKey(parts: {
  gh: string | null
  changes: Pick<GitChanges, 'base' | 'ahead' | 'behind' | 'uncommitted'> | null | undefined
  pr: { number: number; state: string; localHead: string | null; headOid: string | null } | null
  head: string | null
  shipping: boolean
}): string {
  const { changes, pr } = parts
  return [parts.gh, changes?.base, changes?.ahead, changes?.behind, changes?.uncommitted.length, pr?.number, pr?.state, pr?.localHead, pr?.headOid, parts.head, parts.shipping].join(':')
}

/** The group header's checkbox: every tickable row ticked, none, or some. */
export function tickState(uncommitted: readonly GitFileChange[], unticked: ReadonlySet<string>): 'all' | 'none' | 'mixed' {
  const rows = uncommitted.filter(tickable)
  const ticked = rows.filter((c) => !unticked.has(c.path)).length
  return ticked === rows.length ? 'all' : ticked === 0 ? 'none' : 'mixed'
}

/** Unticked paths still in the list (a committed or reverted file leaves; the same path coming back starts ticked). */
export function pruneUnticked(unticked: ReadonlySet<string>, uncommitted: readonly GitFileChange[]): ReadonlySet<string> {
  if (unticked.size === 0) return unticked
  const listed = new Set(uncommitted.map((c) => c.path))
  const kept = [...unticked].filter((p) => listed.has(p))
  return kept.length === unticked.size ? unticked : new Set(kept)
}

/** Moved to the merge chain (src/shared/ship-chain.ts); kept here for the panel's imports. */
export { onOwnBase } from '@shared/ship-chain'

export const itemHeight = (item: ChangeItem): number => ITEM_HEIGHT[item.kind]

/** The open file an item belongs to (its diff lines, notes, comments, editor); null for headers and list notes. */
const fileKeyOf = (item: ChangeItem | undefined): string | null => {
  if (!item || item.kind === 'group') return null
  if (item.kind === 'file') return item.open ? item.key : null
  // The list's own note (还有 N 个未跟踪文件) has no file.
  return item.key.includes(':') ? item.key : null
}

/**
 * The open file whose row has scrolled above `top` while its diff still shows there (Figma 29L): that row is pinned to
 * the top of the list so the file can be folded from where the user is reading. Index of its file item, or null.
 */
export function stickyFileIndex(items: readonly ChangeItem[], offsets: readonly number[], top: number): number | null {
  if (top <= 0) return null
  let at = -1
  for (let i = 0; i < items.length && offsets[i]! <= top; i++) at = i
  const key = fileKeyOf(items[at])
  if (key === null) return null
  for (let i = at; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'file') return item.key === key && offsets[i]! < top ? i : null
  }
  return null
}

/** Whether an item is the last one of its open file's block (its bottom corners round, Figma 29L). */
export function endsOpenFile(items: readonly ChangeItem[], index: number): boolean {
  const key = fileKeyOf(items[index])
  return key !== null && fileKeyOf(items[index + 1]) !== key
}
