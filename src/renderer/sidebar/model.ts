// Pure sidebar view-model: grouping, ordering and keyboard targets. No React, no store access.
import type { Project, Session, SessionId, Worktree } from '@shared/types'
import { compareByUrgency, needsAttention } from '@shared/session-status'

export interface DiffStat {
  added: number
  removed: number
}

export interface SessionRowModel {
  session: Session
  /** Secondary line: the agent's current action, else where the session lives. */
  secondary: string
  /** Only `needs_you` recolors the secondary line (Figma SessionRow `attention`). */
  attention: boolean
  stat: DiffStat | null
}

export interface SidebarGroup {
  id: string
  kind: 'attention' | 'project'
  title: string
  rows: SessionRowModel[]
}

export interface SidebarInput {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
}

export const ATTENTION_GROUP_ID = 'attention'
export const ATTENTION_GROUP_TITLE = '等你处理'

function toRow(session: Session, worktree: Worktree | undefined): SessionRowModel {
  const location = worktree ? (worktree.isMain ? worktree.path : worktree.branch) : ''
  const added = worktree?.added ?? 0
  const removed = worktree?.removed ?? 0
  return {
    session,
    secondary: session.currentAction ?? location,
    attention: session.status === 'needs_you',
    stat: added + removed > 0 ? { added, removed } : null
  }
}

/**
 * Groups sessions for the sidebar.
 * - Sessions that need attention are hoisted into a top "等你处理" group, most urgent first,
 *   and are not repeated under their project.
 * - Projects keep store order; sessions within a project keep store order.
 * - Projects with nothing left to show are omitted. A header's count is the number of rows under it.
 */
export function buildSidebarGroups({ projects, worktrees, sessions }: SidebarInput): SidebarGroup[] {
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const groups: SidebarGroup[] = []

  const queue = sessions.filter((s) => needsAttention(s.status)).sort(compareByUrgency)
  if (queue.length > 0) {
    groups.push({
      id: ATTENTION_GROUP_ID,
      kind: 'attention',
      title: ATTENTION_GROUP_TITLE,
      rows: queue.map((s) => toRow(s, worktreeById.get(s.worktreeId)))
    })
  }

  for (const project of projects) {
    const rows = sessions
      .filter((s) => !needsAttention(s.status) && worktreeById.get(s.worktreeId)?.projectId === project.id)
      .map((s) => toRow(s, worktreeById.get(s.worktreeId)))
    if (rows.length > 0) groups.push({ id: project.id, kind: 'project', title: project.name, rows })
  }
  return groups
}

/** Session ids in the order they appear on screen. */
export function visibleSessionIds(groups: SidebarGroup[]): SessionId[] {
  return groups.flatMap((g) => g.rows.map((r) => r.session.id))
}

/** ⌘1–⌘9: the nth visible session (1-based), or null when there are fewer. */
export function sessionForShortcut(groups: SidebarGroup[], n: number): SessionId | null {
  if (!Number.isInteger(n) || n < 1 || n > 9) return null
  return visibleSessionIds(groups)[n - 1] ?? null
}

/** ⌘J: the next session needing attention after `activeId`, wrapping around. Null when none. */
export function nextAttentionSessionId(groups: SidebarGroup[], activeId: SessionId | null): SessionId | null {
  const queue = groups.filter((g) => g.kind === 'attention').flatMap((g) => g.rows.map((r) => r.session.id))
  if (queue.length === 0) return null
  const at = activeId === null ? -1 : queue.indexOf(activeId)
  return queue[(at + 1) % queue.length] ?? null
}

/** ↑/↓: neighbouring visible session, clamped at the ends. With no current row, down picks the first, up the last. */
export function adjacentSessionId(
  groups: SidebarGroup[],
  currentId: SessionId | null,
  direction: 1 | -1
): SessionId | null {
  const ids = visibleSessionIds(groups)
  if (ids.length === 0) return null
  const at = currentId === null ? -1 : ids.indexOf(currentId)
  if (at === -1) return (direction === 1 ? ids[0] : ids[ids.length - 1]) ?? null
  return ids[Math.min(ids.length - 1, Math.max(0, at + direction))] ?? null
}
