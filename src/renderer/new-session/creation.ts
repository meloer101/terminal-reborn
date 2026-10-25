// What 创建 does (PRD F4 · L1): the sheet closes at once and the session appears in the sidebar right away (starting).
// For a new worktree, main fetches, adds the worktree and copies the `.worktreeinclude` files in the background; the
// session's terminal is held until the folder exists, and a failure is reported on the session itself. With 准备 on,
// the repository's setup script (`.tr/settings.toml`) is approved next and runs in that terminal before the agent.
import { create } from 'zustand'
import type { Workdir, WorktreeCreateRequest } from '@shared/new-session'
import type { AgentKind, ProjectId, SessionId } from '@shared/types'
import { reportLaunchIssue } from '../lifecycle/launch-issues'
import { prepareSetup } from '../scripts/setup-runs'
import { useWorkspace } from '../state/workspace'
import { createFailureText, type CreatePlan } from './model'

/** Sessions whose worktree is being created, or could not be (their terminal must not start). Not persisted. */
export const useWorktreeCreations = create<{ held: Record<SessionId, 'creating' | 'failed' | undefined> }>(() => ({ held: {} }))

/** Holds a session's terminal until its worktree exists (createWorktreeFor releases it). */
export const holdForWorktree = (sessionId: SessionId): void => setHeld(sessionId, 'creating')

function setHeld(sessionId: SessionId, state: 'creating' | 'failed' | undefined): void {
  useWorktreeCreations.setState((s) => ({ held: { ...s.held, [sessionId]: state } }))
}

function fail(sessionId: SessionId, kind: AgentKind, message: string): void {
  setHeld(sessionId, 'failed')
  reportLaunchIssue(sessionId, { kind: 'worktree-failed', message })
  useWorkspace.getState().patchSession(sessionId, { status: 'error', currentAction: `没能创建 worktree：${message}`, ...(kind === 'shell' ? {} : { phase: 'exited' as const }) })
}

/** Carries out a plan from the sheet and selects the new session. */
export function runCreatePlan(projectId: ProjectId, plan: CreatePlan, kind: AgentKind, workdir: Workdir, repo: boolean): SessionId | null {
  const workspace = useWorkspace.getState()
  if (repo) workspace.rememberWorkdir(projectId, workdir)
  workspace.rememberAgent(projectId, kind)

  if (plan.type === 'current') {
    const id = workspace.addSession(projectId, kind)
    if (id) useWorkspace.getState().setActiveSession(id)
    return id
  }
  if (plan.type === 'existing') return workspace.addSessionInWorktree(projectId, { path: plan.path, branch: plan.branch }, kind)

  const { request } = plan
  const id = workspace.addSessionInWorktree(projectId, { path: plan.path, branch: request.branch, baseBranch: request.base }, kind)
  if (!id) return null
  void createWorktreeFor(id, kind, request)
  return id
}

/**
 * Creates the worktree a just-added session waits for (its terminal is held meanwhile), then runs the setup script
 * when 准备 is on. Resolves to whether the folder is there; a failure is reported on the session itself.
 */
export function createWorktreeFor(id: SessionId, kind: AgentKind, request: WorktreeCreateRequest): Promise<boolean> {
  setHeld(id, 'creating')
  return window.tr.gitWorktrees
    .create(request)
    .then(async (result) => {
      if (!result.ok) {
        fail(id, kind, createFailureText(result))
        return false
      }
      if (request.prepare) await prepareSetup(id, result.path)
      setHeld(id, undefined)
      return true
    })
    .catch((error: unknown) => {
      fail(id, kind, error instanceof Error ? error.message : String(error))
      return false
    })
}

/**
 * Sessions whose terminal starts now even though nothing shows it (一题多解: the prompt has to reach every member, not
 * only the ones on screen). Not persisted.
 */
export const useEagerStarts = create<{ ids: Record<SessionId, true | undefined> }>(() => ({ ids: {} }))

export function startEagerly(id: SessionId): void {
  useEagerStarts.setState((s) => ({ ids: { ...s.ids, [id]: true } }))
}
