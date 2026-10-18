// Pure parts of Git · 变更 (PRD F17 13B2 / F5): which diffs are worth fetching, and the flat list of fixed-height rows
// (group headers, files, diff lines, notes, review comments and the comment editor) the view renders through a window.
import type { DiffRow } from '@shared/git-graph/diff'
import type { GitChanges, GitFileChange } from '@shared/git-graph/log'
import type { CommentSide, ReviewComment } from '@shared/review-comments'

export type ChangeGroup = 'uncommitted' | 'committed'

/** Files with more changed lines than this are not diffed in the panel (open them in an editor instead). */
export const MAX_DIFF_LINES = 20_000

/**
 * Figma 13B2 heights: group header 12 + 16 + 4, file row 8 + 16 + 8, DiffLine 20, a note line 4 + 16 + 8. Figma 03:
 * a saved comment 8 + 16 (location) + 2 × 18 (text, clamped) + 8; the editor 8 + 72 (text) + 8 + 28 (buttons) + 8.
 */
export const ITEM_HEIGHT = { group: 32, file: 32, diff: 20, note: 28, comment: 68, editor: 124 } as const

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

export type ChangeItem =
  | { kind: 'group'; title: string; meta: string }
  | { kind: 'file'; group: ChangeGroup; change: GitFileChange; key: string; open: boolean; comments: number }
  | { kind: 'diff'; key: string; group: ChangeGroup; path: string; row: DiffRow }
  | { kind: 'comment'; key: string; comment: ReviewComment }
  | { kind: 'editor'; key: string }
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
  draft: DraftPlace | null = null
): ChangeItem[] {
  const items: ChangeItem[] = []
  const files = (group: ChangeGroup, list: GitFileChange[]) => {
    for (const change of list) {
      const key = changeKey(group, change.path)
      const open = expanded.has(key)
      const own = comments.filter((c) => c.group === group && c.path === change.path)
      const draftHere = draft && draft.group === group && draft.path === change.path ? draft : null
      items.push({ kind: 'file', group, change, key, open, comments: own.length })
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
            items.push({ kind: 'editor', key })
          } else items.push({ kind: 'comment', key, comment })
        }
        for (const row of diff.rows) {
          items.push({ kind: 'diff', key, group, path: change.path, row })
          const anchor = rowAnchor(row)
          if (!anchor) continue
          for (const comment of own) if (comment.side === anchor.side && comment.endLine === anchor.line) commentItem(comment)
          if (draftHere && draftHere.id === null && draftHere.side === anchor.side && draftHere.endLine === anchor.line) {
            draftPlaced = true
            items.push({ kind: 'editor', key })
          }
        }
        // Comments whose line is no longer in the diff (the file changed since) still count; they go last.
        for (const comment of own) if (!placed.has(comment.id)) commentItem(comment)
        if (draftHere && !draftPlaced) items.push({ kind: 'editor', key })
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

export const itemHeight = (item: ChangeItem): number => ITEM_HEIGHT[item.kind]
