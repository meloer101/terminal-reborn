import { describe, expect, it } from 'vitest'
import { findOnPath, pathFromEnvOutput, versionFromOutput } from './agents-installed'

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
    expect(Object.values(findOnPath('', () => true)).some(Boolean)).toBe(false)
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
