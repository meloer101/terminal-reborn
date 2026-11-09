// What the window tells main about its sessions for the phone (PRD F22, Figma 45B): every project (new sessions start
// in one), the agent sessions of worktrees that are not archived with what the phone list shows, and for main only each
// session's folder and each project's root. Pure.
import type { GuiModelCatalog, GuiPicks } from '@shared/gui-chat'
import type { RemoteAgentModels, RemoteSession, RemoteShip, RemoteShipField, RemoteWindowSessions } from '@shared/remote'
import type { SessionSettings } from '@shared/session-settings'
import type { Project, Session, Worktree } from '@shared/types'
import { glanceFields, submitBlocker, submitLabel, type ShipState } from '../pull-requests/ship-flow'

/** Local folders never go to the phone (PRD F22): a worktree's or project's path in a message becomes `.` / the folder name. */
export function hidePaths(text: string, folders: readonly string[]): string {
  let out = text
  for (const folder of [...folders].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(`${folder}/`).join('./').split(folder).join(folder.split('/').pop() ?? '.')
  }
  return out
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * An exit in progress as the phone draws it (Figma 45J): the Ship block's state with its glance worked out. Long text is
 * cut to what main accepts (a session whose run does not validate would drop off the phone's list); `folders` are
 * hidden from messages and git output.
 */
export function remoteShip(state: ShipState, folders: readonly string[] = []): RemoteShip {
  const fields = glanceFields(state).filter((f): f is RemoteShipField => f !== 'base')
  const { error } = state
  const text = (value: string, max: number) => clip(hidePaths(value, folders), max)
  const blocker = submitBlocker(state)
  return {
    kind: state.kind,
    title: clip(state.title, 300),
    agent: clip(state.agent, 100),
    stage: state.stage,
    steps: state.steps.slice(0, 12).map((s) => ({ id: s.id, label: text(s.label, 300), state: s.state, ...(s.note ? { note: text(s.note, 300) } : {}) })),
    texts: { commit: clip(state.texts.commit, 20_000), title: clip(state.texts.title, 500), body: clip(state.texts.body, 60_000), draft: state.texts.draft },
    fields,
    submitLabel: submitLabel(state.kind),
    submitBlocker: blocker ? clip(blocker, 300) : null,
    error: error
      ? {
          step: error.step,
          message: text(error.message, 2000),
          ...(error.output ? { output: hidePaths(error.output, folders).slice(-8000) } : {}),
          conflicts: Boolean(error.conflicts?.length),
          pushRefused: error.pushRefused === true
        }
      : null
  }
}

export interface RemoteShipping {
  /** Ship block states by worktree path. */
  ships: Readonly<Record<string, ShipState>>
  /** How the last exit of a worktree ended, by worktree path (only exits: other notices do not count). */
  endings: Readonly<Record<string, string>>
}

export function remoteSessions(
  data: { projects: readonly Project[]; worktrees: readonly Worktree[]; sessions: readonly Session[] },
  shipping: RemoteShipping = { ships: {}, endings: {} },
  settings: (session: Session) => SessionSettings | undefined = () => undefined
): RemoteWindowSessions {
  const worktrees = new Map(data.worktrees.map((w) => [w.id, w]))
  const out: RemoteWindowSessions = { projects: [], sessions: [], folders: {}, roots: {} }
  for (const s of data.sessions) {
    const w = worktrees.get(s.worktreeId)
    if (!w || w.archived || s.kind === 'shell') continue
    const row: RemoteSession = { id: s.id, projectId: w.projectId, title: s.title, agent: s.kind, status: s.status, activity: s.lastActivityAt }
    if (s.currentAction) row.action = s.currentAction
    if (s.statusSince !== undefined) row.since = s.statusSince
    if (w.branch) row.branch = w.branch
    if (s.dispatchModel) row.model = s.dispatchModel
    if (s.lastReply) row.reply = s.lastReply
    const own = settings(s)
    if (own) row.settings = own
    const ship = shipping.ships[w.path]
    const root = data.projects.find((p) => p.id === w.projectId)?.rootPath ?? ''
    if (ship) row.ship = remoteShip(ship, [w.path, root])
    const ending = shipping.endings[w.path]
    if (ending && !ship) row.shipNotice = clip(hidePaths(ending, [w.path, root]), 300)
    out.sessions.push(row)
    out.folders[s.id] = { cwd: w.path, ...(w.baseBranch ? { base: w.baseBranch } : {}), ...(s.agentSessionId ? { agentSession: s.agentSessionId } : {}) }
  }
  for (const p of data.projects) {
    out.roots[p.id] = p.rootPath
    out.projects.push({ id: p.id, name: p.name })
  }
  return out
}

/**
 * 新建会话's 模型 row (PRD F22 v1.161, Figma 67A): the agent's models as the desktop's empty-session menu lists them
 * (Figma 65) — what a session of it listed before, else what main asked it — and the one a new session starts with,
 * its last pick (left out when the list does not have it: the agent's default). None when it will not run as GUI.
 */
export function agentModels(gui: boolean, picks: GuiPicks | undefined, catalog: GuiModelCatalog | undefined): RemoteAgentModels {
  if (!gui) return { gui, models: [] }
  const models = picks?.models?.length ? picks.models : (catalog?.models ?? [])
  const current = picks?.model ?? catalog?.current
  return { gui, models: [...models], ...(current !== undefined && models.some((m) => m.value === current) ? { current } : {}) }
}
