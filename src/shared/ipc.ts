// Contract between renderer (window.tr) and main / pty-host.
// The preload implements TrApi; main registers handlers for IPC channels.
// Changing a signature here is a cross-track change — note it in the PR.

import type { ActivitySummary, ConfirmOptions } from './lifecycle'
import type { AgentEventEnvelope, PendingPrompt, PermissionDecision, PromptResolution } from './agent-events'
import type { AppSettings, SettingsPatch } from './settings'
import type { AgentKind, SessionId } from './types'

export type Unsubscribe = () => void

export interface PtySpawnOptions {
  sessionId: SessionId
  cwd: string
  /**
   * Start this agent inside the user's login shell (see agent-launch.ts). Ignored when
   * `command` is set; omitted or 'shell' gives a plain login shell.
   */
  agent?: AgentKind
  /** Defaults to the user's login shell. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cols: number
  rows: number
  /** Agent conversation to resume (`claude --resume` / `codex resume`) instead of starting a new one. */
  resumeAgentSessionId?: string
}

export interface PtyExit {
  exitCode: number
  signal?: number
}

export interface PtyApi {
  spawn(options: PtySpawnOptions): Promise<{ pid: number }>
  write(sessionId: SessionId, data: string): void
  resize(sessionId: SessionId, cols: number, rows: number): void
  kill(sessionId: SessionId): void
  /** Flow control: tells the PTY host how many UTF-16 units of output the terminal has finished parsing. */
  ack(sessionId: SessionId, count: number): void
  onData(sessionId: SessionId, listener: (data: string) => void): Unsubscribe
  onExit(sessionId: SessionId, listener: (exit: PtyExit) => void): Unsubscribe
  /**
   * The pty-host process died and was restarted: these sessions lost their terminal process (each
   * also got onExit with code -1). Respawn them with spawn() to recover.
   */
  onHostRestarted(listener: (sessionIds: SessionId[]) => void): Unsubscribe
}

export type ImageExtension = 'png' | 'jpg' | 'gif' | 'webp'

export interface FilesApi {
  /** Absolute path of a File from drag-and-drop or a file input. */
  pathForFile(file: File): string
  /** Writes pasted image bytes to a temp file and resolves to its absolute path. */
  saveTempImage(data: ArrayBuffer, extension: ImageExtension): Promise<string>
}

/** A native context-menu entry. Clicking an item resolves `popup()` with its id. */
export type MenuEntry =
  | {
      type: 'item'
      id: string
      label: string
      enabled?: boolean
      /** Shortcut shown next to the label (display only, e.g. 'CmdOrCtrl+N'); the renderer handles the key. */
      accelerator?: string
    }
  | { type: 'submenu'; label: string; items: MenuEntry[] }
  | { type: 'separator' }

export interface UiApi {
  /** Native folder picker; resolves to an absolute path, or null when cancelled. */
  pickFolder(): Promise<string | null>
  /** Native context menu at the cursor; resolves to the chosen item id, or null when dismissed. */
  popupMenu(entries: MenuEntry[]): Promise<string | null>
  /** Dock badge; 0 clears it. */
  setBadge(count: number): void
  /** System notification. Clicking it focuses the window and fires onNotificationClick with `tag`. */
  notify(notification: { title: string; body: string; tag: string }): void
  onNotificationClick(listener: (tag: string) => void): Unsubscribe
  /** Opens (or focuses) the settings window (⌘,). */
  openSettings(): void
  /** Reveals a file or folder in Finder. Absolute paths only. */
  revealInFinder(path: string): void
  /** Native confirmation sheet; resolves to true when the user picked the confirm button. */
  confirm(options: ConfirmOptions): Promise<boolean>
}

export interface SettingsApi {
  get(): Promise<AppSettings>
  /** Merges and persists; resolves to the sanitized result. Every window gets onChange. */
  update(patch: SettingsPatch): Promise<AppSettings>
  onChange(listener: (settings: AppSettings) => void): Unsubscribe
}

export interface UpdateInfo {
  version: string
  /** Release page to open in the browser. */
  url: string
  notes?: string
}

export interface AppInfoApi {
  /** package.json version of the running app. */
  version: string
  /** Latest GitHub release if newer than the running version, else null. Never throws. */
  checkForUpdates(): Promise<UpdateInfo | null>
  /** Live-work summary for the quit confirmation; send whenever the active-session count changes. */
  reportActivity(summary: ActivitySummary): void
}

export interface AgentApi {
  /** Every normalized hook event from every agent session. */
  onEvent(listener: (envelope: AgentEventEnvelope) => void): Unsubscribe
  /** A permission request or question the UI can answer. */
  onPrompt(listener: (prompt: PendingPrompt) => void): Unsubscribe
  onPromptResolved(listener: (resolution: PromptResolution) => void): Unsubscribe
  /** Answers a pending permission prompt (releases the blocked hook). Unknown ids are ignored. */
  respondPermission(promptId: string, decision: PermissionDecision): void
}

export interface TrApi {
  platform: string
  /** User's home directory, for default cwd. */
  homeDir: string
  pty: PtyApi
  files: FilesApi
  ui: UiApi
  agent: AgentApi
  settings: SettingsApi
  app: AppInfoApi
}

export const IPC = {
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyAck: 'pty:ack',
  /** main → renderer, payload { sessionId, data } */
  ptyData: 'pty:data',
  /** main → renderer, payload { sessionId, exit } */
  ptyExit: 'pty:exit',
  /** main → renderer, payload HostRestartedEvent */
  ptyHostRestarted: 'pty:host-restarted',
  filesSaveTempImage: 'files:save-temp-image',
  uiPickFolder: 'ui:pick-folder',
  uiPopupMenu: 'ui:popup-menu',
  uiSetBadge: 'ui:set-badge',
  uiNotify: 'ui:notify',
  /** main → renderer, payload tag */
  uiNotificationClick: 'ui:notification-click',
  /** main → renderer, payload AgentEventEnvelope */
  agentEvent: 'agent:event',
  /** main → renderer, payload PendingPrompt */
  agentPrompt: 'agent:prompt',
  /** main → renderer, payload PromptResolution */
  agentPromptResolved: 'agent:prompt-resolved',
  agentRespondPermission: 'agent:respond-permission',
  uiOpenSettings: 'ui:open-settings',
  uiRevealInFinder: 'ui:reveal-in-finder',
  uiConfirm: 'ui:confirm',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  /** main → every window, payload AppSettings */
  settingsChanged: 'settings:changed',
  /** sync: returns the app version */
  appVersion: 'app:version',
  appCheckForUpdates: 'app:check-for-updates',
  appReportActivity: 'app:report-activity'
} as const
