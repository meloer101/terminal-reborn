// IPC for terminal snapshots: `<userData>/terminal-snapshots/<sessionId>.json`. A reopened session paints its
// last screen from here at once instead of staying blank while `claude --resume` starts (~2–3 s).
import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { SNAPSHOT_MAX_AGE_MS, TerminalSnapshotFiles } from './terminal-snapshot-file'

/** The longest a quit waits for snapshot writes still in flight. */
const QUIT_WAIT_MS = 2000

export function registerTerminalSnapshots(): void {
  const files = new TerminalSnapshotFiles(join(app.getPath('userData'), 'terminal-snapshots'))
  void files.pruneOlderThan(SNAPSHOT_MAX_AGE_MS)
  // An invalid id or an unreadable file is "no snapshot".
  ipcMain.handle(IPC.terminalSnapshotLoad, (_event, sessionId: unknown) => files.load(sessionId))
  ipcMain.on(IPC.terminalSnapshotSave, (_event, sessionId: unknown, snapshot: unknown) => {
    files.save(sessionId, snapshot).catch((error: unknown) => console.warn('[terminal-snapshots] save failed', error))
  })
  ipcMain.on(IPC.terminalSnapshotRemove, (_event, sessionId: unknown) => {
    // Invalid id: nothing to remove.
    files.remove(sessionId).catch(() => undefined)
  })
  // The last saves arrive while the window unloads during quit; the process must not exit before they are on disk.
  // Another will-quit holder (the pty daemon's shutdown) may quit again meanwhile: hold until the one deadline.
  let deadline: number | null = null
  app.on('will-quit', (event) => {
    if (files.writing === 0) return
    deadline ??= Date.now() + QUIT_WAIT_MS
    const left = deadline - Date.now()
    if (left <= 0) return
    event.preventDefault()
    void Promise.race([files.idle(), new Promise((resolve) => setTimeout(resolve, left))]).then(() => app.quit())
  })
}
