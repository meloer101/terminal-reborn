// Turns a saved terminal snapshot (xterm SerializeAddon output) into what a reopened terminal writes before its
// process starts again. Display only: no modes are restored, and a full-screen program's last frame is drawn in
// the normal buffer, so the new process (which switches to the alternate screen itself) starts from a clean state.

/** How SerializeAddon introduces the alternate buffer when it was active. */
const ALT_BUFFER_START = '\x1b[?1049h\x1b[H'
const SGR_RESET = '\x1b[0m'

/** Rows of scrollback tried in turn until the serialized text fits. */
export const SNAPSHOT_SCROLLBACK_STEPS = [2000, 500, 0] as const
export const SNAPSHOT_MAX_CHARS = 2 * 1024 * 1024

export function restorePayload(data: string, rows: number): string {
  const alt = data.indexOf(ALT_BUFFER_START)
  if (alt === -1) {
    // A plain shell screen: the new prompt starts on the line after the old output.
    return `${data}${SGR_RESET}\r\n`
  }
  const normal = data.slice(0, alt)
  const frame = data.slice(alt + ALT_BUFFER_START.length)
  // Push the normal buffer into scrollback, draw the frame over a clean viewport, park the cursor on the last row.
  return `${normal}${SGR_RESET}${'\r\n'.repeat(rows)}\x1b[H${frame}${SGR_RESET}\x1b[${rows};1H`
}
