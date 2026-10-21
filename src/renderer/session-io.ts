// Integration seam between UI features and live agent sessions: typing a prompt into an agent's TUI with the
// measured send protocol (PRD §6.9). Callers never touch PTYs or protocols.
import { createSendQueue, sendQueued, SendTimeoutError } from '@shared/send-executor'
import { inputLineText, normalizeSendText, planSend, sendRefusal } from '@shared/send-protocol'
import type { AgentKind, SessionId } from '@shared/types'
import { useSessionMeta } from './session-meta/store'
import { useWorkspace } from './state/workspace'
import { attachmentInput } from './terminal/attachments'
import { acceptsBracketedPaste, getSendIo, readViewport } from './terminal/registry'

// One serial queue per session: two sends to the same PTY must never interleave.
const queue = createSendQueue()

/** The session's agent; for a plain terminal, the one started in it by hand, if one is running. */
function agentIn(sessionId: SessionId): Exclude<AgentKind, 'shell'> | undefined {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  return session?.kind === 'shell' ? useSessionMeta.getState().bySession[sessionId]?.agent : session?.kind
}

/** Rejects, before anything is typed, while a dialog or a menu is on the session's screen (PRD §6.7). */
function refuseOverMenu(sessionId: SessionId): void {
  const refusal = sendRefusal(agentIn(sessionId), readViewport(sessionId))
  if (refusal) throw new Error(refusal)
}

/** Types `text` into the session's agent and presses Enter once the agent shows it. Rejects with a user-facing message. */
export async function submitPrompt(sessionId: SessionId, text: string): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session) throw new Error('会话不存在')
  refuseOverMenu(sessionId)
  const steps = planSend(text, session.kind)
  if (steps.length === 0) return
  try {
    await sendQueued(queue, sessionId, steps, getSendIo(sessionId))
  } catch (error) {
    if (error instanceof SendTimeoutError) throw new Error('终端没有显示刚才的输入，没有按回车', { cause: error })
    throw error
  }
}

/**
 * Puts `text` into the session's input line without pressing Enter (the 文件 view's 插入路径到终端, PRD F17):
 * one bracketed paste — or one line when the program does not take bracketed paste, so no newline submits it —
 * queued behind any send in flight (§6.9). Rejects with a user-facing message while a menu is open.
 */
export async function insertIntoTerminal(sessionId: SessionId, text: string): Promise<void> {
  const body = normalizeSendText(text)
  if (!body) return
  refuseOverMenu(sessionId)
  const data = inputLineText(body, acceptsBracketedPaste(sessionId))
  await sendQueued(queue, sessionId, [{ type: 'write', data }], getSendIo(sessionId))
}

/**
 * Files dropped on, pasted into or picked for a session: their paths go into its input line, the way each agent turns
 * image paths into attachments (terminal/attachments.ts). Not Enter.
 */
export async function insertPaths(sessionId: SessionId, paths: readonly string[]): Promise<void> {
  if (!useWorkspace.getState().sessions.some((s) => s.id === sessionId)) return
  const data = attachmentInput(paths, agentIn(sessionId) ?? null, acceptsBracketedPaste(sessionId))
  if (!data) return
  await sendQueued(queue, sessionId, [{ type: 'write', data }], getSendIo(sessionId))
}

/**
 * Puts a slash command (`/compact`, PRD F11) into the agent's input line the way the send protocol types one — the
 * `/` key, then the rest — and stops before Enter: the user presses it after reading. Rejects with a user-facing
 * message while a menu is open (§6.7): the `/` would pick from it.
 */
export async function insertSlashCommand(sessionId: SessionId, command: string): Promise<void> {
  const kind = agentIn(sessionId)
  if (!kind) return
  refuseOverMenu(sessionId)
  const steps = planSend(command, kind)
  const submit = steps.findIndex((step) => step.type === 'waitForText')
  await sendQueued(queue, sessionId, submit >= 0 ? steps.slice(0, submit) : steps, getSendIo(sessionId))
}

/**
 * 总览 · 停止 (PRD F9 batch): one Esc to the agent, as the user would press it in the terminal — it ends the turn and
 * keeps the conversation. Queued behind any send in flight. Not for plain terminals (no agent to interrupt).
 */
export async function interruptAgent(sessionId: SessionId): Promise<void> {
  if (!agentIn(sessionId)) throw new Error('不是 agent 会话')
  await sendQueued(queue, sessionId, [{ type: 'write', data: '\x1b' }], getSendIo(sessionId))
}

const READY_TIMEOUT_MS = 30_000

/** Resolves once the session's agent is up and idle (after a start or resume); rejects after a while. */
export function whenAgentReady(sessionId: SessionId, timeoutMs = READY_TIMEOUT_MS): Promise<void> {
  const ready = (): boolean => {
    const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
    return session?.phase === 'ready' && session.status === 'idle'
  }
  if (ready()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`agent 没有在 ${timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} 分钟` : `${Math.round(timeoutMs / 1000)} 秒`}内启动`))
    }, timeoutMs)
    const unsubscribe = useWorkspace.subscribe(() => {
      if (!ready()) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}
