// Input-method helpers for xterm's textarea: text the macOS input system inserts that no key typed, and where the
// preedit goes. Pure; the surface wires them up.

/** How long after the terminal's last input an inserted ". " still counts as the double-space substitution. */
export const AUTO_PERIOD_WINDOW_MS = 1000

export interface TextInsertion {
  inputType: string
  data: string | null
  /** A key is down (between its keydown and keyup). */
  keyHeld: boolean
  /** What the terminal last sent to the PTY as input, and how long ago. */
  lastInput: string
  msSinceLastInput: number
}

/**
 * macOS "Add period with double-space" (on by default): with a CJK input source the input method inserts ". " after a
 * typed space, with no key event of its own, and xterm sent it to the PTY (orca#11504; Korean commits even trigger it
 * on a single space). The input method reads the setting from the global domain, so the app cannot turn it off for
 * itself; the terminal drops the insertion instead, which is what native terminals (outside the text system) see.
 */
export function isAutoPeriod(insertion: TextInsertion): boolean {
  return (
    insertion.data === '. ' &&
    insertion.inputType.startsWith('insert') &&
    insertion.inputType !== 'insertCompositionText' &&
    !insertion.keyHeld &&
    insertion.lastInput.endsWith(' ') &&
    insertion.msSinceLastInput <= AUTO_PERIOD_WINDOW_MS
  )
}

/**
 * Where xterm's preedit (its composition view, and the textarea it sizes to match) goes in a screen `room` px wide.
 * xterm puts it at the cursor at its full width; at the right edge it ran past the card, Chromium scrolled the card
 * (overflow: hidden) sideways to keep the caret in view, and after a commit xterm leaves the textarea that wide, so
 * the card stayed scrolled. It ends at the right edge instead, and is never wider than the screen.
 */
export function placePreedit(left: number, width: number, room: number): { left: number; width: number } {
  const fitted = Math.min(width, room)
  return { left: Math.max(0, Math.min(left, room - fitted)), width: fitted }
}
