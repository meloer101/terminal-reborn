// How a session's agent is started inside the user's login shell (PRD §4 F1 step 8,
// docs/spikes/send-protocol.md §6). Pure: the pty-host supplies the shell and the real cwd.
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
 * that pins exactly those definitions as trusted (docs/spikes/codex.md), so no `~/.codex` write and no
 * `--dangerously-bypass-hook-trust`.
 * Claude has no such flag: its trust dialog is answered by the user in the terminal.
 * Claude's hooks are injected per launch with `--settings <file>` (PRD §6.2); the file holds hooks
 * only and Claude merges it with the user's own settings, so nothing global is written
 * (docs/spikes/hooks.md). Note that a *second* `--settings` flag replaces this one, not merges.
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

/**
 * Shell arguments that run the agent and then stay in an interactive login shell, so the
 * session survives the agent exiting (the user can re-run it or inspect the directory).
 * `-i` loads the user's rc files so version managers put the CLI on PATH.
 */
export function agentShellArgs(kind: AgentKind, realCwd: string, shell: string, options: AgentLaunchOptions = {}): string[] {
  if (kind === 'shell') return ['-l']
  const line = agentArgv(kind, realCwd, options).map(shellQuote).join(' ')
  return ['-l', '-i', '-c', `${line}; exec ${shellQuote(shell)} -l`]
}
