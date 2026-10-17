// Messages exchanged between main (src/main/pty) and the process that owns the PTYs: the pty daemon
// (src/pty-daemon, over a Unix socket) or, as a fallback, the pty-host utilityProcess (over parentPort).
import type { AgentKind } from '@shared/types'

export interface HostSpawnRequest {
  type: 'spawn'
  id: string
  cwd: string
  agent?: AgentKind
  command?: string
  args?: string[]
  env?: Record<string, string>
  /**
   * The app's environment, used as the PTY's base environment instead of the host's own. A daemon started
   * days ago must not hand new shells a stale PATH.
   */
  baseEnv?: Record<string, string>
  /** Hooks-only settings file for `claude --settings` (set by main/hooks). */
  claudeSettingsPath?: string
  /** `-c` override values for `codex` (hook definitions + trust pins, set by main/hooks). */
  codexConfig?: string[]
  /** Relaunch the agent into this earlier conversation (see agent-launch.ts). */
  resumeAgentSessionId?: string
  cols: number
  rows: number
}

/** A live session's screen as the host's headless mirror sees it (see headless-mirror.ts). */
export interface HostScreen {
  /** SerializeAddon output: scrollback + screen; an active alternate screen comes after `\x1b[?1049h\x1b[H`. */
  data: string
  cols: number
  rows: number
  /** Escape sequences that put the program's input modes (mouse, bracketed paste, …) back. */
  modes: string
  /** Last OSC 0/2 title. */
  title?: string
}

/** A hook event the pty daemon answered itself because no app was attached to the session (PRD §6.8). */
export interface HookJournalEntry {
  event: string
  agent: 'claude' | 'codex'
  /** Parsed body; null when it was too large to keep. */
  payload: unknown
  at: number
}

/** One session the host holds, as listed for a client that (re)connects. */
export interface HostSessionInfo {
  id: string
  pid: number
  agent?: AgentKind
  /** Set when the process exited while no client was attached (the session is kept to show its last screen). */
  exit?: { exitCode: number; signal?: number }
}

export type HostRequest =
  | HostSpawnRequest
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'kill'; id: string }
  /** The renderer finished parsing `count` UTF-16 units of output (flow control). */
  | { type: 'ack'; id: string; count: number }
  /** Stream this session to the client again, starting with a snapshot of its screen. */
  | { type: 'attach'; id: string }
  /** Stop streaming this session; it keeps running. */
  | { type: 'detach'; id: string }
  /** Answered with `sessions`. */
  | { type: 'list' }
  | { type: 'killAll' }

export type HostEvent =
  | { type: 'spawned'; id: string; pid: number }
  | { type: 'spawn-error'; id: string; message: string }
  /** `seq`: the session's output position (UTF-16 units) at the end of this chunk. */
  | { type: 'data'; id: string; data: string; seq: number }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }
  /** Answer to `attach`: everything up to `seq` is in `screen`; data events after it continue the stream. */
  | {
      type: 'attached'
      id: string
      pid: number
      agent?: AgentKind
      seq: number
      screen: HostScreen
      exit?: { exitCode: number; signal?: number }
      /** Hook events missed while detached, oldest first (filled in by the daemon). */
      hooks?: HookJournalEntry[]
    }
  | { type: 'attach-miss'; id: string }
  | { type: 'sessions'; sessions: HostSessionInfo[] }
