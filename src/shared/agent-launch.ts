// How a session's agent is started inside the user's login shell (PRD §4 F1 step 8,
// docs/spikes/send-protocol.md §6). Pure: the pty-host supplies the shell and the real cwd.
import type { AgentKind } from './types'

/** Single-quotes a word for POSIX shells. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** TOML basic string. */
function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

/**
 * Argument vector for the agent CLI. Codex trust is granted per launch with `-c` overrides,
 * so nothing is written to `~/.codex`; the inline-table form is the one that works (spike §6).
 * Claude has no such flag: its trust dialog is answered by the user in the terminal.
 */
export function agentArgv(kind: Exclude<AgentKind, 'shell'>, realCwd: string): string[] {
  if (kind === 'claude') return ['claude']
  return [
    'codex',
    '-c',
    'check_for_update_on_startup=false',
    '-c',
    `projects={${tomlString(realCwd)}={trust_level="trusted"}}`
  ]
}

/**
 * Shell arguments that run the agent and then stay in an interactive login shell, so the
 * session survives the agent exiting (the user can re-run it or inspect the directory).
 * `-i` loads the user's rc files so version managers put the CLI on PATH.
 */
export function agentShellArgs(kind: AgentKind, realCwd: string, shell: string): string[] {
  if (kind === 'shell') return ['-l']
  const line = agentArgv(kind, realCwd).map(shellQuote).join(' ')
  return ['-l', '-i', '-c', `${line}; exec ${shellQuote(shell)} -l`]
}
