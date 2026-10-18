// Starting a session's agent again before handing it a prompt ("让 agent 修复", "交给 Claude 解决", "让 agent 审阅").
import type { SessionId } from '@shared/types'
import { whenAgentReady } from '../session-io'
import { startSession } from '../state/session-start'
import { useWorkspace } from '../state/workspace'

/** Starts the agent again (on its conversation) when it is not running, then waits until it can take a prompt. */
export async function ensureAgentUp(sessionId: SessionId): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (session?.phase !== 'exited' && session?.phase !== 'not-started') return
  await startSession(sessionId, { resume: true })
  await whenAgentReady(sessionId)
}
