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
  /** The title drawn: a nested session named `<its parent's title> · Codex` (同任务多解) shows only `Codex`. */
  title: string
  /**
   * Secondary line: the agent's lifecycle or current action; once a turn is over, its last reply
   * (prefixed "已完成" while unread, so the state is never color-only); else the main checkout's folder.
   */
  secondary: string
  /** Only `needs_you` recolors the secondary line (Figma SessionRow `attention`). */
  attention: boolean
  stat: DiffStat | null
  /** The worktree's branch, drawn on the row's last line next to the agent's mark. */
  branch: string
  /** 1: started by the session right above it through Wavi's dispatch tools (PRD F21), drawn one step in. */
  depth: 0 | 1
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

/** What a finished turn left: "已完成 · <reply>" while unread, the reply once seen. */
function afterTurn(session: Session): string | undefined {
  if (session.status === 'done_unread') return session.lastReply ? `已完成 · ${session.lastReply}` : '已完成 · 未读'
  if (session.status === 'idle') return session.lastReply
  return undefined
}

/** `Cookie 会话迁移 · Codex` under `Cookie 会话迁移` reads `Codex`: the indent already says whose it is. */
export function nestedTitle(title: string, parentTitle: string | undefined): string {
  const prefix = parentTitle ? `${parentTitle} · ` : ''
  return prefix && title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length) : title
}

function toRow(session: Session, worktree: Worktree | undefined, depth: 0 | 1 = 0, parentTitle?: string): SessionRowModel {
  // The branch has its own line now (SessionRow); only the main checkout's folder still says where it lives.
  const location = worktree?.isMain ? worktree.path : ''
  const added = worktree?.added ?? 0
  const removed = worktree?.removed ?? 0
  return {
    session,
    title: depth === 1 ? nestedTitle(session.title, parentTitle) : session.title,
    secondary: phaseLine(session) ?? session.currentAction ?? afterTurn(session) ?? location,
    attention: session.status === 'needs_you',
    stat: added + removed > 0 ? { added, removed } : null,
    branch: worktree?.branch ?? '',
    depth
  }
}

/**
 * Store order, except that a dispatched session follows the session that started it (PRD F21), after that session's
 * earlier children. A child whose dispatcher is not listed here stays where it is, at the top level.
 */
export function withChildrenNested(sessions: readonly Session[]): Array<{ session: Session; depth: 0 | 1; parentTitle?: string }> {
  const listed = new Set(sessions.map((s) => s.id))
  const nested = (s: Session): boolean => s.dispatchedBy !== undefined && listed.has(s.dispatchedBy)
  const out: Array<{ session: Session; depth: 0 | 1; parentTitle?: string }> = []
  for (const session of sessions) {
    if (nested(session)) continue
    out.push({ session, depth: 0 })
    for (const child of sessions) if (child.dispatchedBy === session.id && nested(child)) out.push({ session: child, depth: 1, parentTitle: session.title })
  }
  return out
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
    // Archived worktrees (PRD F15) are folded away until ⌘K 历史 brings them back.
    const own = sessions.filter((s) => {
      const worktree = worktreeById.get(s.worktreeId)
      return worktree?.projectId === project.id && !worktree.archived
    })
    const urgent = own.filter((s) => needsAttention(s.status)).sort(compareByUrgency)[0]
    const isCollapsed = collapsed.has(project.id)
    return {
      id: project.id,
      title: project.name,
      rows: isCollapsed ? [] : withChildrenNested(own).map(({ session, depth, parentTitle }) => toRow(session, worktreeById.get(session.worktreeId), depth, parentTitle)),
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
