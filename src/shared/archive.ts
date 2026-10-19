// Archive (PRD F15, Figma 16D): stop a worktree's sessions, run the repository's `archive` script (approved like the
// others), keep the worktree's state — uncommitted changes included — on a private git ref, and fold it out of the
// sidebar. The folder stays where it is; ⌘K 历史 brings it back (recreating the folder from the ref only when it is
// gone) and the agents resume their conversations. The snapshot itself is src/main/archive-ref.ts.
import type { Session } from './types'

/** Saved on the worktree record while it is archived. */
export interface WorktreeArchive {
  /** Names the ref: `refs/wavi/archive/<id>`. */
  id: string
  /** Epoch ms. */
  at: number
  /** The snapshot commit (HEAD itself for a clean worktree). */
  commit: string
  /** The worktree had uncommitted or untracked files when it was archived. */
  dirty: boolean
}

/** `refs/wavi/archive/<id>`. Null when `id` could escape the namespace. */
export function archiveRefName(id: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(id) || id.includes('..') || id.endsWith('.lock') || id.endsWith('.')) return null
  return `refs/wavi/archive/${id}`
}

/** A fresh archive id: time first, so refs sort by when they were made. */
export function newArchiveId(now: number, random: number): string {
  return `${now.toString(36)}-${Math.floor(random * 0xffffff).toString(36)}`
}

const BUSY: ReadonlySet<Session['status']> = new Set(['running', 'needs_you'])

/** Why this worktree cannot be archived now (Figma 16D, second frame); null when it can. */
export function archiveBlocker(sessions: readonly Pick<Session, 'status'>[], isMain: boolean): string | null {
  if (isMain) return '项目主目录不能归档'
  if (sessions.some((s) => BUSY.has(s.status))) return '会话还在运行，先停下来再归档'
  return null
}

/** Every session that lives in these worktree records: archive stops them all (none is running, see archiveBlocker). */
export function sessionIdsToStop(sessions: readonly { id: string; worktreeId: string }[], worktreeIds: readonly string[]): string[] {
  const ids = new Set(worktreeIds)
  return sessions.filter((session) => ids.has(session.worktreeId)).map((session) => session.id)
}

/**
 * The existing script approval. `approved` runs the command; `declined` and `none` skip it. Either way the
 * caller continues with the snapshot and hiding the worktree.
 */
export function shouldRunArchiveScript(approval: 'approved' | 'declined' | 'none'): boolean {
  return approval === 'approved'
}

export type ArchiveCaptureResult = { ok: true; commit: string; dirty: boolean } | { ok: false; message: string }

export interface ArchiveRestoreRequest {
  /** The project's root (a workspace project). */
  root: string
  /** Where the worktree lives (or lived). */
  worktree: string
  branch: string
  id: string
}

/** `recreated`: the folder was gone and came back from the ref. */
export type ArchiveRestoreResult = { ok: true; recreated: boolean } | { ok: false; message: string }

export interface ArchiveApi {
  /** Points `refs/wavi/archive/<id>` at the worktree's state. Never touches the branch, HEAD, index or files. */
  capture(root: string, worktree: string, id: string): Promise<ArchiveCaptureResult>
  /** Brings the folder back when it is gone (from the ref), then drops the ref. An existing folder is left alone. */
  restore(request: ArchiveRestoreRequest): Promise<ArchiveRestoreResult>
}

export const ARCHIVE_IPC = {
  /** invoke(root, worktree, id) → ArchiveCaptureResult */
  capture: 'archive:capture',
  /** invoke(ArchiveRestoreRequest) → ArchiveRestoreResult */
  restore: 'archive:restore'
} as const

/** "3 天前归档" — the 历史 row's age. */
export function archivedAgo(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return '刚刚归档'
  if (minutes < 60) return `${minutes} 分钟前归档`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前归档`
  return `${Math.floor(hours / 24)} 天前归档`
}
