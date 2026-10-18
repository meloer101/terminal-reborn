// How a repository's scripts (repo-scripts.ts) run in a terminal (PRD F4). Pure shell text; main puts it into the
// PTY's launch arguments. Scripts are POSIX sh (`/bin/sh -e`, stop at the first failing command) whatever the user's
// own shell is; they still run inside the user's interactive login shell, so its PATH (nvm, Homebrew, …) applies.
import { shellQuote } from './agent-launch'

/** OSC number the setup runner reports through (the agent's own markers use AGENT_MARKER_OSC). */
export const SCRIPT_MARKER_OSC = 7772

export type ScriptMarker =
  /** The setup script ended with this exit code (non-zero: the runner now waits for ↵ before going on). */
  | { type: 'setup-exit'; code: number }
  /** The runner is done; the agent (or the shell) starts next. */
  | { type: 'setup-done' }

export const SETUP_DONE_PAYLOAD = 'setup-done'

export function parseScriptMarker(payload: string): ScriptMarker | null {
  if (payload === SETUP_DONE_PAYLOAD) return { type: 'setup-done' }
  const match = /^setup;(\d{1,3})$/.exec(payload)
  return match ? { type: 'setup-exit', code: Number(match[1]) } : null
}

/**
 * Runs the setup script ($1) and reports how it went. A failure (or ⌃C, which only stops the script) waits for ↵ so
 * its output can be read before the agent's TUI takes the screen; the strip under the session sends that ↵ too.
 */
const SETUP_RUNNER = [
  'trap : INT',
  `printf '\\033[2m[运行 setup 脚本 · .tr/settings.toml]\\033[0m\\n'`,
  '/bin/sh -ec "$1"',
  'code=$?',
  `printf '\\033]${SCRIPT_MARKER_OSC};setup;%s\\007' "$code"`,
  'if [ "$code" -ne 0 ]; then',
  `  printf '\\n\\033[2m[setup 脚本失败，退出码 %s · 按回车继续]\\033[0m' "$code"`,
  '  read -r _ || true',
  `  printf '\\n'`,
  'fi',
  `printf '\\033]${SCRIPT_MARKER_OSC};${SETUP_DONE_PAYLOAD}\\007'`
].join('\n')

/** One command (valid in sh, bash, zsh and fish) that runs the setup script before whatever follows it. */
export function setupCommand(script: string): string {
  return `/bin/sh -c ${shellQuote(SETUP_RUNNER)} tr-setup ${shellQuote(script)}`
}

/**
 * Login-shell arguments for the Run button's terminal: the `run` script and nothing after it, so the terminal's process
 * ends with the script (its exit code is the terminal's).
 */
export function runShellArgs(script: string): string[] {
  return ['-l', '-i', '-c', `/bin/sh -ec ${shellQuote(script)}`]
}
