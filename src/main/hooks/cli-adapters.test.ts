import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adminDefaultsPath, buildCliDefaults, cliAdapterLaunch, readAdminDefaults } from './cli-adapters'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Gemini / Qwen defaults file', () => {
  it("appends Wavi's hooks to the administrator's and keeps their other settings", () => {
    const admin = { general: { vimMode: true }, hooks: { BeforeTool: [{ matcher: 'x', hooks: [{ type: 'command', command: 'audit' }] }] } }
    const file = buildCliDefaults('gemini', '/r/tr-hook.sh', admin) as { general: unknown; hooks: Record<string, Array<{ hooks: Array<{ command: string; timeout: number }> }>> }
    expect(file.general).toEqual({ vimMode: true })
    expect(file.hooks.BeforeTool).toHaveLength(2)
    expect(file.hooks.BeforeTool?.[0]?.hooks[0]?.command).toBe('audit')
    expect(file.hooks.BeforeTool?.[1]?.hooks[0]).toMatchObject({ command: `/bin/sh '/r/tr-hook.sh' BeforeTool gemini`, timeout: 10_000 })
    expect(Object.keys(file.hooks)).toEqual(expect.arrayContaining(['SessionStart', 'BeforeAgent', 'AfterAgent', 'Notification']))
  })

  it("uses Qwen's event names and its seconds", () => {
    const file = buildCliDefaults('qwen', '/r/tr-hook.sh', null) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> }
    expect(Object.keys(file.hooks)).toEqual(expect.arrayContaining(['PreToolUse', 'PermissionRequest', 'Stop']))
    expect(file.hooks.Stop?.[0]?.hooks[0]).toEqual({ type: 'command', command: `/bin/sh '/r/tr-hook.sh' Stop qwen`, timeout: 10 })
  })

  it('finds the machine-wide defaults the variable would replace (the user’s own variable first)', () => {
    expect(adminDefaultsPath('gemini', {})).toBe('/Library/Application Support/GeminiCli/system-defaults.json')
    expect(adminDefaultsPath('qwen', { QWEN_CODE_SYSTEM_SETTINGS_PATH: '/etc/q/settings.json' })).toBe('/etc/q/system-defaults.json')
    expect(adminDefaultsPath('gemini', { GEMINI_CLI_SYSTEM_DEFAULTS_PATH: '/mine.json' })).toBe('/mine.json')
    expect(readAdminDefaults('/x', () => '// note\n{"a":1}')).toEqual({ a: 1 })
    expect(readAdminDefaults('/x', () => 'not json')).toBeNull()
    expect(
      readAdminDefaults('/x', () => {
        throw new Error('ENOENT')
      })
    ).toBeNull()
  })

  it('writes the file in Wavi’s own directory (0600) and trusts only Gemini’s launch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wavi-cli-'))
    dirs.push(dir)
    const gemini = cliAdapterLaunch('gemini', dir, '/r/tr-hook.sh', {})
    expect(gemini?.args).toEqual(['--skip-trust'])
    const path = gemini?.env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH ?? ''
    expect(path.startsWith(dir)).toBe(true)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(path, 'utf8')).hooks.AfterAgent).toHaveLength(1)
    expect(cliAdapterLaunch('qwen', dir, '/r/tr-hook.sh', {})?.args).toEqual([])
    expect(cliAdapterLaunch('pi', dir, '/r/tr-hook.sh', {})).toEqual({ env: {}, args: ['-e', '/r/wavi-pi.js'] })
  })
})
