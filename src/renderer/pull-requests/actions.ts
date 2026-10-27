// Opening a PR and 让 agent 修复 (PRD F16). Creating, committing and pushing are the Ship block's steps
// (ship-runner.ts). Fixing puts the failing checks and the end of their log into the agent's input line and leaves
// Enter to the user (PRD §2, §6.9).
import { ciFixPrompt } from '@shared/pull-requests'
import type { Session, SessionId } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { insertIntoTerminal } from '../session-io'
import { openLink } from '../state/link-actions'
import { useWorkspace } from '../state/workspace'
import { setPrBusy, setPrNotice, usePullRequests } from './store'

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Opens a PR page in the session's built-in browser (the session's worktree page). */
export function openPullRequest(sessionId: SessionId | null, url: string): void {
  if (sessionId) openLink(sessionId, url, 'internal')
  else window.open(url, '_blank')
}

export async function fixWithAgent(worktreePath: string, target: Session): Promise<void> {
  if (usePullRequests.getState().busy[worktreePath]) return
  setPrBusy(worktreePath, 'fixing')
  setPrNotice(worktreePath, null)
  try {
    const failure = await window.tr.pr.failure(worktreePath)
    if (!failure) {
      setPrNotice(worktreePath, { tone: 'muted', text: '现在没有失败的检查' })
      return
    }
    useWorkspace.getState().setActiveSession(target.id)
    await ensureAgentUp(target.id)
    await insertIntoTerminal(target.id, ciFixPrompt(failure))
    useWorkspace.getState().requestTerminalFocus()
  } catch (error) {
    setPrNotice(worktreePath, { tone: 'error', text: `没能交给 agent：${errorText(error)}` })
  } finally {
    setPrBusy(worktreePath, null)
  }
}
