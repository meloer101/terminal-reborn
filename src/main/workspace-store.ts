// IPC for the main-owned workspace store (phase 2 · A12): `<userData>/workspace.json`.
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { WorkspaceFileStore } from './workspace-file-store'

let store: WorkspaceFileStore | null = null

/** Whether `path` is the root folder of one of the workspace's projects, as the renderer last saved it. */
export function isProjectRoot(path: string): boolean {
  return store?.projectRoots().includes(path) ?? false
}

export function registerWorkspaceStore(): void {
  const current = new WorkspaceFileStore(join(app.getPath('userData'), 'workspace.json'))
  store = current
  ipcMain.on(IPC.workspaceLoad, (event) => {
    event.returnValue = current.load()
  })
  ipcMain.on(IPC.workspaceSave, (_event, raw: unknown) => current.save(raw))
  // Anything still waiting for the debounce is written before the app goes away.
  app.on('before-quit', () => current.flush())
}
