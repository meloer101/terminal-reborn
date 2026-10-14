// Quit policy: ⌘Q, the app menu, the Dock menu and logout all arrive as `before-quit`. With running or
// waiting sessions the first one is held back until the user confirms; the OS forcing a quit never is.
import { app, powerMonitor, type BrowserWindow } from 'electron'
import { decideQuit, quitConfirmation } from '@shared/lifecycle'
import { getActivity } from './activity'
import { confirm } from './confirm'

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
    if (decideQuit({ active, forced: osForcedQuit }) === 'quit') {
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
