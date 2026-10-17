// The hooks-only settings file handed to Claude with `--settings <file>` (PRD §6.2). Generated once
// per app run; the user's own settings (and Orca's / plugins' hooks) are untouched and keep running,
// because Claude merges hook arrays across settings sources (PRD §6.6).
import { shellQuote } from '@shared/agent-launch'

/** The Claude hook events the app listens to. */
export const CLAUDE_HOOK_EVENTS = [
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

export type ClaudeHookEvent = (typeof CLAUDE_HOOK_EVENTS)[number]

export interface ClaudeHookSettings {
  hooks: Record<string, Array<{ hooks: Array<{ type: 'command'; command: string; timeout: number }> }>>
}

/** Seconds. PermissionRequest outlives the app's own 120 s hold; the rest are fire-and-forget. */
const PERMISSION_TIMEOUT_S = 130
const DEFAULT_TIMEOUT_S = 10

/**
 * `sh <script>` instead of executing the script directly, so a lost executable bit (zip
 * extraction, asar unpack) cannot silently disable every hook (spike §1: status 126).
 */
export function hookCommand(scriptPath: string, event: ClaudeHookEvent, agent = 'claude'): string {
  return `/bin/sh ${shellQuote(scriptPath)} ${event} ${agent}`
}

export function buildClaudeHookSettings(scriptPath: string): ClaudeHookSettings {
  const hooks: ClaudeHookSettings['hooks'] = {}
  for (const event of CLAUDE_HOOK_EVENTS) {
    hooks[event] = [
      {
        hooks: [
          {
            type: 'command',
            command: hookCommand(scriptPath, event),
            timeout: event === 'PermissionRequest' ? PERMISSION_TIMEOUT_S : DEFAULT_TIMEOUT_S
          }
        ]
      }
    ]
  }
  return { hooks }
}
