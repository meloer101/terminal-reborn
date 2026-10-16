// IPC for terminal snapshots: `<userData>/terminal-snapshots/<sessionId>.json`. A reopened session paints its
// last screen from here at once instead of staying blank while `claude --resume` starts (~2–3 s).
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { SNAPSHOT_MAX_AGE_MS, TerminalSnapshotFiles } from './terminal-snapshot-file'

export function registerTerminalSnapshots(): void {
  const files = new TerminalSnapshotFiles(join(app.getPath('userData'), 'terminal-snapshots'))
  files.pruneOlderThan(SNAPSHOT_MAX_AGE_MS)
  ipcMain.on(IPC.terminalSnapshotLoad, (event, sessionId: unknown) => {
    event.returnValue = files.load(sessionId)
  })
  // Written synchronously on receipt: the last save arrives while the window unloads during quit.
  ipcMain.on(IPC.terminalSnapshotSave, (_event, sessionId: unknown, snapshot: unknown) => {
    try {
      files.save(sessionId, snapshot)
    } catch (error) {
      console.warn('[terminal-snapshots] save failed', error)
    }
  })
  ipcMain.on(IPC.terminalSnapshotRemove, (_event, sessionId: unknown) => {
    try {
      files.remove(sessionId)
    } catch {
      // Invalid id: nothing to remove.
    }
  })
}
