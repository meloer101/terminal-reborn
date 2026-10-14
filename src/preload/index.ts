import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type PtyExit, type TrApi } from '@shared/ipc'
import type { SessionId } from '@shared/types'

// One ipcRenderer listener per channel, fanned out by session id. Per-session listeners
// would trip Node's MaxListeners warning once a dozen terminals are open.
class Fanout<T> {
  private readonly listeners = new Map<SessionId, Set<(payload: T) => void>>()

  add(sessionId: SessionId, listener: (payload: T) => void): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(sessionId)
    }
  }

  emit(sessionId: SessionId, payload: T): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(payload)
  }
}

const dataListeners = new Fanout<string>()
const exitListeners = new Fanout<PtyExit>()

ipcRenderer.on(IPC.ptyData, (_event, message: { sessionId: SessionId; data: string }) => {
  dataListeners.emit(message.sessionId, message.data)
})
ipcRenderer.on(IPC.ptyExit, (_event, message: { sessionId: SessionId; exit: PtyExit }) => {
  exitListeners.emit(message.sessionId, message.exit)
})

const api: TrApi = {
  platform: process.platform,
  homeDir: process.env.HOME ?? '/',
  pty: {
    spawn: (options) => ipcRenderer.invoke(IPC.ptySpawn, options),
    write: (sessionId, data) => ipcRenderer.send(IPC.ptyWrite, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.ptyResize, sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.send(IPC.ptyKill, sessionId),
    ack: (sessionId, count) => ipcRenderer.send(IPC.ptyAck, sessionId, count),
    onData: (sessionId, listener) => dataListeners.add(sessionId, listener),
    onExit: (sessionId, listener) => exitListeners.add(sessionId, listener)
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file),
    saveTempImage: (data, extension) => ipcRenderer.invoke(IPC.filesSaveTempImage, data, extension)
  },
  ui: {
    pickFolder: () => ipcRenderer.invoke(IPC.uiPickFolder),
    popupMenu: (entries) => ipcRenderer.invoke(IPC.uiPopupMenu, entries)
  }
}

contextBridge.exposeInMainWorld('tr', api)
