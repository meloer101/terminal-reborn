// Contract between renderer (window.tr) and main / pty-host.
// The preload implements TrApi; main registers handlers for IPC channels.
// Changing a signature here is a cross-track change — note it in the PR.

import type { ActivitySummary, ConfirmOptions } from './lifecycle'
import type { AgentEventEnvelope, HooksHealth, PendingPrompt, PermissionDecision, PromptResolution, SessionHooksSignal } from './agent-events'
import type { AppSettings, SettingsPatch } from './settings'
import type { MenuCommand } from './shortcuts'
import type { AgentKind, SessionId } from './types'
import type { DirEntry, FilePreview, GitStatusSnapshot, LineMarkRange, WorktreeChange } from './worktree-files'
import type { GitWorktreeListing, WorktreeRemoveResult } from './git-worktrees'

export type { ActivitySummary, ConfirmOptions } from './lifecycle'

export type Unsubscribe = () => void

export interface PtySpawnOptions {
  sessionId: SessionId
  cwd: string
  /**
   * Start this agent inside the user's login shell (see agent-launch.ts). Ignored when
   * `command` is set; omitted or 'shell' gives a plain login shell.
   */
  agent?: AgentKind
  /** Relaunch the agent into this earlier conversation (`claude --resume <id>` / `codex resume <id>`). */
  resumeAgentSessionId?: string
  /** Defaults to the user's login shell. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cols: number
  rows: number
}

export interface PtyExit {
  exitCode: number
  signal?: number
}

/** A live session's screen from the pty daemon's mirror (PRD §6.8). */
export interface PtyScreen {
  /** xterm SerializeAddon output; an active alternate screen follows `\x1b[?1049h\x1b[H`. */
  data: string
  cols: number
  rows: number
  /** Escape sequences that restore the program's input modes (mouse reporting, bracketed paste, …). */
  modes: string
  title?: string
}

/** Reattaching to a process that kept running while the app was closed (or the window reloaded). */
export interface PtyAttachResult {
  pid: number
  /** Output position the screen covers; onData chunks whose seq is not past it are already in the screen. */
  seq: number
  screen: PtyScreen
  /** The process ended while detached: the screen is its last one. */
  exit?: PtyExit
}

/** A session the pty daemon holds that no window has attached yet. */
export interface LivePtySession {
  sessionId: SessionId
  pid: number
  agent?: AgentKind
  /** Ended while detached; attach() shows its last screen once. */
  exited: boolean
}

export interface PtyApi {
  spawn(options: PtySpawnOptions): Promise<{ pid: number }>
  /** Sessions still running in the pty daemon from before this window loaded (empty without the daemon). */
  live(): Promise<LivePtySession[]>
  /** Streams a live session to this window again; null when there is nothing to attach to (then spawn). */
  attach(sessionId: SessionId): Promise<PtyAttachResult | null>
  write(sessionId: SessionId, data: string): void
  resize(sessionId: SessionId, cols: number, rows: number): void
  kill(sessionId: SessionId): void
  /** Flow control: tells the PTY host how many UTF-16 units of output the terminal has finished parsing. */
  ack(sessionId: SessionId, count: number): void
  /** `seq`: the session's output position at the end of `data` (see PtyAttachResult.seq). */
  onData(sessionId: SessionId, listener: (data: string, seq: number) => void): Unsubscribe
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

export interface UiApi {
  /** Native folder picker; resolves to an absolute path, or null when cancelled. */
  pickFolder(): Promise<string | null>
  /** Dock badge; 0 clears it. */
  setBadge(count: number): void
  /** System notification. Clicking it focuses the window and fires onNotificationClick with `tag`. */
  notify(notification: { title: string; body: string; tag: string }): void
  onNotificationClick(listener: (tag: string) => void): Unsubscribe
  /** Shows the settings dialog in this window (same as ⌘,). */
  openSettings(): void
  /** ⌘, from the app menu: show the settings dialog. */
  onShowSettings(listener: () => void): Unsubscribe
  /** A command picked in the app menu (or its shortcut, when the menu took the key). */
  onMenuCommand(listener: (command: MenuCommand) => void): Unsubscribe
  /** Reveals a file or folder in Finder. Absolute paths only. */
  revealInFinder(path: string): void
  /** Native confirmation sheet; resolves to true when the user picked the confirm button. */
  confirm(options: ConfirmOptions): Promise<boolean>
}

/**
 * A worktree's files for the right panel's 文件 view (PRD F17). `root` is the worktree's absolute path; every
 * `path` is POSIX and relative to it ('' = the root). Main rejects anything that resolves outside the root.
 */
export interface WorktreeFilesApi {
  /** One directory level, sorted (folders first); `.git` is left out. */
  listDir(root: string, dir: string): Promise<DirEntry[]>
  /** A read-only preview: text up to MAX_PREVIEW_BYTES, otherwise binary / too-large / missing. */
  readFile(root: string, path: string): Promise<FilePreview>
  /** `git status` of the worktree; null when it is not a git checkout. */
  gitStatus(root: string): Promise<GitStatusSnapshot | null>
  /** Lines of the file that differ from HEAD (empty when unknown). */
  lineMarks(root: string, path: string): Promise<LineMarkRange[]>
  /** Every file that is not ignored (tracked + untracked), for the filter; capped at MAX_LISTED_FILES. */
  listFiles(root: string): Promise<string[]>
  /** Opens in the default app (`shell.openPath`); resolves to '' or the system's error message. */
  open(root: string, path: string): Promise<string>
  /** Shows the item in Finder; '' opens the root folder itself. */
  reveal(root: string, path: string): void
  /** Starts / stops watching the worktree for this window; changes arrive through onChanged. */
  watch(root: string): void
  unwatch(root: string): void
  onChanged(listener: (change: WorktreeChange) => void): Unsubscribe
}

/** A project's git worktrees for the right panel's Worktree view (PRD F17). `root` is the project's absolute path. */
export interface GitWorktreesApi {
  /**
   * Every worktree of the repository with uncommitted stats and ahead / behind its base; null when `root` is not in a
   * git repository. `knownPaths` (the workspace's worktree paths) come back resolved in `realPaths` for matching.
   */
  list(root: string, knownPaths: string[]): Promise<GitWorktreeListing | null>
  /** `git worktree remove` (never the main checkout, never with uncommitted changes); `force` only after a second confirmation. */
  remove(root: string, path: string, force: boolean): Promise<WorktreeRemoveResult>
}

/** Main-owned workspace persistence (phase 2 · A12). The payload is the renderer's versioned workspace JSON. */
export interface WorkspaceStoreApi {
  /** Synchronous read at startup (null when nothing is stored yet). */
  loadSync(): unknown
  /** Debounced, atomic write in main. */
  save(data: unknown): void
}

/** What a terminal last showed, saved so a reopened session paints at once while its process starts again. */
export interface TerminalSnapshot {
  cols: number
  rows: number
  /** xterm SerializeAddon output (no modes). */
  data: string
}

/** Main-owned terminal snapshots: `<userData>/terminal-snapshots/`. */
export interface TerminalSnapshotApi {
  /** Synchronous so the snapshot can be painted in the same frame the terminal opens (null when none). */
  loadSync(sessionId: string): TerminalSnapshot | null
  save(sessionId: string, snapshot: TerminalSnapshot): void
  remove(sessionId: string): void
}

export interface SettingsApi {
  get(): Promise<AppSettings>
  /** Merges and persists; resolves to the sanitized result. Every window gets onChange. */
  update(patch: SettingsPatch): Promise<AppSettings>
  onChange(listener: (settings: AppSettings) => void): Unsubscribe
  /** A settings write failed (disk full, permissions, …); the change is applied in memory but not saved. */
  onSaveError(listener: (error: SettingsSaveError) => void): Unsubscribe
}

export interface SettingsSaveError {
  /** English diagnostic (errno message), not UI copy. */
  message: string
}

export interface UpdateInfo {
  version: string
  /** Release page to open in the browser. */
  url: string
  notes?: string
}

/** Whether each agent CLI is on the user's login-shell PATH (first-run screen, B10). */
export interface AgentAvailability {
  claude: boolean
  codex: boolean
}

export interface AppInfoApi {
  /** package.json version of the running app. */
  version: string
  /** Latest GitHub release if newer than the running version, else null. Never throws. */
  checkForUpdates(): Promise<UpdateInfo | null>
  /** Keeps main informed about live sessions (quit confirmation). */
  reportActivity(summary: ActivitySummary): void
  /** Which agent CLIs are installed. Never throws (a failed check reports both as missing). */
  detectAgents(): Promise<AgentAvailability>
  /** The account's full name for the welcome greeting (PRD F18); '' when unknown. Never throws. */
  userName(): Promise<string>
}

export interface AgentApi {
  /** Every normalized hook event from every agent session. */
  onEvent(listener: (envelope: AgentEventEnvelope) => void): Unsubscribe
  /** A permission request or question the UI can answer. */
  onPrompt(listener: (prompt: PendingPrompt) => void): Unsubscribe
  onPromptResolved(listener: (resolution: PromptResolution) => void): Unsubscribe
  /** Answers a pending permission prompt (releases the blocked hook). Unknown ids are ignored. */
  respondPermission(promptId: string, decision: PermissionDecision): void
  /** Current state of the hook server; pair with onHooksHealth, which only fires on changes. */
  getHooksHealth(): Promise<HooksHealth>
  onHooksHealth(listener: (health: HooksHealth) => void): Unsubscribe
  /** Per-session: launched without hooks, or no hook event within SESSION_START_TIMEOUT_MS of launch. */
  onSessionHooks(listener: (signal: SessionHooksSignal) => void): Unsubscribe
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
  workspace: WorkspaceStoreApi
  terminalSnapshots: TerminalSnapshotApi
  worktree: WorktreeFilesApi
  gitWorktrees: GitWorktreesApi
}

export const IPC = {
  ptySpawn: 'pty:spawn',
  /** invoke → LivePtySession[] */
  ptyLive: 'pty:live',
  /** invoke(sessionId) → PtyAttachResult | null */
  ptyAttach: 'pty:attach',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyAck: 'pty:ack',
  /** main → renderer, payload { sessionId, data, seq } */
  ptyData: 'pty:data',
  /** main → renderer, payload { sessionId, exit } */
  ptyExit: 'pty:exit',
  /** main → renderer, payload HostRestartedEvent */
  ptyHostRestarted: 'pty:host-restarted',
  filesSaveTempImage: 'files:save-temp-image',
  uiPickFolder: 'ui:pick-folder',
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
  /** invoke → HooksHealth */
  agentGetHooksHealth: 'agent:get-hooks-health',
  /** main → renderer, payload HooksHealth (on change) */
  agentHooksHealth: 'agent:hooks-health',
  /** main → renderer, payload SessionHooksSignal */
  agentSessionHooks: 'agent:session-hooks',
  uiOpenSettings: 'ui:open-settings',
  /** main → renderer: show the settings dialog */
  uiShowSettings: 'ui:show-settings',
  /** main → renderer, payload MenuCommand */
  uiMenuCommand: 'ui:menu-command',
  uiRevealInFinder: 'ui:reveal-in-finder',
  uiConfirm: 'ui:confirm',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  /** main → every window, payload AppSettings */
  settingsChanged: 'settings:changed',
  /** main → every window, payload SettingsSaveError */
  settingsSaveFailed: 'settings:save-failed',
  /** sync: returns the app version */
  appVersion: 'app:version',
  appCheckForUpdates: 'app:check-for-updates',
  appReportActivity: 'app:report-activity',
  /** invoke → AgentAvailability */
  appDetectAgents: 'app:detect-agents',
  appUserName: 'app:user-name',
  /** sync */
  workspaceLoad: 'workspace:load',
  workspaceSave: 'workspace:save',
  /** sync */
  terminalSnapshotLoad: 'terminal-snapshot:load',
  terminalSnapshotSave: 'terminal-snapshot:save',
  terminalSnapshotRemove: 'terminal-snapshot:remove',
  worktreeListDir: 'worktree:list-dir',
  worktreeReadFile: 'worktree:read-file',
  worktreeGitStatus: 'worktree:git-status',
  worktreeLineMarks: 'worktree:line-marks',
  worktreeListFiles: 'worktree:list-files',
  worktreeOpen: 'worktree:open',
  worktreeReveal: 'worktree:reveal',
  worktreeWatch: 'worktree:watch',
  worktreeUnwatch: 'worktree:unwatch',
  /** main → renderer, payload WorktreeChange */
  worktreeChanged: 'worktree:changed',
  /** invoke(root, knownPaths) → GitWorktreeListing | null */
  gitWorktreesList: 'git-worktrees:list',
  /** invoke(root, path, force) → WorktreeRemoveResult */
  gitWorktreesRemove: 'git-worktrees:remove'
} as const
