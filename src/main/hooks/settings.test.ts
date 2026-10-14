import { describe, expect, it } from 'vitest'
import { buildClaudeHookSettings, CLAUDE_HOOK_EVENTS, hookCommand } from './settings'

const script = '/Applications/Terminal Reborn.app/Contents/Resources/hooks/tr-hook.sh'

describe('buildClaudeHookSettings', () => {
  const settings = buildClaudeHookSettings(script)

  it('registers exactly the events the bridge understands, hooks only', () => {
    expect(Object.keys(settings)).toEqual(['hooks'])
    expect(Object.keys(settings.hooks)).toEqual([...CLAUDE_HOOK_EVENTS])
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd']) {
      expect(settings.hooks[event]).toBeDefined()
    }
  })

  it('runs the relay through /bin/sh with the quoted script path, event and agent', () => {
    expect(settings.hooks.Stop?.[0]?.hooks[0]?.command).toBe(`/bin/sh '${script}' Stop claude`)
    expect(hookCommand("/a/it's/tr-hook.sh", 'PreToolUse')).toBe(`/bin/sh '/a/it'\\''s/tr-hook.sh' PreToolUse claude`)
  })

  it('gives only PermissionRequest a long timeout, longer than the app-side 120 s hold', () => {
    for (const event of CLAUDE_HOOK_EVENTS) {
      const timeout = settings.hooks[event]?.[0]?.hooks[0]?.timeout ?? 0
      if (event === 'PermissionRequest') expect(timeout).toBeGreaterThan(120)
      else expect(timeout).toBeLessThanOrEqual(10)
    }
  })

  it('has no matcher, so tool hooks fire for every tool', () => {
    expect(JSON.stringify(settings)).not.toContain('matcher')
  })
})
