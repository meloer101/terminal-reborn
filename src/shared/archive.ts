// Archive (PRD F15): which sessions an archive stops, and whether the repository's `archive` script runs.
// The snapshot itself is a private git ref (src/main/archive-ref.ts). Declining the script skips the command
// and still leaves the snapshot and the sidebar hide to the caller.

/** `refs/wavi/archive/<id>`. Null when `id` could escape the namespace. */
export function archiveRefName(id: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(id) || id.includes('..') || id.endsWith('.lock') || id.endsWith('.')) return null
  return `refs/wavi/archive/${id}`
}

/** Every session that lives in the worktree. Archive stops them itself, including one whose agent is running. */
export function sessionIdsToStop(sessions: readonly { id: string; worktreeId: string }[], worktreeId: string): string[] {
  return sessions.filter((session) => session.worktreeId === worktreeId).map((session) => session.id)
}

/**
 * The existing script approval. `approved` runs the command; `declined` and `none` skip it. Either way the
 * caller continues with the snapshot and hiding the worktree.
 */
export function shouldRunArchiveScript(approval: 'approved' | 'declined' | 'none'): boolean {
  return approval === 'approved'
}
