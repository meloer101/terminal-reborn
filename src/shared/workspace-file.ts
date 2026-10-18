// On-disk shape of the workspace (`<userData>/workspace.json`, phase 2 · A12) and its sanitizer.
// Pure: main sanitizes on read and on every save, the renderer sanitizes what `loadSync()` returns,
// and the one-time migration from the old localStorage keys lives here too.
import { isWorkdir, type Workdir } from './new-session'
import type { AgentKind, Project, TitleSource, Worktree } from './types'

export const WORKSPACE_FILE_VERSION = 2

/** The right panel's views (PRD F17). Files written before F17 said 'changes' / 'graph'; both read as 'git'. */
export type PersistedRightPanel = 'browser' | 'git' | 'worktree' | 'files'

export const RIGHT_PANEL_VIEWS: readonly PersistedRightPanel[] = ['browser', 'git', 'worktree', 'files']

/** Card width (F17): dragged by its left edge. */
export const PANEL_WIDTH_DEFAULT = 480
export const PANEL_WIDTH_MIN = 400
export const PANEL_WIDTH_MAX = 1200

export function sanitizeRightPanel(value: unknown): PersistedRightPanel | null {
  if (value === 'changes' || value === 'graph') return 'git'
  return RIGHT_PANEL_VIEWS.includes(value as PersistedRightPanel) ? (value as PersistedRightPanel) : null
}

export function clampPanelWidth(value: number): number {
  return Math.round(Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, value)))
}

export interface PersistedSession {
  id: string
  worktreeId: string
  kind: AgentKind
  title: string
  /** Where the title came from (PRD F2); absent in files written before it existed. */
  titleSource?: TitleSource
  /** The agent's own conversation id, used to resume after a restart. */
  agentSessionId?: string
  startedAt: number
  lastActivityAt: number
  /** One line of the agent's last reply, shown while the session is idle. */
  lastReply?: string
  /** Epoch ms the last turn finished. */
  finishedAt?: number
}

export type PersistedWorktree = Pick<Worktree, 'id' | 'projectId' | 'branch' | 'path' | 'isMain'> & { baseBranch?: string }

export interface WorkspaceFile {
  version: typeof WORKSPACE_FILE_VERSION
  projects: Project[]
  worktrees: PersistedWorktree[]
  sessions: PersistedSession[]
  activeSessionId: string | null
  sidebarCollapsed: boolean
  rightPanel: PersistedRightPanel | null
  /** The view ⇧⌘B reopens. Absent = files. */
  lastRightPanel?: PersistedRightPanel
  /** Card width in px. Absent = PANEL_WIDTH_DEFAULT. */
  rightPanelWidth?: number
  /** Projects folded in the sidebar (only ids of projects that exist). */
  collapsedProjectIds: string[]
  /** Composer drafts by session id; only non-empty drafts of sessions that exist. */
  drafts: Record<string, string>
  /** Folders opened as projects, most recent first (first-run screen, B10). Absent when empty. */
  recentProjects?: string[]
  /** 工作目录 last used in the new-session sheet, by project id (PRD F4). Absent when empty. */
  newSessionWorkdir?: Record<string, Workdir>
}

export const MAX_RECENT_PROJECTS = 8

/** Keys of the pre-2a renderer localStorage storage, read once for migration. */
export const LEGACY_WORKSPACE_KEY = 'tr.workspace.v1'
export const LEGACY_DRAFTS_KEY = 'tr.composer.drafts.v1'

const MAX_ITEMS = 500
const MAX_TEXT = 4096
const MAX_TITLE = 500
const MAX_REPLY = 500
const MAX_DRAFT = 200_000

/** Agent conversation ids are UUID-like; this also keeps them safe as a shell word and as a CLI argument. */
const AGENT_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

export const isSafeAgentSessionId = (value: unknown): value is string => typeof value === 'string' && AGENT_SESSION_ID.test(value)

const isString = (v: unknown): v is string => typeof v === 'string'
const isText = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max && !v.includes('\0')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const KINDS: ReadonlySet<unknown> = new Set<AgentKind>(['claude', 'codex', 'shell'])
const TITLE_SOURCES: ReadonlySet<unknown> = new Set<TitleSource>(['prompt', 'agent', 'user'])

function list(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord).slice(0, MAX_ITEMS) : []
}

function dedupe<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
}

/**
 * Validates untrusted JSON into a WorkspaceFile, dropping anything malformed or orphaned.
 * Returns null when `raw` is not a version-2 workspace at all (the caller then migrates or starts empty).
 * `now` fills in missing timestamps.
 */
export function sanitizeWorkspaceFile(raw: unknown, now: number): WorkspaceFile | null {
  if (!isRecord(raw) || raw.version !== WORKSPACE_FILE_VERSION) return null
  return sanitizeBody(raw, now)
}

function sanitizeBody(value: Record<string, unknown>, now: number): WorkspaceFile {
  const projects: Project[] = dedupe(
    list(value.projects)
      .filter((p) => isText(p.id) && isText(p.name) && isText(p.rootPath))
      .map((p) => ({ id: p.id as string, name: p.name as string, rootPath: p.rootPath as string }))
  )
  const projectIds = new Set(projects.map((p) => p.id))

  const worktrees: PersistedWorktree[] = dedupe(
    list(value.worktrees)
      .filter((w) => isText(w.id) && isText(w.projectId) && projectIds.has(w.projectId) && isText(w.branch) && isText(w.path))
      .map((w) => ({
        id: w.id as string,
        projectId: w.projectId as string,
        branch: w.branch as string,
        path: w.path as string,
        isMain: w.isMain === true,
        ...(isText(w.baseBranch) && w.baseBranch !== '' ? { baseBranch: w.baseBranch } : {})
      }))
  )
  const worktreeIds = new Set(worktrees.map((w) => w.id))

  const sessions: PersistedSession[] = dedupe(
    list(value.sessions)
      .filter((s) => isText(s.id) && isText(s.worktreeId) && worktreeIds.has(s.worktreeId) && KINDS.has(s.kind) && isText(s.title, MAX_TITLE))
      .map((s) => {
        const startedAt = isTime(s.startedAt) ? s.startedAt : now
        return {
          id: s.id as string,
          worktreeId: s.worktreeId as string,
          kind: s.kind as AgentKind,
          title: s.title as string,
          ...(TITLE_SOURCES.has(s.titleSource) ? { titleSource: s.titleSource as TitleSource } : {}),
          // A shell has no conversation to resume.
          ...(s.kind !== 'shell' && isSafeAgentSessionId(s.agentSessionId) ? { agentSessionId: s.agentSessionId } : {}),
          startedAt,
          lastActivityAt: isTime(s.lastActivityAt) ? s.lastActivityAt : startedAt,
          ...(isText(s.lastReply, MAX_REPLY) && s.lastReply !== '' ? { lastReply: s.lastReply } : {}),
          ...(isTime(s.finishedAt) ? { finishedAt: s.finishedAt } : {})
        }
      })
  )
  const sessionIds = new Set(sessions.map((s) => s.id))

  const drafts: Record<string, string> = {}
  if (isRecord(value.drafts)) {
    for (const [id, text] of Object.entries(value.drafts)) {
      if (sessionIds.has(id) && isString(text) && text.length > 0) drafts[id] = text.slice(0, MAX_DRAFT)
    }
  }

  const recentProjects = Array.isArray(value.recentProjects)
    ? [...new Set(value.recentProjects.filter((p): p is string => isText(p) && p.startsWith('/')))].slice(0, MAX_RECENT_PROJECTS)
    : []

  const newSessionWorkdir: Record<string, Workdir> = {}
  if (isRecord(value.newSessionWorkdir)) {
    for (const [id, choice] of Object.entries(value.newSessionWorkdir)) if (projectIds.has(id) && isWorkdir(choice)) newSessionWorkdir[id] = choice
  }

  const active = isString(value.activeSessionId) && sessionIds.has(value.activeSessionId)
  const lastRightPanel = sanitizeRightPanel(value.lastRightPanel)
  return {
    version: WORKSPACE_FILE_VERSION,
    projects,
    worktrees,
    sessions,
    activeSessionId: active ? (value.activeSessionId as string) : (sessions[0]?.id ?? null),
    sidebarCollapsed: value.sidebarCollapsed === true,
    rightPanel: sanitizeRightPanel(value.rightPanel),
    ...(lastRightPanel ? { lastRightPanel } : {}),
    ...(typeof value.rightPanelWidth === 'number' && Number.isFinite(value.rightPanelWidth)
      ? { rightPanelWidth: clampPanelWidth(value.rightPanelWidth) }
      : {}),
    collapsedProjectIds: Array.isArray(value.collapsedProjectIds)
      ? [...new Set(value.collapsedProjectIds.filter((id): id is string => isString(id) && projectIds.has(id)))]
      : [],
    drafts,
    ...(recentProjects.length > 0 ? { recentProjects } : {}),
    ...(Object.keys(newSessionWorkdir).length > 0 ? { newSessionWorkdir } : {})
  }
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * One-time migration of the pre-2a renderer storage: `tr.workspace.v1` (a workspace without
 * timestamps or conversation ids) and `tr.composer.drafts.v1` (`{ sessionId: text }`).
 * Returns null when there is nothing to migrate.
 */
export function migrateLegacyWorkspace(workspaceRaw: string | null, draftsRaw: string | null, now: number): WorkspaceFile | null {
  const legacy = parseJson(workspaceRaw)
  if (!isRecord(legacy)) return null
  return sanitizeBody({ ...legacy, drafts: parseJson(draftsRaw), sidebarCollapsed: false, rightPanel: null }, now)
}
