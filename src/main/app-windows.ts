// The app's own windows, as opposed to the sign-in pop-ups that built-in browser pages open (browser/host.ts).
// Pop-ups are always created with the app window as their parent; app windows never have one.
import { BrowserWindow } from 'electron'

export function isAppWindow(win: BrowserWindow): boolean {
  return !win.isDestroyed() && win.getParentWindow() === null
}

/** Every open app window (what used to be `BrowserWindow.getAllWindows()` before pages could open pop-ups). */
export function appWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter(isAppWindow)
}
