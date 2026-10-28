// Worktree view (PRD F17, Figma 13C): the project's git worktrees joined with the workspace's sessions, grouped
// into the working list, 可清理 (bulk) and 没有会话 (one by one), plus the delete guard. Pure; WorktreeView renders it.
import { AGENT_SPECS, CLI_AGENTS } from '@shared/agents'
import type { GitWorktreeInfo, GitWorktreeListing } from '@shared/git-worktrees'
import { isActiveStatus } from '@shared/lifecycle'
import { PORT_BLOCK } from '@shared/ports'
import { compareByUrgency } from '@shared/session-status'
import type { AgentKind, Session, SessionStatus, Worktree, WorktreeId } from '@shared/types'

export const AGENT_LABEL: Record<AgentKind, string> = {
  ...(Object.fromEntries(CLI_AGENTS.map((id) => [id, AGENT_SPECS[id].label])) as Record<AgentKind, string>),
  claude: 'Claude',
  shell: '终端'
}

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
  /** Branch (the one being rebased, during a rebase), or the short commit when detached. */
  name: string
  /** Sessions in this worktree, most urgent first. */
  sessions: Session[]
  /** Status of the most urgent session; null when the worktree has none. */
  status: SessionStatus | null
  /** The workspace's records for this folder. */
  worktreeIds: WorktreeId[]
  /** Path new sessions should use (and the one shown): the workspace's spelling when known, else git's. */
  openPath: string
  sessionLine: string
  /** `+N −M` uncommitted, '' when clean, '?' when git could not tell. */
  diff: string
  /** `↑ahead ↓behind`, '—' without a base. */
  sync: string
}

export interface WorktreeGroups {
  /** The main checkout and every worktree that has a session. */
  working: WorktreeRow[]
  /** No session, and merged into the base or the folder is gone: 清理 removes these in one go. */
  cleanable: WorktreeRow[]
  /** No session, not merged: deleted one by one from 更多, never in bulk (could be hand-made or unfinished work). */
  idle: WorktreeRow[]
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
  if (info.dirtyCount === null) return '?'
  return info.dirtyCount > 0 || info.added > 0 || info.removed > 0 ? `+${info.added} −${info.removed}` : ''
}

export function formatSync(info: Pick<GitWorktreeInfo, 'ahead' | 'behind'>): string {
  return info.ahead === null || info.behind === null ? '—' : `↑${info.ahead} ↓${info.behind}`
}

/** Nothing of its own yet: no commits ahead of the base, and not merged (an agent that has not committed). */
export function hasNoNewCommits(info: Pick<GitWorktreeInfo, 'isMain' | 'ahead' | 'merged'>): boolean {
  return !info.isMain && info.ahead === 0 && !info.merged
}

/** "title · agent · state", the other sessions counted, then the merge state. */
export function sessionLine(sessions: readonly Session[], info: Pick<GitWorktreeInfo, 'isMain' | 'merged' | 'base' | 'ahead'>): string {
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
  else if (hasNoNewCommits(info)) parts.push('无新提交')
  return parts.join(' · ')
}

/** Which group a worktree goes in. Any session keeps it in the working list. */
export function groupOf(info: Pick<GitWorktreeInfo, 'isMain' | 'merged' | 'prunable'>, sessionCount: number): keyof WorktreeGroups {
  if (info.isMain || sessionCount > 0) return 'working'
  return info.merged || info.prunable !== null ? 'cleanable' : 'idle'
}

/**
 * A partial listing (`only`) leaves the other worktrees undetailed: carry their previous details over, by resolved
 * path, while their HEAD is unchanged. Anything never detailed stays so, and the delete guard refuses it.
 */
export function mergeListing(previous: GitWorktreeListing | null | undefined, next: GitWorktreeListing): GitWorktreeListing {
  if (!previous || next.worktrees.every((w) => w.detailed)) return next
  const before = new Map(previous.worktrees.filter((w) => w.detailed).map((w) => [w.realPath, w]))
  return {
    ...next,
    realPaths: { ...previous.realPaths, ...next.realPaths },
    worktrees: next.worktrees.map((w) => {
      const old = w.detailed ? undefined : before.get(w.realPath)
      return old && old.head === w.head && old.branch === w.branch ? { ...old, path: w.path, isMain: w.isMain, locked: w.locked } : w
    })
  }
}

/** Joins git's worktrees with the project's workspace worktrees (by resolved path) and their sessions, then groups them. */
export function buildRows(listing: GitWorktreeListing, worktrees: readonly Worktree[], sessions: readonly Session[]): WorktreeGroups {
  const resolved = (w: Worktree) => listing.realPaths[w.path] ?? w.path
  const groups: WorktreeGroups = { working: [], cleanable: [], idle: [] }
  for (const info of listing.worktrees) {
    const matched = worktrees.filter((w) => resolved(w) === info.realPath || w.path === info.path)
    const ids = new Set(matched.map((w) => w.id))
    const inside = sessions.filter((s) => ids.has(s.worktreeId)).sort(compareByUrgency)
    const line = sessionLine(inside, info)
    groups[groupOf(info, inside.length)].push({
      key: info.realPath,
      info,
      name: info.branch ?? info.rebasing ?? shortSha(info.head),
      sessions: inside,
      status: inside[0]?.status ?? null,
      worktreeIds: matched.map((w) => w.id),
      openPath: matched[0]?.path ?? info.path,
      sessionLine: info.isMain ? `主目录 · ${line}` : line,
      diff: formatDiff(info),
      sync: formatSync(info)
    })
  }
  return groups
}

/**
 * Why this worktree must not be deleted, or null when it may be (after a confirmation). Anything git could not check
 * counts as a reason: unknown is never safe. Main checks the same again before removing.
 */
export function deleteBlocker(row: Pick<WorktreeRow, 'info' | 'sessions'>): string | null {
  const { info } = row
  if (info.isMain) return '主目录不能删除'
  if (row.sessions.some((s) => isActiveStatus(s.status))) return '有会话正在运行或等你处理，先结束它'
  if (!info.detailed) return '还没读完它的状态，稍后再试'
  if (info.locked) return '已被 git worktree lock 锁定'
  if (info.rebasing) return '正在变基，先完成或中止'
  if (info.dirtyCount === null) return '无法确认有没有未提交的改动'
  if (info.dirtyCount > 0) return `有 ${info.dirtyCount} 个未提交的改动，先提交或丢弃`
  if (info.branch === null && info.head) {
    if (info.unreachableCommits === null) return '无法确认它的提交是否都在分支上'
    if (info.unreachableCommits > 0) return `有 ${info.unreachableCommits} 个提交不在任何分支上，先给它建一个分支`
  }
  return null
}

export interface CleanupPlan {
  remove: WorktreeRow[]
  skip: { row: WorktreeRow; reason: string }[]
}

/** Which 可清理 worktrees one click of 清理 removes, and which it leaves (with the reason). Never one with a session. */
export function cleanupPlan(rows: readonly WorktreeRow[]): CleanupPlan {
  const plan: CleanupPlan = { remove: [], skip: [] }
  for (const row of rows) {
    const reason = row.sessions.length > 0 ? '有会话' : deleteBlocker(row)
    if (reason) plan.skip.push({ row, reason })
    else plan.remove.push(row)
  }
  return plan
}

/** What deleting keeps: the branch, or (detached) nothing, since its commits are all on other branches already. */
export function keptText(info: Pick<GitWorktreeInfo, 'branch'>): string {
  return info.branch ? `分支 ${info.branch} 保留` : '它的提交都已在其他分支上'
}

export interface DetailLine {
  label: string
  value: string
  /** Port block, shown in the mono face. */
  mono?: boolean
}

/** The reserved block, TR_PORT through the last port of the ten. */
export function portBlockLabel(port: number): string {
  return `${port}\u2013${port + PORT_BLOCK - 1}`
}

const MAX_LISTED_FILES = 3

/** The selected row's key–value lines (Figma 13C "Details"). `port` is the directory's TR_PORT, when it has a block. */
export function detailLines(info: GitWorktreeInfo, port: number | null = null): DetailLine[] {
  let branch = info.branch ?? (info.rebasing ? `变基中 · ${info.rebasing}` : `分离的 HEAD · ${shortSha(info.head)}`)
  if (info.branch === null && info.unreachableCommits) branch += ` · ${info.unreachableCommits} 个提交不在分支上`
  if (info.locked) branch += ' · 已锁定'
  const files = info.dirtyFiles.slice(0, MAX_LISTED_FILES).join(', ')
  const lines: DetailLine[] = [
    { label: '分支', value: branch },
    {
      label: '基线',
      value: info.base && info.ahead !== null && info.behind !== null ? `${info.base} · 领先 ${info.ahead}，落后 ${info.behind}` : '—'
    },
    {
      label: '未提交',
      value:
        info.dirtyCount === null
          ? '无法读取'
          : info.dirtyCount === 0
            ? '无'
            : info.dirtyCount > MAX_LISTED_FILES
              ? `${files} 等 ${info.dirtyCount} 个`
              : files
    }
  ]
  if (port !== null) lines.push({ label: '端口段', value: portBlockLabel(port), mono: true })
  if (info.prunable !== null) lines.push({ label: '文件夹', value: '已不存在' })
  return lines
}

/** `picked` value for "the user collapsed the open row": no row is expanded, and the active session is not followed. */
export const COLLAPSED = ''

/** The row to show expanded: the user's pick while it still exists, else the active session's worktree (unless collapsed). */
export function selectedRow(rows: readonly WorktreeRow[], picked: string | null, activeWorktreeId: WorktreeId | null): WorktreeRow | null {
  return (
    rows.find((r) => r.key === picked) ??
    (picked === COLLAPSED ? undefined : activeWorktreeId ? rows.find((r) => r.worktreeIds.includes(activeWorktreeId)) : undefined) ??
    null
  )
}
