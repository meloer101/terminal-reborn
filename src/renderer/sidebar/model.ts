// Pure sidebar view-model: grouping, ordering and keyboard targets. No React, no store access.
import type { SubagentInfo } from '@shared/agent-events'
import type { Project, ProjectId, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { compareByUrgency, needsAttention } from '@shared/session-status'
import { phaseLine } from '../lifecycle/present'

export interface SessionRowModel {
  session: Session
  /** The title drawn: a nested session named `<its parent's title> · Codex` (同任务多解) shows only `Codex`. */
  title: string
  /**
   * Second line: the agent's lifecycle or current action; once a turn is over, its last reply
   * (prefixed "已完成" while unread, so the state is never color-only). Empty before the first turn.
   */
  secondary: string
  /** Only `needs_you` recolors the secondary line (Figma SessionRow `attention`). */
  attention: boolean
  /** The worktree's branch: the row's third line, which ends in the agent's mark (Figma 34P). Empty outside git. */
  branch: string
  /** 1: started by the session right above it through Wavi's dispatch tools (PRD F21), drawn one step in. */
  depth: 0 | 1
  /**
   * The line in the glyph column that ties a dispatcher to its children (Figma 40C): `parent` starts it under the
   * glyph, `child` carries it on with a tick to its glyph, `last` turns into its glyph and ends it.
   */
  tree?: 'parent' | 'child' | 'last'
  /** A dispatched session with subagents of its own: a second line starts under its glyph, one column in (Figma 44B). */
  opens?: boolean
  /** Subagent rows drawn right after this row (its own, then its dispatcher's when it is the last child). */
  after?: SubagentRowModel[]
}

/**
 * A subagent the session's agent started itself (Claude's Agent tool; PRD F21 v1.109, Figma 44B): one line, under its
 * session and after the sessions it dispatched. Display only — it is not a session and no keyboard target.
 */
export interface SubagentRowModel {
  /** The session it runs in; a click selects that session. */
  sessionId: SessionId
  /** Claude's `agent_id`. */
  id: string
  title: string
  /** Display name of its model; '' until known. */
  model: string
  /** Its ask is pending (PermissionRequest / AskUserQuestion with its `agent_id`). */
  attention: boolean
  /** 1 under a top-level session, 2 under a dispatched one. */
  depth: 1 | 2
  tree: 'child' | 'last'
  /** Depth 2: its session is not the last of its dispatcher's line, so that line runs on past this row. */
  pass: boolean
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
  /** Running subagents per session (session-meta); none when absent. */
  subagents?: Readonly<Record<SessionId, readonly SubagentInfo[] | undefined>>
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

function toRow(session: Session, worktree: Worktree | undefined, { depth, parentTitle, tree, opens, after }: NestedRow): SessionRowModel {
  // The project header already says which folder this is; the branch has its own line (Figma 34P).
  return {
    session,
    title: depth === 1 ? nestedTitle(session.title, parentTitle) : session.title,
    secondary: phaseLine(session) ?? session.currentAction ?? afterTurn(session) ?? '',
    attention: session.status === 'needs_you',
    branch: worktree?.branch ?? '',
    depth,
    tree,
    ...(opens ? { opens } : {}),
    ...(after ? { after } : {})
  }
}

export const sameSubagent = (a: SubagentRowModel, b: SubagentRowModel): boolean =>
  a.id === b.id && a.title === b.title && a.model === b.model && a.attention === b.attention && a.depth === b.depth && a.tree === b.tree && a.pass === b.pass

/**
 * Whether two models draw the same row (its `after` rows are drawn by SubagentRow, which compares them itself). buildSidebarGroups makes new ones on every store change (an agent's hook event
 * touches one session), so SessionRow compares these instead of the object to redraw only the row that changed.
 */
export function sameRow(a: SessionRowModel, b: SessionRowModel): boolean {
  return (
    a.session === b.session &&
    a.title === b.title &&
    a.secondary === b.secondary &&
    a.attention === b.attention &&
    a.branch === b.branch &&
    a.depth === b.depth &&
    a.tree === b.tree &&
    a.opens === b.opens
  )
}

export interface NestedRow {
  session: Session
  depth: 0 | 1
  parentTitle?: string
  tree?: SessionRowModel['tree']
  opens?: boolean
  after?: SubagentRowModel[]
}

type SubagentsOf = (id: SessionId) => readonly SubagentInfo[]
const NO_SUBAGENTS: SubagentsOf = () => []

function subagentRows(session: Session, items: readonly SubagentInfo[], depth: 1 | 2, pass: boolean): SubagentRowModel[] {
  return items.map((item, i) => ({
    sessionId: session.id,
    id: item.id,
    title: item.title,
    model: item.model ?? '',
    attention: session.askingAgents?.includes(item.id) ?? false,
    depth,
    tree: i === items.length - 1 ? 'last' : 'child',
    pass: depth === 2 && pass
  }))
}

/**
 * Store order, except that a dispatched session follows the session that started it (PRD F21), after that session's
 * earlier children. A child whose dispatcher is not listed here stays where it is, at the top level.
 * Subagents (Figma 44B) hang under their session: a child's right after it, a top-level session's after its children.
 */
export function withChildrenNested(sessions: readonly Session[], subagentsOf: SubagentsOf = NO_SUBAGENTS): NestedRow[] {
  const listed = new Set(sessions.map((s) => s.id))
  const nested = (s: Session): boolean => s.dispatchedBy !== undefined && listed.has(s.dispatchedBy)
  const out: NestedRow[] = []
  for (const session of sessions) {
    if (nested(session)) continue
    const children = sessions.filter((child) => child.dispatchedBy === session.id && nested(child))
    const own = subagentsOf(session.id)
    const top: NestedRow = children.length + own.length > 0 ? { session, depth: 0, tree: 'parent' } : { session, depth: 0 }
    out.push(top)
    let host = top
    children.forEach((child, i) => {
      // The dispatcher's line runs on below this child while another child or one of its own subagents follows.
      const more = i < children.length - 1 || own.length > 0
      const subs = subagentRows(child, subagentsOf(child.id), 2, more)
      host = { session: child, depth: 1, parentTitle: session.title, tree: more ? 'child' : 'last', ...(subs.length > 0 ? { opens: true, after: subs } : {}) }
      out.push(host)
    })
    if (own.length > 0) host.after = [...(host.after ?? []), ...subagentRows(session, own, 1, false)]
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
export function buildSidebarGroups({ projects, worktrees, sessions, collapsedProjectIds = [], subagents }: SidebarInput): SidebarGroup[] {
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const subagentsOf: SubagentsOf = subagents ? (id) => subagents[id] ?? [] : NO_SUBAGENTS
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
      rows: isCollapsed ? [] : withChildrenNested(own, subagentsOf).map((nested) => toRow(nested.session, worktreeById.get(nested.session.worktreeId), nested)),
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
