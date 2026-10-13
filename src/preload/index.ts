import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type PtyExit, type TrApi } from '@shared/ipc'
import type { SessionId } from '@shared/types'

function subscribe<T>(channel: string, sessionId: SessionId, listener: (payload: T) => void, key: 'data' | 'exit') {
  const handler = (_event: IpcRendererEvent, message: { sessionId: SessionId } & Record<string, unknown>) => {
    if (message.sessionId === sessionId) listener(message[key] as T)
  }
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: TrApi = {
  platform: process.platform,
  homeDir: process.env.HOME ?? '/',
  pty: {
    spawn: (options) => ipcRenderer.invoke(IPC.ptySpawn, options),
    write: (sessionId, data) => ipcRenderer.send(IPC.ptyWrite, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.ptyResize, sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.send(IPC.ptyKill, sessionId),
    onData: (sessionId, listener) => subscribe<string>(IPC.ptyData, sessionId, listener, 'data'),
    onExit: (sessionId, listener) => subscribe<PtyExit>(IPC.ptyExit, sessionId, listener, 'exit')
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file),
    saveTempImage: (data, extension) => ipcRenderer.invoke(IPC.filesSaveTempImage, data, extension)
  }
}

contextBridge.exposeInMainWorld('tr', api)
