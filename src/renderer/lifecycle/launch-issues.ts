// Why a session's agent is not running, beyond what its phase says (phase 2a · A3/A8). The Exited card reads it
// to say "claude 未安装" or "项目目录不存在" instead of a bare "已退出". Not persisted; cleared on every launch.
import { create } from 'zustand'
import type { SessionId } from '@shared/types'

export type LaunchIssue =
  /** The launch script's `command -v` found no CLI on the login shell's PATH. */
  | { kind: 'missing-cli' }
  /** The session's directory does not exist (main refuses to start an agent in the home directory instead). */
  | { kind: 'cwd-missing'; path: string }
  /** The PTY could not be started for another reason. */
  | { kind: 'spawn-failed'; message: string }
  /** The agent process ended on its own with this exit code. */
  | { kind: 'agent-exit'; code: number }

export const useLaunchIssues = create<{ issues: Record<SessionId, LaunchIssue | undefined> }>(() => ({ issues: {} }))

export function reportLaunchIssue(sessionId: SessionId, issue: LaunchIssue): void {
  useLaunchIssues.setState((s) => ({ issues: { ...s.issues, [sessionId]: issue } }))
}

export function clearLaunchIssue(sessionId: SessionId): void {
  if (!useLaunchIssues.getState().issues[sessionId]) return
  useLaunchIssues.setState((s) => ({ issues: { ...s.issues, [sessionId]: undefined } }))
}

/** Error code main puts in front of a spawn failure message so the renderer can tell the cause (see main/pty). */
export const CWD_MISSING_CODE = 'TR_CWD_MISSING'

/** What a rejected `pty.spawn` means. Electron wraps the main-process message ("Error invoking remote method …"). */
export function issueFromSpawnError(error: unknown): LaunchIssue {
  const message = error instanceof Error ? error.message : String(error)
  const at = message.indexOf(`${CWD_MISSING_CODE}:`)
  if (at >= 0) return { kind: 'cwd-missing', path: message.slice(at + CWD_MISSING_CODE.length + 1).trim() }
  return { kind: 'spawn-failed', message }
}
