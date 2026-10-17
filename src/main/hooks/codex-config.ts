// Per-launch Codex hooks (PRD §6.2, PRD §6.7). Codex has no `--settings <file>`; what it has is
// `-c key=value` config overrides, and hooks supplied that way come from the "session flags" layer:
//
//   -c 'hooks.PreToolUse=[{hooks=[{type="command",command="…",timeout=10}]}]'      (one per event)
//   -c 'hooks.state={"/<session-flags>/config.toml:pre_tool_use:0:0"={trusted_hash="sha256:…"}}'
//
// Non-managed hooks only run once their exact definition is trusted. The second override pins the hash of
// *our* definitions for this launch only, so nothing is written to `~/.codex` and
// `--dangerously-bypass-hook-trust` (which would also run the user's other untrusted hooks) is not needed.
// The hash is not computed here: Codex computes it, and `codex app-server` reports it via `hooks/list`
// (see ./codex-probe.ts), which keeps this working if Codex changes its hashing.
import { shellQuote, tomlString } from '@shared/agent-launch'

/** Codex 0.142.5 events we listen to (its `hooks/list` knows ten; the rest carry nothing the UI needs). */
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop'] as const

export type CodexHookEvent = (typeof CODEX_HOOK_EVENTS)[number]

/** Seconds. PermissionRequest outlives the app's own 120 s hold; the rest are fire-and-forget. */
const PERMISSION_TIMEOUT_S = 130
const DEFAULT_TIMEOUT_S = 10

/**
 * `sh <script>` instead of executing the script directly, so a lost executable bit cannot silently disable
 * every hook (same reasoning as the Claude settings, PRD §6.6).
 */
export function codexHookCommand(scriptPath: string, event: CodexHookEvent): string {
  return `/bin/sh ${shellQuote(scriptPath)} ${event} codex`
}

/** The `hooks.<Event>=[…]` overrides (TOML values; each becomes one `-c`). */
export function buildCodexHookOverrides(scriptPath: string): string[] {
  return CODEX_HOOK_EVENTS.map((event) => {
    const timeout = event === 'PermissionRequest' ? PERMISSION_TIMEOUT_S : DEFAULT_TIMEOUT_S
    return `hooks.${event}=[{hooks=[{type="command",command=${tomlString(codexHookCommand(scriptPath, event))},timeout=${timeout}}]}]`
  })
}

/** The `hooks.state={…}` override pinning exactly these hashes as trusted. `null` when there is nothing to trust. */
export function buildCodexTrustOverride(hashes: Readonly<Record<string, string>>): string | null {
  const entries = Object.entries(hashes)
  if (entries.length === 0) return null
  return `hooks.state={${entries.map(([key, hash]) => `${tomlString(key)}={trusted_hash=${tomlString(hash)}}`).join(',')}}`
}

interface ListedHook {
  key?: unknown
  source?: unknown
  currentHash?: unknown
}

/**
 * Picks our hooks out of a `hooks/list` result: the `sessionFlags` source is what `-c` produces, so the user's
 * own hooks (`user`), project hooks and plugins are never touched. Returns `{ key: currentHash }`.
 */
export function sessionFlagHashes(listResult: unknown): Record<string, string> {
  const data = (listResult as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return {}
  const hashes: Record<string, string> = {}
  for (const entry of data) {
    const hooks = (entry as { hooks?: unknown } | null)?.hooks
    if (!Array.isArray(hooks)) continue
    for (const hook of hooks as ListedHook[]) {
      if (hook.source !== 'sessionFlags' || typeof hook.key !== 'string' || typeof hook.currentHash !== 'string') continue
      if (/^sha256:[0-9a-f]{64}$/.test(hook.currentHash)) hashes[hook.key] = hook.currentHash
    }
  }
  return hashes
}

/** Whether `hashes` covers every event we configured (a partial result would leave some hooks untrusted and skipped). */
export function coversAllEvents(hashes: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(hashes)
  return CODEX_HOOK_EVENTS.every((event) => keys.some((key) => key.endsWith(`:${snake(event)}:0:0`)))
}

/** `PreToolUse` -> `pre_tool_use` (the event segment of a hook key). */
function snake(event: string): string {
  return event.replace(/[A-Z]/g, (c, i: number) => (i === 0 ? '' : '_') + c.toLowerCase())
}
