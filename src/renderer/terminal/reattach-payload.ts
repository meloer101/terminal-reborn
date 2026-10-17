// Reattaching to a process that kept running in the pty daemon: the daemon's screen (with an active alternate
// screen and the program's input modes) replaces whatever the terminal showed, then the live stream continues from
// the screen's position. Unlike the cold path (snapshot-payload.ts) the modes are restored: the same process is
// still there and expects them. Steps follow Orca's apply-reattach-payload.ts (MIT, see THIRD_PARTY_NOTICES.md).
import type { PtyScreen } from '@shared/ipc'

/** End synchronized output, reset the pen, clear screen and scrollback, home the cursor. */
const CLEAN_SLATE = '\x1b[?2026l\x1b[0m\x1b[2J\x1b[3J\x1b[H'

/** A title must not carry control characters into its OSC sequence (they could end it early). */
function safeTitle(title: string): string {
  let out = ''
  for (const ch of title) {
    const code = ch.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) out += ch
  }
  return out
}

export function reattachPayload(screen: PtyScreen): string {
  const title = screen.title ? `\x1b]2;${safeTitle(screen.title)}\x07` : ''
  return `${CLEAN_SLATE}${screen.data}${screen.modes}${title}`
}

/**
 * The part of a live chunk the reattach screen does not already show. `seq` is the stream position at the chunk's
 * end, `covered` the position the screen was captured at.
 */
export function uncovered(data: string, seq: number, covered: number): string {
  if (seq <= covered) return ''
  const start = seq - data.length
  return start >= covered ? data : data.slice(covered - start)
}
