// macOS line-editing shortcuts that terminals expect (PRD §4 F1).

export interface KeyLike {
  key: string
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  isComposing?: boolean
  /** 229 while an input method handles the key (Chromium's VKEY_PROCESSKEY). */
  keyCode?: number
}

/** Bytes to send for a macOS shortcut, or null when the key should take its normal path. */
export function macKeyToBytes(event: KeyLike): string | null {
  if (event.isComposing || event.ctrlKey || event.shiftKey) return null

  if (event.metaKey && !event.altKey) {
    switch (event.key) {
      case 'Backspace':
        return '\x15' // ⌘⌫ → kill line (Ctrl+U)
      case 'ArrowLeft':
        return '\x01' // ⌘← → line start (Ctrl+A)
      case 'ArrowRight':
        return '\x05' // ⌘→ → line end (Ctrl+E)
    }
  }
  if (event.altKey && !event.metaKey) {
    switch (event.key) {
      case 'ArrowLeft':
        return '\x1bb' // ⌥← → word back (ESC b)
      case 'ArrowRight':
        return '\x1bf' // ⌥→ → word forward (ESC f)
    }
  }
  return null
}

/**
 * A plain printable key whose character should come from the text system, not from the key: true for a single
 * character typed without ⌘ / ⌃ / ⌥ outside an IME composition. xterm sends `event.key` on keydown and cancels the
 * event, which also cancels the keypress carrying what the input method committed in its place, so a Chinese input
 * method's `，` `。` `《` `！` arrived as `,` `.` `<` `!` (orca#6147; Chromium sends that keydown with the plain key and the
 * IME's character in the keypress after it). Left to the keypress, xterm sends the committed character instead.
 * Composition keys (229) and ⌥-composed characters already go through the IME / keypress path.
 */
export function defersToTextInput(event: KeyLike): boolean {
  if (event.isComposing || event.keyCode === 229 || event.metaKey || event.ctrlKey || event.altKey) return false
  return [...event.key].length === 1
}
