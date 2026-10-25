// Pure decisions behind startSession (see ./session-start.ts); kept apart so they can be tested without a DOM.
import type { AgentEvent } from '@shared/agent-events'
import { CONTINUE_LATEST } from '@shared/agent-launch'
import { AGENT_SPECS } from '@shared/agents'
import type { AgentKind, Session } from '@shared/types'
import type { SessionPatch } from './workspace'

/**
 * While true, a not-started session starts (resuming its conversation) the moment it is viewed, like reopening a
 * terminal tab. There is no 恢复对话 / 开始新对话 card: the terminal is the whole UI.
 */
export const AUTO_START_ON_VIEW = true

export interface StartOptions {
  /** Continue the saved conversation (when the session has one); false starts a fresh conversation. */
  resume: boolean
}

/** A not-started session that has a saved conversation: the user could choose between resuming and starting over. */
export function hasStartChoice(session: Pick<Session, 'kind' | 'phase' | 'agentSessionId'>): boolean {
  return session.kind !== 'shell' && session.phase === 'not-started' && !!session.agentSessionId
}

/** Whether a session that is being viewed should be started right now without asking. */
export function shouldAutoStart(session: Pick<Session, 'kind' | 'phase' | 'agentSessionId'> | undefined, auto = AUTO_START_ON_VIEW): boolean {
  if (!session || session.kind === 'shell' || session.phase !== 'not-started') return false
  return auto || !hasStartChoice(session)
}

/**
 * What a start changes about the session. Resuming keeps the saved conversation id (the SessionStart hook
 * reports the id actually in use and replaces it if the agent picked a new one); starting fresh forgets it.
 * A CLI without hooks never reports an id: once it has run, the session keeps CONTINUE_LATEST instead, so the next
 * start continues the most recent conversation in its own worktree.
 */
export function planStart(
  session: Pick<Session, 'agentSessionId'> & { kind?: AgentKind },
  options: StartOptions
): { resumeAgentSessionId: string | undefined; patch: SessionPatch } {
  const resumeAgentSessionId = options.resume ? session.agentSessionId : undefined
  const kind = session.kind
  const continues = kind !== undefined && kind !== 'shell' && AGENT_SPECS[kind].status !== 'hooks' && AGENT_SPECS[kind].continueLatest !== null
  return { resumeAgentSessionId, patch: { phase: 'starting', status: 'idle', agentSessionId: continues ? CONTINUE_LATEST : resumeAgentSessionId } }
}

/** The conversation id a SessionStart hook reports, as a session patch (a later one replaces an earlier id, e.g. after /clear). */
export function agentSessionIdPatch(event: AgentEvent): SessionPatch | null {
  return event.type === 'session-start' && event.agentSessionId ? { agentSessionId: event.agentSessionId } : null
}

