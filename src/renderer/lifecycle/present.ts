// How an agent phase reads in the sidebar, the header and the composer (Figma Screen 10). Pure.
import { hasStartChoice } from '../state/session-start-plan'
import type { AgentKind, Session, SessionStatus } from '@shared/types'

export const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', shell: 'Shell' }

type PhaseView = Pick<Session, 'kind' | 'status' | 'phase'>

/** The glyph for a session: a starting agent shows the working spinner, everything else its status. */
export function glyphStatus(session: Pick<Session, 'status' | 'phase'>): SessionStatus {
  return session.phase === 'starting' ? 'running' : session.status
}

/** Sidebar secondary line while the agent is not simply up (`undefined`: use the usual action / location line). */
export function phaseLine(session: PhaseView & Pick<Session, 'agentSessionId'>): string | undefined {
  switch (session.phase) {
    case 'starting':
      return `正在启动 ${AGENT_NAME[session.kind]}…`
    case 'not-started':
      return hasStartChoice(session) ? '未启动 · 点击恢复上次对话' : '未启动'
    case 'exited':
      // A crash keeps its message (status error).
      return session.status === 'error' ? undefined : `${AGENT_NAME[session.kind]} 已退出`
    default:
      return undefined
  }
}

/** Header status text: `Claude Code · 启动中`. */
export function phaseLabel(session: PhaseView, statusLabel: string): string {
  if (session.phase === 'starting') return '启动中'
  if (session.phase === 'not-started') return '未启动'
  return statusLabel
}

/** The agent is not ready for input: the composer is off and must never type into the shell behind it. */
export function inputBlockedByPhase(session: Pick<Session, 'phase'> | undefined): boolean {
  return session?.phase !== undefined && session.phase !== 'ready'
}

/** Phases whose card replaces the composer (the starting phase keeps a disabled composer instead). */
export function cardReplacesComposer(session: Pick<Session, 'kind' | 'phase' | 'agentSessionId'> | undefined): boolean {
  if (!session) return false
  if (session.phase === 'blocked' || session.phase === 'exited') return true
  return session.phase === 'not-started' && hasStartChoice(session)
}
