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

  it('pre-trusts the codex directory per launch and skips the update prompt', () => {
    expect(agentArgv('codex', '/Users/m/code/acme')).toEqual([
      'codex',
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      'projects={"/Users/m/code/acme"={trust_level="trusted"}}'
    ])
  })

  it('escapes quotes and backslashes in the TOML key', () => {
    expect(agentArgv('codex', '/a "b"\\c')[4]).toBe('projects={"/a \\"b\\"\\\\c"={trust_level="trusted"}}')
  })
})

describe('agentShellArgs', () => {
  it('is a plain login shell for shell sessions', () => {
    expect(agentShellArgs('shell', '/tmp', '/bin/zsh')).toEqual(['-l'])
  })

  it('runs the agent, then execs a login shell', () => {
    expect(agentShellArgs('claude', '/tmp', '/bin/zsh')).toEqual(['-l', '-i', '-c', "'claude'; exec '/bin/zsh' -l"])
  })

  it('quotes every codex argument as one shell word', () => {
    expect(agentShellArgs('codex', '/a b', '/bin/zsh')[3]).toBe(
      `'codex' '-c' 'check_for_update_on_startup=false' '-c' 'projects={"/a b"={trust_level="trusted"}}'; exec '/bin/zsh' -l`
    )
  })
})
