import { describe, expect, it } from 'vitest'
import { parseAckCount, parseSessionId, parseSize, parseSpawnOptions, parseWriteData } from './validate'

const base = { sessionId: 's-1', cwd: '/tmp', cols: 80, rows: 24 }

describe('parseSpawnOptions', () => {
  it('accepts a minimal payload', () => {
    expect(parseSpawnOptions(base)).toEqual(base)
  })

  it('accepts command, args and env', () => {
    const parsed = parseSpawnOptions({ ...base, command: 'claude', args: ['--help'], env: { FOO: 'bar' } })
    expect(parsed.command).toBe('claude')
    expect(parsed.args).toEqual(['--help'])
    expect(parsed.env).toEqual({ FOO: 'bar' })
  })

  it('accepts the setup and run scripts, never next to a command', () => {
    expect(parseSpawnOptions({ ...base, agent: 'claude', script: 'setup' }).script).toBe('setup')
    expect(parseSpawnOptions({ ...base, script: 'run' }).script).toBe('run')
    expect(() => parseSpawnOptions({ ...base, script: 'archive' })).toThrow()
    expect(() => parseSpawnOptions({ ...base, script: 'run', command: '/bin/sh' })).toThrow()
  })

  it('accepts a known agent kind and rejects others', () => {
    expect(parseSpawnOptions({ ...base, agent: 'codex' }).agent).toBe('codex')
    expect(() => parseSpawnOptions({ ...base, agent: 'bash' })).toThrow()
  })

  it('accepts a resume id and rejects ones that could be read as an option or a shell word', () => {
    expect(parseSpawnOptions({ ...base, agent: 'claude', resumeAgentSessionId: '3f2a9c1e-7b4d-4e08-9a55-0c1d2e3f4a5b' }).resumeAgentSessionId).toBe(
      '3f2a9c1e-7b4d-4e08-9a55-0c1d2e3f4a5b'
    )
    for (const bad of ['', '--model', "a'b", 'a b', 5, 'a'.repeat(129)]) {
      expect(() => parseSpawnOptions({ ...base, resumeAgentSessionId: bad })).toThrow()
    }
  })

  it.each([
    ['null', null],
    ['non-object', 'x'],
    ['bad id', { ...base, sessionId: '../etc' }],
    ['non-string cwd', { ...base, cwd: 1 }],
    ['zero cols', { ...base, cols: 0 }],
    ['fractional rows', { ...base, rows: 2.5 }],
    ['huge cols', { ...base, cols: 100000 }],
    ['empty command', { ...base, command: '' }],
    ['non-string arg', { ...base, args: [1] }],
    ['array env', { ...base, env: ['a'] }],
    ['bad env key', { ...base, env: { 'A=B': '1' } }],
    ['non-string env value', { ...base, env: { A: 1 } }],
    ['nul byte', { ...base, command: 'a\0b' }]
  ])('rejects %s', (_name, payload) => {
    expect(() => parseSpawnOptions(payload)).toThrow()
  })
})

describe('other payloads', () => {
  it('validates session ids, sizes, writes and acks', () => {
    expect(parseSessionId('abc-123')).toBe('abc-123')
    expect(() => parseSessionId('')).toThrow()
    expect(() => parseSessionId(5)).toThrow()
    expect(parseSize(80, 24)).toEqual({ cols: 80, rows: 24 })
    expect(() => parseSize(80, -1)).toThrow()
    expect(parseWriteData('ls\r')).toBe('ls\r')
    expect(() => parseWriteData(new ArrayBuffer(1))).toThrow()
    expect(parseAckCount(10.9)).toBe(10)
    expect(() => parseAckCount(-1)).toThrow()
    expect(() => parseAckCount(Number.NaN)).toThrow()
  })
})
