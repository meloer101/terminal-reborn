// Finds the user's own Claude statusLine command so our relay (resources/hooks/tr-statusline.sh) can chain it
// (PRD F11: never replace it). Read-only: the user's settings files are parsed, never written (PRD §6.2).
// Resolved per launch from the session's directory, in Claude's precedence order (highest first). Managed
// settings outrank our `--settings` anyway, so a managed statusLine is simply left alone by Claude.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

export interface UserStatusLineSources {
  /** The session's working directory (absolute, or `~`-relative as the renderer stores it). */
  cwd: string
  home: string
  /** `CLAUDE_CONFIG_DIR`, when set. */
  configDir?: string
  /** File contents, or null when unreadable / missing. */
  readFile(path: string): string | null
}

/** Our own relay must never be chained into itself (a user who copied our settings would loop). */
const OWN_RELAY = 'tr-statusline.sh'
/** Env values are not meant for megabytes; a statusLine command longer than this is not one we pass on. */
const MAX_COMMAND = 16 * 1024

function expandHome(path: string, home: string): string {
  if (path === '~') return home
  return path.startsWith('~/') ? join(home, path.slice(2)) : path
}

export function settingsCandidates(sources: Pick<UserStatusLineSources, 'cwd' | 'home' | 'configDir'>): string[] {
  const cwd = expandHome(sources.cwd, sources.home)
  const configDir = sources.configDir && isAbsolute(sources.configDir) ? sources.configDir : join(sources.home, '.claude')
  const project = isAbsolute(cwd) ? [join(cwd, '.claude', 'settings.local.json'), join(cwd, '.claude', 'settings.json')] : []
  return [...project, join(configDir, 'settings.json')]
}

/**
 * The statusLine command Claude would run for this directory without us, or undefined. The first file that
 * defines `statusLine` decides, as in Claude's own merge (a scalar setting from a higher source wins whole).
 */
export function resolveUserStatusLine(sources: UserStatusLineSources): string | undefined {
  for (const path of settingsCandidates(sources)) {
    const raw = sources.readFile(path)
    if (raw === null) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }
    if (typeof parsed !== 'object' || parsed === null || !('statusLine' in parsed)) continue
    const statusLine = (parsed as { statusLine: unknown }).statusLine
    if (typeof statusLine !== 'object' || statusLine === null) return undefined
    const { type, command } = statusLine as { type?: unknown; command?: unknown }
    if (type !== 'command' || typeof command !== 'string') return undefined
    const trimmed = command.trim()
    if (trimmed === '' || trimmed.length > MAX_COMMAND || trimmed.includes(OWN_RELAY) || trimmed.includes('\0')) return undefined
    return trimmed
  }
  return undefined
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** For the PTY env: the user's statusLine for `cwd`, or '' (the relay then prints nothing). Never throws. */
export function userStatusLineFor(cwd: string): string {
  try {
    return resolveUserStatusLine({ cwd, home: homedir(), configDir: process.env.CLAUDE_CONFIG_DIR, readFile: readText }) ?? ''
  } catch {
    return ''
  }
}
