// Contract between renderer (window.tr) and main / pty-host.
// The preload implements TrApi; main registers handlers for IPC channels.
// Changing a signature here is a cross-track change — note it in the PR.

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
  | { type: 'item'; id: string; label: string; enabled?: boolean }
  | { type: 'submenu'; label: string; items: MenuEntry[] }
  | { type: 'separator' }

export interface UiApi {
  /** Native folder picker; resolves to an absolute path, or null when cancelled. */
  pickFolder(): Promise<string | null>
  /** Native context menu at the cursor; resolves to the chosen item id, or null when dismissed. */
  popupMenu(entries: MenuEntry[]): Promise<string | null>
}

export interface TrApi {
  platform: string
  /** User's home directory, for default cwd. */
  homeDir: string
  pty: PtyApi
  files: FilesApi
  ui: UiApi
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
  filesSaveTempImage: 'files:save-temp-image',
  uiPickFolder: 'ui:pick-folder',
  uiPopupMenu: 'ui:popup-menu'
} as const
