import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { ARCHIVE_IPC } from '@shared/archive'
import { REVIEW_IPC } from '@shared/background-review'
import { PR_IPC } from '@shared/pull-requests'
import { RADAR_IPC } from '@shared/conflict-radar'
import { DISPATCH_IPC } from '@shared/dispatch'
import { IPC, type PtyExit, type TerminalSnapshot, type TrApi } from '@shared/ipc'
import type { HostRestartedEvent } from '@shared/lifecycle'
import { isMenuCommand } from '@shared/shortcuts'
import { isSecondaryKey } from '@shared/window-layout'
import type { SessionId } from '@shared/types'
import { browserApi } from './browser'

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
    saveTempImage: (data, extension) => ipcRenderer.invoke(IPC.filesSaveTempImage, data, extension),
    keepDroppedFile: (path) => ipcRenderer.invoke(IPC.filesKeepDropped, path)
  },
  ui: {
    pickFolder: () => ipcRenderer.invoke(IPC.uiPickFolder),
    pickFiles: (defaultPath) => ipcRenderer.invoke(IPC.uiPickFiles, defaultPath),
    setBadge: (count) => ipcRenderer.send(IPC.uiSetBadge, count),
    notify: (notification) => ipcRenderer.send(IPC.uiNotify, notification),
    onNotificationClick: (listener) => listen(IPC.uiNotificationClick, listener),
    openSettings: () => ipcRenderer.send(IPC.uiOpenSettings),
    onShowSettings: (listener) => listen(IPC.uiShowSettings, listener),
    onMenuCommand: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, command: unknown, windowKey: unknown) => {
        if (isMenuCommand(command)) listener(command, isSecondaryKey(windowKey) ? windowKey : undefined)
      }
      ipcRenderer.on(IPC.uiMenuCommand, handler)
      return () => {
        ipcRenderer.removeListener(IPC.uiMenuCommand, handler)
      }
    },
    focusWindow: (key) => ipcRenderer.send(IPC.uiWindowFocus, key),
    closeWindow: (key) => ipcRenderer.send(IPC.uiWindowClose, key),
    onWindowCloseRequest: (listener) => listen(IPC.uiWindowCloseRequest, (key: unknown) => {
      if (isSecondaryKey(key)) listener(key)
    }),
    onWindowState: (listener) => listen(IPC.uiWindowState, listener),
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
    onSessionHooks: (listener) => listen(IPC.agentSessionHooks, listener),
    getUsage: () => ipcRenderer.invoke(IPC.agentGetUsage),
    onUsage: (listener) => listen(IPC.agentUsage, listener),
    onUsageAlert: (listener) => listen(IPC.agentUsageAlert, listener),
    refreshUsage: () => ipcRenderer.send(IPC.agentRefreshUsage),
    getContextHistory: (sessionId) => ipcRenderer.invoke(IPC.agentContextHistory, sessionId),
    getUsageShares: (vendor, since) => ipcRenderer.invoke(IPC.agentUsageShares, vendor, since)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
    importTheme: () => ipcRenderer.invoke(IPC.settingsImportTheme),
    onChange: (listener) => listen(IPC.settingsChanged, listener),
    onSaveError: (listener) => listen(IPC.settingsSaveFailed, listener)
  },
  app: {
    version: String(ipcRenderer.sendSync(IPC.appVersion)),
    checkForUpdates: () => ipcRenderer.invoke(IPC.appCheckForUpdates),
    reportActivity: (summary) => ipcRenderer.send(IPC.appReportActivity, summary),
    keepTimers: (on) => ipcRenderer.send(IPC.appKeepTimers, on),
    detectAgents: () => ipcRenderer.invoke(IPC.appDetectAgents),
    agentVersions: () => ipcRenderer.invoke(IPC.appAgentVersions),
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
    resolveLinks: (root, paths) => ipcRenderer.invoke(IPC.worktreeResolveLinks, root, paths),
    open: (root, path) => ipcRenderer.invoke(IPC.worktreeOpen, root, path),
    reveal: (root, path) => ipcRenderer.send(IPC.worktreeReveal, root, path),
    watch: (root) => ipcRenderer.send(IPC.worktreeWatch, root),
    unwatch: (root) => ipcRenderer.send(IPC.worktreeUnwatch, root),
    onChanged: (listener) => listen(IPC.worktreeChanged, listener)
  },
  git: {
    available: () => ipcRenderer.invoke(IPC.gitAvailable),
    log: (request) => ipcRenderer.invoke(IPC.gitLog, request),
    signature: (root) => ipcRenderer.invoke(IPC.gitSignature, root),
    fetch: (root) => ipcRenderer.invoke(IPC.gitFetch, root),
    changes: (root, base) => ipcRenderer.invoke(IPC.gitChanges, root, base),
    fileDiff: (request) => ipcRenderer.invoke(IPC.gitFileDiff, request)
  },
  gitWorktrees: {
    list: (root, knownPaths, only) => ipcRenderer.invoke(IPC.gitWorktreesList, root, knownPaths, only),
    remove: (root, path, force) => ipcRenderer.invoke(IPC.gitWorktreesRemove, root, path, force),
    watch: (root) => ipcRenderer.send(IPC.gitWorktreesWatch, root),
    unwatch: (root) => ipcRenderer.send(IPC.gitWorktreesUnwatch, root),
    onChanged: (listener) => listen(IPC.gitWorktreesChanged, listener),
    newSessionInfo: (root) => ipcRenderer.invoke(IPC.gitWorktreesNewSessionInfo, root),
    create: (request) => ipcRenderer.invoke(IPC.gitWorktreesCreate, request),
    mergePrecheck: (root, worktree) => ipcRenderer.invoke(IPC.gitWorktreesMergePrecheck, root, worktree),
    merge: (request) => ipcRenderer.invoke(IPC.gitWorktreesMerge, request)
  },
  browser: browserApi,
  repoScripts: {
    get: (dir) => ipcRenderer.invoke(IPC.repoScriptsGet, dir),
    approve: (dir, name) => ipcRenderer.invoke(IPC.repoScriptsApprove, dir, name),
    run: (dir, name) => ipcRenderer.invoke(IPC.repoScriptsRun, dir, name),
    cancel: (dir) => ipcRenderer.invoke(IPC.repoScriptsCancel, dir)
  },
  review: {
    start: (request) => ipcRenderer.invoke(REVIEW_IPC.start, request),
    cancel: (root) => ipcRenderer.send(REVIEW_IPC.cancel, root),
    turnStarted: (root) => ipcRenderer.send(REVIEW_IPC.turnStarted, root),
    turnEnded: (root, agent) => ipcRenderer.send(REVIEW_IPC.turnEnded, root, agent),
    latest: (root) => ipcRenderer.invoke(REVIEW_IPC.latest, root),
    dismiss: (root, keys, undo = false) => ipcRenderer.send(REVIEW_IPC.dismiss, root, keys, undo),
    onStatus: (listener) => listen(REVIEW_IPC.status, listener)
  },
  archive: {
    capture: (root, worktree, id) => ipcRenderer.invoke(ARCHIVE_IPC.capture, root, worktree, id),
    restore: (request) => ipcRenderer.invoke(ARCHIVE_IPC.restore, request)
  },
  pr: {
    gh: () => ipcRenderer.invoke(PR_IPC.gh),
    onGh: (listener) => listen(PR_IPC.ghChanged, listener),
    watch: (targets) => ipcRenderer.send(PR_IPC.watch, targets),
    refresh: (worktree) => ipcRenderer.send(PR_IPC.refresh, worktree),
    statuses: () => ipcRenderer.invoke(PR_IPC.statuses),
    onStatus: (listener) => listen(PR_IPC.status, listener),
    create: (request) => ipcRenderer.invoke(PR_IPC.create, request),
    draft: (target) => ipcRenderer.invoke(PR_IPC.draft, target),
    commit: (request) => ipcRenderer.invoke(PR_IPC.commit, request),
    push: (target) => ipcRenderer.invoke(PR_IPC.push, target),
    write: (request) => ipcRenderer.invoke(PR_IPC.write, request),
    cancelWrite: (worktree) => ipcRenderer.send(PR_IPC.cancelWrite, worktree),
    failure: (worktree) => ipcRenderer.invoke(PR_IPC.failure, worktree),
    merge: (request) => ipcRenderer.invoke(PR_IPC.merge, request),
    cancelMerge: (target) => ipcRenderer.invoke(PR_IPC.cancelMerge, target),
    resolveThreads: (request) => ipcRenderer.invoke(PR_IPC.resolveThreads, request),
    postReview: (request) => ipcRenderer.invoke(PR_IPC.postReview, request)
  },
  radar: {
    watch: (targets) => ipcRenderer.send(RADAR_IPC.watch, targets),
    reports: () => ipcRenderer.invoke(RADAR_IPC.reports),
    onReport: (listener) => listen(RADAR_IPC.report, listener)
  },
  dispatch: {
    onRequest: (listener) => listen(DISPATCH_IPC.request, listener),
    reply: (callId, result) => ipcRenderer.send(DISPATCH_IPC.reply, callId, result),
    deliver: (request) => ipcRenderer.invoke(DISPATCH_IPC.deliver, request)
  }
}

contextBridge.exposeInMainWorld('tr', api)
