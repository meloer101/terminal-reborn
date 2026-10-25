import { describe, expect, it } from 'vitest'
import { agentArgv, agentShellArgs, CONTINUE_LATEST, parseAgentMarker, shellQuote } from './agent-launch'

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

  it('adds the dispatch MCP config, a model and the first task after -- (PRD F21)', () => {
    expect(agentArgv('claude', '/tmp/x', { claudeSettingsPath: '/s.json', mcpConfigPath: '/m.json', model: 'opus', initialPrompt: '-p mcp do it' })).toEqual([
      'claude',
      '--settings',
      '/s.json',
      '--mcp-config',
      '/m.json',
      '--model',
      'opus',
      '--',
      '-p mcp do it'
    ])
    expect(agentArgv('codex', '/tmp/x', { model: 'gpt-5-codex', initialPrompt: 'do it' }).slice(-4)).toEqual(['-m', 'gpt-5-codex', '--', 'do it'])
  })

  it('never resends the first task when resuming, and drops a model that is not a name', () => {
    const id = '3f2a9c1e-7b4d-4e08-9a55-0c1d2e3f4a5b'
    expect(agentArgv('claude', '/tmp/x', { resumeAgentSessionId: id, initialPrompt: 'again', model: '--evil' })).toEqual(['claude', '--resume', id])
  })

  it('escapes quotes and backslashes in the TOML key', () => {
    expect(agentArgv('codex', '/a "b"\\c')[4]).toBe('projects={"/a \\"b\\"\\\\c"={trust_level="trusted"}}')
  })
})

/** The launch script around an agent command line (see agentShellArgs). */
const script = (kind: 'claude' | 'codex', line: string, shell = '/bin/zsh') =>
  `if command -v ${kind} >/dev/null 2>&1; then ${line}; printf '\\033]7771;exit;%s\\007' "$?"; ` +
  `else printf '\\033]7771;missing\\007'; fi; exec '${shell}' -l`

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
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { resumeAgentSessionId: id })[3]).toBe(script('claude', `'claude' '--resume' '${id}'`))
    expect(agentShellArgs('codex', '/a b', '/bin/zsh', { resumeAgentSessionId: id })[3]).toBe(
      script('codex', `'codex' 'resume' '${id}' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a b"={trust_level="trusted"}}'`)
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

  it('runs `before` (the setup script) first, for agents and plain shells alike', () => {
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh', { before: 'make setup' })).toEqual(['-l', '-i', '-c', "make setup; exec '/bin/zsh' -l"])
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { before: 'make setup' })[3]).toBe(`make setup; ${script('claude', "'claude'")}`)
  })

  it('runs the agent, reports how it ended, then execs a login shell', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh')).toEqual(['-l', '-i', '-c', script('claude', "'claude'")])
  })

  it('checks that the CLI exists in the same login shell and reports a missing one', () => {
    const line = agentShellArgs('codex', '/tmp', '/bin/zsh')[3] ?? ''
    expect(line).toContain('command -v codex >/dev/null 2>&1')
    expect(line).toContain(`printf '\\033]7771;missing\\007'`)
  })

  it('uses fish syntax for fish login shells', () => {
    const line = agentShellArgs('claude', '/tmp', '/opt/homebrew/bin/fish')[3] ?? ''
    expect(line).toBe(
      `if command -v claude >/dev/null 2>&1; 'claude'; printf '\\033]7771;exit;%s\\007' $status; else; printf '\\033]7771;missing\\007'; end; exec '/opt/homebrew/bin/fish' -l`
    )
  })

  it('quotes the settings path as one shell word, spaces and quotes included', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh', { claudeSettingsPath: "/var/it's here/s.json" })[3]).toBe(
      script('claude', `'claude' '--settings' '/var/it'\\''s here/s.json'`)
    )
  })

  it('quotes every codex argument as one shell word', () => {
    expect(agentShellArgs('codex', '/a b', '/bin/zsh')[3]).toBe(
      script('codex', `'codex' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a b"={trust_level="trusted"}}'`)
    )
  })

  it('keeps codex hook overrides intact through the shell (TOML quotes and the single-quoted script path)', () => {
    const override = `hooks.Stop=[{hooks=[{type="command",command="/bin/sh '/a b/tr-hook.sh' Stop codex"}]}]`
    expect(agentShellArgs('codex', '/a', '/bin/zsh', { codexConfig: [override] })[3]).toBe(
      script(
        'codex',
        `'codex' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a"={trust_level="trusted"}}' '-c' ` +
          `'hooks.Stop=[{hooks=[{type="command",command="/bin/sh '\\''/a b/tr-hook.sh'\\'' Stop codex"}]}]'`
      )
    )
  })
})

describe('parseAgentMarker', () => {
  it('reads exit codes and the missing marker', () => {
    expect(parseAgentMarker('exit;0')).toEqual({ type: 'exit', code: 0 })
    expect(parseAgentMarker('exit;130')).toEqual({ type: 'exit', code: 130 })
    expect(parseAgentMarker('missing')).toEqual({ type: 'missing' })
  })

  it('ignores anything else', () => {
    expect(parseAgentMarker('exit;')).toBeNull()
    expect(parseAgentMarker('exit;x')).toBeNull()
    expect(parseAgentMarker('')).toBeNull()
  })
})

describe('other agent CLIs (agents.ts rows)', () => {
  it('passes the first message the way each CLI keeps its TUI open', () => {
    expect(agentArgv('opencode', '/w', { initialPrompt: 'fix it' })).toEqual(['opencode', '--prompt', 'fix it'])
    expect(agentArgv('qwen', '/w', { initialPrompt: 'fix it' })).toEqual(['qwen', '--prompt-interactive', 'fix it'])
    expect(agentArgv('pi', '/w', { initialPrompt: 'fix it' })).toEqual(['pi', 'fix it'])
    expect(agentArgv('grok', '/w', { initialPrompt: '--help me' })).toEqual(['grok', '--', '--help me'])
    // Kimi takes no prompt argument: the message is not put on the command line.
    expect(agentArgv('kimi', '/w', { initialPrompt: 'fix it' })).toEqual(['kimi'])
  })

  it('adds the adapter arguments, the fixed subcommand and the model', () => {
    expect(agentArgv('gemini', '/w', { extraArgs: ['--skip-trust'], model: 'gemini-3-pro' })).toEqual(['gemini', '--skip-trust', '--model', 'gemini-3-pro'])
    expect(agentArgv('pi', '/w', { extraArgs: ['-e', '/r/wavi-pi.js'] })).toEqual(['pi', '-e', '/r/wavi-pi.js'])
    expect(agentArgv('kiro', '/w')).toEqual(['kiro-cli', 'chat', '--tui'])
    // OpenCode 2 has no root --model: the model is dropped rather than passed as a stray flag.
    expect(agentArgv('opencode', '/w', { model: 'x/y' })).toEqual(['opencode'])
  })

  it('resumes by id, or continues the latest conversation for a session without a real id', () => {
    expect(agentArgv('gemini', '/w', { resumeAgentSessionId: 'abc-1', initialPrompt: 'x' })).toEqual(['gemini', '--resume', 'abc-1'])
    expect(agentArgv('copilot', '/w', { resumeAgentSessionId: 'abc-1' })).toEqual(['copilot', '--resume=abc-1'])
    expect(agentArgv('opencode', '/w', { resumeAgentSessionId: CONTINUE_LATEST })).toEqual(['opencode', '--continue'])
    expect(agentArgv('goose', '/w', { resumeAgentSessionId: CONTINUE_LATEST })).toEqual(['goose', 'session'])
  })

  it('checks for the CLI by its binary, not its id', () => {
    const script = agentShellArgs('cursor', '/w', '/bin/zsh')[3] ?? ''
    expect(script).toContain('command -v cursor-agent >/dev/null 2>&1')
    expect(script).toContain(`'cursor-agent'`)
  })
})
