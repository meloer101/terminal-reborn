// macOS line-editing shortcuts that terminals expect (PRD F1 key mappings).

export interface KeyLike {
  key: string
  metaKey: boolean
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  isComposing?: boolean
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
