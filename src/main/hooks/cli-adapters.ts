// Per-launch hooks for Gemini CLI and Qwen Code (ROADMAP 7 ②): both read a "system defaults" settings file named by an
// environment variable, merged *under* the user's own settings with hook arrays concatenated, so the user's hooks keep
// running and nothing under their home is written. The variable replaces the CLI's machine-wide defaults file, so an
// administrator's file (if there is one) is read and carried over into ours.
// Gemini drops every hook in an untrusted folder; `--skip-trust` trusts this launch only (GEMINI_CLI_TRUST_WORKSPACE,
// no write), the same per-launch trust Codex gets with `-c projects=…`. Qwen does not gate system-scope hooks on trust.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { shellQuote } from '@shared/agent-launch'

type Rec = Record<string, unknown>
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)

export const GEMINI_HOOK_EVENTS = ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'Notification', 'AfterAgent', 'SessionEnd'] as const
export const QWEN_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd'
] as const

export type SettingsCli = 'gemini' | 'qwen'

/** The variables that point at each CLI's system settings and defaults files, and their macOS default folder. */
const CLI_PATHS: Record<SettingsCli, { defaults: string; settings: string; dir: string; file: string }> = {
  gemini: {
    defaults: 'GEMINI_CLI_SYSTEM_DEFAULTS_PATH',
    settings: 'GEMINI_CLI_SYSTEM_SETTINGS_PATH',
    dir: '/Library/Application Support/GeminiCli',
    file: 'gemini-defaults.json'
  },
  qwen: {
    defaults: 'QWEN_CODE_SYSTEM_DEFAULTS_PATH',
    settings: 'QWEN_CODE_SYSTEM_SETTINGS_PATH',
    dir: '/Library/Application Support/QwenCode',
    file: 'qwen-defaults.json'
  }
}

export function defaultsVariable(cli: SettingsCli): string {
  return CLI_PATHS[cli].defaults
}

export function defaultsFileName(cli: SettingsCli): string {
  return CLI_PATHS[cli].file
}

/** The machine-wide defaults file the CLI would read without our variable (the user's own override of it first). */
export function adminDefaultsPath(cli: SettingsCli, env: Readonly<Record<string, string | undefined>>): string {
  const paths = CLI_PATHS[cli]
  const own = env[paths.defaults]
  if (own) return own
  const settings = env[paths.settings]
  return join(settings ? dirname(settings) : paths.dir, 'system-defaults.json')
}

/** The administrator's defaults (JSON, `//` comments allowed), or null when there is none or it cannot be read. */
export function readAdminDefaults(path: string, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): Rec | null {
  let text: string
  try {
    text = read(path)
  } catch {
    return null
  }
  try {
    const value: unknown = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
    return isRec(value) ? value : null
  } catch {
    return null
  }
}

const command = (script: string, event: string, cli: SettingsCli): string => `/bin/sh ${shellQuote(script)} ${event} ${cli}`

/**
 * The defaults file: the administrator's settings with our hook definitions appended to their hook arrays.
 * Timeouts: Gemini counts milliseconds, Qwen seconds. Matchers: `*` (every tool and every lifecycle event).
 */
export function buildCliDefaults(cli: SettingsCli, script: string, admin: Rec | null): Rec {
  const events: readonly string[] = cli === 'gemini' ? GEMINI_HOOK_EVENTS : QWEN_HOOK_EVENTS
  const timeout = cli === 'gemini' ? 10_000 : 10
  const theirs = admin && isRec(admin.hooks) ? admin.hooks : {}
  const hooks: Rec = { ...theirs }
  for (const event of events) {
    const existing = Array.isArray(theirs[event]) ? (theirs[event] as unknown[]) : []
    // Gemini names its hooks (in /hooks); Qwen's schema has no `name`.
    const hook = { type: 'command', ...(cli === 'gemini' ? { name: 'wavi' } : {}), command: command(script, event, cli), timeout }
    hooks[event] = [...existing, { matcher: '*', hooks: [hook] }]
  }
  return { ...(admin ?? {}), hooks }
}

/** Pi's extension (resources/hooks/wavi-pi.js) sits next to the hook relay. */
export function piExtensionPath(hookScriptPath: string): string {
  return join(dirname(hookScriptPath), 'wavi-pi.js')
}

export interface CliAdapterLaunch {
  env: Record<string, string>
  args: string[]
}

/**
 * What a Gemini / Qwen / Pi launch adds: the defaults file (written into Wavi's own hook directory, 0600) and its
 * variable, or Pi's `-e <extension>`. Null when the file could not be written (the session then runs on titles).
 */
export function cliAdapterLaunch(
  agent: 'gemini' | 'qwen' | 'pi',
  dir: string,
  hookScriptPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): CliAdapterLaunch | null {
  if (agent === 'pi') return { env: {}, args: ['-e', piExtensionPath(hookScriptPath)] }
  const path = join(dir, defaultsFileName(agent))
  const content = JSON.stringify(buildCliDefaults(agent, hookScriptPath, readAdminDefaults(adminDefaultsPath(agent, env))), null, 2)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    writeFileSync(path, content, { mode: 0o600 })
    chmodSync(path, 0o600)
  } catch (error) {
    console.error(`[hooks] could not write the ${agent} defaults file:`, error)
    return null
  }
  return { env: { [defaultsVariable(agent)]: path }, args: agent === 'gemini' ? ['--skip-trust'] : [] }
}
