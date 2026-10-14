// Integration seam between UI features and live sessions.
// The composer (and later quick-reply) calls these; they don't know about PTYs or send protocols.
import { useEffect, useState } from 'react'
import type { SessionId } from '@shared/types'
import { PASSTHROUGH_BYTES, type PassthroughKey } from '@shared/keys'
import { detectBlockingDialog, planSend, type BlockingDialog } from '@shared/send-protocol'
import { createSendQueue, sendQueued, SendTimeoutError } from '@shared/send-executor'
import { useWorkspace } from './state/workspace'
import { getSendIo, readViewport } from './terminal/registry'

const BLOCKED_MESSAGE = '终端里有确认框，请先在终端中处理'

// One serial queue per session: two sends to the same PTY must never interleave.
const queue = createSendQueue()

/**
 * Delivers composer text using the measured protocol (docs/spikes/send-protocol.md).
 * Rejects with a user-facing message when the agent never shows the pasted text.
 */
export async function submitPrompt(sessionId: SessionId, text: string): Promise<void> {
  const session = useWorkspace.getState().sessions.find((s) => s.id === sessionId)
  if (!session) throw new Error('会话不存在')
  if (detectBlockingDialog(readViewport(sessionId))) throw new Error(BLOCKED_MESSAGE)
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

const DIALOG_CHECK_MS = 150

/**
 * The first-run dialog (trust / update) currently on the session's screen, if any. While one is
 * up the agent swallows keystrokes, so the composer must not send (docs/spikes/send-protocol.md §6).
 */
export function useBlockingDialog(sessionId: SessionId | null): BlockingDialog | null {
  const [dialog, setDialog] = useState<{ sessionId: SessionId | null; value: BlockingDialog | null }>({
    sessionId,
    value: null
  })
  useEffect(() => {
    if (!sessionId) return
    let timer: ReturnType<typeof setTimeout> | null = null
    // Output is parsed asynchronously, so look at the screen a moment after it arrives.
    const check = () => {
      timer = null
      setDialog({ sessionId, value: detectBlockingDialog(readViewport(sessionId)) })
    }
    const schedule = () => {
      timer ??= setTimeout(check, DIALOG_CHECK_MS)
    }
    schedule()
    const unsubscribe = window.tr.pty.onData(sessionId, schedule)
    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
    }
  }, [sessionId])
  return dialog.sessionId === sessionId ? dialog.value : null
}

export const BLOCKING_DIALOG_HINT = BLOCKED_MESSAGE
