// IPC for the main-owned workspace store (phase 2 · A12): `<userData>/workspace.json`.
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { WorkspaceFileStore } from './workspace-file-store'

export function registerWorkspaceStore(): void {
  const store = new WorkspaceFileStore(join(app.getPath('userData'), 'workspace.json'))
  ipcMain.on(IPC.workspaceLoad, (event) => {
    event.returnValue = store.load()
  })
  ipcMain.on(IPC.workspaceSave, (_event, raw: unknown) => store.save(raw))
  // Anything still waiting for the debounce is written before the app goes away.
  app.on('before-quit', () => store.flush())
}
