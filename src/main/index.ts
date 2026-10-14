import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { registerAppearanceEffects } from './appearance'
import { registerActivityHandlers } from './activity'
import { registerFileHandlers } from './files'
import { registerHookHandlers } from './hooks'
import { registerPtyHandlers } from './pty'
import { registerSettingsHandlers } from './settings'
import { registerUiHandlers } from './ui'
import { registerUpdateHandlers } from './updates'
import { createMainWindow, installAppMenu, showSettings } from './windows'
import { registerWorkspaceStore } from './workspace-store'

// Lets e2e runs use a throwaway profile instead of the user's real workspace and drafts.
if (process.env.TR_USER_DATA_DIR) app.setPath('userData', process.env.TR_USER_DATA_DIR)

function registerAppHandlers(): void {
  ipcMain.on(IPC.appVersion, (event) => {
    event.returnValue = app.getVersion()
  })
  ipcMain.on(IPC.uiOpenSettings, (event) => showSettings(BrowserWindow.fromWebContents(event.sender)))
}

void app.whenReady().then(() => {
  registerAppHandlers()
  registerActivityHandlers()
  registerWorkspaceStore()
  registerSettingsHandlers()
  registerAppearanceEffects()
  registerFileHandlers()
  registerHookHandlers()
  registerPtyHandlers()
  registerUiHandlers()
  registerUpdateHandlers()
  installAppMenu()
  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
