// Pure palette model: what can be jumped to or run, and in which order. No React, no store access.
import type { Project, Session, SessionId, SessionStatus, Worktree } from '@shared/types'
import { compareByUrgency, STATUS_LABEL } from '@shared/session-status'
import { SHORTCUTS } from '@shared/shortcuts'
import { matchFields, type MatchField, type Range } from './match'

export type PaletteSection = 'sessions' | 'actions'

export type ActionId =
  | 'new-claude'
  | 'new-codex'
  | 'new-shell'
  | 'add-project'
  | 'toggle-sidebar'
  | 'toggle-overview'
  | 'toggle-changes'
  | 'theme-system'
  | 'theme-dark'
  | 'theme-light'

export type ActionIcon = 'plus' | 'folder-plus' | 'sidebar' | 'overview' | 'changes' | 'monitor' | 'moon' | 'sun'

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
  rightPanel: 'changes' | 'graph' | null
  mainView?: 'session' | 'overview'
  /** The right panel has content (M4); until then its toggle is not offered (B11). */
  panelAvailable: boolean
}

export interface RankedEntry {
  entry: PaletteEntry
  score: number
  /** Highlight ranges by field key ('title' | 'subtitle' ...). */
  ranges: Record<string, Range[]>
}

const KIND_LABEL = { claude: 'Claude', codex: 'Codex', shell: 'Shell' } as const

/** Sessions most urgent first (same order as the sidebar queue). */
export function buildSessionEntries(input: PaletteInput): PaletteEntry[] {
  const projectById = new Map(input.projects.map((p) => [p.id, p]))
  const worktreeById = new Map(input.worktrees.map((w) => [w.id, w]))
  return input.sessions
    .slice()
    .sort(compareByUrgency)
    .map((session): PaletteEntry => {
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
  'add-project': SHORTCUTS['open-project'],
  'toggle-overview': SHORTCUTS['toggle-overview'],
  'toggle-sidebar': SHORTCUTS['toggle-sidebar'],
  'toggle-changes': SHORTCUTS['toggle-right-panel']
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
      action('new-claude', '新建 Claude 会话', 'plus', 'new claude code session', project.name),
      action('new-codex', '新建 Codex 会话', 'plus', 'new codex session', project.name),
      action('new-shell', '新建 Shell 会话', 'plus', 'new shell terminal session', project.name)
    )
  }
  entries.push(
    action('add-project', '添加项目…', 'folder-plus', 'add project folder open'),
    action('toggle-overview', input.mainView === 'overview' ? '关闭总览' : '打开总览', 'overview', 'overview dashboard status board 状态 看板 zonglan'),
    action('toggle-sidebar', '切换侧栏', 'sidebar', 'toggle sidebar'),
    ...(input.panelAvailable
      ? [action('toggle-changes', input.rightPanel === 'changes' ? '关闭变更面板' : '打开变更面板', 'changes', 'changes diff panel')]
      : []),
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

/** Moves the selection with wrap-around; with no results the index stays 0. */
export function stepIndex(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return 0
  return (index + direction + count) % count
}
