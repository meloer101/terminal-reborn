// IPC for the main-owned workspace store (phase 2 · A12): `<userData>/workspace.json`.
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { WorkspaceFileStore } from './workspace-file-store'

let store: WorkspaceFileStore | null = null
let quitting = false

/** Whether `path` is the root folder of one of the workspace's projects, as the renderer last saved it. */
export function isProjectRoot(path: string): boolean {
  return store?.projectRoots().includes(path) ?? false
}

/**
 * The quit is going ahead (quit.ts, once nothing holds it back): from now on a snapshot is written as it arrives,
 * since windows send their last one as they close, after before-quit.
 */
export function workspaceQuitting(): void {
  quitting = true
  store?.flush()
}

export function registerWorkspaceStore(): void {
  const current = new WorkspaceFileStore(join(app.getPath('userData'), 'workspace.json'))
  store = current
  ipcMain.on(IPC.workspaceLoad, (event) => {
    event.returnValue = current.load()
  })
  ipcMain.on(IPC.workspaceSave, (_event, raw: unknown) => {
    current.save(raw)
    // A window closing during quit sends its last snapshot after before-quit: the debounce would not outlive the app.
    if (quitting) current.flush()
  })
  // Anything still waiting for the debounce is written before the app goes away.
  app.on('before-quit', () => current.flush())
}
