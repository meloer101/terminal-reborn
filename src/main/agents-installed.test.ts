import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { findOnPath, pathFromEnvOutput, userLoginPath, versionFromOutput } from './agents-installed'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))

describe('userLoginPath', () => {
  it('answers although the rc files leave a background job holding the output open', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tr-login-shell-'))
    // Stands in for a login shell whose rc file runs `something &`: the job inherits stdout and outlives the shell.
    const shell = join(dir, 'fake-shell')
    writeFileSync(shell, '#!/bin/sh\nsleep 10 &\necho PATH=/fake/bin:/usr/bin\n')
    chmodSync(shell, 0o755)
    const started = Date.now()
    try {
      expect(await userLoginPath(shell)).toBe('/fake/bin:/usr/bin')
      expect(Date.now() - started).toBeLessThan(3_000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('pathFromEnvOutput', () => {
  it('takes the last PATH= line and ignores rc-file noise', () => {
    expect(pathFromEnvOutput('Welcome!\nPATH=/usr/bin\nHOME=/Users/a\nPATH=/opt/bin:/usr/bin\n')).toBe('/opt/bin:/usr/bin')
    expect(pathFromEnvOutput('HOME=/Users/a\n')).toBeNull()
    expect(pathFromEnvOutput('PATH=\n')).toBeNull()
  })
})

describe('findOnPath', () => {
  it('looks for each agent in the absolute PATH entries only', () => {
    const files = new Set(['/Users/a/.volta/bin/claude', 'bin/codex'])
    const found = findOnPath('/usr/bin:/Users/a/.volta/bin:bin', (p) => files.has(p))
    expect(found.claude).toBe(true)
    expect(found.codex).toBe(false)
    const none = findOnPath('', () => true)
    expect(Object.values(none).some((v) => v === true)).toBe(false)
    expect(Object.values(none.adapters ?? {}).some(Boolean)).toBe(false)
  })

  it('also looks for the GUI sessions\' ACP adapters (PRD F23)', () => {
    const found = findOnPath('/opt/bin', (p) => p === '/opt/bin/amp-acp')
    expect(found.adapters).toEqual({ 'amp-acp': true })
  })

  it('looks each CLI up by its binary, not its id (Cursor Agent is cursor-agent, Qwen Code is qwen)', () => {
    const files = new Set(['/opt/bin/cursor-agent', '/opt/bin/qwen', '/opt/bin/kiro-cli'])
    const found = findOnPath('/opt/bin', (p) => files.has(p))
    expect(found).toMatchObject({ cursor: true, qwen: true, kiro: true, claude: false, opencode: false })
  })
})

describe('versionFromOutput', () => {
  it('takes the first version-looking token of what --version printed', () => {
    expect(versionFromOutput('2.1.310 (Claude Code)\n')).toBe('2.1.310')
    expect(versionFromOutput('codex-cli 0.164.0')).toBe('0.164.0')
    expect(versionFromOutput('grok 1.0.67 (2fe064390d07)')).toBe('1.0.67')
    expect(versionFromOutput('v1.4.2-beta.1')).toBe('1.4.2-beta.1')
    expect(versionFromOutput('Error: unknown option --version')).toBeNull()
  })
})
