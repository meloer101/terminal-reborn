// PLACEHOLDER — owned by the `persistence` track (docs/tasks/2a-persistence.md): a main-owned atomic
// JSON store for the workspace (replacing renderer localStorage). Until then: nothing stored here.
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc'

export function registerWorkspaceStore(): void {
  ipcMain.on(IPC.workspaceLoad, (event) => {
    event.returnValue = null
  })
  ipcMain.on(IPC.workspaceSave, () => {})
}
