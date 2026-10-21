// The app's own windows, as opposed to the sign-in pop-ups that built-in browser pages open (browser/host.ts).
// Pop-ups are always created with the app window as their parent; app windows never have one.
// Secondary windows (F20 · 多窗口, secondary-windows.ts) are app windows too, but they have no page of their own: the
// main window's renderer draws them. Messages for "the renderer" go to their opener.
import { BrowserWindow, type WebContents } from 'electron'

const openers = new WeakMap<BrowserWindow, WebContents>()

export function isAppWindow(win: BrowserWindow): boolean {
  return !win.isDestroyed() && win.getParentWindow() === null
}

/** Marks a window opened by `opener`'s page as drawn by that page. */
export function markSecondaryWindow(win: BrowserWindow, opener: WebContents): void {
  openers.set(win, opener)
}

export function isSecondaryWindow(win: BrowserWindow): boolean {
  return openers.has(win)
}

/** The page that draws the window: its opener for a secondary window, its own otherwise. */
export function rendererOf(win: BrowserWindow): WebContents {
  return openers.get(win) ?? win.webContents
}

/** Every app window with a renderer of its own (what used to be `BrowserWindow.getAllWindows()` before pages could open pop-ups). */
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => isAppWindow(win) && !isSecondaryWindow(win))
}

/** Every app window, secondary ones included (native appearance, window chrome). */
export function allAppWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(isAppWindow)
}

/**
 * The window a sheet or picker asked for by `sender`'s page belongs on: the secondary window the user is in, when it is
 * one of that page's, else the page's own window.
 */
export function hostWindowFor(sender: WebContents): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && !focused.isDestroyed() && openers.get(focused) === sender) return focused
  return BrowserWindow.fromWebContents(sender)
}
