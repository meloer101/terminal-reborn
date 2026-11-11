// Review progress (合入链路 v2, PRD v1.170): an 已看 mark on every file row of Git · 变更, `已看 5 / 12` in its header.
// A mark remembers the file's diff fingerprint (`stamp`) when it was set; once the diff changes the mark no longer
// counts (the row reads 看过后又改了) until it is set again; it is dropped when the row leaves the list. Marks live in
// workspace.json per worktree path. Pure.
import type { GitChanges, GitFileChange } from './git-graph/log'

export type ChangeGroup = 'uncommitted' | 'committed'

/** A row of Git · 变更: `<group>:<path>` (the same file in 未提交 and 已提交 is two rows, viewed apart). */
export const changeKey = (group: ChangeGroup, path: string): string => `${group}:${path}`

/** One worktree's marks: row key → the stamp its diff had when it was marked. */
export type ViewedMarks = Record<string, string>

/** A row as review progress sees it. */
export interface ReviewFile {
  key: string
  stamp: string
}

/** The stamp main writes into GitFileChange.stamp: status, line counts, the working file's size and mtime (ms). */
export function changeStamp(parts: {
  status: GitFileChange['status']
  added: number | null
  removed: number | null
  /** null: the file is gone (deleted) or could not be read. */
  size: number | null
  mtimeMs: number | null
}): string {
  const part = (n: number | null): string => (n === null ? '-' : String(Math.trunc(n)))
  return [parts.status, part(parts.added), part(parts.removed), part(parts.size), part(parts.mtimeMs)].join(':')
}

/** A file's stamp: main's, else status, line counts and where a rename came from (main does not fill it yet). */
export function fileStamp(change: GitFileChange): string {
  return change.stamp ?? [change.status, change.added ?? '-', change.removed ?? '-', change.oldPath ?? ''].join(':')
}

/** Every row of Git · 变更 with its key and stamp, 未提交 first. */
export function reviewFiles(changes: Pick<GitChanges, 'uncommitted' | 'committed'>): ReviewFile[] {
  return [
    ...changes.uncommitted.map((c) => ({ key: changeKey('uncommitted', c.path), stamp: fileStamp(c) })),
    ...changes.committed.map((c) => ({ key: changeKey('committed', c.path), stamp: fileStamp(c) }))
  ]
}

export interface ViewedState {
  /** Rows whose mark matches their diff. */
  viewed: Set<string>
  /** Rows marked at an older diff: no longer viewed (看过后又改了). */
  stale: Set<string>
  /** viewed.size, the header's `已看 done / total`. */
  done: number
  total: number
}

export function viewedState(files: readonly ReviewFile[], marks: Readonly<ViewedMarks>): ViewedState {
  const viewed = new Set<string>()
  const stale = new Set<string>()
  for (const file of files) {
    const mark = marks[file.key]
    if (mark === undefined) continue
    if (mark === file.stamp) viewed.add(file.key)
    else stale.add(file.key)
  }
  return { viewed, stale, done: viewed.size, total: files.length }
}

/** 已看 on a row: marks it at its current diff, or unmarks it when it is viewed. Returns new marks. */
export function toggleViewed(marks: Readonly<ViewedMarks>, file: ReviewFile): ViewedMarks {
  const next = { ...marks }
  if (marks[file.key] === file.stamp) delete next[file.key]
  else next[file.key] = file.stamp
  return next
}

/**
 * Drops the marks of rows no longer in the change list; the same object when none goes. A row whose diff changed keeps
 * its mark: it is stale (看过后又改了) until it is marked again.
 */
export function pruneMarks(marks: ViewedMarks, files: readonly ReviewFile[]): ViewedMarks {
  const listed = new Set(files.map((f) => f.key))
  const kept = Object.entries(marks).filter(([key]) => listed.has(key))
  return kept.length === Object.keys(marks).length ? marks : Object.fromEntries(kept)
}

// ── workspace.json ──────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_MARKS_PER_WORKTREE = 5000
const MAX_KEY = 4096 + 16
const MAX_STAMP = 256
const KEY = /^(?:uncommitted|committed):[^\0]+$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * `reviewMarks` of workspace.json: marks by worktree path, only worktrees that exist, only well-formed rows. A file
 * without the field, or with a shape this does not know, loads as no marks.
 */
export function sanitizeReviewMarks(raw: unknown, worktreePaths: ReadonlySet<string>): Record<string, ViewedMarks> {
  const out: Record<string, ViewedMarks> = {}
  if (!isRecord(raw)) return out
  for (const [worktree, value] of Object.entries(raw)) {
    if (!worktreePaths.has(worktree) || !isRecord(value)) continue
    const marks: ViewedMarks = {}
    let count = 0
    for (const [key, stamp] of Object.entries(value)) {
      if (count >= MAX_MARKS_PER_WORKTREE) break
      if (key.length > MAX_KEY || !KEY.test(key) || typeof stamp !== 'string' || stamp === '' || stamp.length > MAX_STAMP) continue
      marks[key] = stamp
      count++
    }
    if (count > 0) out[worktree] = marks
  }
  return out
}
