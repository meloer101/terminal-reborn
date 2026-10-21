// 创建 PR and 让 agent 修复 (PRD F16). Creating asks main to push (it confirms a first push itself) and run
// `gh pr create`, then opens the PR in the built-in browser. Fixing puts the failing checks and the end of their log
// into the agent's input line and leaves Enter to the user (PRD §2, §6.9).
import { ciFixPrompt } from '@shared/pull-requests'
import type { Session, SessionId, Worktree } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { insertIntoTerminal } from '../session-io'
import { openLink } from '../state/link-actions'
import { useWorkspace } from '../state/workspace'
import { setPrBusy, setPrNotice, usePullRequests } from './store'

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Opens a PR page in the session's built-in browser (the session's worktree page). */
export function openPullRequest(sessionId: SessionId | null, url: string): void {
  if (sessionId) openLink(sessionId, url, 'internal')
  else window.open(url, '_blank')
}

/**
 * Pushes and creates the PR; on success opens it. From 创建 PR 面板 (PRD F16 v1.63) with its body, draft and the push
 * the sheet already announced. Returns the error to show in the sheet, or null.
 */
export async function createPullRequest(
  projectRoot: string,
  worktree: Pick<Worktree, 'path'>,
  title: string,
  sessionId: SessionId | null,
  sheet?: { body: string; draft: boolean }
): Promise<string | null> {
  const path = worktree.path
  if (usePullRequests.getState().busy[path]) return '正在创建 PR'
  setPrBusy(path, 'creating')
  setPrNotice(path, null)
  try {
    const result = await window.tr.pr.create({ root: projectRoot, worktree: path, title, ...(sheet ? { body: sheet.body, draft: sheet.draft, pushApproved: true } : {}) })
    if (result.ok) {
      openPullRequest(sessionId, result.url)
      return null
    }
    const text = result.reason === 'declined' ? result.message : `没能创建 PR：${result.message}`
    setPrNotice(path, { tone: result.reason === 'declined' ? 'muted' : 'error', text })
    return text
  } catch (error) {
    const text = `没能创建 PR：${message(error)}`
    setPrNotice(path, { tone: 'error', text })
    return text
  } finally {
    setPrBusy(path, null)
  }
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
    setPrNotice(worktreePath, { tone: 'error', text: `没能交给 agent：${message(error)}` })
  } finally {
    setPrBusy(worktreePath, null)
  }
}
