// Which digit key answers the PromptBar. Pure: the component extracts facts from the event and the DOM.

/** What has keyboard focus, as far as digit shortcuts are concerned. */
export type FocusKind =
  /** The composer textarea. */
  | { type: 'composer'; empty: boolean }
  /** The bar's own free-text field: digits are text there. */
  | { type: 'bar-input' }
  /** Any other text field (command palette, rename box, …). */
  | { type: 'other-input' }
  /** The terminal, or nothing in particular. */
  | { type: 'elsewhere' }

export interface DigitKeyFacts {
  /** KeyboardEvent.code: ⌥ changes `key` on macOS (⌥1 → "¡"), `code` stays Digit1. */
  code: string
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
  key: string
}

/**
 * The 1-based option number a key press selects, or null to leave the key alone.
 * Plain digits choose while the composer is empty or focus is outside it; ⌥digits always choose (they are the
 * way to answer while the composer holds text). Never while typing in the bar's own field or another text field.
 */
export function decideDigitKey(f: DigitKeyFacts, focus: FocusKind): number | null {
  if (f.isComposing || f.keyCode === 229 || f.key === 'Process') return null
  if (f.metaKey || f.ctrlKey || f.shiftKey) return null
  const match = /^(?:Digit|Numpad)([1-9])$/.exec(f.code)
  if (!match) return null
  const n = Number(match[1])
  if (focus.type === 'bar-input' || focus.type === 'other-input') return null
  if (f.altKey) return n
  if (focus.type === 'composer' && !focus.empty) return null
  return n
}
