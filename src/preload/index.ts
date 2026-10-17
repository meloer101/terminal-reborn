import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type PtyExit, type TerminalSnapshot, type TrApi } from '@shared/ipc'
import type { HostRestartedEvent } from '@shared/lifecycle'
import { isMenuCommand } from '@shared/shortcuts'
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

const dataListeners = new Fanout<{ data: string; seq: number }>()
const exitListeners = new Fanout<PtyExit>()

ipcRenderer.on(IPC.ptyData, (_event, message: { sessionId: SessionId; data: string; seq: number }) => {
  dataListeners.emit(message.sessionId, message)
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
    live: () => ipcRenderer.invoke(IPC.ptyLive),
    attach: (sessionId) => ipcRenderer.invoke(IPC.ptyAttach, sessionId),
    write: (sessionId, data) => ipcRenderer.send(IPC.ptyWrite, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.ptyResize, sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.send(IPC.ptyKill, sessionId),
    ack: (sessionId, count) => ipcRenderer.send(IPC.ptyAck, sessionId, count),
    onData: (sessionId, listener) => dataListeners.add(sessionId, ({ data, seq }) => listener(data, seq)),
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
    onMenuCommand: (listener) => listen(IPC.uiMenuCommand, (command: unknown) => {
      if (isMenuCommand(command)) listener(command)
    }),
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
    detectAgents: () => ipcRenderer.invoke(IPC.appDetectAgents),
    userName: () => ipcRenderer.invoke(IPC.appUserName)
  },
  workspace: {
    loadSync: () => ipcRenderer.sendSync(IPC.workspaceLoad) as unknown,
    save: (data) => ipcRenderer.send(IPC.workspaceSave, data)
  },
  terminalSnapshots: {
    loadSync: (sessionId) => ipcRenderer.sendSync(IPC.terminalSnapshotLoad, sessionId) as TerminalSnapshot | null,
    save: (sessionId, snapshot) => ipcRenderer.send(IPC.terminalSnapshotSave, sessionId, snapshot),
    remove: (sessionId) => ipcRenderer.send(IPC.terminalSnapshotRemove, sessionId)
  },
  worktree: {
    listDir: (root, dir) => ipcRenderer.invoke(IPC.worktreeListDir, root, dir),
    readFile: (root, path) => ipcRenderer.invoke(IPC.worktreeReadFile, root, path),
    gitStatus: (root) => ipcRenderer.invoke(IPC.worktreeGitStatus, root),
    lineMarks: (root, path) => ipcRenderer.invoke(IPC.worktreeLineMarks, root, path),
    listFiles: (root) => ipcRenderer.invoke(IPC.worktreeListFiles, root),
    open: (root, path) => ipcRenderer.invoke(IPC.worktreeOpen, root, path),
    reveal: (root, path) => ipcRenderer.send(IPC.worktreeReveal, root, path),
    watch: (root) => ipcRenderer.send(IPC.worktreeWatch, root),
    unwatch: (root) => ipcRenderer.send(IPC.worktreeUnwatch, root),
    onChanged: (listener) => listen(IPC.worktreeChanged, listener)
  }
}

contextBridge.exposeInMainWorld('tr', api)
