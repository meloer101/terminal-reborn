// Pure overview model (PRD F9, Figma 11 v2): every session across projects, grouped by what it
// needs from the user. The list and the board draw the same groups, so the two views never disagree.
import type { Project, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { sessionTime } from '../sidebar/format-elapsed'
import { glyphStatus, phaseLine } from '../lifecycle/present'

/** A group is a session status (after folding a starting agent into running). */
export type OverviewGroupKey = SessionStatus

/** Most pressing first: answer, fix, review, watch, ignore. */
export const GROUP_ORDER: readonly OverviewGroupKey[] = ['needs_you', 'error', 'done_unread', 'running', 'idle', 'exited']

export const GROUP_LABEL: Record<OverviewGroupKey, string> = {
  needs_you: '等你处理',
  error: '出错',
  done_unread: '待审阅',
  running: '运行中',
  idle: '空闲',
  exited: '已退出'
}

/** Color is only for the two states that pull the user in; everything else stays neutral. */
export type OverviewTone = 'attention' | 'error' | 'plain'

/** Board card fill (tokens `--card-<tone>`): one per group, exited shares idle's. */
export type CardTone = 'attention' | 'error' | 'review' | 'working' | 'idle'

export interface OverviewRow {
  session: Session
  /** Status shown as text next to the glyph (status is never color-only). */
  status: SessionStatus
  statusLabel: string
  tone: OverviewTone
  card: CardTone
  title: string
  /** `project › branch`, or just the project for its main checkout. */
  where: string
  projectName: string
  /** What it is doing, asking or reporting. */
  summary: string
  stat: string
  /** "已等 3m" while waiting, this turn's time while running, "5m 前" otherwise (PRD F10). */
  time: string
  /** Waited longer than five minutes: drawn heavier. */
  timeEmphasis: boolean
}

export interface OverviewGroup {
  key: OverviewGroupKey
  label: string
  rows: OverviewRow[]
}

export interface OverviewInput {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  now: number
  /** Free text plus `p:项目` / `s:状态` tokens, all of which must match. */
  filter?: string
}

function statusLabel(session: Session, status: SessionStatus): string {
  if (session.phase === 'starting') return '启动中'
  if (session.phase === 'not-started') return '未启动'
  switch (status) {
    case 'needs_you':
      return '等你处理'
    case 'done_unread':
      return '已完成'
    case 'error':
      return '出错'
    case 'running':
      return '运行中'
    case 'idle':
      return '空闲'
    case 'exited':
      return '已退出'
  }
}

/** What it is doing or asking: the status track writes "等你确认：运行 …" into currentAction while it waits. */
function summaryOf(session: Session, worktree: Worktree | undefined): string {
  const phase = phaseLine(session)
  if (phase) return phase
  if (session.currentAction) return session.currentAction
  if ((session.status === 'idle' || session.status === 'done_unread') && session.lastReply) return session.lastReply
  if (session.kind === 'shell' && worktree) return `终端 · ${worktree.path}`
  return ''
}

function timeFields(time: { text: string; emphasis: boolean }): { time: string; timeEmphasis: boolean } {
  return { time: time.text, timeEmphasis: time.emphasis }
}

function toneOf(status: SessionStatus): OverviewTone {
  if (status === 'needs_you') return 'attention'
  if (status === 'error') return 'error'
  return 'plain'
}

function cardOf(status: SessionStatus): CardTone {
  switch (status) {
    case 'needs_you':
      return 'attention'
    case 'error':
      return 'error'
    case 'done_unread':
      return 'review'
    case 'running':
      return 'working'
    case 'idle':
    case 'exited':
      return 'idle'
  }
}

function toRow(session: Session, worktree: Worktree | undefined, project: Project | undefined, now: number): OverviewRow {
  const status = glyphStatus(session)
  const projectName = project?.name ?? ''
  const branch = worktree?.branch ?? ''
  const added = worktree?.added ?? 0
  const removed = worktree?.removed ?? 0
  return {
    session,
    status,
    statusLabel: statusLabel(session, status),
    tone: toneOf(status),
    card: cardOf(status),
    title: session.title,
    where: branch ? `${projectName} › ${branch}` : projectName,
    projectName,
    summary: summaryOf(session, worktree),
    stat: added + removed > 0 ? `+${added} −${removed}` : '',
    ...timeFields(sessionTime(session, status, now))
  }
}

interface FilterTokens {
  text: string[]
  project: string[]
  status: string[]
}

export function parseFilter(filter: string | undefined): FilterTokens {
  const tokens: FilterTokens = { text: [], project: [], status: [] }
  for (const raw of (filter ?? '').toLowerCase().split(/\s+/)) {
    if (raw === '') continue
    const [prefix, rest] = [raw.slice(0, 2), raw.slice(2)]
    if ((prefix === 'p:' || prefix === 'p：') && rest) tokens.project.push(rest)
    else if ((prefix === 's:' || prefix === 's：') && rest) tokens.status.push(rest)
    else tokens.text.push(raw)
  }
  return tokens
}

function matches(row: OverviewRow, groupLabel: string, f: FilterTokens): boolean {
  const project = row.projectName.toLowerCase()
  const status = `${groupLabel} ${row.statusLabel} ${row.status}`.toLowerCase()
  const text = `${row.title} ${row.where} ${row.summary}`.toLowerCase()
  return (
    f.project.every((t) => project.includes(t)) && f.status.every((t) => status.includes(t)) && f.text.every((t) => text.includes(t))
  )
}

/**
 * Groups in GROUP_ORDER, each with its rows. Empty groups are kept (the board draws a column for each; the
 * list skips them) except `exited`, which only appears when it has rows. Waiting sessions list the one
 * that has waited longest first; every other group lists the most recently active first.
 */
export function buildOverview({ projects, worktrees, sessions, now, filter }: OverviewInput): OverviewGroup[] {
  const worktreeById = new Map(worktrees.map((w) => [w.id, w]))
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const f = parseFilter(filter)
  const byGroup = new Map<OverviewGroupKey, OverviewRow[]>(GROUP_ORDER.map((k) => [k, []]))
  for (const session of sessions) {
    const worktree = worktreeById.get(session.worktreeId)
    if (worktree?.archived) continue
    const row = toRow(session, worktree, worktree && projectById.get(worktree.projectId), now)
    if (!matches(row, GROUP_LABEL[row.status], f)) continue
    byGroup.get(row.status)?.push(row)
  }
  return GROUP_ORDER.map((key) => {
    const rows = byGroup.get(key) ?? []
    rows.sort((a, b) =>
      key === 'needs_you'
        ? a.session.lastActivityAt - b.session.lastActivityAt
        : b.session.lastActivityAt - a.session.lastActivityAt
    )
    return { key, label: GROUP_LABEL[key], rows }
  }).filter((g) => g.key !== 'exited' || g.rows.length > 0)
}

/** Header line: "6 个会话 · 4 个需要你". */
export function overviewSummary(sessions: readonly Pick<Session, 'status'>[], attention: number): string {
  return attention > 0 ? `${sessions.length} 个会话 · ${attention} 个需要你` : `${sessions.length} 个会话`
}

/** Session ids in drawn order (collapsed groups skipped) — ↑/↓ targets. */
export function orderedIds(groups: readonly OverviewGroup[], collapsed: ReadonlySet<OverviewGroupKey>): SessionId[] {
  return groups.filter((g) => !collapsed.has(g.key)).flatMap((g) => g.rows.map((r) => r.session.id))
}

/** ↑/↓ within the drawn rows, clamped; with no selection, down picks the first and up the last. */
export function moveSelection(ids: readonly SessionId[], current: SessionId | null, direction: 1 | -1): SessionId | null {
  if (ids.length === 0) return null
  const at = current === null ? -1 : ids.indexOf(current)
  if (at === -1) return (direction === 1 ? ids[0] : ids[ids.length - 1]) ?? null
  return ids[Math.min(ids.length - 1, Math.max(0, at + direction))] ?? null
}

/** The in-place terminal in the list: 420 by default, draggable between 240 and 70% of the window. */
export const TRAY_HEIGHT = { initial: 420, min: 240, maxShare: 0.7 } as const

export function clampTrayHeight(height: number, viewportHeight: number): number {
  const max = Math.max(TRAY_HEIGHT.min, Math.floor(viewportHeight * TRAY_HEIGHT.maxShare))
  return Math.round(Math.min(max, Math.max(TRAY_HEIGHT.min, height)))
}
