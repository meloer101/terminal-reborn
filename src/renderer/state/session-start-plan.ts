// Pure decisions behind startSession (see ./session-start.ts); kept apart so they can be tested without a DOM.
import type { AgentEvent } from '@shared/agent-events'
import type { Session } from '@shared/types'
import type { SessionPatch } from './workspace'

/**
 * While true, a not-started session starts (resuming its conversation) the moment it is viewed. The UI that
 * offers 恢复对话 / 开始新对话 sets this to false; sessions with no conversation to resume still start by themselves.
 */
export const AUTO_START_ON_VIEW = false

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
 */
export function planStart(
  session: Pick<Session, 'agentSessionId'>,
  options: StartOptions
): { resumeAgentSessionId: string | undefined; patch: SessionPatch } {
  const resumeAgentSessionId = options.resume ? session.agentSessionId : undefined
  return { resumeAgentSessionId, patch: { phase: 'starting', status: 'idle', agentSessionId: resumeAgentSessionId } }
}

/** The conversation id a SessionStart hook reports, as a session patch (a later one replaces an earlier id, e.g. after /clear). */
export function agentSessionIdPatch(event: AgentEvent): SessionPatch | null {
  return event.type === 'session-start' && event.agentSessionId ? { agentSessionId: event.agentSessionId } : null
}

