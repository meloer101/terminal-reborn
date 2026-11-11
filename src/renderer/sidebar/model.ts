// Pure sidebar view-model: grouping, ordering and keyboard targets. No React, no store access.
import type { SubagentInfo } from '@shared/agent-events'
import type { Project, ProjectId, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { compareByUrgency, needsAttention, STATUS_LABEL, STATUS_ORDER } from '@shared/session-status'
import type { SidebarGroupBy } from '@shared/workspace-file'
import { phaseLine } from '../lifecycle/present'
import { currentPhase, isLiveRun, phaseViews, runOutcome, type WorkflowPhaseView, type WorkflowRun } from '@shared/workflow-run'

/**
 * A line hung under a session: a subagent (Figma 44B), or a Claude workflow run and its phases (Figma 74D, PRD F25).
 * `glyph` and `right` are the run's and phases' own; a subagent's glyph comes from its asks.
 */
export interface SideItem extends SubagentInfo {
  kind?: 'workflow' | 'phase'
  glyph?: SessionStatus
  /** Right-hand figure: a run's or phase's done / all. */
  right?: string
}

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
  /** 1: started by a session above it through Wavi's `wavi run` (PRD F21), drawn one step in; 2: by one of those. */
  depth: 0 | 1 | 2
  /** The model `wavi run --model` asked for, before the agent mark on the branch line (Figma 44B); '' when none. */
  model: string
  /** Depth 2 under a child that is not its dispatcher's last: the top line runs on past this row (Figma 44B). */
  pass?: boolean
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
  /** A workflow run's row, or one of its phases (Figma 74D); absent for a subagent. */
  kind?: 'workflow' | 'phase'
  glyph?: SessionStatus
  right?: string
}

export interface SidebarGroup {
  /** A project's id, or `status:<status>` in the 按状态 view. */
  id: string
  /** `project`: a project and its sessions (default). `status`: every listed session with one status (PRD §3.3, Figma 53C). */
  kind: 'project' | 'status'
  /** The status a `status` group holds. */
  status?: SessionStatus
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
  subagents?: Readonly<Record<SessionId, readonly SideItem[] | undefined>>
  /** Absent = by project. */
  groupBy?: SidebarGroupBy
  collapsedStatusGroups?: readonly SessionStatus[]
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

function toRow(session: Session, worktree: Worktree | undefined, { depth, parentTitle, tree, opens, after, pass }: NestedRow): SessionRowModel {
  // The project header already says which folder this is; the branch has its own line (Figma 34P).
  return {
    session,
    title: depth > 0 ? nestedTitle(session.title, parentTitle) : session.title,
    secondary: phaseLine(session) ?? session.currentAction ?? afterTurn(session) ?? '',
    attention: session.status === 'needs_you',
    // A snapshot has no branch (detached): its line says so instead.
    branch: session.dispatchBase === 'snapshot' ? '快照' : session.scheduledBy ? `定时 · ${worktree?.branch ?? ''}` : (worktree?.branch ?? ''),
    depth,
    model: session.dispatchModel ?? '',
    tree,
    ...(pass ? { pass } : {}),
    ...(opens ? { opens } : {}),
    ...(after ? { after } : {})
  }
}

export const sameSubagent = (a: SubagentRowModel, b: SubagentRowModel): boolean =>
  a.id === b.id &&
  a.title === b.title &&
  a.model === b.model &&
  a.attention === b.attention &&
  a.depth === b.depth &&
  a.tree === b.tree &&
  a.pass === b.pass &&
  a.kind === b.kind &&
  a.glyph === b.glyph &&
  a.right === b.right

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
    a.opens === b.opens &&
    a.pass === b.pass
  )
}

export interface NestedRow {
  session: Session
  depth: 0 | 1 | 2
  pass?: boolean
  parentTitle?: string
  tree?: SessionRowModel['tree']
  opens?: boolean
  after?: SubagentRowModel[]
}

type SubagentsOf = (id: SessionId) => readonly SideItem[]
const NO_SUBAGENTS: SubagentsOf = () => []

function subagentRows(session: Session, items: readonly SideItem[], depth: 1 | 2, pass: boolean): SubagentRowModel[] {
  return items.map((item, i) => ({
    sessionId: session.id,
    id: item.id,
    title: item.title,
    model: item.model ?? '',
    attention: !item.kind && (session.askingAgents?.includes(item.id) ?? false),
    depth,
    tree: i === items.length - 1 ? 'last' : 'child',
    pass: depth === 2 && pass,
    ...(item.kind ? { kind: item.kind } : {}),
    ...(item.glyph ? { glyph: item.glyph } : {}),
    ...(item.right !== undefined ? { right: item.right } : {})
  }))
}

/** A run's or phase's state as a session glyph (status is never colour only: each has its own shape). */
const RUN_GLYPH: Readonly<Record<ReturnType<typeof runOutcome>, SessionStatus>> = {
  running: 'running',
  paused: 'idle',
  completed: 'done_unread',
  'partly-failed': 'error',
  failed: 'error',
  stopped: 'exited'
}
const PHASE_GLYPH: Readonly<Record<WorkflowPhaseView['state'], SessionStatus>> = {
  pending: 'idle',
  running: 'running',
  paused: 'idle',
  done: 'done_unread',
  error: 'error',
  stopped: 'exited'
}

/**
 * Figma 74D: a session's workflow runs under it — a row per run (state · name · the current phase's done / all) and,
 * unless folded, a row per phase. A run that ended stays while the session's turn is unread (the user has not looked
 * yet), then goes. Its agents are not listed one by one.
 */
export function workflowItems(runs: readonly WorkflowRun[], { unread, folded }: { unread: boolean; folded: ReadonlySet<string> }): SideItem[] {
  const items: SideItem[] = []
  for (const run of runs) {
    if (!isLiveRun(run) && !unread) continue
    const views = phaseViews(run, 0)
    const at = isLiveRun(run) ? currentPhase(views) : undefined
    const done = run.agents.filter((a) => a.state === 'done').length
    items.push({ id: `workflow:${run.key}`, title: run.name, kind: 'workflow', glyph: RUN_GLYPH[runOutcome(run)], right: at ? `${at.done} / ${at.total}` : `${done} / ${run.agents.length}` })
    if (folded.has(run.key)) continue
    views.forEach((phase, i) =>
      items.push({ id: `phase:${run.key}:${i}`, title: phase.title, kind: 'phase', glyph: PHASE_GLYPH[phase.state], right: phase.total > 0 ? `${phase.done} / ${phase.total}` : '—' })
    )
  }
  return items
}

/**
 * Store order, except that a dispatched session follows the session that started it (PRD F21), after that session's
 * earlier children, and a grandchild follows its own dispatcher the same way, one more step in. A child whose
 * dispatcher is not listed here stays where it is, at the top level. Subagents (Figma 44B) hang under their session
 * after the sessions it dispatched: a child's after its grandchildren, a top-level session's after everything below it.
 */
export function withChildrenNested(sessions: readonly Session[], subagentsOf: SubagentsOf = NO_SUBAGENTS): NestedRow[] {
  const listed = new Set(sessions.map((s) => s.id))
  const nested = (s: Session): boolean => s.dispatchedBy !== undefined && listed.has(s.dispatchedBy)
  const childrenOf = (id: SessionId): Session[] => sessions.filter((child) => child.dispatchedBy === id && nested(child))
  const out: NestedRow[] = []
  for (const session of sessions) {
    if (nested(session)) continue
    const children = childrenOf(session.id)
    const own = subagentsOf(session.id)
    const top: NestedRow = children.length + own.length > 0 ? { session, depth: 0, tree: 'parent' } : { session, depth: 0 }
    out.push(top)
    let last = top
    children.forEach((child, i) => {
      // The dispatcher's line runs on below this child while another child or one of its own subagents follows.
      const more = i < children.length - 1 || own.length > 0
      const grandchildren = childrenOf(child.id)
      const subs = subagentRows(child, subagentsOf(child.id), 2, more)
      const host: NestedRow = { session: child, depth: 1, parentTitle: session.title, tree: more ? 'child' : 'last', ...(grandchildren.length + subs.length > 0 ? { opens: true } : {}) }
      out.push(host)
      last = host
      grandchildren.forEach((grandchild, j) => {
        const row: NestedRow = { session: grandchild, depth: 2, parentTitle: child.title, tree: j < grandchildren.length - 1 || subs.length > 0 ? 'child' : 'last', ...(more ? { pass: true } : {}) }
        out.push(row)
        last = row
      })
      if (subs.length > 0) last.after = subs
    })
    if (own.length > 0) last.after = [...(last.after ?? []), ...subagentRows(session, own, 1, false)]
  }
  return out
}

/** The listed sessions of a project, in store order. Archived worktrees (PRD F15) are folded away until ⌘K 历史 brings them back. */
function sessionsOf(project: Project, sessions: readonly Session[], worktreeById: ReadonlyMap<string, Worktree>): Session[] {
  return sessions.filter((s) => {
    const worktree = worktreeById.get(s.worktreeId)
    return worktree?.projectId === project.id && !worktree.archived
  })
}

/**
 * Groups sessions for the sidebar. By default strictly by place (PRD §3.3): a session always stays under its
 * project, whatever its status. Projects keep store order and sessions keep store order within a project. Every
 * project is listed, even with no sessions, so it always offers "新建会话". A collapsed project draws no rows; its
 * header carries the most urgent attention status instead. With `groupBy: 'status'` see buildStatusGroups.
 */
export function buildSidebarGroups(input: SidebarInput): SidebarGroup[] {
  if (input.groupBy === 'status') return buildStatusGroups(input)
  const { projects, worktrees, sessions, collapsedProjectIds = [], subagents } = input
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const subagentsOf: SubagentsOf = subagents ? (id) => subagents[id] ?? [] : NO_SUBAGENTS
  const collapsed = new Set(collapsedProjectIds)
  return projects.map((project) => {
    const own = sessionsOf(project, sessions, worktreeById)
    const urgent = own.filter((s) => needsAttention(s.status)).sort(compareByUrgency)[0]
    const isCollapsed = collapsed.has(project.id)
    return {
      id: project.id,
      kind: 'project',
      title: project.name,
      rows: isCollapsed ? [] : withChildrenNested(own, subagentsOf).map((nested) => toRow(nested.session, worktreeById.get(nested.session.worktreeId), nested)),
      sessionCount: own.length,
      collapsed: isCollapsed,
      attention: urgent?.status ?? null
    }
  })
}

/**
 * The sidebar's 按状态 view (PRD §3.3, Figma 53C): one group per status, most urgent first (等你处理 → 出错 → 已完成 →
 * 运行中 → 空闲 → 已退出); a status no listed session has is not drawn. Within a group, sessions keep the 按项目 order
 * (projects, then store order), so a row only moves when its status does. Rows are flat — a dispatched session goes to
 * its own status's group — and their last line reads `<project> › <branch>`. A session's own subagents stay under it.
 */
export function buildStatusGroups({ projects, worktrees, sessions, collapsedStatusGroups = [], subagents }: SidebarInput): SidebarGroup[] {
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const listed = projects.flatMap((project) => sessionsOf(project, sessions, worktreeById).map((session) => ({ session, project })))
  const collapsed = new Set(collapsedStatusGroups)
  return STATUS_ORDER.flatMap((status): SidebarGroup[] => {
    const own = listed.filter(({ session }) => session.status === status)
    if (own.length === 0) return []
    const isCollapsed = collapsed.has(status)
    return [
      {
        id: `status:${status}`,
        kind: 'status',
        status,
        title: STATUS_LABEL[status],
        rows: isCollapsed
          ? []
          : own.map(({ session, project }) => {
              const worktree = worktreeById.get(session.worktreeId)
              const subs = subagents?.[session.id] ?? []
              const row = toRow(session, worktree, {
                session,
                depth: 0,
                ...(subs.length > 0 ? { tree: 'parent' as const, after: subagentRows(session, subs, 1, false) } : {})
              })
              return { ...row, branch: row.branch ? `${project.name} › ${row.branch}` : project.name }
            }),
        sessionCount: own.length,
        collapsed: isCollapsed,
        // The header already names the status (Figma 53C): no hint glyph when folded.
        attention: null
      }
    ]
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
