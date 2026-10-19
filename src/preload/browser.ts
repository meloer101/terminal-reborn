// window.tr.browser: the right panel's built-in browser (PRD F17). The pages themselves get no preload at all.
import { ipcRenderer } from 'electron'
import { BROWSER_IPC, type BrowserApi } from '@shared/browser'

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export const browserApi: BrowserApi = {
  show: (worktree, bounds) => ipcRenderer.send(BROWSER_IPC.show, worktree, bounds),
  hide: () => ipcRenderer.send(BROWSER_IPC.hide),
  cover: () => ipcRenderer.invoke(BROWSER_IPC.cover),
  navigate: (worktree, url) => ipcRenderer.send(BROWSER_IPC.navigate, worktree, url),
  back: (worktree) => ipcRenderer.send(BROWSER_IPC.back, worktree),
  forward: (worktree) => ipcRenderer.send(BROWSER_IPC.forward, worktree),
  reload: (worktree) => ipcRenderer.send(BROWSER_IPC.reload, worktree),
  setMobile: (worktree, mobile) => ipcRenderer.send(BROWSER_IPC.setMobile, worktree, mobile),
  openExternal: (worktree) => ipcRenderer.send(BROWSER_IPC.openExternal, worktree),
  pageCommand: (worktree, command, at) => ipcRenderer.send(BROWSER_IPC.pageCommand, worktree, command, at),
  getState: (worktree) => ipcRenderer.invoke(BROWSER_IPC.getState, worktree),
  onState: (listener) => listen(BROWSER_IPC.state, listener),
  onNotice: (listener) => listen(BROWSER_IPC.notice, listener),
  onContextMenu: (listener) => listen(BROWSER_IPC.contextMenu, listener),
  onFocusAddress: (listener) => listen(BROWSER_IPC.focusAddress, listener),
  watchPorts: (sessionId) => ipcRenderer.send(BROWSER_IPC.watchPorts, sessionId),
  unwatchPorts: (sessionId) => ipcRenderer.send(BROWSER_IPC.unwatchPorts, sessionId),
  onPorts: (listener) => listen(BROWSER_IPC.ports, listener),
  endListener: (sessionId, pid) => ipcRenderer.invoke(BROWSER_IPC.endListener, sessionId, pid)
}
