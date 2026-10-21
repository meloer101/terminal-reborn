// Sending and discarding a worktree's review comments (PRD F5). Sending puts one prompt into the agent's input line
// and leaves Enter to the user (PRD §2: Wavi never spends tokens on its own); the comments are cleared once it is there.
import { prThreadsPrompt, type PrThread } from '@shared/pull-requests'
import { commentPicked, reviewPrompt } from '@shared/review-comments'
import type { Session, Worktree } from '@shared/types'
import { ensureAgentUp } from '../../lifecycle/agent-up'
import { insertIntoTerminal } from '../../session-io'
import { clearComments, commentsOf, removeComments } from '../../state/review-comments'
import { setThreadPicked } from '../../pull-requests/store'
import { useWorkspace } from '../../state/workspace'
import { agentSessionFor } from '../merge/model'

/** The agent session comments go to: the active one when it is in the worktree, else its first agent session. */
export function commentTarget(worktree: Pick<Worktree, 'projectId' | 'path'>, sessions: readonly Session[], worktrees: readonly Worktree[], activeId: string | null): Session | null {
  const ids = new Set(worktrees.filter((w) => w.projectId === worktree.projectId && w.path === worktree.path).map((w) => w.id))
  return agentSessionFor(
    sessions.filter((s) => ids.has(s.worktreeId)),
    activeId
  )
}

/** The comments 发给 … sends: the user's own, and the review comments that are ticked (PRD F13). */
export const pickedComments = (root: string) => commentsOf(root).filter(commentPicked)

/**
 * One prompt into the agent's input line: the worktree's ticked comments, then the ticked PR threads quoted as data
 * (PRD F16 v1.63). Sent comments go; sent threads stay on GitHub, unticked here.
 */
export async function sendComments(root: string, target: Session, pr: { number: number; threads: readonly PrThread[] } | null = null): Promise<void> {
  const comments = pickedComments(root)
  const threads = pr?.threads ?? []
  if (comments.length === 0 && threads.length === 0) return
  const state = useWorkspace.getState()
  state.setActiveSession(target.id)
  await ensureAgentUp(target.id)
  const parts = [...(comments.length > 0 ? [reviewPrompt(comments)] : []), ...(threads.length > 0 ? [prThreadsPrompt(pr!.number, threads)] : [])]
  await insertIntoTerminal(target.id, parts.join('\n\n'))
  // Review comments that were not ticked stay for later.
  removeComments(root, new Set(comments.map((c) => c.id)))
  for (const thread of threads) setThreadPicked(thread.id, false)
  useWorkspace.getState().requestTerminalFocus()
}

export async function discardComments(root: string): Promise<void> {
  const count = commentsOf(root).length
  if (count === 0) return
  const confirmed = await window.tr.ui.confirm({
    message: `放弃 ${count} 条评论？`,
    detail: '还没发给 agent 的评论会被删除。',
    confirmLabel: '放弃',
    destructive: true
  })
  if (confirmed) clearComments(root)
}
