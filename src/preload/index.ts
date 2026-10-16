import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type PtyExit, type TerminalSnapshot, type TrApi } from '@shared/ipc'
import type { HostRestartedEvent } from '@shared/lifecycle'
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

function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload)
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
    ack: (sessionId, count) => ipcRenderer.send(IPC.ptyAck, sessionId, count),
    onData: (sessionId, listener) => dataListeners.add(sessionId, listener),
    onExit: (sessionId, listener) => exitListeners.add(sessionId, listener),
    onHostRestarted: (listener) => listen<HostRestartedEvent>(IPC.ptyHostRestarted, (event) => listener(event.sessionIds))
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file),
    saveTempImage: (data, extension) => ipcRenderer.invoke(IPC.filesSaveTempImage, data, extension)
  },
  ui: {
    pickFolder: () => ipcRenderer.invoke(IPC.uiPickFolder),
    setBadge: (count) => ipcRenderer.send(IPC.uiSetBadge, count),
    notify: (notification) => ipcRenderer.send(IPC.uiNotify, notification),
    onNotificationClick: (listener) => listen(IPC.uiNotificationClick, listener),
    openSettings: () => ipcRenderer.send(IPC.uiOpenSettings),
    onShowSettings: (listener) => listen(IPC.uiShowSettings, listener),
    confirm: (options) => ipcRenderer.invoke(IPC.uiConfirm, options),
    revealInFinder: (path) => ipcRenderer.send(IPC.uiRevealInFinder, path)
  },
  agent: {
    onEvent: (listener) => listen(IPC.agentEvent, listener),
    onPrompt: (listener) => listen(IPC.agentPrompt, listener),
    onPromptResolved: (listener) => listen(IPC.agentPromptResolved, listener),
    respondPermission: (promptId, decision) => ipcRenderer.send(IPC.agentRespondPermission, promptId, decision),
    getHooksHealth: () => ipcRenderer.invoke(IPC.agentGetHooksHealth),
    onHooksHealth: (listener) => listen(IPC.agentHooksHealth, listener),
    onSessionHooks: (listener) => listen(IPC.agentSessionHooks, listener)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    onChange: (listener) => listen(IPC.settingsChanged, listener),
    onSaveError: (listener) => listen(IPC.settingsSaveFailed, listener)
  },
  app: {
    version: String(ipcRenderer.sendSync(IPC.appVersion)),
    checkForUpdates: () => ipcRenderer.invoke(IPC.appCheckForUpdates),
    reportActivity: (summary) => ipcRenderer.send(IPC.appReportActivity, summary),
    detectAgents: () => ipcRenderer.invoke(IPC.appDetectAgents)
  },
  workspace: {
    loadSync: () => ipcRenderer.sendSync(IPC.workspaceLoad) as unknown,
    save: (data) => ipcRenderer.send(IPC.workspaceSave, data)
  },
  terminalSnapshots: {
    loadSync: (sessionId) => ipcRenderer.sendSync(IPC.terminalSnapshotLoad, sessionId) as TerminalSnapshot | null,
    save: (sessionId, snapshot) => ipcRenderer.send(IPC.terminalSnapshotSave, sessionId, snapshot),
    remove: (sessionId) => ipcRenderer.send(IPC.terminalSnapshotRemove, sessionId)
  }
}

contextBridge.exposeInMainWorld('tr', api)
