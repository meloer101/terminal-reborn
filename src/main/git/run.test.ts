// The process runner every git and gh call goes through: what callers read when a command fails, stops or floods.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: () => {} } }))
const { gitText, lastLines, runGit, runProcess } = await import('./run')

const shell = (script: string, options: { timeout?: number; maxStdout?: number; input?: string } = {}) =>
  runProcess('/bin/sh', ['-c', script], { cwd: '/', env: process.env, timeout: options.timeout ?? 5_000, ...options })

describe('runProcess', () => {
  it('returns the exit code and both outputs, feeding stdin when given', async () => {
    expect(await shell('cat; echo err >&2; exit 3', { input: 'hello' })).toEqual({ code: 3, stdout: 'hello', stderr: 'err\n' })
  })

  it('stops a command that runs too long or prints too much, and says why (code -1)', async () => {
    const slow = await shell('sleep 5', { timeout: 200 })
    expect(slow.code).toBe(-1)
    expect(slow.stderr).toContain('秒没有结束，已停止')
    const loud = await shell('yes', { maxStdout: 1024 * 1024 })
    expect(loud.code).toBe(-1)
    expect(loud.stderr).toContain('输出超过 1 MiB，已停止')
  })

  it('never rejects when the program is not there', async () => {
    const missing = await runProcess('/no/such/program', [], { cwd: '/', env: process.env, timeout: 1_000 })
    expect(missing.code).toBe(-1)
    expect(missing.stderr).toContain('ENOENT')
  })
})

describe('git', () => {
  it('runs git without a credential prompt, and gitText rejects with its last lines unless the code is allowed', async () => {
    expect((await runGit('/', ['--version'])).stdout).toMatch(/^git version/)
    await expect(gitText('/', ['rev-parse', '--git-dir'])).rejects.toThrow(/not a git repository/)
    await expect(gitText('/', ['rev-parse', '--git-dir'], { ok: [128] })).resolves.toBe('')
    await expect(gitText('/', ['rev-parse', '--git-dir'], { message: () => 'custom' })).rejects.toThrow('custom')
    expect(lastLines('a\nb\nc\nd', 2)).toBe('c d')
  })
})
