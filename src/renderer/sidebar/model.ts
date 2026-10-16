// Pure sidebar view-model: grouping, ordering and keyboard targets. No React, no store access.
import type { Project, ProjectId, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { phaseLine } from '../lifecycle/present'

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
  id: ProjectId
  title: string
  /** Rows drawn under the header; empty while the project is collapsed. */
  rows: SessionRowModel[]
  /** All of the project's sessions, drawn or not. */
  sessionCount: number
  collapsed: boolean
  /** Most urgent status among sessions that need attention (null when none) — the hint on a collapsed header. */
  attention: SessionStatus | null
}

export interface SidebarInput {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  collapsedProjectIds?: readonly ProjectId[]
}

function toRow(session: Session, worktree: Worktree | undefined): SessionRowModel {
  const location = worktree ? (worktree.isMain ? worktree.path : worktree.branch) : ''
  const added = worktree?.added ?? 0
  const removed = worktree?.removed ?? 0
  return {
    session,
    secondary: phaseLine(session) ?? session.currentAction ?? location,
    attention: session.status === 'needs_you',
    stat: added + removed > 0 ? { added, removed } : null
  }
}

/**
 * Groups sessions for the sidebar: strictly by place (PRD §3.3). A session always stays under its project,
 * whatever its status — the cross-project, by-status view is the overview, not the sidebar.
 * Projects keep store order and sessions keep store order within a project. Every project is listed, even
 * with no sessions, so it always offers "新建会话". A collapsed project draws no rows; its header carries
 * the most urgent attention status instead.
 */
export function buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds = [] }: SidebarInput): SidebarGroup[] {
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const collapsed = new Set(collapsedProjectIds)
  return projects.map((project) => {
    const own = sessions.filter((s) => worktreeById.get(s.worktreeId)?.projectId === project.id)
    const urgent = own.filter((s) => needsAttention(s.status)).sort(compareByUrgency)[0]
    const isCollapsed = collapsed.has(project.id)
    return {
      id: project.id,
      title: project.name,
      rows: isCollapsed ? [] : own.map((s) => toRow(s, worktreeById.get(s.worktreeId))),
      sessionCount: own.length,
      collapsed: isCollapsed,
      attention: urgent?.status ?? null
    }
  })
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

/**
 * ⌘J: the next session needing attention after `activeId`, most urgent first, wrapping around — across all
 * projects, collapsed ones included. Null when none.
 */
export function nextAttentionSessionId(sessions: Session[], activeId: SessionId | null): SessionId | null {
  const queue = sessions.filter((s) => needsAttention(s.status)).sort(compareByUrgency).map((s) => s.id)
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
