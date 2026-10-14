import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { registerFileHandlers } from './files'
import { registerHookHandlers } from './hooks'
import { registerPtyHandlers } from './pty'
import { registerSettingsHandlers } from './settings'
import { registerUiHandlers } from './ui'
import { createMainWindow, installAppMenu, openSettingsWindow } from './windows'

// Lets e2e runs use a throwaway profile instead of the user's real workspace and drafts.
if (process.env.TR_USER_DATA_DIR) app.setPath('userData', process.env.TR_USER_DATA_DIR)

function registerAppHandlers(): void {
  ipcMain.on(IPC.appVersion, (event) => {
    event.returnValue = app.getVersion()
  })
  // Replaced by the release track's GitHub update check.
  ipcMain.handle(IPC.appCheckForUpdates, () => null)
  ipcMain.on(IPC.uiOpenSettings, () => openSettingsWindow())
}

void app.whenReady().then(() => {
  registerAppHandlers()
  registerSettingsHandlers()
  registerFileHandlers()
  registerHookHandlers()
  registerPtyHandlers()
  registerUiHandlers()
  installAppMenu()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
