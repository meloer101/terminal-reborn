// Pure key decisions for the palette. The component extracts the facts from the event.

export interface KeyFacts {
  key: string
  keyCode: number
  isComposing: boolean
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

/** IME safety: true while a composition is active or the event is the IME's own keydown. */
export function isImeEvent(f: Pick<KeyFacts, 'isComposing' | 'keyCode' | 'key'>): boolean {
  return f.isComposing || f.keyCode === 229 || f.key === 'Process'
}

export type PaletteKey = 'next' | 'prev' | 'run' | 'close' | 'toggle'

/** ⌘K toggles the palette from anywhere. */
export function isPaletteShortcut(f: Pick<KeyFacts, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return f.metaKey && !f.ctrlKey && !f.altKey && !f.shiftKey && f.key.toLowerCase() === 'k'
}

/** Keys inside the palette. Null = let the input handle it (typing, caret movement, IME). */
export function decidePaletteKey(f: KeyFacts): PaletteKey | null {
  if (isImeEvent(f)) return null
  if (isPaletteShortcut(f)) return 'toggle'
  if (f.metaKey || f.altKey) return null
  if (f.ctrlKey) {
    if (f.shiftKey) return null
    const key = f.key.toLowerCase()
    if (key === 'n' || key === 'j') return 'next'
    return key === 'p' || key === 'k' ? 'prev' : null
  }
  if (f.shiftKey) return f.key === 'Tab' ? 'prev' : null
  switch (f.key) {
    case 'ArrowDown':
    case 'Tab':
      return 'next'
    case 'ArrowUp':
      return 'prev'
    case 'Enter':
      return 'run'
    case 'Escape':
      return 'close'
    default:
      return null
  }
}
