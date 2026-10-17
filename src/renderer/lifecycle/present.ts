// How an agent phase reads in the sidebar and the header (Figma Screen 10). Pure.
import { hasStartChoice } from '../state/session-start-plan'
import type { AgentKind, Session, SessionStatus } from '@shared/types'

export const AGENT_NAME: Record<AgentKind, string> = { claude: 'Claude Code', codex: 'Codex', shell: '终端' }

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

/** How to install an agent CLI that is not on the login shell's PATH (first-run screen). */
export const INSTALL_HINT = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex'
} as const
