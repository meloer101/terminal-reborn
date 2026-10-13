// Sidebar keyboard shortcuts. `resolveShortcut` is pure; `installSidebarShortcuts` wires it to a window.
import type { SessionId } from '@shared/types'

export type ShortcutAction = { type: 'nth'; n: number } | { type: 'next-attention' }

export interface KeyLike {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** ⌘1–⌘9 select the nth visible session; ⌘J jumps to the next one needing attention. */
export function resolveShortcut(e: KeyLike): ShortcutAction | null {
  if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null
  if (/^[1-9]$/.test(e.key)) return { type: 'nth', n: Number(e.key) }
  if (e.key.toLowerCase() === 'j') return { type: 'next-attention' }
  return null
}

export interface ShortcutHandlers {
  selectNth(n: number): SessionId | null
  selectNextAttention(): SessionId | null
}

/**
 * Registers the shortcuts in the capture phase so they work while the terminal has focus.
 * Lives outside React so the shortcuts keep working while the sidebar is collapsed (unmounted).
 */
export function installSidebarShortcuts(target: Window, handlers: ShortcutHandlers): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    const action = resolveShortcut(e)
    if (!action) return
    e.preventDefault()
    e.stopPropagation()
    if (action.type === 'nth') handlers.selectNth(action.n)
    else handlers.selectNextAttention()
  }
  target.addEventListener('keydown', onKeyDown, true)
  return () => target.removeEventListener('keydown', onKeyDown, true)
}
