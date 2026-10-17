// Integration seam between UI features and live agent sessions: typing a prompt into an agent's TUI with the
// measured send protocol (PRD §6.9). Callers never touch PTYs or protocols.
import { createSendQueue, sendQueued, SendTimeoutError } from '@shared/send-executor'
import { bracketedPaste, detectBlockingDialog, normalizeSendText, planSend } from '@shared/send-protocol'
import type { SessionId } from '@shared/types'
import { useWorkspace } from './state/workspace'
import { getSendIo, readViewport } from './terminal/registry'

// One serial queue per session: two sends to the same PTY must never interleave.
const queue = createSendQueue()

/** Types `text` into the session's agent and presses Enter once the agent shows it. Rejects with a user-facing message. */
export async function submitPrompt(sessionId: SessionId, text: string): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session) throw new Error('会话不存在')
  if (detectBlockingDialog(readViewport(sessionId))) throw new Error('终端里有确认框，请先在终端中处理')
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
 * one bracketed paste, queued behind any send in flight (§6.9).
 */
export async function insertIntoTerminal(sessionId: SessionId, text: string): Promise<void> {
  const body = normalizeSendText(text)
  if (!body) return
  await sendQueued(queue, sessionId, [{ type: 'write', data: bracketedPaste(body) }], getSendIo(sessionId))
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
      reject(new Error('agent 没有在 30 秒内启动'))
    }, timeoutMs)
    const unsubscribe = useWorkspace.subscribe(() => {
      if (!ready()) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}
