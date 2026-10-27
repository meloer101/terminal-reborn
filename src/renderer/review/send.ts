// 发给 … in the review block (PRD F13 v1.78): the ticked findings as one prompt in the agent's input line, Enter left to
// the user (PRD §2). The same steps as the comment footer's send (panels/git/comments.ts), limited to the findings the
// block lists; the user's own comments wait for their own button.
import { commentPicked, reviewPrompt } from '@shared/review-comments'
import type { Session } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { insertIntoTerminal } from '../session-io'
import { commentsOf, removeComments } from '../state/review-comments'
import { useWorkspace } from '../state/workspace'

export const pickedFindings = (root: string) => commentsOf(root).filter((c) => c.origin === 'review' && commentPicked(c))

/** Puts the ticked findings into `target`'s input line; the ones that went leave the list, unticked ones stay. */
export async function sendFindings(root: string, target: Session): Promise<void> {
  const findings = pickedFindings(root)
  if (findings.length === 0) return
  useWorkspace.getState().setActiveSession(target.id)
  await ensureAgentUp(target.id)
  await insertIntoTerminal(target.id, reviewPrompt(findings))
  removeComments(root, new Set(findings.map((c) => c.id)))
  useWorkspace.getState().requestTerminalFocus()
}
