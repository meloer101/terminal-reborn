// 让 agent rebase (conflict radar): the rebase note goes into the worktree's agent session's input line, Enter is left
// to the user (PRD §2, §6.9) — the same path as F16's 让 agent 修复 and F4's 交给 agent 解决.
import type { RadarWorktree } from '@shared/conflict-radar'
import type { Session } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { insertIntoTerminal } from '../session-io'
import { useWorkspace } from '../state/workspace'
import { rebasePrompt } from './model'

/** Resolves with an error message (UI copy) when the note could not go in; null when it did. */
export async function rebaseWithAgent(self: RadarWorktree, target: Session): Promise<string | null> {
  try {
    useWorkspace.getState().setActiveSession(target.id)
    await ensureAgentUp(target.id)
    await insertIntoTerminal(target.id, rebasePrompt(self))
    useWorkspace.getState().requestTerminalFocus()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
