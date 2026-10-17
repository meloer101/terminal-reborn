// Worktree view (PRD F17, Figma 13C): the project's git worktrees joined with the workspace's sessions, grouped
// into the working list and 可清理, plus the delete guard. Pure; WorktreeView renders it.
import type { GitWorktreeInfo, GitWorktreeListing } from '@shared/git-worktrees'
import { isActiveStatus } from '@shared/lifecycle'
import { compareByUrgency } from '@shared/session-status'
import type { AgentKind, Session, SessionStatus, Worktree, WorktreeId } from '@shared/types'

export const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex', shell: '终端' }

/** What the session line adds after the agent; running and idle say nothing (the glyph shows it). */
const STATE_TEXT: Partial<Record<SessionStatus, string>> = {
  needs_you: '等你确认',
  done_unread: '待审阅',
  error: '出错',
  exited: '已退出'
}

export interface WorktreeRow {
  /** Resolved path: stable identity across refreshes. */
  key: string
  info: GitWorktreeInfo
  /** Branch, or the short commit when detached. */
  name: string
  /** Sessions in this worktree, most urgent first. */
  sessions: Session[]
  /** Status of the most urgent session; null when the worktree has none. */
  status: SessionStatus | null
  /** The workspace's record for this folder (its path is what new sessions start in), when there is one. */
  worktreeIds: WorktreeId[]
  /** Path new sessions should use: the workspace's spelling when known, else git's. */
  openPath: string
  sessionLine: string
  /** `+N −M` uncommitted, '' when clean. */
  diff: string
  /** `↑ahead ↓behind`, '—' without a base. */
  sync: string
  cleanable: boolean
}

export interface WorktreeGroups {
  working: WorktreeRow[]
  cleanable: WorktreeRow[]
}

export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '无提交'
}

/** `/Users/me/x` → `~/x`. */
export function tildePath(path: string, home: string): string {
  const h = home.replace(/\/+$/, '')
  if (!h) return path
  if (path === h) return '~'
  return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path
}

export function formatDiff(info: Pick<GitWorktreeInfo, 'added' | 'removed' | 'dirtyCount'>): string {
  return info.dirtyCount > 0 || info.added > 0 || info.removed > 0 ? `+${info.added} −${info.removed}` : ''
}

export function formatSync(info: Pick<GitWorktreeInfo, 'ahead' | 'behind'>): string {
  return info.ahead === null || info.behind === null ? '—' : `↑${info.ahead} ↓${info.behind}`
}

/** "title · agent · state", the other sessions counted, and the merged note. */
export function sessionLine(sessions: readonly Session[], info: Pick<GitWorktreeInfo, 'merged' | 'base'>): string {
  const parts: string[] = []
  const top = sessions[0]
  if (top) {
    parts.push(top.title, AGENT_LABEL[top.kind])
    const state = STATE_TEXT[top.status]
    if (state) parts.push(state)
    if (sessions.length > 1) parts.push(`另有 ${sessions.length - 1} 个会话`)
  } else {
    parts.push('无会话')
  }
  if (info.merged && info.base) parts.push(`已合并到 ${info.base}`)
  return parts.join(' · ')
}

/** Old enough to clean up: merged into its base or nobody works in it. The main checkout never is. */
export function isCleanable(info: Pick<GitWorktreeInfo, 'isMain' | 'merged' | 'prunable'>, sessionCount: number): boolean {
  return !info.isMain && (info.merged || info.prunable || sessionCount === 0)
}

/**
 * Joins git's worktrees with the project's workspace worktrees (by resolved path) and their sessions, then splits
 * them into the working list (main checkout first, git's order) and 可清理.
 */
export function buildRows(
  listing: GitWorktreeListing,
  worktrees: readonly Worktree[],
  sessions: readonly Session[]
): WorktreeGroups {
  const resolved = (w: Worktree) => listing.realPaths[w.path] ?? w.path
  const groups: WorktreeGroups = { working: [], cleanable: [] }
  for (const info of listing.worktrees) {
    const matched = worktrees.filter((w) => resolved(w) === info.realPath || w.path === info.path)
    const ids = new Set(matched.map((w) => w.id))
    const inside = sessions.filter((s) => ids.has(s.worktreeId)).sort(compareByUrgency)
    const row: WorktreeRow = {
      key: info.realPath,
      info,
      name: info.branch ?? shortSha(info.head),
      sessions: inside,
      status: inside[0]?.status ?? null,
      worktreeIds: matched.map((w) => w.id),
      openPath: matched[0]?.path ?? info.path,
      sessionLine: info.isMain ? `主目录 · ${sessionLine(inside, info)}` : sessionLine(inside, info),
      diff: formatDiff(info),
      sync: formatSync(info),
      cleanable: isCleanable(info, inside.length)
    }
    ;(row.cleanable ? groups.cleanable : groups.working).push(row)
  }
  return groups
}

/** Why this worktree must not be deleted, or null when it may be (after a confirmation). */
export function deleteBlocker(row: Pick<WorktreeRow, 'info' | 'sessions'>): string | null {
  if (row.info.isMain) return '主目录不能删除'
  if (row.sessions.some((s) => isActiveStatus(s.status))) return '有会话正在运行或等你处理，先结束它'
  if (row.info.dirtyCount > 0) return `有 ${row.info.dirtyCount} 个未提交的改动，先提交或丢弃`
  if (row.info.locked) return '已被 git worktree lock 锁定'
  return null
}

export interface CleanupPlan {
  remove: WorktreeRow[]
  skip: { row: WorktreeRow; reason: string }[]
}

/** Which 可清理 worktrees one click of 清理 removes, and which it leaves (with the reason). */
export function cleanupPlan(rows: readonly WorktreeRow[]): CleanupPlan {
  const plan: CleanupPlan = { remove: [], skip: [] }
  for (const row of rows) {
    const reason = deleteBlocker(row)
    if (reason) plan.skip.push({ row, reason })
    else plan.remove.push(row)
  }
  return plan
}

export interface DetailLine {
  label: string
  value: string
}

const MAX_LISTED_FILES = 3

/** The selected row's key–value lines (Figma 13C "Details"). Ports are added once the port scan (F?) exists. */
export function detailLines(info: GitWorktreeInfo): DetailLine[] {
  const branch = info.branch ?? `分离的 HEAD · ${shortSha(info.head)}`
  const files = info.dirtyFiles.slice(0, MAX_LISTED_FILES).join(', ')
  return [
    { label: '分支', value: info.locked ? `${branch} · 已锁定` : branch },
    {
      label: '基线',
      value: info.base && info.ahead !== null && info.behind !== null ? `${info.base} · 领先 ${info.ahead}，落后 ${info.behind}` : '—'
    },
    {
      label: '未提交',
      value: info.dirtyCount === 0 ? '无' : info.dirtyCount > MAX_LISTED_FILES ? `${files} 等 ${info.dirtyCount} 个` : files
    }
  ]
}

/** The row to show expanded: the user's pick while it still exists, else the active session's worktree. */
export function selectedRow(rows: readonly WorktreeRow[], picked: string | null, activeWorktreeId: WorktreeId | null): WorktreeRow | null {
  return (
    rows.find((r) => r.key === picked) ??
    (activeWorktreeId ? rows.find((r) => r.worktreeIds.includes(activeWorktreeId)) : undefined) ??
    null
  )
}
