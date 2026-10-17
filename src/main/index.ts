import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { registerActivityHandlers } from './activity'
import { registerAgentDetection } from './agents-installed'
import { registerUserName } from './user-name'
import { registerAppearanceEffects } from './appearance'
import { registerConfirmHandlers } from './confirm'
import { registerFileHandlers } from './files'
import { registerHookHandlers } from './hooks'
import { registerPtyHandlers } from './pty'
import { installQuitGuard } from './quit'
import { registerSettingsHandlers } from './settings'
import { registerUiHandlers } from './ui'
import { registerUpdateHandlers } from './updates'
import { createMainWindow, getMainWindow, installAppMenu, showMainWindow, showSettings } from './windows'
import { registerTerminalSnapshots } from './terminal-snapshots'
import { registerWorkspaceStore } from './workspace-store'
import { registerWorktreeFileHandlers } from './worktree-files'

// Lets e2e runs use a throwaway profile instead of the user's real workspace and drafts.
if (process.env.TR_USER_DATA_DIR) app.setPath('userData', process.env.TR_USER_DATA_DIR)

// A stray bug must not take every agent down: log and keep running.
process.on('uncaughtException', (error) => console.error('[main] uncaughtException', error))
process.on('unhandledRejection', (reason) => console.error('[main] unhandledRejection', reason))

function registerAppHandlers(): void {
  ipcMain.on(IPC.appVersion, (event) => {
    event.returnValue = app.getVersion()
  })
  ipcMain.on(IPC.uiOpenSettings, (event) => showSettings(BrowserWindow.fromWebContents(event.sender)))
}

// One instance per profile: a second launch brings the first one forward instead of competing for the terminals.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow()
  })
  start()
}

function start(): void {
  void app.whenReady().then(boot)
}

// Packaged builds get the icon from build/icon.icns; `npm run dev` runs the stock Electron binary, so set it here.
function useAppIconInDev(): void {
  if (app.isPackaged || process.platform !== 'darwin') return
  app.dock?.setIcon(join(app.getAppPath(), 'build', 'icon.png'))
}

function boot(): void {
  useAppIconInDev()
  registerAppHandlers()
  registerActivityHandlers()
  registerAgentDetection()
  registerUserName()
  registerWorkspaceStore()
  registerTerminalSnapshots()
  registerConfirmHandlers()
  registerSettingsHandlers()
  registerAppearanceEffects()
  registerFileHandlers()
  registerWorktreeFileHandlers()
  registerHookHandlers()
  registerPtyHandlers()
  registerUiHandlers()
  registerUpdateHandlers()
  installAppMenu()
  installQuitGuard(getMainWindow)
  createMainWindow()
  // Dock icon click: the close button only hid the window.
  app.on('activate', () => showMainWindow())
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
