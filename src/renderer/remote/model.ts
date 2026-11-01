// What the window tells main about its sessions for the phone (PRD F22, Figma 45B): every project (new sessions start
// in one), the agent sessions of worktrees that are not archived with what the phone list shows, and for main only each
// session's folder and each project's root. Pure.
import type { RemoteSession, RemoteWindowSessions } from '@shared/remote'
import type { Project, Session, Worktree } from '@shared/types'

export function remoteSessions(data: { projects: readonly Project[]; worktrees: readonly Worktree[]; sessions: readonly Session[] }): RemoteWindowSessions {
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
    out.sessions.push(row)
    out.folders[s.id] = { cwd: w.path, ...(w.baseBranch ? { base: w.baseBranch } : {}), ...(s.agentSessionId ? { agentSession: s.agentSessionId } : {}) }
  }
  for (const p of data.projects) {
    out.roots[p.id] = p.rootPath
    out.projects.push({ id: p.id, name: p.name })
  }
  return out
}
