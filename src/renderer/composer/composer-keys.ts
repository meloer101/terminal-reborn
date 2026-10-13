// Pure keyboard decision logic for the composer (PRD F1). No DOM access: the component
// extracts `KeyFacts` from the event and applies the returned action.
import type { PassthroughKey } from '@shared/keys'

export interface KeyFacts {
  key: string
  keyCode: number
  isComposing: boolean
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
}

export interface InputState {
  /** Raw editor text. Empty means exactly '' — a lone space is real content. */
  text: string
}

export type KeyAction =
  /** Let the browser handle it (typing, newline, caret movement, IME). */
  | { type: 'default' }
  /** Submit the current text. */
  | { type: 'send' }
  /** Forward a key to the agent; the editor must not also handle it. */
  | { type: 'passthrough'; key: PassthroughKey }
  /** Swallow the key (e.g. ↵ with nothing to send). */
  | { type: 'swallow' }

const DEFAULT: KeyAction = { type: 'default' }

/** IME safety: true while a composition is active or the event is the IME's own keydown. */
export function isImeEvent(f: Pick<KeyFacts, 'isComposing' | 'keyCode' | 'key'>): boolean {
  return f.isComposing || f.keyCode === 229 || f.key === 'Process'
}

export function decideKey(f: KeyFacts, state: InputState): KeyAction {
  if (isImeEvent(f)) return DEFAULT

  if (f.key === 'Enter') {
    if (f.shiftKey || f.altKey) return DEFAULT
    return state.text.trim().length === 0 ? { type: 'swallow' } : { type: 'send' }
  }

  // Pass-through only when the input is empty; otherwise the keys edit text normally.
  if (state.text.length > 0) return DEFAULT

  const noMods = !f.shiftKey && !f.metaKey && !f.ctrlKey && !f.altKey
  if (noMods) {
    if (f.key === 'Escape') return { type: 'passthrough', key: 'escape' }
    if (f.key === 'ArrowUp') return { type: 'passthrough', key: 'up' }
    if (f.key === 'ArrowDown') return { type: 'passthrough', key: 'down' }
  }
  if (f.key === 'Tab' && f.shiftKey && !f.metaKey && !f.ctrlKey && !f.altKey) {
    return { type: 'passthrough', key: 'shift-tab' }
  }
  if (f.ctrlKey && !f.metaKey && !f.altKey && !f.shiftKey && f.key.toLowerCase() === 'c') {
    return { type: 'passthrough', key: 'ctrl-c' }
  }
  return DEFAULT
}

/** ⌘L focuses the composer from anywhere. */
export function isFocusShortcut(f: Pick<KeyFacts, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return f.metaKey && !f.ctrlKey && !f.altKey && !f.shiftKey && f.key.toLowerCase() === 'l'
}
