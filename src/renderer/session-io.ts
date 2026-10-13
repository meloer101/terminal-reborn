// Integration seam between UI features and live sessions.
// The composer (and later quick-reply) calls these; they don't know about PTYs or send protocols.
import type { SessionId } from '@shared/types'
import { PASSTHROUGH_BYTES, type PassthroughKey } from '@shared/keys'
import { planSend } from '@shared/send-protocol'
import { createSendQueue, sendQueued, SendTimeoutError } from '@shared/send-executor'
import { useWorkspace } from './state/workspace'
import { getSendIo } from './terminal/registry'

// One serial queue per session: two sends to the same PTY must never interleave.
const queue = createSendQueue()

/**
 * Delivers composer text using the measured protocol (docs/spikes/send-protocol.md).
 * Rejects with a user-facing message when the agent never shows the pasted text.
 */
export async function submitPrompt(sessionId: SessionId, text: string): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session) throw new Error('会话不存在')
  const steps = planSend(text, session.kind)
  if (steps.length === 0) return
  try {
    await sendQueued(queue, sessionId, steps, getSendIo(sessionId))
  } catch (error) {
    if (error instanceof SendTimeoutError) throw new Error('终端没有显示刚才的输入，未发送回车，已放回输入栏', { cause: error })
    throw error
  }
}

export function sendPassthrough(sessionId: SessionId, key: PassthroughKey): void {
  window.tr.pty.write(sessionId, PASSTHROUGH_BYTES[key])
}
