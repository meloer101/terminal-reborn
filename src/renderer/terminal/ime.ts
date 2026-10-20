// Text the macOS input system inserts into xterm's textarea that no key typed. Pure; the surface wires it up.

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
