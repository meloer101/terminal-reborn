// Pure palette model: what can be jumped to or run, and in which order. No React, no store access.
import type { Project, ProjectId, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { STATUS_LABEL } from '@shared/session-status'
import { SHORTCUTS } from '@shared/shortcuts'
import type { PersistedRightPanel as PanelView } from '@shared/workspace-file'
import { buildSidebarGroups, visibleSessionIds } from '../sidebar/model'
import { matchFields, type MatchField, type Range } from './match'

export type PaletteSection = 'sessions' | 'actions'

export type ActionId =
  | 'new-claude'
  | 'new-codex'
  | 'new-shell'
  | 'open-project'
  | 'toggle-sidebar'
  | 'toggle-overview'
  | 'toggle-right-panel'
  | 'theme-system'
  | 'theme-dark'
  | 'theme-light'

export type ActionIcon = 'plus' | 'folder-plus' | 'sidebar' | 'overview' | 'panel' | 'monitor' | 'moon' | 'sun'

export type PaletteTarget = { type: 'session'; sessionId: SessionId } | { type: 'action'; action: ActionId }

export interface PaletteEntry {
  id: string
  section: PaletteSection
  target: PaletteTarget
  title: string
  /** Secondary text: "project · current action" for sessions, the target project for new-session actions. */
  subtitle: string
  /** Only sessions. */
  status?: SessionStatus
  /** Only actions. */
  icon?: ActionIcon
  /** Session needs the user: recolors the subtitle like the sidebar row. */
  attention?: boolean
  /** Electron accelerator of the same command outside the palette, drawn at the row's end. */
  shortcut?: string
  fields: MatchField[]
}

export interface PaletteInput {
  projects: Project[]
  worktrees: Worktree[]
  sessions: Session[]
  activeSessionId: SessionId | null
  rightPanel: PanelView | null
  mainView?: 'session' | 'overview'
  /** Folded sidebar projects: their sessions are listed but have no ⌘1–⌘9. */
  collapsedProjectIds?: readonly ProjectId[]
}

export interface RankedEntry {
  entry: PaletteEntry
  score: number
  /** Highlight ranges by field key ('title' | 'subtitle' ...). */
  ranges: Record<string, Range[]>
}

const KIND_LABEL = { claude: 'Claude Code', codex: 'Codex', shell: '终端' } as const

/**
 * Sessions in sidebar order — project by project, store order within each, folded projects included (B16) — so the
 * list reads the same as the sidebar. The first nine rows the sidebar shows carry their ⌘1–⌘9.
 */
export function buildSessionEntries(input: PaletteInput): PaletteEntry[] {
  const projectById = new Map(input.projects.map((p) => [p.id, p]))
  const worktreeById = new Map(input.worktrees.map((w) => [w.id, w]))
  const ordered = buildSidebarGroups({ projects: input.projects, worktrees: input.worktrees, sessions: input.sessions }).flatMap(
    (group) => group.rows.map((row) => row.session)
  )
  const numbered = visibleSessionIds(
    buildSidebarGroups({ ...input, collapsedProjectIds: input.collapsedProjectIds ?? [] })
  ).slice(0, 9)
  return ordered
    .map((session): PaletteEntry => {
      const n = numbered.indexOf(session.id)
      const worktree = worktreeById.get(session.worktreeId)
      const projectName = (worktree && projectById.get(worktree.projectId)?.name) ?? ''
      const detail = session.currentAction ?? worktree?.branch ?? ''
      return {
        id: `session:${session.id}`,
        section: 'sessions',
        target: { type: 'session', sessionId: session.id },
        title: session.title,
        subtitle: [projectName, detail].filter(Boolean).join(' · '),
        status: session.status,
        attention: session.status === 'needs_you',
        ...(n >= 0 ? { shortcut: `CmdOrCtrl+${n + 1}` } : {}),
        fields: [
          { key: 'title', text: session.title, weight: 3 },
          { key: 'project', text: projectName, weight: 2 },
          { key: 'branch', text: worktree?.branch ?? '', weight: 2 },
          { key: 'action', text: session.currentAction ?? '', weight: 1.5 },
          { key: 'kind', text: KIND_LABEL[session.kind], weight: 1 },
          { key: 'status', text: STATUS_LABEL[session.status], weight: 1 }
        ]
      }
    })
}

/** The shortcut that runs the same command without the palette (@shared/shortcuts). */
const ACTION_SHORTCUT: Partial<Record<ActionId, string>> = {
  'new-claude': SHORTCUTS['new-session'],
  'open-project': SHORTCUTS['open-project'],
  'toggle-overview': SHORTCUTS['toggle-overview'],
  'toggle-sidebar': SHORTCUTS['toggle-sidebar'],
  'toggle-right-panel': SHORTCUTS['toggle-right-panel']
}

function action(id: ActionId, title: string, icon: ActionIcon, keywords: string, subtitle = ''): PaletteEntry {
  const shortcut = ACTION_SHORTCUT[id]
  return {
    id: `action:${id}`,
    section: 'actions',
    target: { type: 'action', action: id },
    title,
    subtitle,
    icon,
    ...(shortcut ? { shortcut } : {}),
    fields: [
      { key: 'title', text: title, weight: 3 },
      { key: 'subtitle', text: subtitle, weight: 1.5 },
      { key: 'keywords', text: keywords, weight: 1 }
    ]
  }
}

/** The project new sessions go to: the active session's project, else the first one. */
export function currentProject(input: Pick<PaletteInput, 'projects' | 'worktrees' | 'sessions' | 'activeSessionId'>): Project | null {
  const session = input.sessions.find((s) => s.id === input.activeSessionId)
  const worktree = input.worktrees.find((w) => w.id === session?.worktreeId)
  return input.projects.find((p) => p.id === worktree?.projectId) ?? input.projects[0] ?? null
}

export function buildActionEntries(input: PaletteInput): PaletteEntry[] {
  const project = currentProject(input)
  const entries: PaletteEntry[] = []
  if (project) {
    entries.push(
      action('new-claude', '新建 Claude Code 会话', 'plus', 'new claude code session', project.name),
      action('new-codex', '新建 Codex 会话', 'plus', 'new codex session', project.name),
      action('new-shell', '新建终端', 'plus', 'new shell terminal session zhongduan', project.name)
    )
  }
  entries.push(
    action('open-project', '打开项目…', 'folder-plus', 'open add project folder'),
    action('toggle-overview', input.mainView === 'overview' ? '关闭总览' : '打开总览', 'overview', 'overview dashboard status board 状态 看板 zonglan'),
    action('toggle-sidebar', '切换侧栏', 'sidebar', 'toggle sidebar'),
    action('toggle-right-panel', input.rightPanel ? '关闭右侧栏' : '打开右侧栏', 'panel', 'right panel files git browser worktree 文件 youcelan'),
    action('theme-system', '主题：跟随系统', 'monitor', 'theme system auto appearance'),
    action('theme-dark', '主题：深色', 'moon', 'theme dark appearance'),
    action('theme-light', '主题：浅色', 'sun', 'theme light appearance')
  )
  return entries
}

export function buildEntries(input: PaletteInput): PaletteEntry[] {
  return [...buildSessionEntries(input), ...buildActionEntries(input)]
}

/**
 * Filters and orders entries for a query. Entries stay grouped by section; the section holding
 * the best match comes first (ties and the empty query: sessions first), so ↵ always runs the
 * best hit. Within a section the better match comes first and ties keep the incoming order,
 * so with an empty query sessions stay in urgency order.
 */
export function rankEntries(entries: readonly PaletteEntry[], query: string): RankedEntry[] {
  const ranked: RankedEntry[] = []
  for (const entry of entries) {
    const match = matchFields(query, entry.fields)
    if (match) ranked.push({ entry, score: match.score, ranges: match.ranges })
  }
  const best: Record<PaletteSection, number> = { sessions: -1, actions: -1 }
  for (const r of ranked) best[r.entry.section] = Math.max(best[r.entry.section], r.score)
  const sectionRank = (s: PaletteSection) => (s === 'sessions' ? 0 : 1)
  // Array.prototype.sort is stable, so equal scores keep their urgency / declaration order.
  return ranked.sort(
    (a, b) =>
      (a.entry.section === b.entry.section
        ? 0
        : best[b.entry.section] - best[a.entry.section] || sectionRank(a.entry.section) - sectionRank(b.entry.section)) ||
      b.score - a.score
  )
}

/** Moves the selection, stopping at both ends; with no results the index stays 0. */
export function stepIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0
  // Clamped, not wrapped: ↑ on the first row must not land on the theme actions at the end (B17).
  return Math.min(count - 1, Math.max(0, index + direction))
}
