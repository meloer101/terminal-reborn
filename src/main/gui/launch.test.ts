import { describe, expect, it } from 'vitest'
import { exitReason, guiArgv, guiCommand, guiEnv, isImagePath, withPaths } from './launch'

describe('guiArgv', () => {
  it('Claude: the stream-json flags, resume, the hooks file, the system prompt and the model', () => {
    const argv = guiArgv({ agent: 'claude', realCwd: '/r', launch: { model: 'opus' }, resume: 'abc-1', claudeSettingsPath: '/h/settings.json', extraArgs: ['--append-system-prompt', 'x'] })
    expect(argv).toEqual([
      'claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--replay-user-messages', '--permission-prompt-tool', 'stdio', '--resume', 'abc-1', '--settings', '/h/settings.json',
      '--append-system-prompt', 'x', '--model', 'opus'
    ])
  })

  it('Claude: a saved 权限 or 计划 as --permission-mode; 询问 is its default and passes none (Figma 56)', () => {
    const mode = (launch: { permission?: 'ask' | 'accept-edits' | 'auto'; plan?: boolean }) => {
      const argv = guiArgv({ agent: 'claude', realCwd: '/r', launch })!
      const at = argv.indexOf('--permission-mode')
      return at < 0 ? null : argv[at + 1]
    }
    expect(mode({})).toBeNull()
    expect(mode({ permission: 'ask' })).toBeNull()
    expect(mode({ permission: 'accept-edits' })).toBe('acceptEdits')
    expect(mode({ permission: 'auto' })).toBe('auto')
    expect(mode({ permission: 'auto', plan: true })).toBe('plan')
  })

  it('Claude: an unsafe resume id or model is left out', () => {
    const argv = guiArgv({ agent: 'claude', realCwd: '/r', launch: { model: '--danger' }, resume: '../x' })!
    expect(argv).not.toContain('--resume')
    expect(argv).not.toContain('--model')
  })

  it('Codex: global -c overrides (no update check, this folder trusted) before app-server', () => {
    expect(guiArgv({ agent: 'codex', realCwd: '/r/a"b', launch: {}, extraArgs: ['-c', 'developer_instructions="x"'] })).toEqual([
      'codex', '-c', 'check_for_update_on_startup=false', '-c', 'projects={"/r/a\\"b"={trust_level="trusted"}}', '-c', 'developer_instructions="x"', 'app-server'
    ])
  })

  it('ACP: the agent binary in ACP mode, or its adapter', () => {
    // Grok's permission mode is a launch argument (Figma 56): 询问 / 接受编辑 → default, 自动 → auto, 计划 → plan.
    expect(guiArgv({ agent: 'grok', realCwd: '/r', launch: {} })).toEqual(['grok', '--permission-mode', 'default', 'agent', 'stdio'])
    expect(guiArgv({ agent: 'grok', realCwd: '/r', launch: { permission: 'accept-edits' } })).toEqual(['grok', '--permission-mode', 'default', 'agent', 'stdio'])
    expect(guiArgv({ agent: 'grok', realCwd: '/r', launch: { permission: 'auto' } })).toEqual(['grok', '--permission-mode', 'auto', 'agent', 'stdio'])
    expect(guiArgv({ agent: 'grok', realCwd: '/r', launch: { permission: 'auto', plan: true } })).toEqual(['grok', '--permission-mode', 'plan', 'agent', 'stdio'])
    expect(guiArgv({ agent: 'gemini', realCwd: '/r', launch: { permission: 'auto' } })).toEqual(['gemini', '--acp'])
    expect(guiArgv({ agent: 'pi', realCwd: '/r', launch: {} })).toEqual(['pi-acp'])
    expect(guiArgv({ agent: 'crush', realCwd: '/r', launch: {} })).toBeNull()
    expect(guiEnv('droid')).toMatchObject({ DROID_DISABLE_AUTO_UPDATE: 'true' })
  })
})

describe('guiCommand', () => {
  it('runs the binary directly, or through sh with the PATH prefix first', () => {
    expect(guiCommand(['claude', '-p'])).toEqual({ command: 'claude', args: ['-p'] })
    expect(guiCommand(['claude', "it's"], '/u/bin')).toEqual({ command: '/bin/sh', args: ['-c', `PATH='/u/bin':"$PATH"; export PATH; exec 'claude' 'it'\\''s'`] })
  })
})

describe('attachments and exits', () => {
  it('tells images from other files and appends paths', () => {
    expect(isImagePath('/a/b.PNG')).toBe(true)
    expect(isImagePath('/a/b.heic')).toBe(false)
    expect(withPaths('look', ['/a.txt', '/b.md'])).toBe('look\n\n/a.txt\n/b.md')
    expect(withPaths('', ['/a.txt'])).toBe('/a.txt')
    expect(withPaths('x', [])).toBe('x')
  })

  it('says why the process ended', () => {
    expect(exitReason({ exitCode: 127, stderr: 'zsh: command not found: grok' }, 'grok')).toBe('找不到 grok')
    expect(exitReason({ exitCode: 1, stderr: 'warn\nError: not logged in\n' }, 'codex')).toBe('codex 退出了（退出码 1）：warn Error: not logged in')
    expect(exitReason({ exitCode: 0, signal: 15, stderr: '' }, 'claude')).toBe('claude 被结束了')
  })
})
