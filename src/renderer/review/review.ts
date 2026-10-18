// 让 agent 审阅 (PRD F13): sends the agent's own review command to the session; the review stays in the TUI. Pure
// parts first (which command, why not now), then the action.
import type { AgentKind, Session, SessionId } from '@shared/types'
import { ensureAgentUp } from '../lifecycle/agent-up'
import { submitPrompt } from '../session-io'
import { useWorkspace } from '../state/workspace'

/** Claude Code reviews with `/code-review`, Codex with `/review`; a plain terminal has no agent. */
export function reviewCommand(kind: AgentKind): string | null {
  if (kind === 'claude') return '/code-review'
  if (kind === 'codex') return '/review'
  return null
}

/**
 * Why a review cannot be asked for now; null when it can. An agent that is not running is started again on its
 * conversation first, so only a busy or not-yet-ready one is refused.
 */
export function reviewBlocker(session: Pick<Session, 'kind' | 'phase' | 'status'>): string | null {
  if (reviewCommand(session.kind) === null) return '终端会话没有 agent'
  if (session.phase === 'starting') return 'agent 正在启动'
  if (session.phase === 'blocked') return '终端里有提示要先处理'
  if (session.phase === 'exited' || session.phase === 'not-started') return null
  if (session.status === 'running') return 'agent 正在运行，等这一轮结束'
  if (session.status === 'needs_you') return 'agent 在等你处理'
  return null
}

/** Starts the agent again if needed, then types its review command. Rejects with a user-facing message. */
export async function requestReview(sessionId: SessionId): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session) throw new Error('会话不存在')
  const command = reviewCommand(session.kind)
  const blocker = reviewBlocker(session)
  if (!command || blocker) throw new Error(blocker ?? '不能审阅')
  await ensureAgentUp(sessionId)
  await submitPrompt(sessionId, command)
}
