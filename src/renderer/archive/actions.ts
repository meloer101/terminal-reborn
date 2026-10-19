// Archiving and restoring a worktree (PRD F15, Figma 16D). Archive: stop the worktree's sessions (their screens are
// kept), run the repository's `archive` script after the usual approval, keep the worktree's state on a private ref,
// then fold it out of every list. Restore: main brings the folder back only if it is gone; the records come back and
// the agents resume their conversations on first view.
import { archiveBlocker, newArchiveId, sessionIdsToStop, shouldRunArchiveScript } from '@shared/archive'
import type { ProjectId, WorktreeId } from '@shared/types'
import { useWorkspace } from '../state/workspace'
import { disposeTerminal } from '../terminal/registry'
import { forgetLiveSessions } from '../terminal/live-sessions'

export interface ArchiveTarget {
  projectId: ProjectId
  /** The project's root (main only accepts workspace project roots). */
  root: string
  worktreePath: string
  /** Workspace records at that path: their sessions stop and they fold away together. */
  worktreeIds: WorktreeId[]
  branch: string
  isMain: boolean
}

export type ArchiveOutcome =
  | { ok: true; dirty: boolean }
  | { ok: false; stage: 'blocked' | 'snapshot'; message: string }
  /** The archive script exited non-zero: the caller may archive anyway (`ignoreScriptFailure`). */
  | { ok: false; stage: 'script'; message: string; output: string }

export type ArchiveStep = 'stopping' | 'script' | 'snapshot'

/** The archive target for a workspace worktree record (every record at the same path goes with it). */
export function archiveTargetFor(worktreeId: WorktreeId): ArchiveTarget | null {
  const state = useWorkspace.getState()
  const worktree = state.worktrees.find((w) => w.id === worktreeId)
  const project = worktree && state.projects.find((p) => p.id === worktree.projectId)
  if (!worktree || !project) return null
  const ids = state.worktrees.filter((w) => w.projectId === worktree.projectId && w.path === worktree.path).map((w) => w.id)
  return { projectId: project.id, root: project.rootPath, worktreePath: worktree.path, worktreeIds: ids, branch: worktree.branch, isMain: worktree.isMain }
}

export function blockerFor(target: ArchiveTarget): string | null {
  const ids = new Set(target.worktreeIds)
  return archiveBlocker(
    useWorkspace.getState().sessions.filter((s) => ids.has(s.worktreeId)),
    target.isMain
  )
}

export async function archiveWorktree(
  target: ArchiveTarget,
  options: { ignoreScriptFailure?: boolean; onStep?: (step: ArchiveStep) => void } = {}
): Promise<ArchiveOutcome> {
  const blocker = blockerFor(target)
  if (blocker) return { ok: false, stage: 'blocked', message: blocker }

  options.onStep?.('stopping')
  const sessionIds = sessionIdsToStop(useWorkspace.getState().sessions, target.worktreeIds)
  // Kept screens (no `forget`): restoring paints them before the agent resumes.
  for (const id of sessionIds) disposeTerminal(id, false)
  forgetLiveSessions(sessionIds)

  options.onStep?.('script')
  const info = await window.tr.repoScripts.get(target.worktreePath).catch(() => null)
  if (info?.scripts.archive !== undefined) {
    const approval = await window.tr.repoScripts.approve(target.worktreePath, 'archive')
    if (shouldRunArchiveScript(approval)) {
      const result = await window.tr.repoScripts.run(target.worktreePath, 'archive')
      if (result.code !== 0 && !options.ignoreScriptFailure) {
        return {
          ok: false,
          stage: 'script',
          message: result.code === null ? 'archive 脚本没能运行' : `archive 脚本没通过（退出码 ${result.code}）`,
          output: result.output.trim()
        }
      }
    }
  }

  options.onStep?.('snapshot')
  const id = newArchiveId(Date.now(), Math.random())
  const saved = await window.tr.archive.capture(target.root, target.worktreePath, id)
  if (!saved.ok) return { ok: false, stage: 'snapshot', message: `没能记下工作区：${saved.message}` }
  useWorkspace.getState().archiveWorktrees(target.worktreeIds, { id, at: Date.now(), commit: saved.commit, dirty: saved.dirty })
  return { ok: true, dirty: saved.dirty }
}

/** ⌘K 历史: brings an archived worktree back and selects its first session. Rejects with a user-facing message. */
export async function restoreArchivedWorktree(worktreeId: WorktreeId): Promise<void> {
  const state = useWorkspace.getState()
  const worktree = state.worktrees.find((w) => w.id === worktreeId)
  const project = worktree && state.projects.find((p) => p.id === worktree.projectId)
  if (!worktree?.archived || !project) throw new Error('这个归档已经不在了')
  const result = await window.tr.archive.restore({ root: project.rootPath, worktree: worktree.path, branch: worktree.branch, id: worktree.archived.id })
  if (!result.ok) throw new Error(result.message)
  const ids = useWorkspace
    .getState()
    .worktrees.filter((w) => w.projectId === worktree.projectId && w.path === worktree.path && w.archived)
    .map((w) => w.id)
  forgetLiveSessions(sessionIdsToStop(useWorkspace.getState().sessions, ids))
  useWorkspace.getState().unarchiveWorktrees(ids)
}
