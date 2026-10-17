// Quit policy: ⌘Q, the app menu, the Dock menu and logout all arrive as `before-quit`. With the pty daemon the
// sessions keep running and nothing is asked (docs/spikes/pty-daemon.md §7). Without it (fallback host), running or
// waiting sessions hold the first quit back until the user confirms; the OS forcing a quit never is.
// "退出并结束所有会话" (⌥⌘Q) ends every session, after a confirmation while any is active.
import { app, powerMonitor, type BrowserWindow } from 'electron'
import { decideQuit, endSessionsQuitConfirmation, quitConfirmation } from '@shared/lifecycle'
import { getActivity } from './activity'
import { confirm } from './confirm'
import { endSessionsOnNextQuit, quitKeepsSessions } from './pty'

let quitting = false
let osForcedQuit = false
let confirming = false

/** True once a quit is under way: windows must really close instead of hiding. */
export function isQuitting(): boolean {
  return quitting
}

export function installQuitGuard(getParent: () => BrowserWindow | null): void {
  // Logout / shutdown: a dialog here would block the system, so let the quit through.
  powerMonitor.on('shutdown', () => {
    osForcedQuit = true
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    const { active } = getActivity()
    if (decideQuit({ active, forced: osForcedQuit, keepsSessions: quitKeepsSessions() }) === 'quit') {
      quitting = true
      return
    }
    event.preventDefault()
    if (confirming) return
    confirming = true
    void confirm(quitConfirmation(active), getParent())
      .catch(() => false)
      .then((ok) => {
        confirming = false
        if (!ok) return
        quitting = true
        app.quit()
      })
  })
}

/** "退出并结束所有会话": confirm while sessions are active, then quit ending them all (and the daemon). */
export function quitEndingSessions(getParent: () => BrowserWindow | null): void {
  if (confirming || quitting) return
  const ask = endSessionsQuitConfirmation(getActivity().active)
  confirming = ask !== null
  void (ask ? confirm(ask, getParent()).catch(() => false) : Promise.resolve(true)).then((ok) => {
    confirming = false
    if (!ok) return
    endSessionsOnNextQuit()
    quitting = true
    app.quit()
  })
}
