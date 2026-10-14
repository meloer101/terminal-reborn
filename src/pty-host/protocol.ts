// Messages exchanged between main (src/main/pty) and the pty-host utilityProcess.
import type { AgentKind } from '@shared/types'

export interface HostSpawnRequest {
  type: 'spawn'
  id: string
  cwd: string
  agent?: AgentKind
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** Hooks-only settings file for `claude --settings` (set by main/hooks). */
  claudeSettingsPath?: string
  cols: number
  rows: number
}

export type HostRequest =
  | HostSpawnRequest
  | { type: 'write'; id: string; data: string }
  | { type: 'resize'; id: string; cols: number; rows: number }
  | { type: 'kill'; id: string }
  /** The renderer finished parsing `count` UTF-16 units of output (flow control). */
  | { type: 'ack'; id: string; count: number }
  | { type: 'killAll' }

export type HostEvent =
  | { type: 'spawned'; id: string; pid: number }
  | { type: 'spawn-error'; id: string; message: string }
  | { type: 'data'; id: string; data: string }
  | { type: 'exit'; id: string; exitCode: number; signal?: number }
