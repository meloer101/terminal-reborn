import { describe, expect, it } from 'vitest'
import { agentArgv, agentShellArgs, shellQuote } from './agent-launch'

describe('shellQuote', () => {
  it('wraps in single quotes and escapes embedded ones', () => {
    expect(shellQuote('a b $HOME "q"')).toBe(`'a b $HOME "q"'`)
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })
})

describe('agentArgv', () => {
  it('starts claude with no extra flags', () => {
    expect(agentArgv('claude', '/tmp/x')).toEqual(['claude'])
  })

  it('injects the hooks-only settings file for claude with --settings', () => {
    expect(agentArgv('claude', '/tmp/x', { claudeSettingsPath: '/tmp/tr-hooks-ab/claude-settings.json' })).toEqual([
      'claude',
      '--settings',
      '/tmp/tr-hooks-ab/claude-settings.json'
    ])
  })

  it('does not pass claude settings to codex', () => {
    expect(agentArgv('codex', '/tmp/x', { claudeSettingsPath: '/s.json' })).not.toContain('--settings')
  })

  it('pre-trusts the codex directory per launch and skips the update prompt', () => {
    expect(agentArgv('codex', '/Users/dev/code/acme')).toEqual([
      'codex',
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      'projects={"/Users/dev/code/acme"={trust_level="trusted"}}'
    ])
  })

  it('escapes quotes and backslashes in the TOML key', () => {
    expect(agentArgv('codex', '/a "b"\\c')[4]).toBe('projects={"/a \\"b\\"\\\\c"={trust_level="trusted"}}')
  })
})

describe('resuming a conversation', () => {
  const id = '3f2a9c1e-7b4d-4e08-9a55-0c1d2e3f4a5b'

  it('claude: --resume <id> next to the hooks settings', () => {
    expect(agentArgv('claude', '/tmp/x', { resumeAgentSessionId: id })).toEqual(['claude', '--resume', id])
    expect(agentArgv('claude', '/tmp/x', { resumeAgentSessionId: id, claudeSettingsPath: '/s.json' })).toEqual([
      'claude',
      '--resume',
      id,
      '--settings',
      '/s.json'
    ])
  })

  it('codex: the resume subcommand comes first, then the per-launch -c overrides', () => {
    expect(agentArgv('codex', '/a', { resumeAgentSessionId: id, codexConfig: ['hooks.x=1'] })).toEqual([
      'codex',
      'resume',
      id,
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      'projects={"/a"={trust_level="trusted"}}',
      '-c',
      'hooks.x=1'
    ])
  })

  it('does not resume without an id, or with an id that is not a plain token', () => {
    expect(agentArgv('claude', '/a', {})).toEqual(['claude'])
    expect(agentArgv('claude', '/a', { resumeAgentSessionId: '' })).toEqual(['claude'])
    expect(agentArgv('claude', '/a', { resumeAgentSessionId: '--dangerously-skip-permissions' })).toEqual(['claude'])
    expect(agentArgv('codex', '/a', { resumeAgentSessionId: '$(reboot)' })).not.toContain('resume')
  })

  it('shell-quotes the id as one word', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { resumeAgentSessionId: id })[3]).toBe(`'claude' '--resume' '${id}'; exec '/bin/zsh' -l`)
    expect(agentShellArgs('codex', '/a b', '/bin/zsh', { resumeAgentSessionId: id })[3]).toBe(
      `'codex' 'resume' '${id}' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a b"={trust_level="trusted"}}'; exec '/bin/zsh' -l`
    )
  })

  it('a plain shell session ignores the id', () => {
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh', { resumeAgentSessionId: id })).toEqual(['-l'])
  })
})

describe('agentShellArgs', () => {
  it('is a plain login shell for shell sessions', () => {
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh')).toEqual(['-l'])
  })

  it('runs the agent, then execs a login shell', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh')).toEqual(['-l', '-i', '-c', "'claude'; exec '/bin/zsh' -l"])
  })

  it('quotes the settings path as one shell word, spaces and quotes included', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { claudeSettingsPath: "/var/it's here/s.json" })[3]).toBe(
      `'claude' '--settings' '/var/it'\\''s here/s.json'; exec '/bin/zsh' -l`
    )
  })

  it('quotes every codex argument as one shell word', () => {
    expect(agentShellArgs('codex', '/a b', '/bin/zsh')[3]).toBe(
      `'codex' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a b"={trust_level="trusted"}}'; exec '/bin/zsh' -l`
    )
  })

  it('keeps codex hook overrides intact through the shell (TOML quotes and the single-quoted script path)', () => {
    const override = `hooks.Stop=[{hooks=[{type="command",command="/bin/sh '/a b/tr-hook.sh' Stop codex"}]}]`
    expect(agentShellArgs('codex', '/a', '/bin/zsh', { codexConfig: [override] })[3]).toBe(
      `'codex' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a"={trust_level="trusted"}}' '-c' ` +
        `'hooks.Stop=[{hooks=[{type="command",command="/bin/sh '\\''/a b/tr-hook.sh'\\'' Stop codex"}]}]'; exec '/bin/zsh' -l`
    )
  })
})
