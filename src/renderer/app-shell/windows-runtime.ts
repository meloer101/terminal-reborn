// The windows this renderer draws (PRD F20 · 多窗口): the main window's own `window`, plus each secondary window it
// opened (secondary-windows.tsx). Code that listens on the window for keys or focus registers once with everyWindow()
// and is installed in every window, those opened later included.
import { MAIN_WINDOW, type WindowKey } from '@shared/window-layout'
import { useWorkspace } from '../state/workspace'

type Install = (win: Window, key: WindowKey) => (() => void) | void

const windows = new Map<WindowKey, Window>([[MAIN_WINDOW, window]])
const installers = new Set<Install>()
const cleanups = new Map<WindowKey, Map<Install, () => void>>()

function install(fn: Install, key: WindowKey, win: Window): void {
  const cleanup = fn(win, key)
  if (!cleanup) return
  let byWindow = cleanups.get(key)
  if (!byWindow) cleanups.set(key, (byWindow = new Map()))
  byWindow.set(fn, cleanup)
}

/** Runs `fn` for every window now and every window opened later; the returned function undoes it everywhere. */
export function everyWindow(fn: Install): () => void {
  installers.add(fn)
  for (const [key, win] of windows) install(fn, key, win)
  return () => {
    installers.delete(fn)
    for (const byWindow of cleanups.values()) {
      byWindow.get(fn)?.()
      byWindow.delete(fn)
    }
  }
}

export function addWindow(key: WindowKey, win: Window): void {
  windows.set(key, win)
  for (const fn of installers) install(fn, key, win)
}

export function removeWindow(key: WindowKey): void {
  if (key === MAIN_WINDOW) return
  for (const cleanup of cleanups.get(key)?.values() ?? []) cleanup()
  cleanups.delete(key)
  windows.delete(key)
}

export const windowOf = (key: WindowKey): Window | undefined => windows.get(key)

/** The key of the window `win` is, or null when it is none of ours. */
export function keyOfWindow(win: Window | null | undefined): WindowKey | null {
  if (!win) return null
  for (const [key, w] of windows) if (w === win) return key
  return null
}

/** The window an element or event target is in. */
export function windowOfNode(node: Node | null | undefined): Window {
  return node?.ownerDocument?.defaultView ?? window
}

/** The document of the window with the keyboard (where sheets, menus and the palette open). */
export function keyDocument(): Document {
  return (windows.get(useWorkspace.getState().keyWindow) ?? window).document
}

/** Whether any of the app's windows has the system focus. */
export function anyWindowFocused(): boolean {
  for (const win of windows.values()) {
    try {
      if (win.document.visibilityState === 'visible' && win.document.hasFocus()) return true
    } catch {
      // A window that is closing.
    }
  }
  return false
}
