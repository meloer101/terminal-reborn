import { app, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { registerActivityHandlers } from './activity'
import { registerAppearanceEffects } from './appearance'
import { registerConfirmHandlers } from './confirm'
import { registerFileHandlers } from './files'
import { registerHookHandlers } from './hooks'
import { registerPtyHandlers } from './pty'
import { installQuitGuard } from './quit'
import { registerSettingsHandlers } from './settings'
import { registerUiHandlers } from './ui'
import { registerUpdateHandlers } from './updates'
import { createMainWindow, getMainWindow, installAppMenu, openSettingsWindow, showMainWindow } from './windows'

// Lets e2e runs use a throwaway profile instead of the user's real workspace and drafts.
if (process.env.TR_USER_DATA_DIR) app.setPath('userData', process.env.TR_USER_DATA_DIR)

// A stray bug must not take every agent down: log and keep running.
process.on('uncaughtException', (error) => console.error('[main] uncaughtException', error))
process.on('unhandledRejection', (reason) => console.error('[main] unhandledRejection', reason))

function registerAppHandlers(): void {
  ipcMain.on(IPC.appVersion, (event) => {
    event.returnValue = app.getVersion()
  })
  ipcMain.on(IPC.uiOpenSettings, () => openSettingsWindow())
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

function boot(): void {
  registerAppHandlers()
  registerActivityHandlers()
  registerConfirmHandlers()
  registerSettingsHandlers()
  registerAppearanceEffects()
  registerFileHandlers()
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
