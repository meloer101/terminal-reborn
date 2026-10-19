// How a session's agent is started inside the user's login shell (PRD §6.2).
// Pure: the pty-host supplies the shell and the real cwd.
import type { AgentKind } from './types'
import { isSafeAgentSessionId } from './workspace-file'

/** Single-quotes a word for POSIX shells. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** TOML basic string. */
export function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Argument vector for the agent CLI. Codex trust is granted per launch with `-c` overrides,
 * so nothing is written to `~/.codex`; the inline-table form is the one that works (spike §6).
 * Codex hooks are injected the same way: `-c hooks.<Event>=[…]` plus a `-c hooks.state={…trusted_hash…}`
 * that pins exactly those definitions as trusted (PRD §6.7), so no `~/.codex` write and no
 * `--dangerously-bypass-hook-trust`.
 * Claude has no such flag: its trust dialog is answered by the user in the terminal.
 * Claude's hooks are injected per launch with `--settings <file>` (PRD §6.2); the file holds hooks
 * only and Claude merges it with the user's own settings, so nothing global is written
 * (PRD §6.6). Note that a *second* `--settings` flag replaces this one, not merges.
 */
export interface AgentLaunchOptions {
  /** Hooks-only settings JSON for Claude (see src/main/hooks/settings.ts). */
  claudeSettingsPath?: string
  /** TOML `key=value` overrides for Codex, each passed as its own `-c` (see src/main/hooks/codex-config.ts). */
  codexConfig?: readonly string[]
  /**
   * Continue this earlier conversation instead of starting a new one: `claude --resume <id>` /
   * `codex resume <id>` (Codex 0.142.5 `codex resume [OPTIONS] [SESSION_ID]`). Ignored unless it is a safe id.
   */
  resumeAgentSessionId?: string
  /**
   * A command (sh / zsh / bash / fish syntax alike) to run first in the same login shell, e.g. the repository's setup
   * script (script-launch.ts `setupCommand`). The agent starts when it returns, whatever its exit code.
   */
  before?: string
}

export function agentArgv(kind: Exclude<AgentKind, 'shell'>, realCwd: string, options: AgentLaunchOptions = {}): string[] {
  const resumeId = isSafeAgentSessionId(options.resumeAgentSessionId) ? options.resumeAgentSessionId : undefined
  if (kind === 'claude') {
    return [
      'claude',
      ...(resumeId ? ['--resume', resumeId] : []),
      ...(options.claudeSettingsPath ? ['--settings', options.claudeSettingsPath] : [])
    ]
  }
  return [
    'codex',
    ...(resumeId ? ['resume', resumeId] : []),
    '-c',
    'check_for_update_on_startup=false',
    '-c',
    `projects={${tomlString(realCwd)}={trust_level="trusted"}}`,
    ...(options.codexConfig ?? []).flatMap((override) => ['-c', override])
  ]
}

/** OSC number the launch script uses to tell the terminal what became of the agent process. */
export const AGENT_MARKER_OSC = 7771

export type AgentMarker =
  /** The agent process ended (its exit code); the PTY now holds a plain login shell. */
  | { type: 'exit'; code: number }
  /** The CLI is not on the login shell's PATH. */
  | { type: 'missing' }

export function parseAgentMarker(payload: string): AgentMarker | null {
  if (payload === 'missing') return { type: 'missing' }
  const match = /^exit;(-?\d{1,3})$/.exec(payload)
  return match ? { type: 'exit', code: Number(match[1]) } : null
}

/**
 * Shell arguments that run the agent and then stay in an interactive login shell, so the
 * session survives the agent exiting (the user can re-run it or inspect the directory).
 * `-i` loads the user's rc files so version managers put the CLI on PATH.
 *
 * The script also reports what happened as an OSC marker (AGENT_MARKER_OSC): `missing` when the CLI is
 * not installed (phase 2 · A8 preflight: `command -v` in the same login shell that would run it) and
 * `exit;<code>` once the agent process is gone, so the app knows the shell prompt is back (A3).
 */
export function agentShellArgs(kind: AgentKind, realCwd: string, shell: string, options: AgentLaunchOptions = {}): string[] {
  const before = options.before ? `${options.before}; ` : ''
  if (kind === 'shell') return before ? ['-l', '-i', '-c', `${before}exec ${shellQuote(shell)} -l`] : ['-l']
  const line = agentArgv(kind, realCwd, options).map(shellQuote).join(' ')
  const marker = (payload: string) => `printf '\\033]${AGENT_MARKER_OSC};${payload}\\007'`
  const check = `command -v ${kind} >/dev/null 2>&1`
  const fish = /(?:^|\/)fish$/.test(shell)
  const script = fish
    ? `if ${check}; ${line}; ${marker('exit;%s')} $status; else; ${marker('missing')}; end`
    : `if ${check}; then ${line}; ${marker('exit;%s')} "$?"; else ${marker('missing')}; fi`
  return ['-l', '-i', '-c', `${before}${script}; exec ${shellQuote(shell)} -l`]
}
