// Integration seam between UI features and live sessions.
// The composer (and later quick-reply) calls these; they don't know about PTYs or send protocols.
//
// M0: naive writes so the composer is usable as soon as PTYs exist.
// After the `spike-send` and `pty-terminal` tracks merge, submitPrompt switches to
// planSend() + the send executor, reading the screen through the terminal registry.
import type { SessionId } from '@shared/types'
import { PASSTHROUGH_BYTES, type PassthroughKey } from '@shared/keys'

export async function submitPrompt(sessionId: SessionId, text: string): Promise<void> {
  window.tr.pty.write(sessionId, `\x1b[200~${text}\x1b[201~`)
  await new Promise((resolve) => setTimeout(resolve, 150))
  window.tr.pty.write(sessionId, '\r')
}

export function sendPassthrough(sessionId: SessionId, key: PassthroughKey): void {
  window.tr.pty.write(sessionId, PASSTHROUGH_BYTES[key])
}
