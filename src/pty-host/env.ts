import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Variables from the app's own environment that must not leak into user shells. */
const STRIPPED = new Set([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'NODE_OPTIONS',
  'CLAUDECODE',
  // Who is calling, as Claude reports it to Anthropic (PRD §6.17): a TUI here is `cli`, a GUI session sets `wavi`
  // itself. Inherited from an SDK app or a headless parent it would bill the 5-hour window at the `sdk-*` rate.
  'CLAUDE_CODE_ENTRYPOINT'
])

/**
 * The app was started from inside a Claude Code session (a shell or tool call there sets CLAUDECODE): everything that
 * session put in the environment describes it, not the user. Passed on, a `claude` in a terminal here believes it is
 * that session's child (no transcript, the outer session's messaging socket). Only then are its markers dropped, so
 * `CLAUDE_CODE_*` settings a user exports in an ordinary terminal still reach their agents. CLAUDE_CONFIG_DIR is
 * the user's choice of config either way.
 */
function isOuterClaudeSessionVar(key: string, value: string): boolean {
  if (key === 'CLAUDE_CONFIG_DIR') return false
  if (key.startsWith('CLAUDE_')) return true
  // The Claude desktop app points its sessions at its own proxy; a `claude` here would sign in through it and fail
  // (PRD §6.17). A base URL the user set in their profile comes back from the login shell.
  if (key === 'ANTHROPIC_BASE_URL') return true
  // Claude Code's tool shells set these for themselves; a user's terminal must not inherit them.
  return key === 'AI_AGENT' || key === 'BAGGAGE' || (key === 'GIT_EDITOR' && value === 'true')
}

export function buildPtyEnv(base: NodeJS.ProcessEnv, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  const insideClaude = base.CLAUDECODE !== undefined
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || STRIPPED.has(key)) continue
    if (insideClaude && isOuterClaudeSessionVar(key, value)) continue
    env[key] = value
  }
  Object.assign(env, extra)

  const isUtf8 = (value: string | undefined) => value !== undefined && /utf-?8/i.test(value)
  if (!isUtf8(env.LANG)) env.LANG = 'en_US.UTF-8'
  if (env.LC_ALL !== undefined && !isUtf8(env.LC_ALL)) delete env.LC_ALL

  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Wavi'
  return env
}

/** Expands a leading `~`, and falls back to the home directory if the result is not an existing directory. */
export function resolveCwd(
  cwd: string,
  home: string = homedir(),
  isDirectory: (path: string) => boolean = defaultIsDirectory
): string {
  let candidate = cwd
  if (candidate === '~') candidate = home
  else if (candidate.startsWith('~/')) candidate = join(home, candidate.slice(2))
  return isAbsolute(candidate) && isDirectory(candidate) ? candidate : home
}

function defaultIsDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function resolveShell(env: Record<string, string>): { command: string; args: string[] } {
  const shell = env.SHELL && isAbsolute(env.SHELL) ? env.SHELL : '/bin/zsh'
  return { command: shell, args: ['-l'] }
}
