// Module-level open/closed store for the palette, plus the global ⌘K shortcut. Lives outside
// React so the sidebar's "跳转到…" row can call openCommandPalette() without prop plumbing.
import { create } from 'zustand'
import { isPaletteShortcut } from './keys'

export const usePaletteOpen = create<{ open: boolean }>()(() => ({ open: false }))

/** The element that had focus when the palette opened (xterm's textarea, the composer, ...). */
let restoreTo: HTMLElement | null = null

export function isCommandPaletteOpen(): boolean {
  return usePaletteOpen.getState().open
}

export function openCommandPalette(): void {
  if (isCommandPaletteOpen()) return
  const active = document.activeElement
  restoreTo = active instanceof HTMLElement && active !== document.body ? active : null
  usePaletteOpen.setState({ open: true })
}

/**
 * Closes the palette and puts focus back where it was. Focus moves on the next frame, not
 * synchronously: when ↵ closes the palette, the keypress/keyup that follow the keydown must
 * not land on the terminal (xterm would send a stray carriage return).
 */
export function closeCommandPalette(): void {
  if (!isCommandPaletteOpen()) return
  const target = restoreTo
  restoreTo = null
  usePaletteOpen.setState({ open: false })
  requestAnimationFrame(() => {
    if (!isCommandPaletteOpen() && target?.isConnected) target.focus()
  })
}

export function toggleCommandPalette(): void {
  if (isCommandPaletteOpen()) closeCommandPalette()
  else openCommandPalette()
}

// Capture phase on window: wins over xterm and the composer, which stop key events in bubble phase.
const onKeyDown = (e: KeyboardEvent) => {
  if (!isPaletteShortcut(e)) return
  e.preventDefault()
  e.stopPropagation()
  toggleCommandPalette()
}
window.addEventListener('keydown', onKeyDown, true)
if (import.meta.hot) import.meta.hot.dispose(() => window.removeEventListener('keydown', onKeyDown, true))
