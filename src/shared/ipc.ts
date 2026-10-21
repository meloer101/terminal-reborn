// Contract between renderer (window.tr) and main / pty-host.
// The preload implements TrApi; main registers handlers for IPC channels.
// Changing a signature here is a cross-track change — note it in the PR.

import type { ActivitySummary, ConfirmOptions } from './lifecycle'
import type { BrowserApi } from './browser'
import type { ArchiveApi } from './archive'
import type { BackgroundReviewApi } from './background-review'
import type { PullRequestApi } from './pull-requests'
import type { ConflictRadarApi } from './conflict-radar'
import type { AgentEventEnvelope, HooksHealth, PendingPrompt, PermissionDecision, PromptResolution, SessionHooksSignal } from './agent-events'
import type { ContextHistory, SessionSpend, UsageAlert, UsageVendor, VendorUsage } from './session-meta'
import type { AppSettings, SettingsPatch } from './settings'
import type { MenuCommand } from './shortcuts'
import type { AgentKind, SessionId } from './types'
import type { DirEntry, FilePreview, GitStatusSnapshot, LineMarkRange, WorktreeChange } from './worktree-files'
import type { GitChanges, GitFileDiffRequest, GitLogPage, GitLogRequest } from './git-graph/log'
import type { GitWorktreeListing, WorktreeRemoveResult } from './git-worktrees'
import type { NewSessionInfo, WorktreeCreateRequest, WorktreeCreateResult } from './new-session'
import type { MergePrecheck, MergeRequest, MergeResult } from './git-merge'
import type { CapturedScript, RepoScripts, RunnableScript } from './repo-scripts'

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
  /**
   * Run one of the repository's approved scripts (PRD F4): 'setup' before the agent (or shell) starts, 'run' as the
   * terminal's only program. Main reads the script from `cwd`'s `.tr/settings.toml` and refuses one that is not
   * approved (RepoScriptsApi.approve).
   */
  script?: RunnableScript
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
  /**
   * Copies a dropped file that only the app may read (macOS's `TemporaryItems/NSIRD_*`, e.g. a screenshot thumbnail)
   * next to the pasted images and resolves to the copy; any other path comes back unchanged.
   */
  keepDroppedFile(path: string): Promise<string>
}

export interface UiApi {
  /** Native folder picker; resolves to an absolute path, or null when cancelled. */
  pickFolder(): Promise<string | null>
  /** Native picker for files and folders (several) opening in `defaultPath`; resolves to absolute paths, [] when cancelled. */
  pickFiles(defaultPath?: string): Promise<string[]>
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
  /**
   * Paths printed in a session's terminal (relative to the root, or absolute): for each, its relative path when it
   * is an existing file inside the worktree, else null. At most 64 per call.
   */
  resolveLinks(root: string, paths: readonly string[]): Promise<(string | null)[]>
  /** Opens in the default app (`shell.openPath`); resolves to '' or the system's error message. */
  open(root: string, path: string): Promise<string>
  /** Shows the item in Finder; '' opens the root folder itself. */
  reveal(root: string, path: string): void
  /** Starts / stops watching the worktree for this window; changes arrive through onChanged. */
  watch(root: string): void
  unwatch(root: string): void
  onChanged(listener: (change: WorktreeChange) => void): Unsubscribe
}

/** The right panel's Git view (PRD F6 / F17 Git · 图谱 + 变更). `root` is any worktree of the repo. */
export interface GitGraphApi {
  /** Whether a working git is installed (checked once; never runs the macOS install-prompt stub). */
  available(): Promise<boolean>
  /** One page of the commit graph plus refs and worktrees; null when `root` is not in a git repo. */
  log(request: GitLogRequest): Promise<GitLogPage | null>
  /** Cheap fingerprint of every ref and worktree HEAD; when it changes, reload the graph. '' when not a repo. */
  signature(root: string): Promise<string>
  /** `git fetch --all --prune` (never prompts); resolves to '' or git's error message. */
  fetch(root: string): Promise<string>
  /** Uncommitted and committed (vs `base`, a branch name) files of the worktree; null when not a repo. Rejects with git's message. */
  changes(root: string, base?: string): Promise<GitChanges | null>
  /** Unified diff text of one file. */
  fileDiff(request: GitFileDiffRequest): Promise<string>
}

/**
 * A project's git worktrees for the right panel's Worktree view (PRD F17). `root` must be one of the workspace's
 * project roots (main refuses anything else).
 */
export interface GitWorktreesApi {
  /**
   * Every worktree of the repository with uncommitted stats and ahead / behind its base; null when `root` is not in a
   * git repository. `knownPaths` (the workspace's worktree paths) come back resolved in `realPaths` for matching.
   * `only` (resolved paths) limits the per-worktree details to those; the others come back with `detailed: false`.
   */
  list(root: string, knownPaths: string[], only?: string[]): Promise<GitWorktreeListing | null>
  /** `git worktree remove`, refused whenever work could be lost; `force` only after git's submodule refusal. */
  remove(root: string, path: string, force: boolean): Promise<WorktreeRemoveResult>
  /** Starts / stops watching the repository's worktrees and branches for this window; changes arrive through onChanged. */
  watch(root: string): void
  unwatch(root: string): void
  /** The project at `root` gained, lost or moved a worktree or branch. */
  onChanged(listener: (root: string) => void): Unsubscribe
  /** What the new-session sheet needs about the project at `root` (PRD F4); `repo: false` outside a git repository. */
  newSessionInfo(root: string): Promise<NewSessionInfo>
  /** Fetches, then `git worktree add` on a new branch and copies the `.worktreeinclude` files (PRD F4). */
  create(request: WorktreeCreateRequest): Promise<WorktreeCreateResult>
  /** Whether `worktree`'s branch can be merged into its base, and what is in the way (PRD F4 预检). Rejects on bad input. */
  mergePrecheck(root: string, worktree: string): Promise<MergePrecheck>
  /** Merges the branch into its base (squash / merge / rebase), then optionally pushes the base to origin (PRD F4). */
  merge(request: MergeRequest): Promise<MergeResult>
}

/** What `.tr/settings.toml` of a worktree says (PRD F4 · 脚本与端口), plus the worktree's TR_PORT. */
export interface RepoScriptsInfo {
  scripts: RepoScripts
  /** What is wrong with the file (UI copy); empty when it is fine or missing. */
  problems: string[]
  /** First port of the worktree's block; null when every block is taken. */
  port: number | null
}

export type ScriptApproval =
  /** Approved now or earlier: spawn with `script` set. */
  | 'approved'
  /** The user said no in the confirmation sheet. */
  | 'declined'
  /** The file has no such script. */
  | 'none'

/** How a captured script (the merge test) ended. `code` is null when it was cancelled or did not start. */
export interface ScriptRunResult {
  code: number | null
  /** Tail of stdout and stderr, capped. */
  output: string
  cancelled: boolean
}

export interface RepoScriptsApi {
  /** The scripts of the worktree (or folder) at `dir`. Rejects on bad input. */
  get(dir: string): Promise<RepoScriptsInfo>
  /**
   * Makes sure the repository's scripts may run: the first time (and whenever they changed) main shows a confirmation
   * sheet listing every command and remembers the approved content per repository.
   */
  approve(dir: string, name: RunnableScript | CapturedScript): Promise<ScriptApproval>
  /**
   * Runs an approved captured script in `dir` (the merge `test`) and resolves when it exits. One run per directory;
   * cancelling resolves the in-flight call with `cancelled`.
   */
  run(dir: string, name: CapturedScript): Promise<ScriptRunResult>
  /** Stops the captured script running in `dir`, if any. */
  cancel(dir: string): Promise<void>
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
  /**
   * While a send is scheduled (恢复后发送“继续”, PRD F11) this window's timers keep full speed when it is hidden:
   * Chromium otherwise slows a hidden page's timers to about once a minute, and the send protocol polls the screen.
   */
  keepTimers(on: boolean): void
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
  /** The latest plan usage per vendor (account-level, kept across app runs; PRD F11). */
  getUsage(): Promise<VendorUsage[]>
  /** A vendor's plan usage changed (or was confirmed again after a while). */
  onUsage(listener: (usage: VendorUsage) => void): Unsubscribe
  /** A plan window crossed 75 / 90 / 100 % for the first time this period (sent to one window; Figma 18D). */
  onUsageAlert(listener: (alert: UsageAlert) => void): Unsubscribe
  /** Someone is looking at the usage (the popover opened): main asks the accounts now, within its own limits. */
  refreshUsage(): void
  /** The session's context over its turns, from the agent's transcript (null: nothing read yet). Figma 18A. */
  getContextHistory(sessionId: string): Promise<ContextHistory | null>
  /** Tokens each of the vendor's sessions spent since `since` (epoch ms), closed ones included. Figma 18B. */
  getUsageShares(vendor: UsageVendor, since: number): Promise<SessionSpend[]>
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
  git: GitGraphApi
  gitWorktrees: GitWorktreesApi
  /** The right panel's built-in browser and the session ports it lists (PRD F17 / F14); channels in BROWSER_IPC. */
  browser: BrowserApi
  /** `.tr/settings.toml` scripts and TR_PORT (PRD F4). */
  repoScripts: RepoScriptsApi
  /** Background code review (PRD F13); channels in REVIEW_IPC. */
  review: BackgroundReviewApi
  /** Archiving a worktree (PRD F15); channels in ARCHIVE_IPC. */
  archive: ArchiveApi
  /** PR / CI status and 创建 PR through the user's gh login (PRD F16); channels in PR_IPC. */
  pr: PullRequestApi
  /** Background pairwise / base merge-tree checks of active worktrees (冲突雷达); channels in RADAR_IPC. */
  radar: ConflictRadarApi
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
  filesKeepDropped: 'files:keep-dropped',
  uiPickFolder: 'ui:pick-folder',
  uiPickFiles: 'ui:pick-files',
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
  /** invoke → VendorUsage[] */
  agentGetUsage: 'agent:get-usage',
  /** main → every window, payload VendorUsage */
  agentUsage: 'agent:usage',
  /** main → one window, payload UsageAlert */
  agentUsageAlert: 'agent:usage-alert',
  /** renderer → main (send), no payload: poll the accounts now */
  agentRefreshUsage: 'agent:refresh-usage',
  /** invoke(sessionId) → ContextHistory | null */
  agentContextHistory: 'agent:context-history',
  /** invoke(vendor, since) → SessionSpend[] */
  agentUsageShares: 'agent:usage-shares',
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
  /** renderer → main, payload boolean */
  appKeepTimers: 'app:keep-timers',
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
  /** invoke(root, paths) → (string | null)[] */
  worktreeResolveLinks: 'worktree:resolve-links',
  worktreeOpen: 'worktree:open',
  worktreeReveal: 'worktree:reveal',
  worktreeWatch: 'worktree:watch',
  worktreeUnwatch: 'worktree:unwatch',
  /** main → renderer, payload WorktreeChange */
  worktreeChanged: 'worktree:changed',
  gitAvailable: 'git:available',
  gitLog: 'git:log',
  gitSignature: 'git:signature',
  gitFetch: 'git:fetch',
  gitChanges: 'git:changes',
  gitFileDiff: 'git:file-diff',
  /** invoke(root, knownPaths, only?) → GitWorktreeListing | null */
  gitWorktreesList: 'git-worktrees:list',
  /** invoke(root, path, force) → WorktreeRemoveResult */
  gitWorktreesRemove: 'git-worktrees:remove',
  gitWorktreesWatch: 'git-worktrees:watch',
  gitWorktreesUnwatch: 'git-worktrees:unwatch',
  /** main → renderer, payload root */
  gitWorktreesChanged: 'git-worktrees:changed',
  /** invoke(root) → NewSessionInfo */
  gitWorktreesNewSessionInfo: 'git-worktrees:new-session-info',
  /** invoke(WorktreeCreateRequest) → WorktreeCreateResult */
  gitWorktreesCreate: 'git-worktrees:create',
  /** invoke(root, worktree) → MergePrecheck */
  gitWorktreesMergePrecheck: 'git-worktrees:merge-precheck',
  /** invoke(MergeRequest) → MergeResult */
  gitWorktreesMerge: 'git-worktrees:merge',
  /** invoke(dir) → RepoScriptsInfo */
  repoScriptsGet: 'repo-scripts:get',
  /** invoke(dir, name) → ScriptApproval */
  repoScriptsApprove: 'repo-scripts:approve',
  /** invoke(dir, name) → ScriptRunResult */
  repoScriptsRun: 'repo-scripts:run',
  /** invoke(dir) → void. Stops the captured script in that directory. */
  repoScriptsCancel: 'repo-scripts:cancel'
} as const
